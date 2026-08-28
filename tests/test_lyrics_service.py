import pytest
from backend.services.lyrics_service import parse_lrc, get_lyrics

def test_parse_lrc():
    sample_lrc = """
    [00:12.34] First line of lyrics
    [01:05.567] Second line of lyrics with 3 decimal digits
    [02:30.00] Third line of lyrics
    """
    parsed = parse_lrc(sample_lrc)
    assert len(parsed) == 3
    assert parsed[0]["time"] == 12.34
    assert parsed[0]["text"] == "First line of lyrics"

    assert parsed[1]["time"] == 65.57  # 1m 5.567s
    assert parsed[1]["text"] == "Second line of lyrics with 3 decimal digits"

    assert parsed[2]["time"] == 150.0
    assert parsed[2]["text"] == "Third line of lyrics"

def test_parse_lrc_empty_or_malformed():
    assert parse_lrc("") == []
    assert parse_lrc("Some random text without timestamps") == []

def test_get_lyrics_fallback():
    # Test fallback behavior when song is not found or mock lookup
    res = get_lyrics("NonExistentSong12345XYZ", "NonExistentArtist98765ABC")
    assert isinstance(res, dict)
    assert "plain" in res
    assert "synced" in res
    assert "lines" in res
