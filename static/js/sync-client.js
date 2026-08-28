/**
 * OXYZEN SOUNDSYNC CLIENT
 * Real-Time WebSocket Multi-Device Synchronized Listening Rooms with Song Requests & Co-Host Admins
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
    this.connected = false;
    this.reconnectAttempts = 0;
    
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
      this.leaveRoom();
    }

    this.roomCode = roomCode.toUpperCase().trim();
    this.roomName = roomName;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/ws/room/${this.roomCode}`;

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      // Send JOIN handshake
      this.send({
        type: "JOIN",
        user_id: this.userId,
        user_name: this.userName,
        avatar: this.avatar
      });
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

    this.ws.onclose = () => {
      this.connected = false;
      window.dispatchEvent(new CustomEvent("oxyzen:sync_disconnected"));
    };

    this.ws.onerror = (err) => {
      console.warn("SoundSync WebSocket Error:", err);
    };
  }

  leaveRoom() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.roomCode = null;
    this.isHost = false;
    this.isAdmin = false;
    this.listeners = [];
    this.admins = [];
    this.requests = [];
    window.dispatchEvent(new CustomEvent("oxyzen:sync_left"));
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  handleMessage(msg) {
    const type = msg.type;

    if (type === "ROOM_STATE") {
      const state = msg.state;
      this.isHost = msg.you ? msg.you.is_host : false;
      this.listeners = state.listeners || [];
      this.admins = state.admins || [];
      this.isAdmin = this.isHost || this.admins.includes(this.userId);
      this.requests = state.requests || [];
      this.roomName = state.room_name;
      
      // Sync track if playing
      if (state.current_track) {
        window.dispatchEvent(new CustomEvent("oxyzen:sync_play_track", {
          detail: {
            track: state.current_track,
            currentTime: state.current_time || 0,
            isPlaying: state.is_playing
          }
        }));
      }

      if (this.onStateChange) this.onStateChange(state);
      window.dispatchEvent(new CustomEvent("oxyzen:sync_state", { detail: state }));
    }

    else if (type === "PLAY_TRACK") {
      window.dispatchEvent(new CustomEvent("oxyzen:sync_play_track", {
        detail: {
          track: msg.track,
          currentTime: msg.current_time || 0,
          isPlaying: true,
          triggeredBy: msg.triggered_by
        }
      }));
    }

    else if (type === "PLAY_STATE") {
      window.dispatchEvent(new CustomEvent("oxyzen:sync_play_state", {
        detail: {
          isPlaying: msg.is_playing,
          currentTime: msg.current_time,
          triggeredBy: msg.triggered_by
        }
      }));
    }

    else if (type === "SEEK") {
      window.dispatchEvent(new CustomEvent("oxyzen:sync_seek", {
        detail: {
          time: msg.time
        }
      }));
    }

    else if (type === "QUEUE_UPDATED") {
      window.dispatchEvent(new CustomEvent("oxyzen:sync_queue", {
        detail: {
          queue: msg.queue,
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
      this.leaveRoom();
    }
  }

  // Playback Control Emitters
  broadcastPlayTrack(track) {
    if (!this.connected) return;
    this.send({
      type: "PLAY_TRACK",
      track: track
    });
  }

  broadcastPlayState(isPlaying, currentTime) {
    if (!this.connected) return;
    this.send({
      type: "PLAY_STATE",
      is_playing: isPlaying,
      current_time: currentTime
    });
  }

  broadcastSeek(time) {
    if (!this.connected) return;
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
    if (!this.connected || !this.isHost) return;
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
