import os
import time
import json
import logging
import asyncio
import shutil
import tempfile
import http.cookiejar
import urllib3
from typing import List, Dict, Optional, Any
# pyrefly: ignore [missing-import]
from ytmusicapi import YTMusic
import yt_dlp
from yt_dlp.utils import DownloadError, ExtractorError
import requests

# Suppress unverified HTTPS warnings for public mirror probing
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("oxyzen_music")

# Invidious & Piped public instances pool for zero-cookie cloud/datacenter bypass
DEFAULT_INVIDIOUS_INSTANCES: List[str] = [
    "https://invidious.flokinet.to",
    "https://inv.tux.pizza",
    "https://invidious.nerdvpn.de",
    "https://invidious.private.coffee",
    "https://yt.drgnz.club",
    "https://invidious.projectsegfau.lt",
    "https://invidious.einfachzocken.eu",
    "https://invidious.tiekoetter.com",
    "https://invidious.jing.rocks",
    "https://invidious.perennialte.ch",
    "https://inv.nadeko.net",
    "https://yewtu.be",
    "https://iv.melmac.space"
]

def get_invidious_instances() -> List[str]:
    custom = os.environ.get("INVIDIOUS_INSTANCES") or os.environ.get("INVIDIOUS_CUSTOM_URL")
    if custom:
        return [c.strip() for c in custom.split(",") if c.strip()]
    return list(DEFAULT_INVIDIOUS_INSTANCES)

invidious_instance_pool: List[str] = get_invidious_instances()

DEFAULT_PIPED_INSTANCES: List[str] = [
    "https://api.piped.private.coffee",
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://pipedapi.tokhmi.xyz"
]

# -------------------------------------------------------------
# COOKIES & CLIENT AUTH MANAGEMENT (RENDER READ-ONLY BYPASS)
# -------------------------------------------------------------
def get_writable_cookie_path() -> Optional[str]:
    """
    Locates YouTube cookies and ensures they are located in a writable path (e.g., /tmp/cookies.txt)
    to prevent yt-dlp [Errno 30] Read-only file system crashes on Render cloud hosting.
    
    Render mounts secret files at /etc/secrets/cookies.txt as a read-only filesystem.
    When yt-dlp runs, it tries to write session state back to the cookie file.
    Copying the file to /tmp/cookies.txt gives yt-dlp and ytmusicapi full write access.
    """
    target_temp = "/tmp/cookies.txt" if os.name != "nt" else os.path.join(tempfile.gettempdir(), "cookies.txt")

    # 1. Check Render Secret File mount (/etc/secrets/cookies.txt)
    render_secret = "/etc/secrets/cookies.txt"
    if os.path.exists(render_secret):
        try:
            shutil.copyfile(render_secret, target_temp)
            try:
                os.chmod(target_temp, 0o600)
            except Exception:
                pass
            logger.info(f"Copied Render read-only cookie secret ({render_secret}) to writable path: {target_temp}")
            return target_temp
        except Exception as e:
            logger.warning(f"Failed to copy Render secret {render_secret} to {target_temp}: {e}")
            return render_secret

    # 2. Check explicit env vars: YTDL_COOKIEFILE, COOKIE_FILE_PATH, COOKIES_PATH
    for env_var in ["YTDL_COOKIEFILE", "COOKIE_FILE_PATH", "COOKIES_PATH"]:
        src_path = os.environ.get(env_var)
        if src_path and os.path.exists(src_path):
            try:
                shutil.copyfile(src_path, target_temp)
                try:
                    os.chmod(target_temp, 0o600)
                except Exception:
                    pass
                logger.info(f"Copied cookie file from {env_var} ({src_path}) to writable path: {target_temp}")
                return target_temp
            except Exception as e:
                logger.warning(f"Could not copy {src_path} to temp cookie path: {e}")
                return src_path

    # 3. Check local workspace cookies.txt
    for local_path in [
        os.path.join(os.getcwd(), "cookies.txt"),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cookies.txt"),
    ]:
        if os.path.exists(local_path):
            try:
                shutil.copyfile(local_path, target_temp)
                logger.info(f"Using local workspace YouTube cookie file (copied to {target_temp}): {local_path}")
                return target_temp
            except Exception:
                logger.info(f"Using local workspace YouTube cookie file directly: {local_path}")
                return local_path

    # 4. Check if raw cookie contents were passed as an environment variable
    raw_cookies = os.environ.get("YTDL_COOKIES") or os.environ.get("YTDL_COOKIES_TEXT")
    if raw_cookies and len(raw_cookies.strip()) > 20:
        try:
            with open(target_temp, "w", encoding="utf-8") as f:
                f.write(raw_cookies.strip())
            try:
                os.chmod(target_temp, 0o600)
            except Exception:
                pass
            logger.info(f"Successfully initialized writable cookie file at {target_temp} from YTDL_COOKIES env var.")
            return target_temp
        except Exception as e:
            logger.warning(f"Failed to write YTDL_COOKIES env var to {target_temp}: {e}")

    return None

# Alias for backward compatibility
get_cookie_file_path = get_writable_cookie_path

ACTIVE_COOKIE_PATH = get_writable_cookie_path()

def get_ytmusic_client() -> Optional[YTMusic]:
    """
    Initializes and returns a YTMusic client passing the writable cookie file if available,
    with unauthenticated fallback.
    """
    cookie_path = get_writable_cookie_path() or ACTIVE_COOKIE_PATH
    if cookie_path and os.path.exists(cookie_path):
        try:
            # 1. Attempt loading via requests Session with MozillaCookieJar for Netscape cookies.txt
            session = requests.Session()
            cj = http.cookiejar.MozillaCookieJar(cookie_path)
            cj.load(ignore_discard=True, ignore_expires=True)
            session.cookies = cj
            return YTMusic(requests_session=session)
        except Exception:
            # 2. Attempt direct path in case of json credentials
            try:
                return YTMusic(cookie_path)
            except Exception as e:
                logger.warning(f"Could not initialize YTMusic with cookies ({cookie_path}): {e}")
    try:
        return YTMusic()
    except Exception as e:
        logger.warning(f"Error initializing unauthenticated YTMusic: {e}")
        return None

# Initialize global YTMusic client with active cookie path
yt = get_ytmusic_client()

# In-memory stream URL cache: video_id -> {url, headers, expires_at, info}
stream_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL = 3600 * 4  # 4 hours TTL cache

def _evict_expired_cache() -> None:
    """Evicts expired stream items from memory to prevent unbound growth."""
    now = time.time()
    expired = [k for k, v in stream_cache.items() if v.get("expires_at", 0) <= now]
    for k in expired:
        stream_cache.pop(k, None)
    # If still large, remove oldest 20%
    if len(stream_cache) > 400:
        sorted_keys = sorted(stream_cache.keys(), key=lambda k: stream_cache[k].get("expires_at", 0))
        for k in sorted_keys[:80]:
            stream_cache.pop(k, None)

def build_ytdl_opts(client_tier: str = "primary") -> Dict[str, Any]:
    """
    Builds optimized yt-dlp options with dynamic cookie, proxy, PO token, and client emulation.
    """
    cookie_file = get_writable_cookie_path()
    proxy = os.environ.get("YTDL_PROXY") or os.environ.get("HTTP_PROXY") or os.environ.get("HTTPS_PROXY")
    po_token = os.environ.get("YTDL_PO_TOKEN") or os.environ.get("PO_TOKEN")
    visitor_data = os.environ.get("YTDL_VISITOR_DATA") or os.environ.get("VISITOR_DATA")

    # Select client priority based on fallback tier
    if client_tier == "mobile":
        clients = ['android', 'ios']
    elif client_tier == "embedded":
        clients = ['tv_embedded', 'web_embedded', 'mweb']
    else:
        clients = ['android', 'ios', 'tv_embedded', 'web', 'mweb']

    yt_extractor_args: Dict[str, Any] = {
        'player_client': clients,
        'player_skip': ['webpage', 'configs', 'js'],
    }

    if po_token:
        yt_extractor_args['po_token'] = [f"web+{po_token}"]
    if visitor_data:
        yt_extractor_args['visitor_data'] = [visitor_data]

    opts: Dict[str, Any] = {
        'format': 'bestaudio/best',
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'extract_flat': False,
        'cachedir': False,
        'socket_timeout': 15,
        'retries': 5,
        'nocheckcertificate': True,
        'extractor_args': {
            'youtube': yt_extractor_args
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Mode': 'navigate',
        }
    }

    if cookie_file:
        opts['cookiefile'] = cookie_file

    if proxy:
        opts['proxy'] = proxy

    return opts

YTDL_OPTS = build_ytdl_opts("primary")

def format_duration(seconds: Optional[int]) -> str:
    if not seconds:
        return "0:00"
    mins = seconds // 60
    secs = seconds % 60
    return f"{mins}:{secs:02d}"

def parse_duration_str(dur_str: Optional[str]) -> int:
    if not dur_str:
        return 0
    parts = dur_str.strip().split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except Exception:
        pass
    return 0

def clean_thumbnail(thumbnails: List[Dict[str, Any]]) -> str:
    if not thumbnails:
        return "/static/assets/logo.png"
    # Choose highest resolution
    sorted_thumbs = sorted(thumbnails, key=lambda x: x.get("width", 0), reverse=True)
    url = sorted_thumbs[0].get("url", "")
    # Upgrade low-res ytimg url if possible
    if "w120-h120" in url:
        url = url.replace("w120-h120", "w544-h544")
    elif "w60-h60" in url:
        url = url.replace("w60-h60", "w544-h544")
    return url

def clean_track_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    video_id = item.get("videoId")
    if not video_id:
        return None
    
    title = item.get("title") or "Unknown Track"
    artists = item.get("artists") or []
    artist_name = ", ".join([a.get("name", "") for a in artists if isinstance(a, dict)]) if artists else item.get("artist", "Unknown Artist")
    if not artist_name:
        artist_name = "Unknown Artist"
        
    album_obj = item.get("album")
    album_name = album_obj.get("name", "") if isinstance(album_obj, dict) else (album_obj or "")
    
    duration = item.get("duration") or "3:30"
    duration_sec = item.get("duration_seconds") or parse_duration_str(duration)
    
    thumbnail = clean_thumbnail(item.get("thumbnails", []))
    if not thumbnail or thumbnail == "/static/assets/logo.png":
        thumbnail = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
    
    return {
        "id": video_id,
        "videoId": video_id,
        "title": title,
        "artist": artist_name,
        "album": album_name,
        "duration": duration,
        "duration_sec": duration_sec,
        "thumbnail": thumbnail,
        "year": item.get("year", "")
    }

def get_search_suggestions(query: str) -> List[str]:
    if not query or not query.strip():
        return []
    client = yt or get_ytmusic_client()
    if client:
        try:
            return client.get_search_suggestions(query.strip())
        except Exception as e:
            logger.warning(f"Error fetching suggestions via ytmusic: {e}")
        
    # Fallback to public google autocomplete
    try:
        res = requests.get(
            f"https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q={query.strip()}",
            timeout=3
        )
        if res.status_code == 200:
            data = res.json()
            if len(data) > 1 and isinstance(data[1], list):
                return data[1][:8]
    except Exception:
        pass
    return []

def search_via_ytdl(query: str, limit: int = 30) -> List[Dict[str, Any]]:
    """
    Fallback search using yt-dlp's ytsearch extractor when ytmusicapi encounters
    cloud/datacenter JSONDecodeError or blocking.
    """
    if not query or not query.strip():
        return []
    
    tracks: List[Dict[str, Any]] = []
    seen_ids = set()
    search_opts = {
        **YTDL_OPTS,
        'extract_flat': True,
        'skip_download': True,
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
    }
    try:
        with yt_dlp.YoutubeDL(search_opts) as ydl:
            info = ydl.extract_info(f"ytsearch{max(limit, 25)}:{query.strip()}", download=False)
            entries = (info and info.get("entries")) or []
            for entry in entries:
                if not entry or not entry.get("id"):
                    continue
                v_id = entry["id"]
                if v_id in seen_ids:
                    continue
                seen_ids.add(v_id)
                dur = int(entry.get("duration") or 0)
                uploader = entry.get("uploader") or entry.get("channel") or entry.get("creator") or "Unknown Artist"
                thumb = entry.get("thumbnail") or f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg"
                tracks.append({
                    "id": v_id,
                    "videoId": v_id,
                    "title": entry.get("title") or "Unknown Title",
                    "artist": uploader,
                    "album": "Oxyzen Audio",
                    "duration": format_duration(dur),
                    "duration_sec": dur,
                    "thumbnail": thumb,
                    "year": ""
                })
                if len(tracks) >= limit:
                    break
    except Exception as e:
        logger.error(f"Fallback yt-dlp search error for '{query}': {e}")
    return tracks

def search_music(query: str, filter_type: Optional[str] = None, limit: int = 50) -> Dict[str, Any]:
    if not query or not query.strip():
        return {"tracks": [], "artists": [], "albums": [], "playlists": []}
    
    q = query.strip()
    tracks: List[Dict[str, Any]] = []
    artists: List[Dict[str, Any]] = []
    albums: List[Dict[str, Any]] = []
    playlists: List[Dict[str, Any]] = []
    seen_track_ids = set()

    client = yt or get_ytmusic_client()
    if client:
        try:
            # Map frontend filter type to ytmusicapi filter
            yt_filter = None
            if filter_type == "songs":
                yt_filter = "songs"
            elif filter_type == "videos":
                yt_filter = "videos"
            elif filter_type == "albums":
                yt_filter = "albums"
            elif filter_type == "artists":
                yt_filter = "artists"
            elif filter_type == "playlists":
                yt_filter = "playlists"
                
            results = client.search(q, filter=yt_filter, limit=max(limit, 35))
            
            for item in results:
                r_type = item.get("resultType")
                if r_type in ("song", "video"):
                    cleaned = clean_track_item(item)
                    if cleaned and cleaned["id"] not in seen_track_ids:
                        seen_track_ids.add(cleaned["id"])
                        tracks.append(cleaned)
                elif r_type == "artist":
                    artists.append({
                        "id": item.get("browseId", ""),
                        "name": item.get("artist", item.get("name", "Unknown Artist")),
                        "thumbnail": clean_thumbnail(item.get("thumbnails", [])),
                        "subscribers": item.get("subscribers", "")
                    })
                elif r_type == "album":
                    artists_list = item.get("artists", [])
                    art_name = ", ".join([a.get("name", "") for a in artists_list if isinstance(a, dict)]) if artists_list else ""
                    albums.append({
                        "id": item.get("browseId", ""),
                        "title": item.get("title", "Unknown Album"),
                        "artist": art_name,
                        "year": item.get("year", ""),
                        "thumbnail": clean_thumbnail(item.get("thumbnails", []))
                    })
                elif r_type == "playlist":
                    playlists.append({
                        "id": item.get("browseId", ""),
                        "title": item.get("title", "Unknown Playlist"),
                        "itemCount": item.get("itemCount", ""),
                        "author": item.get("author", ""),
                        "thumbnail": clean_thumbnail(item.get("thumbnails", []))
                    })

            # If user wanted songs or general search and we got fewer than limit, fetch additional video/song matches
            if (filter_type in (None, "songs")) and len(tracks) < limit:
                extra_filter = "videos" if yt_filter == "songs" else "songs"
                try:
                    extra_results = client.search(q, filter=extra_filter, limit=limit - len(tracks) + 10)
                    for item in extra_results:
                        cleaned = clean_track_item(item)
                        if cleaned and cleaned["id"] not in seen_track_ids:
                            seen_track_ids.add(cleaned["id"])
                            tracks.append(cleaned)
                            if len(tracks) >= limit:
                                break
                except Exception:
                    pass

        except Exception as e:
            logger.warning(f"Search error in ytmusic (will fall back to yt-dlp): {e}")

    # Fallback to yt-dlp search if tracks are empty or if client failed
    if not tracks and filter_type in (None, "songs", "videos"):
        logger.info(f"Querying yt-dlp fallback search for: '{q}'")
        ytdl_tracks = search_via_ytdl(q, limit=limit)
        for t in ytdl_tracks:
            if t["id"] not in seen_track_ids:
                seen_track_ids.add(t["id"])
                tracks.append(t)

    return {
        "tracks": tracks[:limit],
        "artists": artists,
        "albums": albums,
        "playlists": playlists
    }

def _resolve_via_invidious(video_id: str) -> Optional[Dict[str, Any]]:
    """
    Robust fallback resolver that queries public Invidious and Piped instances to fetch
    direct audio streams. Bypasses datacenter/cloud IP blocks without requiring cookies.
    """
    global invidious_instance_pool
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "application/json"
    }

    # Step 1: Query Invidious instances
    for idx, host in enumerate(list(invidious_instance_pool)):
        clean_host = host.rstrip("/")
        api_url = f"{clean_host}/api/v1/videos/{video_id}"
        try:
            resp = requests.get(api_url, headers=headers, timeout=4.5, verify=False)
            if resp.status_code == 200:
                data = resp.json()
                formats = data.get("adaptiveFormats", [])
                audio_formats = []
                for f in formats:
                    mime = f.get("type", "")
                    container = f.get("container", "")
                    if mime.startswith("audio/") or container in ("webm", "m4a", "opus", "mp3") or f.get("audioQuality"):
                        if f.get("url"):
                            audio_formats.append(f)

                # Fallback to formatStreams if adaptiveFormats has no separate audio
                if not audio_formats and data.get("formatStreams"):
                    audio_formats = [f for f in data["formatStreams"] if f.get("url")]

                if audio_formats:
                    def get_bitrate(fmt):
                        try:
                            return int(fmt.get("bitrate") or fmt.get("abr") or 0)
                        except (ValueError, TypeError):
                            return 0

                    audio_formats.sort(key=get_bitrate, reverse=True)
                    best_stream = audio_formats[0]
                    stream_url = best_stream.get("url")

                    # Promote working instance to the front of the pool for instant subsequent queries
                    if idx > 0 and host in invidious_instance_pool:
                        invidious_instance_pool.remove(host)
                        invidious_instance_pool.insert(0, host)

                    logger.info(f"Successfully resolved audio stream for {video_id} via Invidious instance: {clean_host}")
                    return {
                        "stream_url": stream_url,
                        "headers": {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                            "Accept": "*/*"
                        },
                        "title": data.get("title", ""),
                        "artist": data.get("author", ""),
                        "duration_sec": int(data.get("lengthSeconds") or 0),
                        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                    }
        except Exception as inv_err:
            logger.debug(f"Invidious instance {clean_host} failed for {video_id}: {inv_err}")
            continue

    # Step 2: Fallback to Piped instances if Invidious was unreachable
    for piped_host in DEFAULT_PIPED_INSTANCES:
        clean_piped = piped_host.rstrip("/")
        piped_url = f"{clean_piped}/streams/{video_id}"
        try:
            resp = requests.get(piped_url, headers=headers, timeout=4.5, verify=False)
            if resp.status_code == 200:
                data = resp.json()
                audio_streams = data.get("audioStreams", [])
                if audio_streams:
                    def get_piped_bitrate(s):
                        try:
                            return int(s.get("bitrate") or 0)
                        except (ValueError, TypeError):
                            return 0
                    audio_streams.sort(key=get_piped_bitrate, reverse=True)
                    best_audio = audio_streams[0]
                    stream_url = best_audio.get("url")
                    if stream_url:
                        logger.info(f"Successfully resolved audio stream for {video_id} via Piped instance: {clean_piped}")
                        return {
                            "stream_url": stream_url,
                            "headers": {
                                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                                "Accept": "*/*"
                            },
                            "title": data.get("title", ""),
                            "artist": data.get("uploader", ""),
                            "duration_sec": int(data.get("duration") or 0),
                            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                        }
        except Exception as piped_err:
            logger.debug(f"Piped instance {clean_piped} failed for {video_id}: {piped_err}")
            continue

    return None

def resolve_stream_info(video_id: str, force_refresh: bool = False) -> Dict[str, Any]:
    now = time.time()
    if not force_refresh and video_id in stream_cache:
        cached = stream_cache[video_id]
        if cached["expires_at"] > now:
            return cached

    url = f"https://www.youtube.com/watch?v={video_id}"
    extracted_info = None
    stream_url = None
    headers = {}

    # Attempt 1: Primary YTDL with multi-client mobile bypass
    try:
        with yt_dlp.YoutubeDL(YTDL_OPTS) as ydl:
            extracted_info = ydl.extract_info(url, download=False)
            if extracted_info:
                stream_url = extracted_info.get("url")
                if not stream_url and "formats" in extracted_info:
                    audio_formats = [f for f in extracted_info["formats"] if f.get("acodec") != "none"]
                    if audio_formats:
                        best = max(audio_formats, key=lambda f: f.get("abr", 0) or f.get("tbr", 0))
                        stream_url = best.get("url")
                    elif extracted_info.get("formats"):
                        stream_url = extracted_info["formats"][-1].get("url")
                headers = extracted_info.get("http_headers", {})
    except (DownloadError, ExtractorError, Exception) as e1:
        logger.warning(f"Primary yt-dlp extraction failed for {video_id}: {e1}")

    # Attempt 2: Fallback with tv_embedded & web_embedded
    if not stream_url:
        try:
            fallback_opts = dict(YTDL_OPTS)
            fallback_opts['extractor_args'] = {
                'youtube': {
                    'player_client': ['tv_embedded', 'web_embedded', 'mweb']
                }
            }
            with yt_dlp.YoutubeDL(fallback_opts) as ydl:
                extracted_info = ydl.extract_info(url, download=False)
                if extracted_info:
                    stream_url = extracted_info.get("url")
                    if not stream_url and "formats" in extracted_info:
                        audio_formats = [f for f in extracted_info["formats"] if f.get("acodec") != "none"]
                        if audio_formats:
                            stream_url = max(audio_formats, key=lambda f: f.get("abr", 0) or f.get("tbr", 0)).get("url")
                    headers = extracted_info.get("http_headers", {})
        except (DownloadError, ExtractorError, Exception) as e2:
            logger.warning(f"Secondary yt-dlp fallback failed for {video_id}: {e2}")

    # Attempt 3: Invidious & Piped public API fallback (bypasses datacenter 403 / bot detection)
    if not stream_url:
        logger.info(f"Initiating Invidious API stream resolution fallback for {video_id}...")
        invidious_result = _resolve_via_invidious(video_id)
        if invidious_result:
            stream_url = invidious_result["stream_url"]
            headers = invidious_result.get("headers", {})
            extracted_info = {
                "title": invidious_result.get("title", ""),
                "uploader": invidious_result.get("artist", ""),
                "duration": invidious_result.get("duration_sec", 0),
                "thumbnail": invidious_result.get("thumbnail", f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg")
            }

    if not stream_url:
        raise ValueError(f"Could not resolve direct audio stream for {video_id}")

    # Ensure headers include standard browser user agent
    if "User-Agent" not in headers:
        headers["User-Agent"] = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

    result = {
        "stream_url": stream_url,
        "headers": headers,
        "title": (extracted_info and extracted_info.get("title")) or "",
        "artist": (extracted_info and (extracted_info.get("uploader") or extracted_info.get("channel"))) or "",
        "duration_sec": (extracted_info and extracted_info.get("duration")) or 0,
        "thumbnail": (extracted_info and extracted_info.get("thumbnail")) or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        "expires_at": now + CACHE_TTL
    }
    _evict_expired_cache()
    stream_cache[video_id] = result
    return result

async def resolve_stream_info_async(video_id: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Non-blocking async wrapper that resolves the stream in a background threadpool,
    guaranteeing the FastAPI asyncio event loop is never blocked during yt-dlp scraping.
    """
    return await asyncio.to_thread(resolve_stream_info, video_id, force_refresh)

def get_vibe_recommendations(video_id: Optional[str] = None, artist: Optional[str] = None, title: Optional[str] = None) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []
    seen_ids = set()
    if video_id:
        seen_ids.add(video_id)
    
    client = yt or get_ytmusic_client()
    if video_id and client:
        try:
            watch_pl = client.get_watch_playlist(videoId=video_id, limit=30)
            if watch_pl and "tracks" in watch_pl:
                for item in watch_pl["tracks"]:
                    v_id = item.get("videoId")
                    if v_id and v_id not in seen_ids:
                        cleaned = clean_track_item(item)
                        if cleaned:
                            seen_ids.add(v_id)
                            recommendations.append(cleaned)
        except Exception as e:
            logger.warning(f"Error getting watch playlist recommendations: {e}")

    # If empty or fewer than 10, search related hits
    if len(recommendations) < 10 and (artist or title):
        query = f"{artist or ''} {title or ''} hits music".strip()
        search_res = search_music(query, filter_type="songs", limit=20)
        for t in search_res.get("tracks", []):
            if t["id"] not in seen_ids:
                seen_ids.add(t["id"])
                recommendations.append(t)

    # Secondary fallback to yt-dlp search if still empty
    if len(recommendations) < 5 and (artist or title):
        query = f"{artist or ''} {title or ''} official audio".strip()
        ytdl_tracks = search_via_ytdl(query, limit=15)
        for t in ytdl_tracks:
            if t["id"] not in seen_ids:
                seen_ids.add(t["id"])
                recommendations.append(t)

    return recommendations

def get_personalized_adaptive_sections(profile: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Generates personalized dynamic sections based on user's listening history & likes.
    """
    sections: List[Dict[str, Any]] = []
    top_artists = profile.get("top_history_artists", [])
    liked_artists = profile.get("liked_artists", [])
    recent_seeds = profile.get("recent_seeds", [])

    # Combine top artist names
    artist_names = []
    for a in top_artists + liked_artists:
        name = a.get("artist", "").strip()
        if name and name not in artist_names and name != "Unknown Artist":
            artist_names.append(name)

    # 1. Made For You • Adaptive Radar (if seeds or artists exist)
    if recent_seeds:
        seed_track = recent_seeds[0]
        recs = get_vibe_recommendations(
            video_id=seed_track.get("id"),
            artist=seed_track.get("artist"),
            title=seed_track.get("title")
        )
        if recs:
            sections.append({
                "id": "personalized_adaptive_radar",
                "title": "Made For You • Adaptive Radar",
                "tagline": f"Real-time vibe matching from your recent replay of '{seed_track.get('title')}'",
                "badge": "AI Tailored",
                "color": "#F5C542",
                "is_personalized": True,
                "tracks": recs[:12]
            })

    # 2. Because You Listen To [Top Artist]
    if artist_names:
        fav_artist = artist_names[0]
        artist_hits = search_music(f"{fav_artist} greatest hits essentials", filter_type="songs", limit=12)
        if artist_hits.get("tracks"):
            sections.append({
                "id": "personalized_favorite_artist",
                "title": f"Because You Listen to {fav_artist}",
                "tagline": f"Deep cuts, top charts, and related frequencies for {fav_artist}",
                "badge": "Taste Match",
                "color": "#A855F7",
                "is_personalized": True,
                "tracks": artist_hits["tracks"][:12]
            })

    # 3. Heavy Rotation (Recent replay queue)
    if len(recent_seeds) >= 3:
        sections.append({
            "id": "personalized_heavy_rotation",
            "title": "Your Heavy Rotation",
            "tagline": "Your most recently celebrated sessions on Oxyzen",
            "badge": "On Replay",
            "color": "#22D3EE",
            "is_personalized": True,
            "tracks": recent_seeds[:10]
        })

    return sections

def get_explore_feed(profile: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    # Curated High-Vibe Luxury Sections for Oxyzen
    curated_categories = [
        {
            "id": "trending_global",
            "title": "Global Heatwave",
            "tagline": "The hottest tracks dominating the planet right now",
            "badge": "Top Charts",
            "color": "#F5C542",
            "query": "Global Top 50 hits 2026"
        },
        {
            "id": "cyberpunk_chill",
            "title": "Cyberpunk & Synthwave",
            "tagline": "Neon night drives and futuristic frequencies",
            "badge": "Vibe Station",
            "color": "#22D3EE",
            "query": "Cyberpunk synthwave synth chill electro"
        },
        {
            "id": "lofi_zen",
            "title": "Lo-Fi Zen Oasis",
            "tagline": "Pure calm, study beats, and organic breathing room",
            "badge": "Deep Focus",
            "color": "#A855F7",
            "query": "Lofi hip hop beats to relax study to chill"
        },
        {
            "id": "midnight_drive",
            "title": "Midnight Hyperdrive",
            "tagline": "Hypnotic basslines and atmospheric nocturnal soundscapes",
            "badge": "Atmospheric",
            "color": "#F5C542",
            "query": "Midnight drive playlist phonk wave electronic"
        },
        {
            "id": "beast_mode",
            "title": "Beast Mode Workout",
            "tagline": "Adrenaline-fueled pump and high-BPM energy",
            "badge": "High Energy",
            "color": "#22D3EE",
            "query": "Workout gym motivation beast mode electronic rock"
        },
        {
            "id": "desi_bangers",
            "title": "Desi & Bollywood Bangers",
            "tagline": "Chart-topping desi rhythms, punjabi drops, and soulful melodies",
            "badge": "Trending India",
            "color": "#A855F7",
            "query": "Trending Bollywood Punjabi hits 2026"
        }
    ]

    feed_sections: List[Dict[str, Any]] = []
    
    # 1. Check if user profile has personal history for personalized sections
    if profile:
        try:
            personalized_secs = get_personalized_adaptive_sections(profile)
            feed_sections.extend(personalized_secs)
        except Exception as e:
            logger.warning(f"Error generating personalized sections: {e}")

    # 2. Fetch curated category tracks
    for cat in curated_categories:
        try:
            res = search_music(cat["query"], filter_type="songs", limit=12)
            tracks = res.get("tracks", [])
            if not tracks:
                tracks = search_via_ytdl(cat["query"], limit=12)
            if tracks:
                feed_sections.append({
                    "id": cat["id"],
                    "title": cat["title"],
                    "tagline": cat["tagline"],
                    "badge": cat["badge"],
                    "color": cat["color"],
                    "tracks": tracks
                })
        except Exception as e:
            logger.error(f"Error fetching explore section {cat['id']}: {e}")

    # 3. If all sections failed or empty, provide guaranteed curated fallback sections
    if not feed_sections:
        logger.info("Explore sections empty, populating curated yt-dlp fallback feed...")
        fallback_queries = [
            ("trending_global", "Global Heatwave", "The hottest tracks dominating the planet right now", "Top Charts", "#F5C542", "Global Top 50 hits 2026"),
            ("desi_bangers", "Desi & Bollywood Bangers", "Chart-topping desi rhythms and soulful melodies", "Trending India", "#A855F7", "Trending Bollywood Hindi songs 2026"),
            ("lofi_zen", "Lo-Fi Zen Oasis", "Pure calm, study beats, and organic breathing room", "Deep Focus", "#22D3EE", "Lofi hip hop chill beats relax"),
        ]
        for fid, ftitle, ftagline, fbadge, fcolor, fquery in fallback_queries:
            fb_tracks = search_via_ytdl(fquery, limit=10)
            if fb_tracks:
                feed_sections.append({
                    "id": fid,
                    "title": ftitle,
                    "tagline": ftagline,
                    "badge": fbadge,
                    "color": fcolor,
                    "tracks": fb_tracks
                })

    return {
        "hero": {
            "title": "Breathe The Sound",
            "subtitle": "Unchained. Uninterrupted. Pure High-Fidelity Audio.",
            "gradient": "linear-gradient(135deg, #F5C542 0%, #A855F7 50%, #22D3EE 100%)"
        },
        "sections": feed_sections
    }

# -------------------------------------------------------------
# MULTILINGUAL MOOD STATIONS & ADAPTIVE HUBS
# -------------------------------------------------------------
MOOD_DEFINITIONS: Dict[str, Dict[str, Any]] = {
    "breakup": {
        "id": "breakup",
        "name": "Breakup & Heartache",
        "icon": "💔",
        "color": "#F43F5E",
        "gradient": "linear-gradient(135deg, rgba(244, 63, 94, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Emotional healing, deep heartache, and raw melancholy",
        "queries": {
            "Telugu": "Telugu sad breakup heart touching melody songs",
            "Hindi": "Hindi sad breakup songs arijit singh b praak",
            "Tamil": "Tamil sad breakup songs melody",
            "Punjabi": "Punjabi sad romantic breakup songs",
            "English": "Heartbreak sad pop songs emotional acoustic",
            "default": "Heartbreak sad emotional acoustic songs"
        }
    },
    "sad": {
        "id": "sad",
        "name": "Sadness & Melancholy",
        "icon": "🌧️",
        "color": "#60A5FA",
        "gradient": "linear-gradient(135deg, rgba(96, 165, 250, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Deep reflective acoustic soul, rainy window vibes, and quiet thoughts",
        "queries": {
            "Telugu": "Telugu emotional slow melody songs soothing",
            "Hindi": "Hindi acoustic slow sad songs",
            "Tamil": "Tamil feel sad melody songs slow",
            "Punjabi": "Punjabi slow sad melodies",
            "English": "Slow acoustic sad melancholic songs chill",
            "default": "Melancholic acoustic slow songs"
        }
    },
    "love": {
        "id": "love",
        "name": "Romantic Love & Euphoria",
        "icon": "💖",
        "color": "#EC4899",
        "gradient": "linear-gradient(135deg, rgba(236, 72, 153, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Sweet romantic melodies, heartwarming duets, and pure passion",
        "queries": {
            "Telugu": "Telugu love songs romantic melody hits sid sriram",
            "Hindi": "Hindi romantic love songs latest arijit singh",
            "Tamil": "Tamil romantic love melody hits anirudh",
            "Punjabi": "Punjabi romantic love songs latest",
            "English": "Romantic love pop songs acoustic duo",
            "default": "Romantic love melody hits"
        }
    },
    "feel_good": {
        "id": "feel_good",
        "name": "Feel Good & Pure Joy",
        "icon": "☀️",
        "color": "#FBBF24",
        "gradient": "linear-gradient(135deg, rgba(251, 191, 36, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Instant dopamine, upbeat sunshine rhythms, and happy energy",
        "queries": {
            "Telugu": "Telugu energetic feel good happy songs dance",
            "Hindi": "Hindi happy feel good vibes upbeat songs",
            "Tamil": "Tamil feel good positive songs",
            "Punjabi": "Punjabi upbeat feel good happy songs",
            "English": "Feel good upbeat pop songs happy vibes",
            "default": "Feel good happy uplifting songs"
        }
    },
    "rock": {
        "id": "rock",
        "name": "High Voltage Rock & Metal",
        "icon": "⚡",
        "color": "#EF4444",
        "gradient": "linear-gradient(135deg, rgba(239, 68, 68, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Electrifying guitars, heavy bass, pure power, and stadium energy",
        "queries": {
            "Telugu": "Telugu rock songs heavy beats energetic",
            "Hindi": "Hindi rock band songs junoon amit trivedi",
            "Tamil": "Tamil rock songs mass anirudh",
            "English": "Rock metal classic rock guitar hits",
            "default": "Rock metal guitar rock hits"
        }
    },
    "heroic": {
        "id": "heroic",
        "name": "Heroic & Epic Cinematic",
        "icon": "🛡️",
        "color": "#F5C542",
        "gradient": "linear-gradient(135deg, rgba(245, 197, 66, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Massive orchestral anthems, heroic elevation, and blockbuster themes",
        "queries": {
            "Telugu": "Telugu mass heroic background music songs elevate",
            "Hindi": "Hindi epic cinematic heroic motivational songs",
            "Tamil": "Tamil mass elevate heroic theme songs",
            "English": "Epic orchestral heroic cinematic trailer music",
            "default": "Epic cinematic heroic anthems"
        }
    },
    "lofi": {
        "id": "lofi",
        "name": "Midnight Lofi & Chill",
        "icon": "🌌",
        "color": "#8B5CF6",
        "gradient": "linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Late-night studying, relaxing rainy synthbeats, and cozy frequencies",
        "queries": {
            "Telugu": "Telugu lofi chill songs slow reverb",
            "Hindi": "Hindi lofi chill remix beats soothing",
            "English": "Lofi hip hop beats relaxing midnight chill",
            "default": "Lofi hip hop chill relaxing beats"
        }
    },
    "workout": {
        "id": "workout",
        "name": "Workout & Pure Energy",
        "icon": "🔥",
        "color": "#F97316",
        "gradient": "linear-gradient(135deg, rgba(249, 115, 22, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "High BPM fitness motivation, aggressive drops, and cardio pumps",
        "queries": {
            "Telugu": "Telugu gym workout motivation energetic songs",
            "Hindi": "Hindi workout motivation aggressive songs",
            "English": "Gym workout motivation phonk edm high energy",
            "default": "Gym workout motivation high bpm phonk"
        }
    },
    "party": {
        "id": "party",
        "name": "Club Party & Dancefloor",
        "icon": "💃",
        "color": "#D946EF",
        "gradient": "linear-gradient(135deg, rgba(217, 70, 239, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Chart-topping party drops, club bangers, and non-stop bass",
        "queries": {
            "Telugu": "Telugu party dance songs mass",
            "Hindi": "Bollywood dance party club bangers",
            "Punjabi": "Punjabi party dance hits club",
            "English": "EDM party dance pop hits",
            "default": "Party dance club bangers EDM"
        }
    },
    "zen": {
        "id": "zen",
        "name": "Zen & Deep Meditation",
        "icon": "🧘",
        "color": "#10B981",
        "gradient": "linear-gradient(135deg, rgba(16, 185, 129, 0.3), rgba(15, 23, 42, 0.95))",
        "tagline": "Tranquil soundscapes, 432Hz healing, Tibetan bowls, and nature",
        "queries": {
            "default": "432hz healing meditation calm ambient sleep rain tranquil"
        }
    }
}

mood_cache: Dict[str, Dict[str, Any]] = {}
MOOD_CACHE_TTL = 1800  # 30 minutes

def get_mood_categories() -> List[Dict[str, Any]]:
    return [
        {
            "id": m["id"],
            "name": m["name"],
            "icon": m["icon"],
            "color": m["color"],
            "gradient": m["gradient"],
            "tagline": m["tagline"]
        }
        for m in MOOD_DEFINITIONS.values()
    ]

def get_mood_feed(mood_key: str, languages: Optional[List[str]] = None) -> Dict[str, Any]:
    mood = MOOD_DEFINITIONS.get(mood_key.lower())
    if not mood:
        mood = MOOD_DEFINITIONS.get("feel_good", list(MOOD_DEFINITIONS.values())[0])

    langs = languages or ["English", "Telugu", "Hindi"]
    cache_key = f"{mood['id']}:{':'.join(sorted(langs))}"
    now = time.time()

    if cache_key in mood_cache and mood_cache[cache_key]["expires_at"] > now:
        return mood_cache[cache_key]["data"]

    queries_map = mood.get("queries", {})
    selected_queries = []

    for l in langs:
        if l in queries_map:
            selected_queries.append(queries_map[l])
        else:
            selected_queries.append(f"{l} {mood['name']} hits songs")

    # Always ensure default query is available
    default_q = queries_map.get("default", f"{mood['name']} songs hits")
    if default_q not in selected_queries:
        selected_queries.append(default_q)

    all_tracks: List[Dict[str, Any]] = []
    seen_ids = set()

    for q in selected_queries[:4]:
        try:
            res = search_music(q, filter_type="songs", limit=16)
            tracks = res.get("tracks", [])
            if not tracks:
                tracks = search_via_ytdl(q, limit=12)
            for t in tracks:
                if t["id"] not in seen_ids:
                    seen_ids.add(t["id"])
                    all_tracks.append(t)
        except Exception as e:
            logger.warning(f"Error fetching mood query '{q}': {e}")

    # If still fewer than 5 tracks, run guaranteed yt-dlp fallback
    if len(all_tracks) < 5:
        try:
            fallback_tracks = search_via_ytdl(f"{mood['name']} popular songs hits", limit=16)
            for t in fallback_tracks:
                if t["id"] not in seen_ids:
                    seen_ids.add(t["id"])
                    all_tracks.append(t)
        except Exception as e:
            logger.warning(f"Fallback yt-dlp mood search error: {e}")

    result = {
        "mood": {
            "id": mood["id"],
            "name": mood["name"],
            "icon": mood["icon"],
            "color": mood["color"],
            "gradient": mood["gradient"],
            "tagline": mood["tagline"],
            "languages": langs
        },
        "total": len(all_tracks),
        "tracks": all_tracks
    }

    mood_cache[cache_key] = {
        "data": result,
        "expires_at": now + MOOD_CACHE_TTL
    }
    return result

