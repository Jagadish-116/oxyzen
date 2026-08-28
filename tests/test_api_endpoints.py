import pytest

def test_health_check(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "OXYZEN" in data["service"]

def test_root_frontend(client):
    response = client.get("/")
    assert response.status_code == 200
    # Should serve index.html
    assert "OXYZEN" in response.text or "html" in response.text

def test_api_suggestions(client):
    response = client.get("/api/suggestions?q=synthwave")
    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "synthwave"
    assert isinstance(data["suggestions"], list)

def test_api_search(client):
    response = client.get("/api/search?q=Daft+Punk&filter=songs&limit=5")
    assert response.status_code == 200
    data = response.json()
    assert "tracks" in data
    assert isinstance(data["tracks"], list)

def test_api_explore(client):
    response = client.get("/api/explore")
    assert response.status_code == 200
    data = response.json()
    assert "sections" in data
    assert len(data["sections"]) > 0

def test_api_personalized(client):
    # Add a history track to establish a taste profile
    track = {
        "id": "trk_personal_1",
        "title": "Starboy",
        "artist": "The Weeknd",
        "album": "Starboy",
        "duration": "3:50",
        "duration_sec": 230,
        "thumbnail": ""
    }
    client.post("/api/library/history/add", json=track)

    response = client.get("/api/personalized")
    assert response.status_code == 200
    data = response.json()
    assert "profile" in data
    assert "sections" in data
    assert data["profile"]["total_plays"] >= 1

def test_api_user_profile(client):
    # Get default profile
    res = client.get("/api/user/profile")
    assert res.status_code == 200
    data = res.json()
    assert "profile" in data
    assert "languages" in data["profile"]

    # Save new profile
    update_payload = {
        "name": "SoundMaster",
        "avatar": "🔥",
        "languages": ["Telugu", "English", "Hindi"],
        "audio_quality": "Master 320k"
    }
    res_save = client.post("/api/user/profile", json=update_payload)
    assert res_save.status_code == 200
    assert res_save.json()["success"] is True

    # Verify updated profile
    res_after = client.get("/api/user/profile")
    assert res_after.json()["profile"]["name"] == "SoundMaster"
    assert res_after.json()["profile"]["avatar"] == "🔥"
    assert "Telugu" in res_after.json()["profile"]["languages"]

def test_api_moods(client):
    # Get all mood categories
    res = client.get("/api/moods")
    assert res.status_code == 200
    data = res.json()
    assert "moods" in data
    assert len(data["moods"]) >= 8

    # Get specific mood feed (e.g. love)
    res_mood = client.get("/api/moods/love?languages=Telugu,English")
    assert res_mood.status_code == 200
    feed = res_mood.json()
    assert "mood" in feed
    assert feed["mood"]["id"] == "love"
    assert "tracks" in feed

def test_api_recommendations(client):
    response = client.get("/api/recommendations?artist=Daft+Punk&title=Get+Lucky")
    assert response.status_code == 200
    data = response.json()
    assert "recommendations" in data

def test_api_lyrics(client):
    response = client.get("/api/lyrics?title=Starboy&artist=The+Weeknd")
    assert response.status_code == 200
    data = response.json()
    assert "plain" in data or "lines" in data

def test_api_likes_flow(client):
    # Initial likes
    res = client.get("/api/library/likes")
    assert res.status_code == 200
    assert res.json()["total"] == 0

    track = {
        "id": "trk_endpoint_1",
        "title": "Midnight City",
        "artist": "M83",
        "album": "Album",
        "duration": "4:00",
        "duration_sec": 240,
        "thumbnail": "https://example.com/thumb.jpg"
    }

    # Toggle like (add)
    res_toggle = client.post("/api/library/likes/toggle", json=track)
    assert res_toggle.status_code == 200
    assert res_toggle.json()["liked"] is True

    # Check likes
    res_after = client.get("/api/library/likes")
    assert res_after.json()["total"] == 1
    assert "trk_endpoint_1" in res_after.json()["liked_ids"]

    # Toggle like (remove)
    res_toggle_off = client.post("/api/library/likes/toggle", json=track)
    assert res_toggle_off.json()["liked"] is False
    assert client.get("/api/library/likes").json()["total"] == 0

def test_api_playlists_flow(client):
    # Create playlist
    res = client.post("/api/library/playlists/create", json={"name": "Night Vibes", "description": "Lofi & Chill"})
    assert res.status_code == 200
    pl = res.json()
    pl_id = pl["id"]

    # Get playlists list
    res_list = client.get("/api/library/playlists")
    assert len(res_list.json()["playlists"]) == 1

    # Add track
    track = {
        "id": "trk_pl_1",
        "title": "Resonance",
        "artist": "HOME",
        "album": "Odyssey",
        "duration": "3:30",
        "duration_sec": 210,
        "thumbnail": ""
    }
    res_add = client.post(f"/api/library/playlists/{pl_id}/add", json=track)
    assert res_add.status_code == 200
    assert res_add.json()["success"] is True

    # Get details
    res_det = client.get(f"/api/library/playlists/{pl_id}")
    assert res_det.status_code == 200
    assert len(res_det.json()["tracks"]) == 1

    # Remove track
    res_del_trk = client.delete(f"/api/library/playlists/{pl_id}/track/trk_pl_1")
    assert res_del_trk.status_code == 200
    assert res_del_trk.json()["success"] is True

    # Delete playlist
    res_del_pl = client.delete(f"/api/library/playlists/{pl_id}")
    assert res_del_pl.status_code == 200
    assert res_del_pl.json()["success"] is True

def test_api_history_flow(client):
    # Add history item
    track = {
        "id": "trk_hist_1",
        "title": "Blinding Lights",
        "artist": "The Weeknd",
        "album": "After Hours",
        "duration": "3:20",
        "duration_sec": 200,
        "thumbnail": ""
    }
    res_add = client.post("/api/library/history/add", json=track)
    assert res_add.status_code == 200

    # Get history
    res_get = client.get("/api/library/history")
    assert res_get.status_code == 200
    assert len(res_get.json()["history"]) == 1
    assert res_get.json()["history"][0]["track_id"] == "trk_hist_1"

    # Clear history
    res_clear = client.post("/api/library/history/clear")
    assert res_clear.status_code == 200
    assert len(client.get("/api/library/history").json()["history"]) == 0

def test_api_rooms_flow(client):
    # Create room
    res = client.post("/api/rooms/create", json={"room_name": "Antigravity Lounge", "host_name": "Tester", "room_code": "TEST88"})
    assert res.status_code == 200
    data = res.json()
    assert data["room_code"] == "TEST88"

    # Get room info
    res_info = client.get("/api/rooms/TEST88")
    assert res_info.status_code == 200
    assert res_info.json()["room_name"] == "Antigravity Lounge"
