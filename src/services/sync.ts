/**
 * SoundSync Lounge Management Service for Oxyzen
 * Handles real-time multi-user WebSocket rooms, state broadcast, drift correction,
 * chat messages, song requests, and co-host admin roles.
 */

export interface Listener {
  id: string;
  name: string;
  avatar: string;
  is_host: boolean;
  is_admin?: boolean;
  joined_at: number;
}

export interface SongRequest {
  id: string;
  track: any;
  requester_id: string;
  requester_name: string;
  created_at: number;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  user_name: string;
  avatar: string;
  text: string;
  timestamp: number;
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
  requests: SongRequest[] = [];
  queue: any[] = [];
  sockets: Set<any> = new Set();
  private emptyTimeout: NodeJS.Timeout | null = null;

  constructor(code: string, name: string, hostId: string, hostName = 'Host') {
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

  addSocket(ws: any): void {
    this.sockets.add(ws);
    if (this.emptyTimeout) {
      clearTimeout(this.emptyTimeout);
      this.emptyTimeout = null;
    }
  }

  removeSocket(ws: any): void {
    this.sockets.delete(ws);
  }

  addListener(id: string, name: string, avatar?: string): Listener {
    const isHost = id === this.host_id;
    const listener: Listener = {
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

  removeListener(id: string): boolean {
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

  promoteToAdmin(userId: string): boolean {
    const listener = this.listeners.get(userId);
    if (!listener) return false;
    this.admins.add(userId);
    listener.is_admin = true;
    return true;
  }

  demoteFromAdmin(userId: string): boolean {
    if (userId === this.host_id) return false; // Host cannot be demoted
    const listener = this.listeners.get(userId);
    if (!listener) return false;
    this.admins.delete(userId);
    listener.is_admin = false;
    return true;
  }

  updatePlayback(track: any, position: number, isPlaying: boolean): void {
    if (track) this.current_track = track;
    this.position = position;
    this.is_playing = isPlaying;
    this.updated_at = Date.now() / 1000;
  }

  addRequest(track: any, requesterId: string, requesterName: string): SongRequest {
    const req: SongRequest = {
      id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      track,
      requester_id: requesterId,
      requester_name: requesterName,
      created_at: Date.now() / 1000
    };
    this.requests.unshift(req);
    // Limit to 20 pending requests
    if (this.requests.length > 20) this.requests = this.requests.slice(0, 20);
    return req;
  }

  dismissRequest(reqId: string): void {
    this.requests = this.requests.filter(r => r.id !== reqId);
  }

  broadcast(message: Record<string, any>, excludeWs: any = null): void {
    const payload = JSON.stringify(message);
    for (const ws of this.sockets) {
      if (ws !== excludeWs) {
        try {
          if (typeof ws.send === 'function') {
            ws.send(payload);
          }
        } catch (err) {
          console.warn('Error broadcasting to sync socket:', err);
        }
      }
    }
  }

  toStateDict(): any {
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
      queue: this.queue
    };
  }
}

export class SyncManager {
  private rooms: Map<string, SyncRoom> = new Map();

  createRoom(name = 'Oxyzen SoundSync Lounge', hostId = 'user_host', hostName = 'Host', customCode?: string): SyncRoom {
    let code = (customCode || '').toUpperCase().trim();
    if (!code || code.length < 3 || this.rooms.has(code)) {
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

  getOrCreateRoom(code: string, hostId = 'user_host', hostName = 'Host'): SyncRoom {
    const existing = this.getRoom(code);
    if (existing) return existing;
    return this.createRoom(`SoundSync Room ${code.toUpperCase()}`, hostId, hostName, code);
  }

  deleteRoom(code: string): boolean {
    return this.rooms.delete(code.toUpperCase().trim());
  }

  listRooms(): any[] {
    return Array.from(this.rooms.values()).map(r => r.toStateDict());
  }
}

export const syncManager = new SyncManager();
