/**
 * SoundSync Lounge Management Service for Oxyzen
 * Handles real-time multi-user WebSocket rooms, state broadcast, drift correction,
 * chat messages, song requests, and co-host admin roles.
 */
export class SyncRoom {
    code;
    name;
    host_id;
    created_at;
    current_track = null;
    position = 0;
    is_playing = false;
    updated_at;
    listeners = new Map();
    admins = new Set();
    requests = [];
    queue = [];
    chat_history = [];
    sockets = new Set();
    emptyTimeout = null;
    constructor(code, name, hostId, hostName = 'Host') {
        this.code = code.toUpperCase().trim();
        this.name = name;
        this.host_id = hostId;
        this.created_at = Date.now() / 1000;
        this.updated_at = this.created_at;
        this.admins.add(hostId);
        // Initial host listener
        this.listeners.set(hostId, {
            id: hostId,
            name: hostName,
            avatar: '👑',
            is_host: true,
            is_admin: true,
            joined_at: this.created_at
        });
    }
    addSocket(ws) {
        this.sockets.add(ws);
        if (this.emptyTimeout) {
            clearTimeout(this.emptyTimeout);
            this.emptyTimeout = null;
        }
    }
    removeSocket(ws) {
        this.sockets.delete(ws);
    }
    addListener(id, name, avatar) {
        const isHost = id === this.host_id;
        const listener = {
            id,
            name: name || `Listener_${id.slice(-4)}`,
            avatar: avatar || (isHost ? '👑' : '🎧'),
            is_host: isHost,
            is_admin: isHost || this.admins.has(id),
            joined_at: Date.now() / 1000
        };
        this.listeners.set(id, listener);
        return listener;
    }
    removeListener(id) {
        const removed = this.listeners.delete(id);
        this.admins.delete(id);
        // If host left and others remain, promote the next listener to host
        if (id === this.host_id && this.listeners.size > 0) {
            const nextHost = Array.from(this.listeners.values())[0];
            this.host_id = nextHost.id;
            nextHost.is_host = true;
            nextHost.is_admin = true;
            this.admins.add(nextHost.id);
        }
        return removed;
    }
    promoteToAdmin(userId) {
        const listener = this.listeners.get(userId);
        if (!listener)
            return false;
        this.admins.add(userId);
        listener.is_admin = true;
        return true;
    }
    demoteFromAdmin(userId) {
        if (userId === this.host_id)
            return false; // Host cannot be demoted
        const listener = this.listeners.get(userId);
        if (!listener)
            return false;
        this.admins.delete(userId);
        listener.is_admin = false;
        return true;
    }
    updatePlayback(track, position, isPlaying) {
        if (track)
            this.current_track = track;
        this.position = position;
        this.is_playing = isPlaying;
        this.updated_at = Date.now() / 1000;
    }
    addRequest(track, requesterId, requesterName) {
        const req = {
            id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            track,
            requester_id: requesterId,
            requester_name: requesterName,
            created_at: Date.now() / 1000
        };
        this.requests.unshift(req);
        // Limit to 20 pending requests
        if (this.requests.length > 20)
            this.requests = this.requests.slice(0, 20);
        return req;
    }
    dismissRequest(reqId) {
        this.requests = this.requests.filter(r => r.id !== reqId);
    }
    addChatMessage(msg) {
        this.chat_history.push(msg);
        if (this.chat_history.length > 50) {
            this.chat_history.shift();
        }
    }
    broadcast(message, excludeWs = null) {
        const payload = JSON.stringify(message);
        for (const ws of this.sockets) {
            if (ws !== excludeWs) {
                try {
                    if (typeof ws.send === 'function') {
                        ws.send(payload);
                    }
                }
                catch (err) {
                    console.warn('Error broadcasting to sync socket:', err);
                }
            }
        }
    }
    toStateDict() {
        return {
            room_code: this.code,
            room_name: this.name,
            host_id: this.host_id,
            created_at: this.created_at,
            current_track: this.current_track,
            current_time: this.position,
            position: this.position,
            is_playing: this.is_playing,
            updated_at: this.updated_at,
            listener_count: this.listeners.size,
            listeners: Array.from(this.listeners.values()),
            admins: Array.from(this.admins),
            requests: this.requests,
            queue: this.queue,
            chat_history: this.chat_history
        };
    }
}
export class SyncManager {
    rooms = new Map();
    createRoom(name = 'Oxyzen SoundSync Lounge', hostId = 'user_host', hostName = 'Host', customCode) {
        let code = (customCode || '').toUpperCase().trim();
        if (!code || code.length < 3 || this.rooms.has(code)) {
            code = Math.random().toString(36).substring(2, 8).toUpperCase();
        }
        const room = new SyncRoom(code, name, hostId, hostName);
        this.rooms.set(code, room);
        return room;
    }
    getRoom(code) {
        if (!code)
            return null;
        return this.rooms.get(code.toUpperCase().trim()) || null;
    }
    getOrCreateRoom(code, hostId = 'user_host', hostName = 'Host') {
        const existing = this.getRoom(code);
        if (existing)
            return existing;
        return this.createRoom(`SoundSync Room ${code.toUpperCase()}`, hostId, hostName, code);
    }
    deleteRoom(code) {
        return this.rooms.delete(code.toUpperCase().trim());
    }
    listRooms() {
        return Array.from(this.rooms.values()).map(r => r.toStateDict());
    }
}
export const syncManager = new SyncManager();
