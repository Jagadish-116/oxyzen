import sqlite3
import os
import json
import time
import uuid
from typing import List, Dict, Optional, Any

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "oxyzen.db")

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Likes table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS likes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration TEXT,
        duration_sec INTEGER,
        thumbnail TEXT,
        added_at REAL
    )
    """)
    
    # Playlists table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        cover_url TEXT,
        created_at REAL
    )
    """)
    
    # Playlist Tracks table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT,
        track_id TEXT,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration TEXT,
        duration_sec INTEGER,
        thumbnail TEXT,
        position INTEGER,
        added_at REAL,
        PRIMARY KEY (playlist_id, track_id)
    )
    """)
    
    # History table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album TEXT,
        duration TEXT,
        duration_sec INTEGER,
        thumbnail TEXT,
        played_at REAL
    )
    """)
    
    # User Preferences (Key-Value)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS preferences (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)

    conn.commit()
    conn.close()

# ----------------- LIKES MANAGEMENT ----------------- #

def toggle_like(track: Dict[str, Any]) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    track_id = track.get("id") or track.get("videoId")
    if not track_id:
        conn.close()
        return False
        
    cursor.execute("SELECT id FROM likes WHERE id = ?", (track_id,))
    exists = cursor.fetchone()
    
    if exists:
        cursor.execute("DELETE FROM likes WHERE id = ?", (track_id,))
        is_liked = False
    else:
        cursor.execute("""
        INSERT OR REPLACE INTO likes (id, title, artist, album, duration, duration_sec, thumbnail, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            track_id,
            track.get("title", "Unknown Title"),
            track.get("artist", "Unknown Artist"),
            track.get("album", ""),
            track.get("duration", "0:00"),
            track.get("duration_sec", 0),
            track.get("thumbnail", ""),
            time.time()
        ))
        is_liked = True
        
    conn.commit()
    conn.close()
    return is_liked

def get_likes() -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM likes ORDER BY added_at DESC")
    rows = cursor.fetchall()
    conn.close()
    seen = set()
    unique_tracks = []
    for r in rows:
        d = dict(r)
        if d["id"] not in seen:
            seen.add(d["id"])
            unique_tracks.append(d)
    return unique_tracks

def get_liked_ids() -> List[str]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT id FROM likes")
    rows = cursor.fetchall()
    conn.close()
    return [row["id"] for row in rows]

# ----------------- PLAYLISTS MANAGEMENT ----------------- #

def create_playlist(name: str, description: str = "", cover_url: str = "") -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()
    playlist_id = "pl_" + str(uuid.uuid4())[:8]
    created_at = time.time()
    
    cursor.execute("""
    INSERT INTO playlists (id, name, description, cover_url, created_at)
    VALUES (?, ?, ?, ?, ?)
    """, (playlist_id, name, description, cover_url, created_at))
    conn.commit()
    conn.close()
    return {
        "id": playlist_id,
        "name": name,
        "description": description,
        "cover_url": cover_url,
        "created_at": created_at,
        "tracks": []
    }

def get_playlists() -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM playlists ORDER BY created_at DESC")
    playlists = [dict(row) for row in cursor.fetchall()]
    
    for pl in playlists:
        cursor.execute("SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ?", (pl["id"],))
        pl["track_count"] = cursor.fetchone()["count"]
        if not pl.get("cover_url"):
            cursor.execute("SELECT thumbnail FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC LIMIT 1", (pl["id"],))
            first_track = cursor.fetchone()
            if first_track and first_track["thumbnail"]:
                pl["cover_url"] = first_track["thumbnail"]
    conn.close()
    return playlists

def get_playlist_details(playlist_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
    pl = cursor.fetchone()
    if not pl:
        conn.close()
        return None
    data = dict(pl)
    cursor.execute("SELECT * FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC", (playlist_id,))
    tracks = [dict(row) for row in cursor.fetchall()]
    data["tracks"] = tracks
    conn.close()
    return data

def add_track_to_playlist(playlist_id: str, track: Dict[str, Any]) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    track_id = track.get("id") or track.get("videoId")
    if not track_id:
        conn.close()
        return False
        
    cursor.execute("SELECT MAX(position) as max_pos FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    res = cursor.fetchone()
    next_pos = (res["max_pos"] + 1) if res and res["max_pos"] is not None else 0
    
    try:
        cursor.execute("""
        INSERT OR REPLACE INTO playlist_tracks (playlist_id, track_id, title, artist, album, duration, duration_sec, thumbnail, position, added_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            playlist_id,
            track_id,
            track.get("title", "Unknown Title"),
            track.get("artist", "Unknown Artist"),
            track.get("album", ""),
            track.get("duration", "0:00"),
            track.get("duration_sec", 0),
            track.get("thumbnail", ""),
            next_pos,
            time.time()
        ))
        conn.commit()
        success = True
    except Exception:
        success = False
    conn.close()
    return success

def remove_track_from_playlist(playlist_id: str, track_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?", (playlist_id, track_id))
    conn.commit()
    conn.close()
    return True

def delete_playlist(playlist_id: str) -> bool:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    cursor.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?", (playlist_id,))
    conn.commit()
    conn.close()
    return True

# ----------------- HISTORY MANAGEMENT ----------------- #

def add_to_history(track: Dict[str, Any]):
    conn = get_db()
    cursor = conn.cursor()
    track_id = track.get("id") or track.get("videoId")
    if not track_id:
        conn.close()
        return
        
    cursor.execute("""
    INSERT INTO history (track_id, title, artist, album, duration, duration_sec, thumbnail, played_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        track_id,
        track.get("title", "Unknown Title"),
        track.get("artist", "Unknown Artist"),
        track.get("album", ""),
        track.get("duration", "0:00"),
        track.get("duration_sec", 0),
        track.get("thumbnail", ""),
        time.time()
    ))
    cursor.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY played_at DESC LIMIT 200)")
    conn.commit()
    conn.close()

def get_history(limit: int = 50) -> List[Dict[str, Any]]:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM history ORDER BY played_at DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def clear_history():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM history")
    conn.commit()
    conn.close()

def get_user_listening_profile() -> Dict[str, Any]:
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT artist, COUNT(*) as play_count 
        FROM history 
        WHERE artist IS NOT NULL AND artist != 'Unknown Artist' AND artist != ''
        GROUP BY artist 
        ORDER BY play_count DESC 
        LIMIT 10
    """)
    top_history_artists = [{"artist": row["artist"], "count": row["play_count"]} for row in cursor.fetchall()]
    
    cursor.execute("""
        SELECT artist, COUNT(*) as like_count 
        FROM likes 
        WHERE artist IS NOT NULL AND artist != 'Unknown Artist' AND artist != ''
        GROUP BY artist 
        ORDER BY like_count DESC 
        LIMIT 10
    """)
    liked_artists = [{"artist": row["artist"], "count": row["like_count"]} for row in cursor.fetchall()]

    cursor.execute("""
        SELECT DISTINCT track_id, title, artist, album, thumbnail, duration, duration_sec 
        FROM history 
        ORDER BY id DESC 
        LIMIT 10
    """)
    recent_seeds = [
        {
            "id": row["track_id"],
            "videoId": row["track_id"],
            "title": row["title"],
            "artist": row["artist"],
            "album": row["album"],
            "thumbnail": row["thumbnail"],
            "duration": row["duration"],
            "duration_sec": row["duration_sec"]
        }
        for row in cursor.fetchall()
    ]

    cursor.execute("SELECT COUNT(*) as total FROM history")
    total_history = cursor.fetchone()["total"]

    cursor.execute("SELECT COUNT(DISTINCT id) as total FROM likes")
    total_likes = cursor.fetchone()["total"]

    conn.close()
    return {
        "top_history_artists": top_history_artists,
        "liked_artists": liked_artists,
        "recent_seeds": recent_seeds,
        "total_plays": total_history,
        "total_likes": total_likes
    }

def save_preference(key: str, value: Any):
    conn = get_db()
    cursor = conn.cursor()
    val_str = json.dumps(value) if not isinstance(value, str) else value
    cursor.execute("INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)", (key, val_str))
    conn.commit()
    conn.close()

def get_preference(key: str, default: Any = None) -> Any:
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM preferences WHERE key = ?", (key,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return default
    try:
        return json.loads(row["value"])
    except Exception:
        return row["value"]

def get_user_profile() -> Dict[str, Any]:
    default_profile = {
        "name": "Oxyzen Listener",
        "avatar": "👑",
        "bio": "Breathing the music in high fidelity",
        "languages": ["English", "Telugu", "Hindi"],
        "audio_quality": "Master 320k",
        "theme": "cyber_gold"
    }
    pref = get_preference("user_profile", default=default_profile)
    if isinstance(pref, dict):
        for k, v in default_profile.items():
            if k not in pref:
                pref[k] = v
        return pref
    return default_profile

def save_user_profile(profile_data: Dict[str, Any]) -> Dict[str, Any]:
    current = get_user_profile()
    current.update(profile_data)
    save_preference("user_profile", current)
    return current
