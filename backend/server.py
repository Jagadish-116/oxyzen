import os
import sys
import json
import time
import asyncio
import logging
from typing import Optional, Dict, Any, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, Path, Header, Response, Request, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
import aiohttp
import uvicorn

# Include backend path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from services.db_service import (
    init_db, toggle_like, get_likes, get_liked_ids,
    create_playlist, get_playlists, get_playlist_details,
    add_track_to_playlist, remove_track_from_playlist, delete_playlist,
    add_to_history, get_history, clear_history,
    save_preference, get_preference, get_user_listening_profile,
    get_user_profile, save_user_profile
)
from services.music_service import (
    get_search_suggestions, search_music, resolve_stream_info, resolve_stream_info_async,
    get_vibe_recommendations, get_explore_feed, format_duration,
    get_personalized_adaptive_sections, get_mood_categories, get_mood_feed
)
from services.lyrics_service import get_lyrics
from services.sync_service import sync_manager

logger = logging.getLogger("oxyzen_server")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing Oxyzen Database & Audio Engine...")
    init_db()
    logger.info("Oxyzen Ready. The Luxury Music Experience is Online.")
    yield
    # Shutdown
    logger.info("Oxyzen shutting down.")

app = FastAPI(title="OXYZEN - Pure Unchained Music Engine", version="1.0.0", lifespan=lifespan)

# Allow all origins for seamless web / mobile access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- SEARCH & SUGGESTIONS ----------------- #

@app.get("/api/suggestions")
async def api_suggestions(q: str = Query(..., min_length=1)):
    suggestions = await asyncio.to_thread(get_search_suggestions, q)
    return {"query": q, "suggestions": suggestions}

@app.get("/api/search")
async def api_search(
    q: str = Query(..., min_length=1),
    filter: Optional[str] = Query(None, description="songs, albums, artists, playlists, videos"),
    limit: int = Query(50, ge=1, le=100)
):
    results = await asyncio.to_thread(search_music, query=q, filter_type=filter, limit=limit)
    return results

# ----------------- EXPLORE & RECOMMENDATIONS ----------------- #

@app.get("/api/explore")
async def api_explore():
    profile = get_user_listening_profile()
    feed = await asyncio.to_thread(get_explore_feed, profile=profile)
    return feed

@app.get("/api/personalized")
async def api_personalized():
    profile = get_user_listening_profile()
    sections = await asyncio.to_thread(get_personalized_adaptive_sections, profile)
    return {
        "profile": {
            "total_plays": profile.get("total_plays", 0),
            "total_likes": profile.get("total_likes", 0),
            "top_artists": profile.get("top_history_artists", [])[:5]
        },
        "sections": sections
    }

# ----------------- USER PROFILE & PREFERENCES ----------------- #

@app.get("/api/user/profile")
async def api_get_user_profile():
    profile = get_user_profile()
    stats = get_user_listening_profile()
    return {
        "profile": profile,
        "stats": {
            "total_plays": stats.get("total_plays", 0),
            "total_likes": stats.get("total_likes", 0),
            "top_artists": stats.get("top_history_artists", [])[:5]
        }
    }

@app.post("/api/user/profile")
async def api_save_user_profile(payload: Dict[str, Any]):
    updated = save_user_profile(payload)
    return {"success": True, "profile": updated}

# ----------------- MOODS & MULTILINGUAL HUBS ----------------- #

@app.get("/api/moods")
async def api_get_moods():
    categories = await asyncio.to_thread(get_mood_categories)
    return {"moods": categories}

@app.get("/api/moods/{mood_key}")
async def api_get_mood_feed(mood_key: str, languages: Optional[str] = Query(None)):
    langs = [l.strip() for l in languages.split(",") if l.strip()] if languages else None
    if not langs:
        profile = get_user_profile()
        langs = profile.get("languages", ["English", "Telugu", "Hindi"])
    feed = await asyncio.to_thread(get_mood_feed, mood_key, languages=langs)
    return feed

@app.get("/api/recommendations")
async def api_recommendations(
    video_id: Optional[str] = Query(None),
    artist: Optional[str] = Query(None),
    title: Optional[str] = Query(None)
):
    recs = await asyncio.to_thread(get_vibe_recommendations, video_id=video_id, artist=artist, title=title)
    return {"recommendations": recs}

# ----------------- AUDIO STREAMING & PROXY ----------------- #

@app.get("/api/stream_info/{video_id}")
async def api_stream_info(video_id: str, force_refresh: bool = Query(False)):
    try:
        info = await resolve_stream_info_async(video_id, force_refresh=force_refresh)
        return {
            "id": video_id,
            "title": info.get("title"),
            "artist": info.get("artist"),
            "stream_url": f"/api/stream/{video_id}",
            "direct_url": info.get("stream_url"),
            "thumbnail": info.get("thumbnail"),
            "duration_sec": info.get("duration_sec")
        }
    except Exception as e:
        logger.error(f"Error resolving stream info for {video_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/stream/{video_id}")
async def api_stream_audio(video_id: str, request: Request, force_refresh: bool = Query(False)):
    """
    High-performance, low-memory chunked audio streaming proxy with full HTTP Range support.
    Streams 64KB/128KB chunks without accumulating whole audio files in RAM (ideal for Render 512MB RAM).
    Enables seeking, instant playback, zero CORS restrictions, and automatic fallback reconnection.
    """
    try:
        info = await resolve_stream_info_async(video_id, force_refresh=force_refresh)
    except Exception as e:
        logger.error(f"Failed to resolve stream for {video_id}: {e}")
        raise HTTPException(status_code=404, detail="Audio stream not found")

    target_url = info["stream_url"]
    req_headers = dict(info.get("headers", {}))
    
    if "User-Agent" not in req_headers:
        req_headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    req_headers["Accept"] = "*/*"

    # Forward Range headers if provided by browser
    client_range = request.headers.get("range")
    if client_range:
        req_headers["Range"] = client_range

    async def stream_generator(url, headers):
        timeout = aiohttp.ClientTimeout(total=1800, connect=10, sock_read=30)
        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(url, headers=headers) as upstream_resp:
                    if upstream_resp.status in (403, 410):
                        # Expired or rejected token, re-resolve stream via fallback
                        fresh_info = await resolve_stream_info_async(video_id, force_refresh=True)
                        fresh_url = fresh_info["stream_url"]
                        fresh_headers = dict(fresh_info.get("headers", {}))
                        if client_range:
                            fresh_headers["Range"] = client_range
                        async with session.get(fresh_url, headers=fresh_headers) as fresh_resp:
                            async for chunk in fresh_resp.content.iter_chunked(64 * 1024):
                                yield chunk
                    else:
                        async for chunk in upstream_resp.content.iter_chunked(64 * 1024):
                            yield chunk
        except Exception as err:
            logger.warning(f"Streaming generator exception for {video_id}: {err}")

    # Forward upstream headers & status
    status_code = 206 if client_range else 200
    resp_headers = {"Accept-Ranges": "bytes"}

    try:
        timeout = aiohttp.ClientTimeout(total=6)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(target_url, headers=req_headers) as head_resp:
                for h in ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"]:
                    if h in head_resp.headers:
                        resp_headers[h] = head_resp.headers[h]
                if head_resp.status in (200, 206):
                    status_code = head_resp.status
    except Exception:
        pass

    resp_headers["Cache-Control"] = "public, max-age=86400"
    resp_headers["Access-Control-Allow-Origin"] = "*"

    return StreamingResponse(
        stream_generator(target_url, req_headers),
        status_code=status_code,
        headers=resp_headers,
        media_type=resp_headers.get("Content-Type", "audio/mp4")
    )

# ----------------- LYRICS ----------------- #

@app.get("/api/lyrics")
async def api_lyrics(
    title: str = Query(..., min_length=1),
    artist: str = Query(..., min_length=1),
    duration: Optional[int] = Query(None)
):
    lyrics_data = await asyncio.to_thread(get_lyrics, title=title, artist=artist, duration_sec=duration)
    return lyrics_data

# ----------------- LIBRARY: LIKES, PLAYLISTS, HISTORY ----------------- #

@app.get("/api/library/likes")
async def api_get_likes():
    likes = get_likes()
    liked_ids = [l["id"] for l in likes]
    return {"likes": likes, "liked_ids": liked_ids, "total": len(likes)}

@app.post("/api/library/likes/toggle")
async def api_toggle_like(track: Dict[str, Any]):
    is_liked = toggle_like(track)
    return {"liked": is_liked, "id": track.get("id") or track.get("videoId")}

@app.get("/api/library/playlists")
async def api_get_playlists():
    playlists = get_playlists()
    return {"playlists": playlists}

@app.post("/api/library/playlists/create")
async def api_create_playlist(data: Dict[str, Any]):
    name = data.get("name", "New Playlist")
    desc = data.get("description", "")
    cover = data.get("cover_url", "")
    pl = create_playlist(name=name, description=desc, cover_url=cover)
    return pl

@app.get("/api/library/playlists/{playlist_id}")
async def api_get_playlist(playlist_id: str):
    pl = get_playlist_details(playlist_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return pl

@app.post("/api/library/playlists/{playlist_id}/add")
async def api_add_playlist_track(playlist_id: str, track: Dict[str, Any]):
    success = add_track_to_playlist(playlist_id, track)
    return {"success": success}

@app.delete("/api/library/playlists/{playlist_id}/track/{track_id}")
async def api_remove_playlist_track(playlist_id: str, track_id: str):
    success = remove_track_from_playlist(playlist_id, track_id)
    return {"success": success}

@app.delete("/api/library/playlists/{playlist_id}")
async def api_delete_playlist(playlist_id: str):
    success = delete_playlist(playlist_id)
    return {"success": success}

@app.get("/api/library/history")
async def api_get_history(limit: int = Query(50, ge=1, le=200)):
    history = get_history(limit=limit)
    return {"history": history}

@app.post("/api/library/history/add")
async def api_add_history(track: Dict[str, Any]):
    add_to_history(track)
    return {"status": "ok"}

@app.post("/api/library/history/clear")
async def api_clear_history():
    clear_history()
    return {"status": "cleared"}

# ----------------- SOUNDSYNC LISTENING ROOMS ----------------- #

@app.post("/api/rooms/create")
async def api_create_room(data: Dict[str, Any]):
    room_name = data.get("room_name", "Oxyzen SoundSync Lounge")
    host_name = data.get("host_name", "Host")
    host_id = data.get("host_id", f"user_{int(time.time()*1000)%10000}")
    custom_code = data.get("room_code")
    
    room = sync_manager.create_room(
        name=room_name,
        host_id=host_id,
        host_name=host_name,
        custom_code=custom_code
    )
    return {
        "room_code": room.code,
        "room_name": room.name,
        "host_id": room.host_id,
        "created_at": room.created_at
    }

@app.get("/api/rooms/{code}")
async def api_get_room_info(code: str):
    room = sync_manager.get_room(code)
    if not room:
        raise HTTPException(status_code=404, detail="Listening room not found")
    return room.to_state_dict()

@app.websocket("/ws/room/{room_code}")
async def websocket_room_endpoint(websocket: WebSocket, room_code: str):
    await websocket.accept()
    room_code = room_code.upper().strip()
    room = sync_manager.get_room(room_code)
    
    # Reject connections to non-existing rooms
    if not room:
        await websocket.send_text(json.dumps({
            "type": "ERROR",
            "message": f"Room '{room_code}' does not exist or has been closed. Please check the code or host a new lounge."
        }))
        await websocket.close(code=4004, reason="Room does not exist")
        return

    user_id: Optional[str] = None
    user_name: str = "Anonymous Listener"
    user_avatar: str = "🎧"

    try:
        # First message expected is JOIN with user details
        init_data_raw = await websocket.receive_text()
        init_data = json.loads(init_data_raw)
        
        if init_data.get("type") == "JOIN":
            user_id = init_data.get("user_id") or f"user_{int(time.time()*1000)%100000}"
            user_name = init_data.get("user_name", "Listener")
            user_avatar = init_data.get("avatar", "🎧")
            
            room.add_listener(user_id=user_id, name=user_name, avatar=user_avatar, ws=websocket)
            
            # Send full current state to newly joined user
            await websocket.send_text(json.dumps({
                "type": "ROOM_STATE",
                "state": room.to_state_dict(),
                "you": {
                    "user_id": user_id,
                    "is_host": (user_id == room.host_id)
                }
            }))
            
            # Broadcast user joined alert to all others in room
            await room.broadcast({
                "type": "USER_JOINED",
                "user": {
                    "user_id": user_id,
                    "name": user_name,
                    "avatar": user_avatar,
                    "is_host": (user_id == room.host_id)
                },
                "listener_count": len(room.listeners),
                "listeners": room.to_state_dict()["listeners"]
            }, exclude_user_id=user_id)

        # Message loop
        while True:
            raw_msg = await websocket.receive_text()
            msg = json.loads(raw_msg)
            msg_type = msg.get("type")
            is_host = (user_id == room.host_id)

            if msg_type == "PLAY_TRACK":
                # Only host or authorized can change track
                track = msg.get("track")
                if track:
                    room.current_track = track
            can_control = is_host or room.is_admin_or_host(user_id)

            if msg_type == "PLAY_TRACK":
                track = msg.get("track")
                if can_control and track:
                    room.current_track = track
                    room.is_playing = True
                    room.current_time = 0.0
                    room.last_sync_timestamp = time.time()
                    await room.broadcast({
                        "type": "PLAY_TRACK",
                        "track": track,
                        "current_time": 0.0,
                        "is_playing": True,
                        "server_timestamp": time.time(),
                        "triggered_by": user_name
                    })

            elif msg_type == "PLAY_STATE":
                if can_control:
                    is_playing = bool(msg.get("is_playing", False))
                    current_time = float(msg.get("current_time", 0.0))
                    room.is_playing = is_playing
                    room.current_time = current_time
                    room.last_sync_timestamp = time.time()
                    await room.broadcast({
                        "type": "PLAY_STATE",
                        "is_playing": is_playing,
                        "current_time": current_time,
                        "server_timestamp": time.time(),
                        "triggered_by": user_name
                    }, exclude_user_id=user_id)

            elif msg_type == "SEEK":
                if can_control:
                    seek_time = float(msg.get("time", 0.0))
                    room.current_time = seek_time
                    room.last_sync_timestamp = time.time()
                    await room.broadcast({
                        "type": "SEEK",
                        "time": seek_time,
                        "is_playing": room.is_playing,
                        "server_timestamp": time.time(),
                        "triggered_by": user_name
                    }, exclude_user_id=user_id)

            elif msg_type == "ADD_QUEUE":
                track = msg.get("track")
                if track:
                    room.queue.append(track)
                    await room.broadcast({
                        "type": "QUEUE_UPDATED",
                        "queue": room.queue,
                        "added_by": user_name,
                        "track": track
                    })

            elif msg_type == "REMOVE_QUEUE":
                if can_control:
                    index = msg.get("index")
                    if isinstance(index, int) and 0 <= index < len(room.queue):
                        removed = room.queue.pop(index)
                        await room.broadcast({
                            "type": "QUEUE_UPDATED",
                            "queue": room.queue,
                            "removed_track": removed
                        })

            elif msg_type == "REQUEST_SONG":
                track = msg.get("track")
                if track:
                    req_item = room.add_request(track, user_id, user_name, user_avatar)
                    await room.broadcast({
                        "type": "REQUEST_ADDED",
                        "request": req_item,
                        "requests": room.requests,
                        "requester": user_name
                    })

            elif msg_type == "ACCEPT_REQUEST":
                if can_control:
                    req_id = msg.get("request_id")
                    play_now = bool(msg.get("play_now", False))
                    if req_id:
                        acc = room.accept_request(req_id, play_now=play_now)
                        if acc:
                            if play_now:
                                await room.broadcast({
                                    "type": "PLAY_TRACK",
                                    "track": acc["track"],
                                    "current_time": 0.0,
                                    "is_playing": True,
                                    "server_timestamp": time.time(),
                                    "triggered_by": f"{user_name} (Accepted request from {acc.get('requester', 'Listener')})"
                                })
                            else:
                                await room.broadcast({
                                    "type": "QUEUE_UPDATED",
                                    "queue": room.queue,
                                    "added_by": f"Accepted request from {acc.get('requester', 'Listener')}",
                                    "track": acc["track"]
                                })
                            await room.broadcast({
                                "type": "REQUEST_ACCEPTED",
                                "request_id": req_id,
                                "requests": room.requests
                            })

            elif msg_type == "DISMISS_REQUEST":
                if can_control:
                    req_id = msg.get("request_id")
                    if req_id:
                        room.remove_request(req_id)
                        await room.broadcast({
                            "type": "REQUEST_DISMISSED",
                            "request_id": req_id,
                            "requests": room.requests
                        })

            elif msg_type == "PROMOTE_ADMIN":
                target_user_id = msg.get("target_user_id")
                if is_host and target_user_id:
                    if room.promote_admin(target_user_id):
                        await room.broadcast({
                            "type": "ADMIN_UPDATED",
                            "admins": list(room.admins),
                            "listeners": room.to_state_dict()["listeners"],
                            "message": f"👑 {user_name} granted Co-Host Admin privileges to {room.listeners.get(target_user_id, {}).get('name', 'Listener')}"
                        })

            elif msg_type == "DEMOTE_ADMIN":
                target_user_id = msg.get("target_user_id")
                if is_host and target_user_id:
                    if room.demote_admin(target_user_id):
                        await room.broadcast({
                            "type": "ADMIN_UPDATED",
                            "admins": list(room.admins),
                            "listeners": room.to_state_dict()["listeners"],
                            "message": f"🛡️ Admin privileges revoked for {room.listeners.get(target_user_id, {}).get('name', 'Listener')}"
                        })

            elif msg_type == "TRANSFER_HOST":
                target_user_id = msg.get("target_user_id")
                if is_host and target_user_id in room.listeners:
                    room.host_id = target_user_id
                    room.admins.discard(target_user_id)
                    for uid in room.listeners:
                        room.listeners[uid]["is_host"] = (uid == target_user_id)
                    await room.broadcast({
                        "type": "HOST_CHANGED",
                        "new_host_id": target_user_id,
                        "new_host_name": room.listeners[target_user_id]["name"],
                        "listeners": room.to_state_dict()["listeners"],
                        "admins": list(room.admins)
                    })

            elif msg_type == "REACTION_PULSE":
                emoji = msg.get("emoji", "🔥")
                await room.broadcast({
                    "type": "REACTION_PULSE",
                    "user_id": user_id,
                    "user_name": user_name,
                    "emoji": emoji
                })

            elif msg_type == "CHAT_MESSAGE":
                text = msg.get("text", "").strip()
                if text:
                    await room.broadcast({
                        "type": "CHAT_MESSAGE",
                        "user_id": user_id,
                        "user_name": user_name,
                        "avatar": user_avatar,
                        "text": text[:200],
                        "timestamp": time.time()
                    })

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {user_id} ({user_name})")
    except Exception as e:
        logger.warning(f"WebSocket error for {user_id}: {e}")
    finally:
        if room and user_id:
            room.remove_listener(user_id)
            if len(room.listeners) == 0:
                sync_manager.delete_room(room.code)
                logger.info(f"Deleted empty SoundSync room: {room.code}")
            else:
                # Notify remaining users
                asyncio.create_task(room.broadcast({
                    "type": "USER_LEFT",
                    "user_id": user_id,
                    "user_name": user_name,
                    "listener_count": len(room.listeners),
                    "listeners": room.to_state_dict()["listeners"],
                    "host_id": room.host_id
                }))

# ----------------- DIRECT DOWNLOAD ----------------- #

@app.get("/api/download/{video_id}")
async def api_download_track(video_id: str, title: Optional[str] = None, artist: Optional[str] = None):
    try:
        info = resolve_stream_info(video_id)
        target_url = info["stream_url"]
        safe_filename = f"{artist or info.get('artist', 'Artist')} - {title or info.get('title', 'Track')}.m4a"
        safe_filename = "".join(c for c in safe_filename if c.isalnum() or c in " .-_()").strip()

        async def file_generator():
            timeout = aiohttp.ClientTimeout(total=600)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(target_url, headers=info.get("headers", {})) as resp:
                    async for chunk in resp.content.iter_chunked(128 * 1024):
                        yield chunk

        return StreamingResponse(
            file_generator(),
            media_type="audio/mp4",
            headers={"Content-Disposition": f'attachment; filename="{safe_filename}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {e}")

# ----------------- HEALTH & STATIC FILES ----------------- #

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "OXYZEN Luxury Music Platform",
        "version": "1.0.0",
        "time": time.time()
    }

# Mount static frontend directory
STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def root():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Oxyzen Backend is running. Frontend build in progress."}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"==================================================")
    print(f"✦ OXYZEN LUXURY MUSIC ENGINE RUNNING ON http://localhost:{port} ✦")
    print(f"==================================================")
    uvicorn.run("server:app", host=host, port=port, reload=False)
