/**
 * SoundSync Lounge Management Service for Oxyzen
 * Enables synchronized multi-user listening rooms and live state updates.
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
    constructor(code, name, hostId, hostName = 'Host') {
        this.code = code.toUpperCase();
        this.name = name;
        this.host_id = hostId;
        this.created_at = Date.now() / 1000;
        this.updated_at = this.created_at;
        this.admins.add(hostId);
        // Add initial host listener
        this.listeners.set(hostId, {
            id: hostId,
            name: hostName,
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            is_host: true,
            joined_at: this.created_at
        });
    }
    addListener(id, name, avatar) {
        const listener = {
            id,
            name: name || `Listener_${id.slice(-4)}`,
            avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
            is_host: id === this.host_id,
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
            this.admins.add(nextHost.id);
        }
        return removed;
    }
    updatePlayback(track, position, isPlaying) {
        this.current_track = track;
        this.position = position;
        this.is_playing = isPlaying;
        this.updated_at = Date.now() / 1000;
    }
    toStateDict() {
        return {
            room_code: this.code,
            room_name: this.name,
            host_id: this.host_id,
            created_at: this.created_at,
            current_track: this.current_track,
            position: this.position,
            is_playing: this.is_playing,
            updated_at: this.updated_at,
            listener_count: this.listeners.size,
            listeners: Array.from(this.listeners.values()),
            admins: Array.from(this.admins)
        };
    }
}
export class SyncManager {
    rooms = new Map();
    createRoom(name = 'Oxyzen SoundSync Lounge', hostId = 'user_host', hostName = 'Host', customCode) {
        let code = (customCode || '').toUpperCase().trim();
        if (!code || this.rooms.has(code)) {
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
    deleteRoom(code) {
        return this.rooms.delete(code.toUpperCase().trim());
    }
    listRooms() {
        return Array.from(this.rooms.values()).map(r => r.toStateDict());
    }
}
export const syncManager = new SyncManager();
