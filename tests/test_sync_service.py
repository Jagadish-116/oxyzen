import pytest
import time
from backend.services.sync_service import SoundSyncRoom, SoundSyncManager

def test_soundsync_room_basics():
    room = SoundSyncRoom(code="PARTY1", name="Chill Vibes", host_id="user_1", host_name="Alice")
    assert room.code == "PARTY1"
    assert room.name == "Chill Vibes"
    assert room.host_id == "user_1"
    assert room.is_playing is False
    assert room.current_time == 0.0
    assert room.get_estimated_current_time() == 0.0

    state = room.to_state_dict()
    assert state["room_code"] == "PARTY1"
    assert state["room_name"] == "Chill Vibes"
    assert state["listener_count"] == 0

def test_soundsync_playback_estimation():
    room = SoundSyncRoom(code="EST1", name="Estimation Test", host_id="user_1", host_name="Alice")
    room.is_playing = True
    room.current_time = 10.0
    room.last_sync_timestamp = time.time() - 2.5  # 2.5 seconds elapsed

    est = room.get_estimated_current_time()
    assert 12.0 <= est <= 13.0

def test_soundsync_listeners_and_host_transfer():
    room = SoundSyncRoom(code="LISTEN", name="Listening Room", host_id="user_1", host_name="Host User")
    
    # Add first user
    room.add_listener(user_id="user_1", name="Host User", avatar="👑", ws=None)
    assert len(room.listeners) == 1
    assert room.listeners["user_1"]["is_host"] is True

    # Add second user
    room.add_listener(user_id="user_2", name="Listener Bob", avatar="🎧", ws=None)
    assert len(room.listeners) == 2
    assert room.listeners["user_2"]["is_host"] is False

    # Remove host -> automatic promotion of remaining listener
    room.remove_listener("user_1")
    assert len(room.listeners) == 1
    assert room.host_id == "user_2"
    assert room.listeners["user_2"]["is_host"] is True

    # Remove second user -> empty
    room.remove_listener("user_2")
    assert len(room.listeners) == 0

def test_soundsync_manager():
    mgr = SoundSyncManager()
    room = mgr.create_room(name="Room Alpha", host_id="u1", host_name="User 1")
    assert room.code in mgr.rooms
    assert mgr.get_room(room.code) == room
    assert mgr.get_room(room.code.lower()) == room

    # Custom room code
    custom_room = mgr.create_room(name="VIP Room", host_id="u2", host_name="VIP", custom_code="VIP777")
    assert custom_room.code == "VIP777"
    assert mgr.get_room("vip777") == custom_room

    # Delete room
    mgr.delete_room("VIP777")
    assert mgr.get_room("VIP777") is None

def test_soundsync_song_requests_and_admins():
    room = SoundSyncRoom(code="REQADM", name="Party Space", host_id="host_1", host_name="Master Host")
    room.add_listener("host_1", "Master Host", "👑", None)
    room.add_listener("user_2", "Guest Listener", "🎧", None)

    # 1. Admin promotion & demotion
    assert room.is_admin_or_host("host_1") is True
    assert room.is_admin_or_host("user_2") is False

    assert room.promote_admin("user_2") is True
    assert room.is_admin_or_host("user_2") is True
    assert "user_2" in room.admins

    state = room.to_state_dict()
    assert state["listeners"][1]["is_admin"] is True

    assert room.demote_admin("user_2") is True
    assert room.is_admin_or_host("user_2") is False

    # 2. Song Requests Flow
    track = {
        "id": "trk_req_1",
        "title": "Blinding Lights",
        "artist": "The Weeknd",
        "duration": "3:20"
    }

    req = room.add_request(track, "user_2", "Guest Listener", "🎧")
    assert len(room.requests) == 1
    assert req["track"]["id"] == "trk_req_1"
    assert req["user_name"] == "Guest Listener"

    # Accept request into queue
    accepted = room.accept_request(req["id"], play_now=False)
    assert accepted is not None
    assert len(room.requests) == 0
    assert len(room.queue) == 1
    assert room.queue[0]["id"] == "trk_req_1"

