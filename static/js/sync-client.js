/**
 * OXYZEN SOUNDSYNC CLIENT
 * Real-Time WebSocket Multi-Device Synchronized Listening Rooms with Song Requests & Co-Host Admins
 * Features: Auto-reconnect with exponential backoff, heartbeat keep-alive, echo loop prevention.
 */

class SoundSyncClient {
  constructor() {
    this.ws = null;
    this.roomCode = null;
    this.roomName = null;
    this.isHost = false;
    this.isAdmin = false;
    this.userId = localStorage.getItem("oxyzen_user_id") || ("user_" + Math.floor(Math.random() * 89999 + 10000));
    localStorage.setItem("oxyzen_user_id", this.userId);
    
    this.userName = localStorage.getItem("oxyzen_user_name") || ("Listener " + this.userId.slice(-4));
    this.avatar = localStorage.getItem("oxyzen_user_avatar") || "🎧";
    this.listeners = [];
    this.admins = [];
    this.requests = [];
    this.queue = [];
    this.connected = false;
    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 6;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.isRemoteUpdate = false;
    
    this.onStateChange = null;
    this.onReaction = null;
    this.onChat = null;
  }

  setProfile(name, avatar) {
    if (name) {
      this.userName = name.trim();
      localStorage.setItem("oxyzen_user_name", this.userName);
    }
    if (avatar) {
      this.avatar = avatar;
      localStorage.setItem("oxyzen_user_avatar", this.avatar);
    }
  }

  joinRoom(roomCode, roomName = null) {
    if (this.ws) {
      this.leaveRoom(false);
    }

    this.roomCode = (roomCode || "OXYZEN").toUpperCase().trim();
    this.roomName = roomName;
    this.isConnecting = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host || "localhost:8000";
    const wsUrl = `${protocol}//${host}/ws/room/${encodeURIComponent(this.roomCode)}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Send JOIN handshake
        this.send({
          type: "JOIN",
          room_code: this.roomCode,
          user_id: this.userId,
          user_name: this.userName,
          avatar: this.avatar
        });

        // Start ping interval for connection keepalive on Render proxy
        this.startHeartbeat();

        window.dispatchEvent(new CustomEvent("oxyzen:sync_connected", { detail: { roomCode: this.roomCode } }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (err) {
          console.error("Error parsing SoundSync message:", err);
        }
      };

      this.ws.onclose = (event) => {
        const wasConnected = this.connected;
        this.connected = false;
        this.isConnecting = false;
        this.stopHeartbeat();

        window.dispatchEvent(new CustomEvent("oxyzen:sync_disconnected", { detail: { code: event.code, reason: event.reason } }));

        // Attempt auto-reconnect if not explicitly closed
        if (this.roomCode && event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);
          console.info(`SoundSync connection closed. Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.reconnectTimer = setTimeout(() => {
            if (this.roomCode) {
              this.joinRoom(this.roomCode, this.roomName);
            }
          }, delay);
        }
      };

      this.ws.onerror = (err) => {
        console.warn("SoundSync WebSocket Error:", err);
        this.isConnecting = false;
      };
    } catch (e) {
      console.error("Failed to construct WebSocket:", e);
      this.isConnecting = false;
    }
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send({ type: "PING", timestamp: Date.now() });
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  leaveRoom(notifyServer = true) {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      if (notifyServer && this.connected) {
        this.send({ type: "LEAVE_ROOM", user_id: this.userId });
      }
      this.ws.close(1000, "User Left");
      this.ws = null;
    }

    this.connected = false;
    this.isConnecting = false;
    this.roomCode = null;
    this.isHost = false;
    this.isAdmin = false;
    this.listeners = [];
    this.admins = [];
    this.requests = [];
    this.queue = [];
    this.reconnectAttempts = 0;
    window.dispatchEvent(new CustomEvent("oxyzen:sync_left"));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handleMessage(msg) {
    const type = msg.type;

    if (type === "PONG") {
      // Heartbeat acknowledged
      return;
    }

    if (type === "ROOM_STATE") {
      const state = msg.state || {};
      this.isHost = msg.you ? msg.you.is_host : (state.host_id === this.userId);
      this.listeners = state.listeners || [];
      this.admins = state.admins || [];
      this.isAdmin = this.isHost || this.admins.includes(this.userId);
      this.requests = state.requests || [];
      this.queue = state.queue || [];
      this.roomName = state.room_name || this.roomName;
      
      // Sync track if playing
      if (state.current_track) {
        this.isRemoteUpdate = true;
        window.dispatchEvent(new CustomEvent("oxyzen:sync_play_track", {
          detail: {
            track: state.current_track,
            currentTime: state.current_time || 0,
            isPlaying: state.is_playing
          }
        }));
        setTimeout(() => { this.isRemoteUpdate = false; }, 300);
      }

      if (this.onStateChange) this.onStateChange(state);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_state", { detail: state }));
    }

    else if (type === "PLAY_TRACK") {
      this.isRemoteUpdate = true;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_play_track", {
        detail: {
          track: msg.track,
          currentTime: msg.current_time || 0,
          isPlaying: true,
          triggeredBy: msg.triggered_by
        }
      }));
      setTimeout(() => { this.isRemoteUpdate = false; }, 300);
    }

    else if (type === "PLAY_STATE") {
      this.isRemoteUpdate = true;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_play_state", {
        detail: {
          isPlaying: msg.is_playing,
          currentTime: msg.current_time,
          triggeredBy: msg.triggered_by
        }
      }));
      setTimeout(() => { this.isRemoteUpdate = false; }, 300);
    }

    else if (type === "SEEK") {
      this.isRemoteUpdate = true;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_seek", {
        detail: {
          time: msg.time
        }
      }));
      setTimeout(() => { this.isRemoteUpdate = false; }, 300);
    }

    else if (type === "QUEUE_UPDATED") {
      this.queue = msg.queue || [];
      window.dispatchEvent(new CustomEvent("oxyzen:sync_queue", {
        detail: {
          queue: this.queue,
          addedBy: msg.added_by
        }
      }));
    }

    else if (type === "REQUEST_ADDED") {
      this.requests = msg.requests || this.requests;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_request_added", {
        detail: {
          request: msg.request,
          requests: this.requests,
          requester: msg.requester
        }
      }));
    }

    else if (type === "REQUEST_ACCEPTED") {
      this.requests = msg.requests || this.requests;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_request_accepted", {
        detail: {
          requestId: msg.request_id,
          requests: this.requests
        }
      }));
    }

    else if (type === "REQUEST_DISMISSED") {
      this.requests = msg.requests || this.requests;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_request_dismissed", {
        detail: {
          requestId: msg.request_id,
          requests: this.requests
        }
      }));
    }

    else if (type === "ADMIN_UPDATED") {
      this.admins = msg.admins || [];
      this.listeners = msg.listeners || this.listeners;
      this.isAdmin = this.isHost || this.admins.includes(this.userId);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_admin_updated", {
        detail: {
          admins: this.admins,
          listeners: this.listeners,
          message: msg.message
        }
      }));
    }

    else if (type === "USER_JOINED") {
      this.listeners = msg.listeners || this.listeners;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_user_joined", { detail: msg.user }));
    }

    else if (type === "USER_LEFT") {
      this.listeners = msg.listeners || this.listeners;
      this.isHost = (msg.host_id === this.userId);
      this.isAdmin = this.isHost || this.admins.includes(this.userId);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_user_left", { detail: msg }));
    }

    else if (type === "HOST_CHANGED") {
      this.isHost = (msg.new_host_id === this.userId);
      this.listeners = msg.listeners || this.listeners;
      this.admins = msg.admins || [];
      this.isAdmin = this.isHost || this.admins.includes(this.userId);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_host_changed", { detail: msg }));
    }

    else if (type === "REACTION_PULSE") {
      if (this.onReaction) this.onReaction(msg);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_reaction", { detail: msg }));
    }

    else if (type === "CHAT_MESSAGE") {
      if (this.onChat) this.onChat(msg);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_chat", { detail: msg }));
    }

    else if (type === "ERROR") {
      window.dispatchEvent(new CustomEvent("oxyzen:sync_error", { detail: msg }));
    }
  }

  // Playback Control Emitters
  broadcastPlayTrack(track) {
    if (!this.connected || this.isRemoteUpdate) return;
    this.send({
      type: "PLAY_TRACK",
      track: track,
      current_time: 0
    });
  }

  broadcastPlayState(isPlaying, currentTime) {
    if (!this.connected || this.isRemoteUpdate) return;
    this.send({
      type: "PLAY_STATE",
      is_playing: isPlaying,
      current_time: currentTime,
      timestamp: Date.now() / 1000
    });
  }

  broadcastSeek(time) {
    if (!this.connected || this.isRemoteUpdate) return;
    this.send({
      type: "SEEK",
      time: time
    });
  }

  broadcastAddQueue(track) {
    if (!this.connected) return;
    this.send({
      type: "ADD_QUEUE",
      track: track
    });
  }

  broadcastRemoveQueue(index) {
    if (!this.connected) return;
    this.send({
      type: "REMOVE_QUEUE",
      index: index
    });
  }

  // Song Requests
  requestSong(track) {
    if (!this.connected || !track) return;
    this.send({
      type: "REQUEST_SONG",
      track: track
    });
  }

  acceptRequest(requestId, playNow = false) {
    if (!this.connected || !requestId) return;
    this.send({
      type: "ACCEPT_REQUEST",
      request_id: requestId,
      play_now: playNow
    });
  }

  dismissRequest(requestId) {
    if (!this.connected || !requestId) return;
    this.send({
      type: "DISMISS_REQUEST",
      request_id: requestId
    });
  }

  // Admin Role Management
  promoteAdmin(targetUserId) {
    if (!this.connected || !this.isHost || !targetUserId) return;
    this.send({
      type: "PROMOTE_ADMIN",
      target_user_id: targetUserId
    });
  }

  demoteAdmin(targetUserId) {
    if (!this.connected || !this.isHost || !targetUserId) return;
    this.send({
      type: "DEMOTE_ADMIN",
      target_user_id: targetUserId
    });
  }

  broadcastTransferHost(targetUserId) {
    if (!this.connected || !this.isHost || !targetUserId) return;
    this.send({
      type: "TRANSFER_HOST",
      target_user_id: targetUserId
    });
  }

  sendReaction(emoji) {
    if (!this.connected) return;
    this.send({
      type: "REACTION_PULSE",
      emoji: emoji
    });
  }

  sendChat(text) {
    if (!this.connected || !text.trim()) return;
    this.send({
      type: "CHAT_MESSAGE",
      text: text.trim()
    });
  }
}

window.oxyzenSync = new SoundSyncClient();
