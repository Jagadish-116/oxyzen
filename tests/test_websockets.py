import pytest
import json

def test_websocket_room_lifecycle(client):
    room_code = "WSTEST"
    
    # Connect to room websocket
    with client.websocket_connect(f"/ws/room/{room_code}") as ws:
        # Send JOIN message
        ws.send_text(json.dumps({
            "type": "JOIN",
            "user_id": "user_host_1",
            "user_name": "Host Alice",
            "avatar": "🎧"
        }))

        # Receive ROOM_STATE
        resp_raw = ws.receive_text()
        resp = json.loads(resp_raw)
        assert resp["type"] == "ROOM_STATE"
        assert resp["state"]["room_code"] == room_code
        assert resp["you"]["is_host"] is True

        # Host plays a track
        ws.send_text(json.dumps({
            "type": "PLAY_TRACK",
            "track": {
                "id": "trk_ws_1",
                "title": "Starlight",
                "artist": "Muse"
            }
        }))

        # Receive PLAY_TRACK broadcast
        track_msg = json.loads(ws.receive_text())
        assert track_msg["type"] == "PLAY_TRACK"
        assert track_msg["track"]["id"] == "trk_ws_1"
        assert track_msg["is_playing"] is True

        # Host sends chat message
        ws.send_text(json.dumps({
            "type": "CHAT_MESSAGE",
            "text": "Hello party people!"
        }))

        chat_msg = json.loads(ws.receive_text())
        assert chat_msg["type"] == "CHAT_MESSAGE"
        assert chat_msg["text"] == "Hello party people!"
        assert chat_msg["user_name"] == "Host Alice"

        # Host sends reaction pulse
        ws.send_text(json.dumps({
            "type": "REACTION_PULSE",
            "emoji": "🔥"
        }))

        pulse_msg = json.loads(ws.receive_text())
        assert pulse_msg["type"] == "REACTION_PULSE"
        assert pulse_msg["emoji"] == "🔥"
