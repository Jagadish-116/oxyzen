import json
import time
import random
import string
import logging
from typing import Dict, List, Any, Optional, Set
from fastapi import WebSocket

logger = logging.getLogger("oxyzen_sync")

class SoundSyncRoom:
    def __init__(self, code: str, name: str, host_id: str, host_name: str):
        self.code = code
        self.name = name
        self.host_id = host_id
        self.created_at = time.time()
        self.current_track: Optional[Dict[str, Any]] = None
        self.is_playing: bool = False
        self.current_time: float = 0.0
        self.last_sync_timestamp: float = time.time()
        self.queue: List[Dict[str, Any]] = []
        # user_id -> {"name": str, "avatar": str, "ws": WebSocket, "is_host": bool}
        self.listeners: Dict[str, Dict[str, Any]] = {}
        # Co-Hosts / Admins authorized to control music alongside host
        self.admins: Set[str] = set()
        # Song requests list submitted by room participants
        self.requests: List[Dict[str, Any]] = []

    def is_admin_or_host(self, user_id: str) -> bool:
        return user_id == self.host_id or user_id in self.admins

    def promote_admin(self, user_id: str) -> bool:
        if user_id in self.listeners and user_id != self.host_id:
            self.admins.add(user_id)
            return True
        return False

    def demote_admin(self, user_id: str) -> bool:
        if user_id in self.admins:
            self.admins.remove(user_id)
            return True
        return False

    def add_request(self, track: Dict[str, Any], user_id: str, user_name: str, avatar: str) -> Dict[str, Any]:
        req_id = f"req_{int(time.time()*1000)}_{random.randint(100, 999)}"
        item = {
            "id": req_id,
            "track": track,
            "user_id": user_id,
            "user_name": user_name,
            "avatar": avatar or "🎧",
            "timestamp": time.time()
        }
        self.requests.append(item)
        return item

    def remove_request(self, request_id: str) -> bool:
        initial_len = len(self.requests)
        self.requests = [r for r in self.requests if r.get("id") != request_id]
        return len(self.requests) < initial_len

    def accept_request(self, request_id: str, play_now: bool = False) -> Optional[Dict[str, Any]]:
        found = None
        for r in self.requests:
            if r.get("id") == request_id:
                found = r
                break
        if found:
            self.remove_request(request_id)
            track = found["track"]
            if play_now:
                self.current_track = track
                self.is_playing = True
                self.current_time = 0.0
                self.last_sync_timestamp = time.time()
            else:
                self.queue.append(track)
            return {"track": track, "play_now": play_now, "requester": found["user_name"]}
        return None

    def get_estimated_current_time(self) -> float:
        if not self.is_playing:
            return self.current_time
        elapsed = time.time() - self.last_sync_timestamp
        return max(0.0, self.current_time + elapsed)

    def to_state_dict(self) -> Dict[str, Any]:
        listeners_list = [
            {
                "user_id": uid,
                "name": data["name"],
                "avatar": data.get("avatar", "🎧"),
                "is_host": (uid == self.host_id),
                "is_admin": (uid == self.host_id or uid in self.admins)
            }
            for uid, data in self.listeners.items()
        ]
        return {
            "room_code": self.code,
            "room_name": self.name,
            "host_id": self.host_id,
            "admins": list(self.admins),
            "current_track": self.current_track,
            "is_playing": self.is_playing,
            "current_time": self.get_estimated_current_time(),
            "server_timestamp": time.time(),
            "queue": self.queue,
            "requests": self.requests,
            "listener_count": len(self.listeners),
            "listeners": listeners_list
        }

    async def broadcast(self, message: Dict[str, Any], exclude_user_id: Optional[str] = None):
        payload = json.dumps(message)
        disconnected = []
        for uid, listener in list(self.listeners.items()):
            if exclude_user_id and uid == exclude_user_id:
                continue
            ws: WebSocket = listener.get("ws")
            if ws:
                try:
                    await ws.send_text(payload)
                except Exception as e:
                    logger.warning(f"Error sending message to {uid}: {e}")
                    disconnected.append(uid)
        for uid in disconnected:
            self.remove_listener(uid)

    def add_listener(self, user_id: str, name: str, avatar: str, ws: WebSocket):
        is_host = (user_id == self.host_id or len(self.listeners) == 0)
        if is_host:
            self.host_id = user_id
        self.listeners[user_id] = {
            "name": name,
            "avatar": avatar,
            "ws": ws,
            "is_host": is_host
        }

    def remove_listener(self, user_id: str) -> bool:
        if user_id in self.listeners:
            del self.listeners[user_id]
            self.admins.discard(user_id)
            # If host left and there are other listeners, promote the oldest listener
            if user_id == self.host_id and len(self.listeners) > 0:
                next_host_id = next(iter(self.listeners))
                self.host_id = next_host_id
                self.listeners[next_host_id]["is_host"] = True
                self.admins.discard(next_host_id)
            return True
        return False


class SoundSyncManager:
    def __init__(self):
        self.rooms: Dict[str, SoundSyncRoom] = {}

    def generate_room_code(self, length: int = 6) -> str:
        chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        while True:
            code = "".join(random.choice(chars) for _ in range(length))
            if code not in self.rooms:
                return code

    def create_room(self, name: str, host_id: str, host_name: str, custom_code: Optional[str] = None) -> SoundSyncRoom:
        code = custom_code.upper().strip() if custom_code and len(custom_code.strip()) >= 3 else self.generate_room_code()
        room = SoundSyncRoom(code=code, name=name or f"{host_name}'s SoundSync Lounge", host_id=host_id, host_name=host_name)
        self.rooms[code] = room
        return room

    def get_room(self, code: str) -> Optional[SoundSyncRoom]:
        return self.rooms.get(code.upper().strip())

    def delete_room(self, code: str):
        if code.upper() in self.rooms:
            del self.rooms[code.upper()]

    def cleanup_empty_rooms(self):
        now = time.time()
        to_delete = []
        for code, room in list(self.rooms.items()):
            if len(room.listeners) == 0 and (now - room.created_at > 3600):
                to_delete.append(code)
        for code in to_delete:
            self.delete_room(code)

sync_manager = SoundSyncManager()
