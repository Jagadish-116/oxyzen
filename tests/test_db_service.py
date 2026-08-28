import pytest
from backend.services.db_service import (
    init_db, toggle_like, get_likes, get_liked_ids,
    create_playlist, get_playlists, get_playlist_details,
    add_track_to_playlist, remove_track_from_playlist, delete_playlist,
    add_to_history, get_history, clear_history,
    save_preference, get_preference, get_user_listening_profile
)

def test_init_db():
    init_db()
    # Should not throw when initialized multiple times
    init_db()

def test_likes_management():
    track_1 = {
        "id": "vid_101",
        "title": "Midnight City",
        "artist": "M83",
        "album": "Hurry Up, We're Dreaming",
        "duration": "4:03",
        "duration_sec": 243,
        "thumbnail": "https://example.com/thumb.jpg"
    }

    # Initial state
    assert get_likes() == []
    assert get_liked_ids() == []

    # Toggle like -> True
    is_liked = toggle_like(track_1)
    assert is_liked is True
    likes = get_likes()
    assert len(likes) == 1
    assert likes[0]["id"] == "vid_101"
    assert likes[0]["title"] == "Midnight City"
    assert get_liked_ids() == ["vid_101"]

    # Toggle like again -> False (unlike)
    is_liked = toggle_like(track_1)
    assert is_liked is False
    assert len(get_likes()) == 0
    assert get_liked_ids() == []

    # Toggle with missing ID
    assert toggle_like({}) is False

def test_playlists_crud():
    # Create playlist
    pl = create_playlist(name="Synthwave Favorites", description="Best retro synth", cover_url="https://example.com/cover.jpg")
    pl_id = pl["id"]
    assert pl["name"] == "Synthwave Favorites"
    assert pl["description"] == "Best retro synth"

    playlists = get_playlists()
    assert len(playlists) == 1
    assert playlists[0]["id"] == pl_id
    assert playlists[0]["track_count"] == 0

    # Add tracks
    track_a = {
        "id": "trk_1",
        "title": "Resonance",
        "artist": "HOME",
        "album": "Odyssey",
        "duration": "3:32",
        "duration_sec": 212,
        "thumbnail": "https://example.com/res.jpg"
    }
    track_b = {
        "id": "trk_2",
        "title": "Days of Thunder",
        "artist": "The Midnight",
        "album": "Days of Thunder",
        "duration": "5:20",
        "duration_sec": 320,
        "thumbnail": "https://example.com/dot.jpg"
    }

    assert add_track_to_playlist(pl_id, track_a) is True
    assert add_track_to_playlist(pl_id, track_b) is True
    assert add_track_to_playlist(pl_id, {}) is False

    # Get details
    details = get_playlist_details(pl_id)
    assert details is not None
    assert len(details["tracks"]) == 2
    assert details["tracks"][0]["track_id"] == "trk_1"
    assert details["tracks"][0]["position"] == 0
    assert details["tracks"][1]["track_id"] == "trk_2"
    assert details["tracks"][1]["position"] == 1

    # Remove track
    assert remove_track_from_playlist(pl_id, "trk_1") is True
    details_after_removal = get_playlist_details(pl_id)
    assert len(details_after_removal["tracks"]) == 1
    assert details_after_removal["tracks"][0]["track_id"] == "trk_2"

    # Delete playlist
    assert delete_playlist(pl_id) is True
    assert get_playlist_details(pl_id) is None
    assert len(get_playlists()) == 0

def test_history_management():
    assert get_history() == []

    for i in range(5):
        add_to_history({
            "id": f"hist_{i}",
            "title": f"Track {i}",
            "artist": f"Artist {i % 2}",
            "album": "Album",
            "duration": "3:00",
            "duration_sec": 180,
            "thumbnail": ""
        })

    hist = get_history(limit=3)
    assert len(hist) == 3
    # Most recent first
    assert hist[0]["track_id"] == "hist_4"

    full_hist = get_history(limit=50)
    assert len(full_hist) == 5

    # Test user listening profile extraction
    profile = get_user_listening_profile()
    assert profile["total_plays"] == 5
    assert len(profile["top_history_artists"]) > 0

    # Clear history
    clear_history()
    assert len(get_history()) == 0

def test_preferences():
    assert get_preference("volume", default=80) == 80
    save_preference("volume", 95)
    assert get_preference("volume") == 95

    eq_settings = {"preset": "Bass Boost", "gains": [4, 3, 2, 1, 0, 0, 1, 2, 3, 4]}
    save_preference("eq", eq_settings)
    assert get_preference("eq") == eq_settings
