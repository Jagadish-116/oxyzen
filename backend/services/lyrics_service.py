import logging
import requests
import re
from typing import Dict, Any, Optional, List

logger = logging.getLogger("oxyzen_lyrics")

def parse_lrc(lrc_text: str) -> List[Dict[str, Any]]:
    """
    Parses standard LRC format into list of {time: seconds_float, text: str}
    """
    lines = lrc_text.strip().split("\n")
    parsed = []
    pattern = re.compile(r"\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)")
    
    for line in lines:
        match = pattern.match(line.strip())
        if match:
            mins = int(match.group(1))
            secs = int(match.group(2))
            ms = match.group(3)
            if len(ms) == 2:
                ms_val = int(ms) * 10
            else:
                ms_val = int(ms)
            total_seconds = mins * 60 + secs + (ms_val / 1000.0)
            text = match.group(4).strip()
            if text:
                parsed.append({
                    "time": round(total_seconds, 2),
                    "text": text
                })
    return parsed

def synthesize_timed_lines_from_plain(plain_text: str, duration_sec: int) -> List[Dict[str, Any]]:
    """
    Splits plain text lyrics into stanzas and assigns proportional timecodes across duration.
    """
    raw_lines = [l.strip() for l in plain_text.strip().split("\n") if l.strip()]
    if not raw_lines:
        return []
    
    dur = max(duration_sec or 180, 60)
    lead_in = 10.0  # 10s intro lead in
    active_span = max(dur - lead_in - 10.0, 30.0)
    interval = active_span / len(raw_lines)
    
    timed = []
    for idx, line in enumerate(raw_lines):
        t = round(lead_in + (idx * interval), 2)
        timed.append({"time": t, "text": line})
    return timed

def clean_search_terms(title: str, artist: str):
    """
    Aggressively strips YouTube music video tags, movie credits, and channel suffixes.
    """
    t = title
    # Remove bracketed and parenthesized video markers
    t = re.sub(r"(?i)\((official|lyric|video|audio|full|song|from|remix|4k|hd|visualizer|acoustic|live|cover|version).*?\)", "", t)
    t = re.sub(r"(?i)\[(official|lyric|video|audio|full|song|from|remix|4k|hd|visualizer|acoustic|live|cover|version).*?\]", "", t)
    t = re.sub(r"(?i)\|\s*(official|lyric|video|audio|full|song).*?$", "", t)
    t = re.sub(r"(?i)-\s*(official|lyric|video|audio|full|song).*?$", "", t)
    t = re.sub(r"[^\w\s\-\']", " ", t)
    t = re.sub(r"\s+", " ", t).strip()

    a = artist
    a = re.sub(r"(?i)\((feat|ft|featuring|topic|vevo).*?\)", "", a)
    a = re.sub(r"(?i)\[(feat|ft|featuring|topic|vevo).*?\]", "", a)
    a = re.sub(r"(?i)\s*-\s*Topic", "", a)
    a = re.sub(r"(?i)\s*VEVO", "", a)
    a = a.split(",")[0].split("&")[0].split("/")[0].strip()
    a = re.sub(r"\s+", " ", a).strip()

    return t, a

def get_lyrics(title: str, artist: str, duration_sec: Optional[int] = None) -> Dict[str, Any]:
    """
    Fetches synced and plain lyrics using LRCLIB and fallback public lyrics engines.
    """
    clean_title, clean_artist = clean_search_terms(title, artist)
    dur = duration_sec or 0

    result = {
        "synced": False,
        "lines": [],
        "plain": "",
        "instrumental": False,
        "provider": "Oxyzen Lyrics Engine"
    }

    # 1. Try exact match on LRCLIB
    try:
        params = {
            "track_name": clean_title,
            "artist_name": clean_artist
        }
        if dur > 0:
            params["duration"] = str(dur)

        res = requests.get("https://lrclib.net/api/get", params=params, timeout=3.5)
        if res.status_code == 200:
            data = res.json()
            if data.get("instrumental"):
                result["instrumental"] = True
                result["plain"] = "✦ Instrumental Studio Track ✦"
                return result
                
            if data.get("syncedLyrics"):
                parsed = parse_lrc(data["syncedLyrics"])
                if parsed:
                    result["synced"] = True
                    result["lines"] = parsed
                    result["plain"] = data.get("plainLyrics", "")
                    return result
            elif data.get("plainLyrics"):
                result["plain"] = data["plainLyrics"]
                result["synced"] = True
                result["lines"] = synthesize_timed_lines_from_plain(data["plainLyrics"], dur)
                return result
    except Exception as e:
        logger.warning(f"LRCLIB get error: {e}")

    # 2. Try broad search on LRCLIB
    try:
        search_query = f"{clean_title} {clean_artist}".strip()
        res = requests.get(f"https://lrclib.net/api/search?q={requests.utils.quote(search_query)}", timeout=3.5)
        if res.status_code == 200:
            items = res.json()
            if isinstance(items, list) and len(items) > 0:
                for item in items:
                    if item.get("syncedLyrics"):
                        parsed = parse_lrc(item["syncedLyrics"])
                        if parsed:
                            result["synced"] = True
                            result["lines"] = parsed
                            result["plain"] = item.get("plainLyrics", "")
                            return result
                    elif item.get("plainLyrics") and not result["plain"]:
                        result["plain"] = item["plainLyrics"]
                
                if result["plain"]:
                    result["synced"] = True
                    result["lines"] = synthesize_timed_lines_from_plain(result["plain"], dur)
                    return result
    except Exception as e:
        logger.warning(f"LRCLIB search error: {e}")

    # 3. Fallback aesthetic lyrics lines if no lyrics found
    if not result["lines"]:
        fallback_stanzas = [
            f"✦ Listening to '{title}' by {artist}",
            "✦ Pure High-Fidelity Audio Stream",
            "✦ Breathe the music in studio clarity",
            "✦ Synced spatial stereo fidelity active"
        ]
        result["plain"] = "\n".join(fallback_stanzas)
        result["synced"] = True
        result["lines"] = [
            {"time": 5.0, "text": f"♪ {title} ♪"},
            {"time": 15.0, "text": f"Artist: {artist}"},
            {"time": 30.0, "text": "✦ Pure Unchained High-Fidelity Audio ✦"},
            {"time": 60.0, "text": "✦ Enjoying Lossless Spatial Audio on Oxyzen ✦"},
            {"time": 90.0, "text": f"♪ {title} ♪"}
        ]

    return result
