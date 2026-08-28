import pytest
from backend.services.music_service import (
    format_duration, parse_duration_str, clean_thumbnail, clean_track_item,
    get_search_suggestions, search_music, get_explore_feed, get_vibe_recommendations
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
