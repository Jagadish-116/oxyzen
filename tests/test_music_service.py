import pytest
from backend.services.music_service import (
    format_duration, parse_duration_str, clean_thumbnail, clean_track_item,
    get_search_suggestions, search_music, get_explore_feed, get_vibe_recommendations,
    _extract_best_stream_url
)

def test_format_duration():
    assert format_duration(None) == "0:00"
    assert format_duration(0) == "0:00"
    assert format_duration(65) == "1:05"
    assert format_duration(3600) == "60:00"
    assert format_duration(215) == "3:35"

def test_parse_duration_str():
    assert parse_duration_str(None) == 0
    assert parse_duration_str("") == 0
    assert parse_duration_str("3:45") == 225
    assert parse_duration_str("1:02:10") == 3730
    assert parse_duration_str("invalid") == 0

def test_clean_thumbnail():
    assert clean_thumbnail([]) == "/static/assets/logo.png"
    thumbs = [
        {"url": "https://example.com/w120-h120/image.jpg", "width": 120},
        {"url": "https://example.com/w544-h544/image.jpg", "width": 544}
    ]
    cleaned = clean_thumbnail(thumbs)
    assert "w544-h544" in cleaned

def test_clean_track_item():
    raw_item = {
        "videoId": "abc123xyz",
        "title": "Midnight Resonance",
        "artists": [{"name": "Synth Master"}],
        "album": {"name": "Retro Future"},
        "duration": "3:30",
        "duration_seconds": 210,
        "thumbnails": [{"url": "https://example.com/art.jpg", "width": 300}],
        "year": "2026"
    }
    cleaned = clean_track_item(raw_item)
    assert cleaned is not None
    assert cleaned["id"] == "abc123xyz"
    assert cleaned["title"] == "Midnight Resonance"
    assert cleaned["artist"] == "Synth Master"
    assert cleaned["album"] == "Retro Future"
    assert cleaned["duration_sec"] == 210

    # Missing videoId should return None
    assert clean_track_item({"title": "No ID"}) is None

def test_get_search_suggestions():
    assert get_search_suggestions("") == []
    assert get_search_suggestions("   ") == []
    # Test real suggestions lookup
    suggestions = get_search_suggestions("The Weeknd")
    assert isinstance(suggestions, list)

def test_search_music_empty():
    res = search_music("")
    assert res == {"tracks": [], "artists": [], "albums": [], "playlists": []}

def test_explore_feed():
    feed = get_explore_feed()
    assert "hero" in feed
    assert "sections" in feed
    assert isinstance(feed["sections"], list)
    assert len(feed["sections"]) > 0
    for sec in feed["sections"]:
        assert "id" in sec
        assert "title" in sec
        assert "tracks" in sec
        assert isinstance(sec["tracks"], list)

def test_extract_best_stream_url():
    # Direct URL test
    assert _extract_best_stream_url({"url": "https://example.com/stream.m4a"}) == "https://example.com/stream.m4a"
    
    # Formats tree test with audio formats
    info_with_formats = {
        "formats": [
            {"format_id": "1", "url": "https://example.com/audio_low.m4a", "vcodec": "none", "acodec": "mp4a", "abr": 64},
            {"format_id": "2", "url": "https://example.com/audio_high.m4a", "vcodec": "none", "acodec": "mp4a", "abr": 160},
            {"format_id": "3", "url": "https://example.com/video.mp4", "vcodec": "avc1", "acodec": "none", "tbr": 500}
        ]
    }
    assert _extract_best_stream_url(info_with_formats) == "https://example.com/audio_high.m4a"

    # Empty or None info
    assert _extract_best_stream_url(None) is None
    assert _extract_best_stream_url({}) is None

