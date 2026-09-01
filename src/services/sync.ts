/**
 * SoundSync Lounge Management Service for Oxyzen
 * Enables synchronized multi-user listening rooms and live state updates.
 */

export interface Listener {
  id: string;
  name: string;
  avatar: string;
  is_host: boolean;
  joined_at: number;
}

export class SyncRoom {
  code: string;
  name: string;
  host_id: string;
  created_at: number;
  current_track: any | null = null;
  position: number = 0;
  is_playing: boolean = false;
  updated_at: number;
  listeners: Map<string, Listener> = new Map();
  admins: Set<string> = new Set();

  constructor(code: string, name: string, hostId: string, hostName = 'Host') {
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

  addListener(id: string, name: string, avatar?: string): Listener {
    const listener: Listener = {
      id,
      name: name || `Listener_${id.slice(-4)}`,
      avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      is_host: id === this.host_id,
      joined_at: Date.now() / 1000
    };
    this.listeners.set(id, listener);
    return listener;
  }

  removeListener(id: string): boolean {
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

  updatePlayback(track: any, position: number, isPlaying: boolean): void {
    this.current_track = track;
    this.position = position;
    this.is_playing = isPlaying;
    this.updated_at = Date.now() / 1000;
  }

  toStateDict(): any {
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
  private rooms: Map<string, SyncRoom> = new Map();

  createRoom(name = 'Oxyzen SoundSync Lounge', hostId = 'user_host', hostName = 'Host', customCode?: string): SyncRoom {
    let code = (customCode || '').toUpperCase().trim();
    if (!code || this.rooms.has(code)) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
    }

    const room = new SyncRoom(code, name, hostId, hostName);
    this.rooms.set(code, room);
    return room;
  }

  getRoom(code: string): SyncRoom | null {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase().trim()) || null;
  }

  deleteRoom(code: string): boolean {
    return this.rooms.delete(code.toUpperCase().trim());
  }

  listRooms(): any[] {
    return Array.from(this.rooms.values()).map(r => r.toStateDict());
  }
}

export const syncManager = new SyncManager();
