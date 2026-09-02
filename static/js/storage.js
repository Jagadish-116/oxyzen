/**
 * OXYZEN CLIENT-SIDE STORAGE DATABASE (Zero-Backend / Local Storage)
 * Manages client-side persistence for:
 * - Liked Songs / Favorites
 * - Custom Playlists (Create, Edit, Delete, Add/Remove Songs)
 * - Listening History & Recent Sessions (capped at 50 tracks)
 * - Playback State (Volume, Shuffle, Repeat Mode, 8D Spatial, Position)
 * - User Preferences & Audio Quality
 * - 1-Click JSON Backup Export & Import (Seamless Data Portability)
 */

class OxyzenStorage {
  constructor() {
    this.STORAGE_KEYS = {
      LIKES: "oxyzen_liked_tracks",
      PLAYLISTS: "oxyzen_custom_playlists",
      HISTORY: "oxyzen_listening_history",
      SETTINGS: "oxyzen_playback_settings",
      PROFILE: "oxyzen_user_profile"
    };

    this.initStorage();
  }

  initStorage() {
    if (!localStorage.getItem(this.STORAGE_KEYS.LIKES)) {
      localStorage.setItem(this.STORAGE_KEYS.LIKES, JSON.stringify([]));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.PLAYLISTS)) {
      localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify([]));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.HISTORY)) {
      localStorage.setItem(this.STORAGE_KEYS.HISTORY, JSON.stringify([]));
    }
    if (!localStorage.getItem(this.STORAGE_KEYS.SETTINGS)) {
      localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify({
        volume: 1.0,
        repeatMode: "off", // "off" | "all" | "one"
        isShuffle: false,
        spatial8D: false,
        eqPreset: "flat",
        lastTrack: null,
        lastPosition: 0
      }));
    }
  }

  // -------------------------------------------------------------
  // LIKED SONGS / FAVORITES
  // -------------------------------------------------------------
  getLikedTracks() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.LIKES);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn("Error reading liked tracks from storage:", e);
      return [];
    }
  }

  getLikedSongs() {
    return this.getLikedTracks();
  }

  getFavorites() {
    return this.getLikedTracks();
  }

  getLikedIds() {
    const tracks = this.getLikedTracks();
    return new Set(tracks.map(t => t.id || t.videoId));
  }

  toggleLike(track) {
    if (!track) return false;
    const id = track.id || track.videoId;
    if (!id) return false;

    let likes = this.getLikedTracks();
    const existingIdx = likes.findIndex(t => (t.id === id || t.videoId === id));
    let isLiked = false;

    if (existingIdx >= 0) {
      likes.splice(existingIdx, 1);
      isLiked = false;
    } else {
      const cleanTrack = {
        id: id,
        videoId: id,
        title: track.title || "Unknown Track",
        artist: track.artist || "Unknown Artist",
        album: track.album || "Oxyzen Audio",
        thumbnail: track.image || track.thumbnail || "/static/assets/logo.png",
        image: track.image || track.thumbnail || "/static/assets/logo.png",
        stream_url: track.stream_url || "",
        downloadUrl: track.downloadUrl || [],
        duration: track.duration || "3:30",
        duration_sec: track.duration_sec || 210,
        liked_at: Date.now()
      };
      likes.unshift(cleanTrack);
      isLiked = true;
    }

    try {
      localStorage.setItem(this.STORAGE_KEYS.LIKES, JSON.stringify(likes));
      this.dispatchStorageEvent("likes", { isLiked, trackId: id, total: likes.length });
    } catch (e) {
      console.warn("Storage quota exceeded or error saving like:", e);
    }

    return isLiked;
  }

  isLiked(trackId) {
    if (!trackId) return false;
    const likes = this.getLikedTracks();
    return likes.some(t => (t.id === trackId || t.videoId === trackId));
  }

  // -------------------------------------------------------------
  // CUSTOM PLAYLISTS
  // -------------------------------------------------------------
  getPlaylists() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.PLAYLISTS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn("Error reading playlists from storage:", e);
      return [];
    }
  }

  getPlaylist(playlistId) {
    const playlists = this.getPlaylists();
    return playlists.find(p => p.id === playlistId) || null;
  }

  createPlaylist(name = "My High-Fidelity Vibe", description = "", coverUrl = "") {
    const playlists = this.getPlaylists();
    const newPlaylist = {
      id: `pl_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: name.trim() || "New Playlist",
      description: description.trim() || "Acoustic curation on Oxyzen",
      cover_url: coverUrl.trim() || "/static/assets/logo.png",
      created_at: Date.now(),
      updated_at: Date.now(),
      tracks: []
    };

    playlists.unshift(newPlaylist);
    localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    this.dispatchStorageEvent("playlists", { action: "create", playlist: newPlaylist });
    return newPlaylist;
  }

  updatePlaylist(playlistId, updates = {}) {
    let playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return false;

    if (updates.name) pl.name = updates.name.trim();
    if (updates.description !== undefined) pl.description = updates.description.trim();
    if (updates.cover_url) pl.cover_url = updates.cover_url.trim();
    pl.updated_at = Date.now();

    localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    this.dispatchStorageEvent("playlists", { action: "update", playlist: pl });
    return true;
  }

  deletePlaylist(playlistId) {
    let playlists = this.getPlaylists();
    const initialLen = playlists.length;
    playlists = playlists.filter(p => p.id !== playlistId);
    if (playlists.length !== initialLen) {
      localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
      this.dispatchStorageEvent("playlists", { action: "delete", playlistId });
      return true;
    }
    return false;
  }

  addTrackToPlaylist(playlistId, track) {
    if (!track) return false;
    const id = track.id || track.videoId;
    if (!id) return false;

    let playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl) return false;

    if (!Array.isArray(pl.tracks)) pl.tracks = [];

    // Avoid exact duplicate tracks in same playlist
    if (pl.tracks.some(t => (t.id === id || t.videoId === id))) {
      return false; // already in playlist
    }

    const cleanTrack = {
      id: id,
      videoId: id,
      title: track.title || "Unknown Track",
      artist: track.artist || "Unknown Artist",
      album: track.album || "Oxyzen Audio",
      thumbnail: track.image || track.thumbnail || "/static/assets/logo.png",
      image: track.image || track.thumbnail || "/static/assets/logo.png",
      stream_url: track.stream_url || "",
      downloadUrl: track.downloadUrl || [],
      duration: track.duration || "3:30",
      duration_sec: track.duration_sec || 210,
      added_at: Date.now()
    };

    pl.tracks.push(cleanTrack);
    pl.updated_at = Date.now();

    // If no custom cover, use first track's cover
    if (!pl.cover_url || pl.cover_url === "/static/assets/logo.png") {
      pl.cover_url = cleanTrack.thumbnail;
    }

    localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    this.dispatchStorageEvent("playlists", { action: "add_track", playlistId, track: cleanTrack });
    return true;
  }

  removeTrackFromPlaylist(playlistId, trackId) {
    let playlists = this.getPlaylists();
    const pl = playlists.find(p => p.id === playlistId);
    if (!pl || !Array.isArray(pl.tracks)) return false;

    pl.tracks = pl.tracks.filter(t => (t.id !== trackId && t.videoId !== trackId));
    pl.updated_at = Date.now();

    localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(playlists));
    this.dispatchStorageEvent("playlists", { action: "remove_track", playlistId, trackId });
    return true;
  }

  // -------------------------------------------------------------
  // LISTENING HISTORY (Max 50 Recent Tracks)
  // -------------------------------------------------------------
  getHistory(limit = 50) {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.HISTORY);
      const list = data ? JSON.parse(data) : [];
      return list.slice(0, limit);
    } catch (e) {
      console.warn("Error reading history from storage:", e);
      return [];
    }
  }

  addToHistory(track) {
    if (!track) return;
    const id = track.id || track.videoId;
    if (!id) return;

    let history = this.getHistory(100);
    // Remove if already exists to bump to top
    history = history.filter(t => (t.id !== id && t.videoId !== id));

    const cleanTrack = {
      id: id,
      videoId: id,
      title: track.title || "Unknown Track",
      artist: track.artist || "Unknown Artist",
      album: track.album || "Oxyzen Audio",
      thumbnail: track.image || track.thumbnail || "/static/assets/logo.png",
      image: track.image || track.thumbnail || "/static/assets/logo.png",
      stream_url: track.stream_url || "",
      downloadUrl: track.downloadUrl || [],
      duration: track.duration || "3:30",
      duration_sec: track.duration_sec || 210,
      played_at: Date.now()
    };

    history.unshift(cleanTrack);
    // Cap at 50 tracks
    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    try {
      localStorage.setItem(this.STORAGE_KEYS.HISTORY, JSON.stringify(history));
      this.dispatchStorageEvent("history", { track: cleanTrack, count: history.length });
    } catch (e) {}
  }

  clearHistory() {
    localStorage.setItem(this.STORAGE_KEYS.HISTORY, JSON.stringify([]));
    this.dispatchStorageEvent("history", { action: "clear", count: 0 });
  }

  // -------------------------------------------------------------
  // PLAYBACK SETTINGS & SESSION STATE
  // -------------------------------------------------------------
  getSettings() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEYS.SETTINGS);
      return data ? JSON.parse(data) : {};
    } catch (e) {
      return {};
    }
  }

  saveSettings(partialSettings = {}) {
    const current = this.getSettings();
    const updated = { ...current, ...partialSettings };
    try {
      localStorage.setItem(this.STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
    } catch (e) {}
    return updated;
  }

  // -------------------------------------------------------------
  // JSON BACKUP EXPORT & IMPORT (DATA PORTABILITY)
  // -------------------------------------------------------------
  exportBackupData() {
    return {
      version: "1.0",
      exported_at: new Date().toISOString(),
      app: "Oxyzen Music",
      likes: this.getLikedTracks(),
      playlists: this.getPlaylists(),
      history: this.getHistory(50),
      settings: this.getSettings(),
      profile: {
        name: localStorage.getItem("oxyzen_user_name") || "Oxyzen Listener",
        avatar: localStorage.getItem("oxyzen_user_avatar") || "👑",
        languages: JSON.parse(localStorage.getItem("oxyzen_user_languages") || '["English", "Telugu", "Hindi"]')
      }
    };
  }

  downloadBackupFile() {
    const data = this.exportBackupData();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().split("T")[0];
    a.href = url;
    a.download = `oxyzen_backup_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  importBackupData(jsonStringOrObject, mode = "merge") {
    try {
      let data = jsonStringOrObject;
      if (typeof jsonStringOrObject === "string") {
        data = JSON.parse(jsonStringOrObject);
      }

      if (!data || typeof data !== "object") {
        throw new Error("Invalid backup format: root must be a JSON object.");
      }

      // 1. Likes
      if (Array.isArray(data.likes)) {
        if (mode === "replace") {
          localStorage.setItem(this.STORAGE_KEYS.LIKES, JSON.stringify(data.likes));
        } else {
          // Merge likes by track ID
          const currentLikes = this.getLikedTracks();
          const seen = new Set(currentLikes.map(t => t.id || t.videoId));
          for (const item of data.likes) {
            const id = item.id || item.videoId;
            if (id && !seen.has(id)) {
              currentLikes.push(item);
              seen.add(id);
            }
          }
          localStorage.setItem(this.STORAGE_KEYS.LIKES, JSON.stringify(currentLikes));
        }
      }

      // 2. Playlists
      if (Array.isArray(data.playlists)) {
        if (mode === "replace") {
          localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(data.playlists));
        } else {
          const currentPls = this.getPlaylists();
          const plNames = new Set(currentPls.map(p => p.name.toLowerCase()));
          for (const pl of data.playlists) {
            if (pl.name && !plNames.has(pl.name.toLowerCase())) {
              currentPls.push({
                ...pl,
                id: `pl_imported_${Date.now()}_${Math.floor(Math.random() * 1000)}`
              });
              plNames.add(pl.name.toLowerCase());
            }
          }
          localStorage.setItem(this.STORAGE_KEYS.PLAYLISTS, JSON.stringify(currentPls));
        }
      }

      // 3. History
      if (Array.isArray(data.history)) {
        if (mode === "replace") {
          localStorage.setItem(this.STORAGE_KEYS.HISTORY, JSON.stringify(data.history.slice(0, 50)));
        } else {
          const currentHistory = this.getHistory(50);
          const histIds = new Set(currentHistory.map(h => h.id || h.videoId));
          for (const h of data.history) {
            const id = h.id || h.videoId;
            if (id && !histIds.has(id) && currentHistory.length < 50) {
              currentHistory.push(h);
              histIds.add(id);
            }
          }
          localStorage.setItem(this.STORAGE_KEYS.HISTORY, JSON.stringify(currentHistory));
        }
      }

      // 4. Profile
      if (data.profile && typeof data.profile === "object") {
        if (data.profile.name) localStorage.setItem("oxyzen_user_name", data.profile.name);
        if (data.profile.avatar) localStorage.setItem("oxyzen_user_avatar", data.profile.avatar);
        if (Array.isArray(data.profile.languages)) {
          localStorage.setItem("oxyzen_user_languages", JSON.stringify(data.profile.languages));
        }
      }

      this.dispatchStorageEvent("imported", { mode, timestamp: Date.now() });
      return { success: true, message: "Backup successfully restored!" };
    } catch (err) {
      console.error("Failed to import Oxyzen backup:", err);
      return { success: false, message: err.message || "Failed to parse backup JSON." };
    }
  }

  // -------------------------------------------------------------
  // EVENT NOTIFICATIONS
  // -------------------------------------------------------------
  dispatchStorageEvent(type, detail = {}) {
    window.dispatchEvent(new CustomEvent("oxyzen:storage_updated", {
      detail: { type, ...detail }
    }));
  }
}

// Global instance
window.oxyzenStorage = new OxyzenStorage();
