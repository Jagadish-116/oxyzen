/**
 * OXYZEN MASTER CONTROLLER
 * Unchained Luxury Music Application
 */

const API_BASE = "";

class OxyzenApp {
  constructor() {
    this.audio = window.oxyzenAudio;
    this.sync = window.oxyzenSync;
    this.storage = window.oxyzenStorage || new OxyzenStorage();

    // Track Registry / Cache (Solves explore feed, search, and vibe radar lookup)
    this.trackCache = new Map();

    // Restore saved settings from local storage
    const savedSettings = this.storage.getSettings() || {};

    // Playback State
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = -1;
    this.isShuffle = !!savedSettings.isShuffle;
    this.repeatMode = savedSettings.repeatMode || "off"; // "off" | "all" | "one"
    this.infiniteRadio = true;
    this.isSeeking = false;
    this.vibeTracks = [];

    // Library State (Loaded directly from client-side database)
    this.likedIds = this.storage.getLikedIds();
    this.playlists = this.storage.getPlaylists();
    this.currentPlaylistId = null;

    // User Profile & Preferences State
    this.userProfile = {
      name: localStorage.getItem("oxyzen_user_name") || "Oxyzen Listener",
      avatar: localStorage.getItem("oxyzen_user_avatar") || "👑",
      bio: "Breathing the music in high fidelity",
      languages: JSON.parse(localStorage.getItem("oxyzen_user_languages") || '["English", "Telugu", "Hindi"]'),
      audio_quality: "Master 320k"
    };

    // View State
    this.activeView = "explore";
    this.searchQuery = "";
    this.searchFilter = null;
    this.searchDebounceTimer = null;
    this.activeMoodKey = null;

    // Lyrics State
    this.lyricsData = { synced: false, lines: [], plain: "" };
    this.activeLyricIndex = -1;

    // SoundSync Profile State
    this.selectedHostAvatar = "👑";
    this.selectedListenerAvatar = "🎧";

    // DOM Elements & Initialization
    this.initDOMElements();
    this.initEventListeners();
    this.loadInitialData();
  }

  // -------------------------------------------------------------
  // TRACK REGISTRY HELPERS
  // -------------------------------------------------------------
  registerTrack(track) {
    if (!track) return null;
    const id = track.id || track.videoId;
    if (!id) return null;
    let thumb = track.thumbnail || "";
    if (!thumb || thumb === "/static/assets/logo.png") {
      thumb = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    const normalized = {
      ...track,
      id: id,
      videoId: id,
      title: track.title || "Unknown Track",
      artist: track.artist || "Unknown Artist",
      album: track.album || "Oxyzen Audio",
      thumbnail: thumb,
      duration: track.duration || "3:30",
      duration_sec: track.duration_sec || 210
    };
    this.trackCache.set(id, normalized);
    return normalized;
  }

  registerTracks(tracksList) {
    if (!Array.isArray(tracksList)) return [];
    return tracksList.map(t => this.registerTrack(t)).filter(Boolean);
  }

  findTrackById(trackId) {
    if (!trackId) return null;
    if (this.trackCache.has(trackId)) {
      return this.trackCache.get(trackId);
    }
    const inQueue = this.queue.find(t => (t.id === trackId || t.videoId === trackId));
    if (inQueue) return inQueue;

    // Resilient DOM fallback
    const card = document.querySelector(`.music-card[data-track-id="${trackId}"]`);
    if (card) {
      const title = card.querySelector('.card-title') ? card.querySelector('.card-title').innerText : 'Track';
      const artist = card.querySelector('.card-subtitle') ? card.querySelector('.card-subtitle').innerText : 'Artist';
      const img = card.querySelector('.card-img') ? card.querySelector('.card-img').src : `https://i.ytimg.com/vi/${trackId}/hqdefault.jpg`;
      return this.registerTrack({
        id: trackId,
        videoId: trackId,
        title,
        artist,
        thumbnail: img,
        duration: "3:30",
        duration_sec: 210
      });
    }
    return null;
  }

  // -------------------------------------------------------------
  // DOM ELEMENT REFERENCES
  // -------------------------------------------------------------
  initDOMElements() {
    // Navigation & Views (Desktop Sidebar & Mobile Bottom Navigation)
    this.navItems = document.querySelectorAll(".nav-item[data-view], .mobile-nav-tab[data-view]");
    this.pageViews = document.querySelectorAll(".page-view");

    // Search Elements
    this.searchInput = document.getElementById("search-input");
    this.searchClearBtn = document.getElementById("search-clear");
    this.suggestionsBox = document.getElementById("search-suggestions");
    this.searchFilterChips = document.querySelectorAll(".search-filter-chip");

    // Player Dock
    this.playPauseBtn = document.getElementById("play-pause-btn");
    this.prevBtn = document.getElementById("prev-btn");
    this.nextBtn = document.getElementById("next-btn");
    this.shuffleBtn = document.getElementById("shuffle-btn");
    this.repeatBtn = document.getElementById("repeat-btn");
    this.spatial8DBtn = document.getElementById("spatial-8d-btn");

    this.seekSlider = document.getElementById("seek-slider");
    this.currentTimeLabel = document.getElementById("current-time-label");
    this.totalTimeLabel = document.getElementById("total-time-label");

    this.playerThumb = document.getElementById("player-thumb");
    this.playerTitle = document.getElementById("player-title");
    this.playerArtist = document.getElementById("player-artist");
    this.playerLikeBtn = document.getElementById("player-like-btn");
    this.volumeSlider = document.getElementById("volume-slider");
    this.volumeIcon = document.getElementById("volume-icon");

    // Canvases
    this.dockCanvas = document.getElementById("dock-visualizer-canvas");
    this.cinemaCanvas = document.getElementById("cinema-visualizer-canvas");
    if (this.dockCanvas && this.cinemaCanvas && this.audio) {
      this.audio.setVisualizerCanvases(this.dockCanvas, this.cinemaCanvas);
    }

    // Cinema Overlay Elements
    this.cinemaOverlay = document.getElementById("cinema-mode-overlay");
    this.cinemaBackdrop = document.getElementById("cinema-backdrop");
    this.cinemaArt = document.getElementById("cinema-art");
    this.cinemaTitle = document.getElementById("cinema-title");
    this.cinemaArtist = document.getElementById("cinema-artist");
    this.cinemaLyrics = document.getElementById("cinema-lyrics");
    this.cinemaCloseBtn = document.getElementById("cinema-close-btn");
    this.cinemaToggleBtn = document.getElementById("cinema-toggle-btn");
    this.cinemaFullscreenBtn = document.getElementById("cinema-fullscreen-btn");
    this.cinemaSeekSlider = document.getElementById("cinema-seek-slider");
    this.cinemaCurrentTime = document.getElementById("cinema-current-time");
    this.cinemaTotalTime = document.getElementById("cinema-total-time");
    this.cinemaVolumeSlider = document.getElementById("cinema-volume-slider");
    this.cinemaLikeBtn = document.getElementById("cinema-like-btn");
    this.cinemaSpatialBtn = document.getElementById("cinema-spatial-btn");

    // Slide Panels & Modals
    this.lyricsPanel = document.getElementById("lyrics-slide-panel");
    this.lyricsToggleBtn = document.getElementById("lyrics-toggle-btn");
    this.lyricsCloseBtn = document.getElementById("lyrics-close-btn");
    this.lyricsContent = document.getElementById("lyrics-panel-content");

    this.queuePanel = document.getElementById("queue-slide-panel");
    this.queueToggleBtn = document.getElementById("queue-toggle-btn");
    this.queueCloseBtn = document.getElementById("queue-close-btn");
    this.queueList = document.getElementById("queue-panel-list");
    this.queueBadge = document.getElementById("queue-badge");

    this.eqModal = document.getElementById("equalizer-modal");
    this.eqOpenBtn = document.getElementById("eq-open-btn");
    this.eqCloseBtn = document.getElementById("eq-close-btn");

    // Profile Elements
    this.profileModal = document.getElementById("user-profile-modal");
    this.profileOpenBtn = document.getElementById("topbar-profile-btn");
    this.profileSidebarBtn = document.getElementById("sidebar-user-profile-btn");
    this.profileCloseBtn = document.getElementById("profile-close-btn");
    this.profileSaveBtn = document.getElementById("profile-save-btn");
  }

  // -------------------------------------------------------------
  // EVENT LISTENERS INITIALIZATION
  // -------------------------------------------------------------
  initEventListeners() {
    // 1. Navigation clicks
    this.navItems.forEach(item => {
      item.addEventListener("click", () => {
        const view = item.dataset.view;
        this.switchView(view);
      });
    });

    // 2. Search Box Events
    if (this.searchInput) {
      this.searchInput.addEventListener("input", (e) => {
        const val = e.target.value;
        if (this.searchClearBtn) {
          this.searchClearBtn.classList.toggle("visible", val.length > 0);
        }
        clearTimeout(this.searchDebounceTimer);
        if (val.trim().length > 1) {
          this.searchDebounceTimer = setTimeout(() => this.fetchSuggestions(val.trim()), 180);
        } else {
          this.hideSuggestions();
        }
      });

      this.searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && this.searchInput.value.trim()) {
          this.hideSuggestions();
          this.performSearch(this.searchInput.value.trim());
        } else if (e.key === "Escape") {
          this.hideSuggestions();
        }
      });
    }

    if (this.searchClearBtn) {
      this.searchClearBtn.addEventListener("click", () => {
        this.searchInput.value = "";
        this.searchClearBtn.classList.remove("visible");
        this.hideSuggestions();
      });
    }

    // Filter Chips
    this.searchFilterChips.forEach(chip => {
      chip.addEventListener("click", () => {
        this.searchFilterChips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        this.searchFilter = chip.dataset.filter === "all" ? null : chip.dataset.filter;
        if (this.searchQuery) {
          this.performSearch(this.searchQuery);
        }
      });
    });

    // 3. Audio Engine Event Listeners
    window.addEventListener("oxyzen:play", () => {
      if (this.playPauseBtn) this.playPauseBtn.innerHTML = "❚❚";
      const cinemaPlayBtn = document.getElementById("cinema-play-pause-btn");
      if (cinemaPlayBtn) cinemaPlayBtn.innerHTML = "❚❚";
      const syncPlayBtn = document.getElementById("sync-ctrl-play");
      if (syncPlayBtn) syncPlayBtn.innerHTML = "❚❚";

      if (this.playerThumb) this.playerThumb.classList.add("spinning");
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.style.transform = "translateX(50px)";
      
      this.updateActiveRowHighlight();
      if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin)) {
        this.sync.broadcastPlayState(true, this.audio.audio.currentTime);
      }
    });

    window.addEventListener("oxyzen:pause", () => {
      if (this.playPauseBtn) this.playPauseBtn.innerHTML = "▶";
      const cinemaPlayBtn = document.getElementById("cinema-play-pause-btn");
      if (cinemaPlayBtn) cinemaPlayBtn.innerHTML = "▶";
      const syncPlayBtn = document.getElementById("sync-ctrl-play");
      if (syncPlayBtn) syncPlayBtn.innerHTML = "▶";

      if (this.playerThumb) this.playerThumb.classList.remove("spinning");
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.style.transform = "translateX(0px)";

      if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin)) {
        this.sync.broadcastPlayState(false, this.audio.audio.currentTime);
      }
    });

    window.addEventListener("oxyzen:timeupdate", (e) => {
      if (!this.isSeeking) {
        const cur = e.detail.currentTime;
        const dur = e.detail.duration || (this.currentTrack ? this.currentTrack.duration_sec : 0);
        
        // Dock Seekbar
        if (this.seekSlider && dur > 0) {
          this.seekSlider.value = (cur / dur) * 100;
          this.updateSliderFill(this.seekSlider);
        }
        if (this.currentTimeLabel) this.currentTimeLabel.innerText = this.formatTime(cur);
        if (this.totalTimeLabel && dur > 0) this.totalTimeLabel.innerText = this.formatTime(dur);

        // Cinema Mode Seekbar
        if (this.cinemaSeekSlider && dur > 0) {
          this.cinemaSeekSlider.value = (cur / dur) * 100;
          this.updateSliderFill(this.cinemaSeekSlider);
        }
        if (this.cinemaCurrentTime) this.cinemaCurrentTime.innerText = this.formatTime(cur);
        if (this.cinemaTotalTime && dur > 0) this.cinemaTotalTime.innerText = this.formatTime(dur);

        // SoundSync Space Stage Seekbar
        const syncSeekBar = document.getElementById("sync-seek-bar");
        if (syncSeekBar && dur > 0) {
          syncSeekBar.value = (cur / dur) * 100;
          this.updateSliderFill(syncSeekBar);
        }
        const syncCurTime = document.getElementById("sync-current-time");
        if (syncCurTime) syncCurTime.innerText = this.formatTime(cur);
        const syncTotalTime = document.getElementById("sync-total-time");
        if (syncTotalTime && dur > 0) syncTotalTime.innerText = this.formatTime(dur);

        // Sync active lyrics line (locked internal scroll)
        this.updateActiveLyricLine(cur);
      }
    });

    window.addEventListener("oxyzen:ended", () => {
      this.handleTrackEnded();
    });

    // Resilient Audio Stream Recovery & Auto-Skip
    window.addEventListener("oxyzen:stream_failed", (e) => {
      const track = (e.detail && e.detail.track) || this.currentTrack;
      const title = (track && track.title) || "Audio track";
      this.showToast(`⚠️ "${title}" stream unavailable. Skipping in 3s...`);
      if (this.streamFailTimer) clearTimeout(this.streamFailTimer);
      this.streamFailTimer = setTimeout(() => {
        this.playNext();
      }, 3000);
    });

    // Local Storage Synchronizer Event
    window.addEventListener("oxyzen:storage_updated", (e) => {
      const { type } = e.detail || {};
      if (type === "likes") {
        this.likedIds = this.storage.getLikedIds();
        this.updateLikesBadge(this.likedIds.size);
        if (this.activeView === "liked") this.loadLikedView();
      } else if (type === "playlists") {
        this.playlists = this.storage.getPlaylists();
        this.updatePlaylistsBadge(this.playlists.length);
        if (this.activeView === "playlists") this.loadPlaylistsView();
      } else if (type === "history") {
        if (this.activeView === "history") this.loadHistoryView();
      } else if (type === "imported") {
        this.likedIds = this.storage.getLikedIds();
        this.playlists = this.storage.getPlaylists();
        this.updateLikesBadge(this.likedIds.size);
        this.updatePlaylistsBadge(this.playlists.length);
        this.loadUserProfile();
        if (this.activeView === "liked") this.loadLikedView();
        if (this.activeView === "playlists") this.loadPlaylistsView();
        if (this.activeView === "history") this.loadHistoryView();
      }
    });

    window.addEventListener("oxyzen:next", () => this.playNext());
    window.addEventListener("oxyzen:prev", () => this.playPrevious());

    // 4. Player Dock Controls
    if (this.playPauseBtn) this.playPauseBtn.addEventListener("click", () => this.togglePlayPause());
    if (this.nextBtn) this.nextBtn.addEventListener("click", () => this.playNext());
    if (this.prevBtn) this.prevBtn.addEventListener("click", () => this.playPrevious());

    if (this.shuffleBtn) {
      this.shuffleBtn.addEventListener("click", () => {
        this.isShuffle = !this.isShuffle;
        this.shuffleBtn.classList.toggle("active", this.isShuffle);
        this.storage.saveSettings({ isShuffle: this.isShuffle });
        this.showToast(this.isShuffle ? "🔀 Shuffle On" : "➡️ Shuffle Off");
      });
    }

    if (this.repeatBtn) {
      this.repeatBtn.addEventListener("click", () => {
        if (this.repeatMode === "off") {
          this.repeatMode = "all";
          this.repeatBtn.innerHTML = "🔁";
          this.repeatBtn.classList.add("active");
          this.showToast("🔁 Repeat All");
        } else if (this.repeatMode === "all") {
          this.repeatMode = "one";
          this.repeatBtn.innerHTML = "🔂";
          this.repeatBtn.classList.add("active");
          this.showToast("🔂 Repeat Track");
        } else {
          this.repeatMode = "off";
          this.repeatBtn.innerHTML = "🔁";
          this.repeatBtn.classList.remove("active");
          this.showToast("➡️ Repeat Off");
        }
        this.storage.saveSettings({ repeatMode: this.repeatMode });
      });
    }

    if (this.spatial8DBtn) {
      this.spatial8DBtn.addEventListener("click", () => this.toggle8DMode());
    }

    // Seek Slider Drag Events
    if (this.seekSlider) {
      this.seekSlider.addEventListener("mousedown", () => this.isSeeking = true);
      this.seekSlider.addEventListener("touchstart", () => this.isSeeking = true);
      this.seekSlider.addEventListener("input", (e) => {
        this.updateSliderFill(e.target);
        const percent = parseFloat(e.target.value);
        const dur = this.audio.audio.duration || (this.currentTrack ? this.currentTrack.duration_sec : 0);
        if (this.currentTimeLabel && dur > 0) {
          this.currentTimeLabel.innerText = this.formatTime((percent / 100) * dur);
        }
      });
      this.seekSlider.addEventListener("change", (e) => {
        const percent = parseFloat(e.target.value);
        const dur = this.audio.audio.duration || (this.currentTrack ? this.currentTrack.duration_sec : 0);
        const targetSec = (percent / 100) * dur;
        this.audio.seek(targetSec);
        this.isSeeking = false;
        if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin)) {
          this.sync.broadcastSeek(targetSec);
        }
      });
    }

    // Volume Slider
    if (this.volumeSlider) {
      this.volumeSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        this.audio.setVolume(val);
        this.updateSliderFill(e.target);
        if (this.volumeIcon) {
          this.volumeIcon.innerText = val === 0 ? "🔇" : val < 0.5 ? "🔉" : "🔊";
        }
        if (this.cinemaVolumeSlider) {
          this.cinemaVolumeSlider.value = val;
          this.updateSliderFill(this.cinemaVolumeSlider);
        }
      });
    }

    if (this.volumeIcon) {
      this.volumeIcon.addEventListener("click", () => {
        if (this.audio.audio.volume > 0) {
          this.lastVol = this.audio.audio.volume;
          this.audio.setVolume(0);
          this.volumeSlider.value = 0;
          this.volumeIcon.innerText = "🔇";
        } else {
          const restore = this.lastVol || 0.8;
          this.audio.setVolume(restore);
          this.volumeSlider.value = restore;
          this.volumeIcon.innerText = restore < 0.5 ? "🔉" : "🔊";
        }
        this.updateSliderFill(this.volumeSlider);
      });
    }

    // Dock Like Button
    if (this.playerLikeBtn) {
      this.playerLikeBtn.addEventListener("click", () => {
        if (this.currentTrack) {
          this.toggleLikeTrack(this.currentTrack);
        }
      });
    }

    // 5. Cinema Mode Controls
    if (this.cinemaToggleBtn) {
      this.cinemaToggleBtn.addEventListener("click", () => this.toggleCinemaMode(true));
    }
    if (this.cinemaCloseBtn) {
      this.cinemaCloseBtn.addEventListener("click", () => this.toggleCinemaMode(false));
    }
    if (this.cinemaFullscreenBtn) {
      this.cinemaFullscreenBtn.addEventListener("click", () => {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
      });
    }

    if (this.cinemaSeekSlider) {
      this.cinemaSeekSlider.addEventListener("mousedown", () => this.isSeeking = true);
      this.cinemaSeekSlider.addEventListener("touchstart", () => this.isSeeking = true);
      this.cinemaSeekSlider.addEventListener("input", (e) => {
        this.updateSliderFill(e.target);
        const percent = parseFloat(e.target.value);
        const dur = this.audio.audio.duration || (this.currentTrack ? this.currentTrack.duration_sec : 0);
        if (this.cinemaCurrentTime && dur > 0) {
          this.cinemaCurrentTime.innerText = this.formatTime((percent / 100) * dur);
        }
      });
      this.cinemaSeekSlider.addEventListener("change", (e) => {
        const percent = parseFloat(e.target.value);
        const dur = this.audio.audio.duration || (this.currentTrack ? this.currentTrack.duration_sec : 0);
        const targetSec = (percent / 100) * dur;
        this.audio.seek(targetSec);
        this.isSeeking = false;
        if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin)) {
          this.sync.broadcastSeek(targetSec);
        }
      });
    }

    if (this.cinemaVolumeSlider) {
      this.cinemaVolumeSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        this.audio.setVolume(val);
        this.updateSliderFill(e.target);
        if (this.volumeSlider) {
          this.volumeSlider.value = val;
          this.updateSliderFill(this.volumeSlider);
        }
      });
    }

    if (this.cinemaLikeBtn) {
      this.cinemaLikeBtn.addEventListener("click", () => {
        if (this.currentTrack) {
          this.toggleLikeTrack(this.currentTrack);
        }
      });
    }

    if (this.cinemaSpatialBtn) {
      this.cinemaSpatialBtn.addEventListener("click", () => this.toggle8DMode());
    }

    // Panels & Modals
    if (this.lyricsToggleBtn) {
      this.lyricsToggleBtn.addEventListener("click", () => {
        this.lyricsPanel.classList.toggle("open");
        this.queuePanel.classList.remove("open");
      });
    }
    if (this.lyricsCloseBtn) {
      this.lyricsCloseBtn.addEventListener("click", () => this.lyricsPanel.classList.remove("open"));
    }

    if (this.queueToggleBtn) {
      this.queueToggleBtn.addEventListener("click", () => {
        this.queuePanel.classList.toggle("open");
        this.lyricsPanel.classList.remove("open");
        this.renderQueuePanel();
      });
    }
    if (this.queueCloseBtn) {
      this.queueCloseBtn.addEventListener("click", () => this.queuePanel.classList.remove("open"));
    }

    if (this.eqOpenBtn) {
      this.eqOpenBtn.addEventListener("click", () => this.eqModal.classList.add("active"));
    }
    if (this.eqCloseBtn) {
      this.eqCloseBtn.addEventListener("click", () => this.eqModal.classList.remove("active"));
    }
    if (this.eqModal) {
      this.eqModal.addEventListener("click", (e) => {
        if (e.target === this.eqModal) this.eqModal.classList.remove("active");
      });
    }
    // Cinema Floating Dock Idle Auto-Hide
    let cinemaIdleTimer = null;
    if (this.cinemaOverlay) {
      const dock = document.getElementById("cinema-floating-dock");
      this.cinemaOverlay.addEventListener("mousemove", () => {
        if (dock) dock.classList.remove("idle-hidden");
        clearTimeout(cinemaIdleTimer);
        cinemaIdleTimer = setTimeout(() => {
          if (this.cinemaOverlay && this.cinemaOverlay.classList.contains("active") && dock) {
            dock.classList.add("idle-hidden");
          }
        }, 3800);
      });
    }

    // Setup Specific UI Modules
    this.setupProfileUI();
    this.setupEqualizerUI();
    this.setupSoundSyncSpaceUI();
    this.setupKeyboardShortcuts();
  }

  // -------------------------------------------------------------
  // 8D SPATIAL AUDIO TOGGLE
  // -------------------------------------------------------------
  toggle8DMode() {
    const active = this.audio.toggle8DSpatial();
    if (this.spatial8DBtn) this.spatial8DBtn.classList.toggle("active", active);
    if (this.cinemaSpatialBtn) this.cinemaSpatialBtn.classList.toggle("active", active);
    
    const pill = document.getElementById("sidebar-profile-pill");
    if (active) {
      this.showToast("🎧 8D Spatial Binaural Surround Active");
      if (pill) pill.innerHTML = '<span class="audio-mode-pulse-dot"></span> 8D Spatial';
    } else {
      this.showToast("🎵 Pure Master Hi-Fi Stereo Mode");
      if (pill) pill.innerHTML = '<span class="audio-mode-pulse-dot"></span> Master Hi-Fi';
    }
  }

  // -------------------------------------------------------------
  // VIEW NAVIGATION
  // -------------------------------------------------------------
  switchView(viewName) {
    this.activeView = viewName;
    document.querySelectorAll(".nav-item[data-view], .mobile-nav-tab[data-view]").forEach(item => {
      item.classList.toggle("active", item.dataset.view === viewName);
    });
    this.pageViews.forEach(view => {
      view.classList.toggle("active", view.id === `view-${viewName}`);
    });

    if (viewName === "explore") {
      this.refreshPersonalizedSections();
    } else if (viewName === "moods") {
      this.loadMoodCategories();
    } else if (viewName === "liked") {
      this.loadLikedView();
    } else if (viewName === "playlists") {
      this.loadPlaylistsView();
    } else if (viewName === "history") {
      this.loadHistoryView();
    } else if (viewName === "vibe") {
      this.loadVibeStationView();
    } else if (viewName === "sync-space") {
      this.renderSoundSyncSpace();
    }
  }

  // -------------------------------------------------------------
  // INITIAL DATA & FEED LOADING
  // -------------------------------------------------------------
  async loadInitialData() {
    try {
      // 1. Load Profile & stats
      await this.loadUserProfile();

      // 2. Load from client storage first (Instant, zero latency, 100% offline resilient)
      const localLikes = this.storage.getLikedTracks();
      this.likedIds = new Set(localLikes.map(t => t.id || t.videoId));
      this.updateLikesBadge(localLikes.length);
      if (localLikes.length > 0) this.registerTracks(localLikes);

      this.playlists = this.storage.getPlaylists();
      this.updatePlaylistsBadge(this.playlists.length);

      // Restore button UI states
      if (this.shuffleBtn) this.shuffleBtn.classList.toggle("active", this.isShuffle);
      if (this.repeatBtn) {
        if (this.repeatMode === "all") {
          this.repeatBtn.innerHTML = "🔁";
          this.repeatBtn.classList.add("active");
        } else if (this.repeatMode === "one") {
          this.repeatBtn.innerHTML = "🔂";
          this.repeatBtn.classList.add("active");
        }
      }

      // 3. Fetch explore feed
      const exploreRes = await fetch(`${API_BASE}/api/explore`).then(r => r.json()).catch(() => ({}));
      if (exploreRes && exploreRes.sections) {
        this.renderExploreFeed(exploreRes);
      }
    } catch (err) {
      console.warn("Error loading initial data:", err);
    }
  }

  // -------------------------------------------------------------
  // USER PROFILE & LANGUAGE PREFERENCES
  // -------------------------------------------------------------
  async loadUserProfile() {
    try {
      const res = await fetch(`${API_BASE}/api/user/profile`);
      const data = await res.json();
      if (data && data.profile) {
        this.userProfile = { ...this.userProfile, ...data.profile };
        this.updateProfileUI();
      }
    } catch (e) {
      this.updateProfileUI();
    }
  }

  updateProfileUI() {
    const avatar = this.userProfile.avatar || "👑";
    const name = this.userProfile.name || "Oxyzen Listener";
    const langs = this.userProfile.languages || ["English", "Telugu", "Hindi"];

    // Sidebar
    const sideAvatar = document.getElementById("sidebar-user-avatar");
    const sideName = document.getElementById("sidebar-user-name");
    const sideLangs = document.getElementById("sidebar-user-langs");
    if (sideAvatar) {
      if (avatar.startsWith("http")) {
        sideAvatar.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
      } else {
        sideAvatar.innerText = avatar;
      }
    }
    if (sideName) sideName.innerText = name;
    if (sideLangs) sideLangs.innerText = langs.map(l => l.slice(0, 2).toUpperCase()).join(" • ");

    // Topbar
    const topAvatar = document.getElementById("topbar-avatar");
    const topName = document.getElementById("topbar-username");
    if (topAvatar) {
      if (avatar.startsWith("http")) {
        topAvatar.innerHTML = `<img src="${avatar}" style="width:20px;height:20px;border-radius:50%;object-fit:cover;">`;
      } else {
        topAvatar.innerText = avatar;
      }
    }
    if (topName) topName.innerText = name.split(" ")[0] || name;

    // Moods subtitle
    const moodSub = document.getElementById("mood-hub-languages-desc");
    if (moodSub) {
      moodSub.innerText = `Curated emotional albums tailored to your preferred languages (${langs.join(", ")})`;
    }

    // Profile Modal inputs
    const modalAvatar = document.getElementById("profile-modal-avatar-preview");
    const nameInput = document.getElementById("profile-name-input");
    if (modalAvatar) {
      if (avatar.startsWith("http")) {
        modalAvatar.innerHTML = `<img src="${avatar}" style="width:100%;height:100%;border-radius:inherit;object-fit:cover;">`;
      } else {
        modalAvatar.innerText = avatar;
      }
    }
    if (nameInput) nameInput.value = name;

    document.querySelectorAll(".lang-chip").forEach(chip => {
      chip.classList.toggle("active", langs.includes(chip.dataset.lang));
    });

    const picker = document.getElementById("profile-avatar-picker");
    if (picker) {
      picker.querySelectorAll(".profile-avatar-pill, .avatar-option").forEach(opt => {
        opt.classList.toggle("active", opt.dataset.avatar === avatar);
      });
    }

    // Sync sound sync profile
    this.sync.setProfile(name, avatar);
  }

  setupProfileUI() {
    const openModal = () => {
      if (this.profileModal) this.profileModal.classList.add("active");
      this.fetchProfileStats();
    };

    if (this.profileOpenBtn) this.profileOpenBtn.addEventListener("click", openModal);
    if (this.profileSidebarBtn) this.profileSidebarBtn.addEventListener("click", openModal);
    
    const moodLangBtn = document.getElementById("mood-customize-languages-btn");
    if (moodLangBtn) moodLangBtn.addEventListener("click", openModal);

    if (this.profileCloseBtn) {
      this.profileCloseBtn.addEventListener("click", () => {
        this.profileModal.classList.remove("active");
      });
    }

    // Avatar options in profile modal
    const picker = document.getElementById("profile-avatar-picker");
    if (picker) {
      picker.querySelectorAll(".profile-avatar-pill, .avatar-option").forEach(opt => {
        opt.addEventListener("click", () => {
          picker.querySelectorAll(".profile-avatar-pill, .avatar-option").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");
          const av = opt.dataset.avatar || "👑";
          this.userProfile.avatar = av;
          const preview = document.getElementById("profile-modal-avatar-preview");
          if (preview) preview.innerText = av;
        });
      });
    }

    // Language chips multi-select
    document.querySelectorAll(".lang-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("active");
      });
    });

    // Save profile
    if (this.profileSaveBtn) {
      this.profileSaveBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("profile-name-input");
        const newName = (nameInput && nameInput.value.trim()) || "Oxyzen Listener";
        
        const selectedLangs = [];
        document.querySelectorAll(".lang-chip.active").forEach(chip => {
          if (chip.dataset.lang) selectedLangs.push(chip.dataset.lang);
        });

        const qualityOpt = document.querySelector('input[name="audio-quality-opt"]:checked');
        const quality = qualityOpt ? qualityOpt.value : "Master 320k";

        this.userProfile.name = newName;
        this.userProfile.languages = selectedLangs.length > 0 ? selectedLangs : ["English", "Telugu", "Hindi"];
        this.userProfile.audio_quality = quality;

        localStorage.setItem("oxyzen_user_name", this.userProfile.name);
        localStorage.setItem("oxyzen_user_avatar", this.userProfile.avatar);
        localStorage.setItem("oxyzen_user_languages", JSON.stringify(this.userProfile.languages));

        this.updateProfileUI();
        if (this.profileModal) this.profileModal.classList.remove("active");
        this.showToast(`✨ Preferences saved! Tailored to ${this.userProfile.languages.join(", ")}`);

        // Persist to server
        fetch(`${API_BASE}/api/user/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.userProfile)
        }).catch(() => {});

        // If in moods view, reload active mood
        if (this.activeView === "moods" && this.activeMoodKey) {
          this.loadMoodStation(this.activeMoodKey);
        }
      });
    }

    // Backup Export & Import Handlers
    const exportBtn = document.getElementById("profile-export-backup-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        this.storage.downloadBackupFile();
        this.showToast("📥 Exported Oxyzen data backup (.json)");
      });
    }

    const importBtn = document.getElementById("profile-import-backup-btn");
    const importFileInput = document.getElementById("profile-import-file-input");
    if (importBtn && importFileInput) {
      importBtn.addEventListener("click", () => importFileInput.click());
      importFileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target.result;
            const res = this.storage.importBackupData(content, "merge");
            if (res.success) {
              this.showToast("✨ Data backup restored successfully!");
              this.loadUserProfile();
              this.fetchProfileStats();
            } else {
              this.showToast(`❌ ${res.message}`);
            }
          } catch (err) {
            this.showToast("❌ Failed to parse backup file");
          }
        };
        reader.readAsText(file);
        importFileInput.value = "";
      });
    }
  }

  async fetchProfileStats() {
    const statPlays = document.getElementById("profile-stat-plays");
    const statLikes = document.getElementById("profile-stat-likes");
    const statPls = document.getElementById("profile-stat-playlists");

    const history = this.storage.getHistory(100);
    const likes = this.storage.getLikedTracks();
    const pls = this.storage.getPlaylists();

    if (statPlays) statPlays.innerText = history.length;
    if (statLikes) statLikes.innerText = likes.length;
    if (statPls) statPls.innerText = pls.length;

    try {
      const res = await fetch(`${API_BASE}/api/user/profile`);
      const data = await res.json();
      if (data && data.stats) {
        if (statPlays && data.stats.total_plays > history.length) {
          statPlays.innerText = data.stats.total_plays;
        }
      }
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // MULTILINGUAL MOOD STATIONS MATRIX
  // -------------------------------------------------------------
  async loadMoodCategories() {
    const grid = document.getElementById("moods-categories-grid");
    if (!grid) return;

    try {
      const res = await fetch(`${API_BASE}/api/moods`);
      const data = await res.json();
      const moods = data.moods || [];

      grid.innerHTML = moods.map(m => `
        <div class="mood-card" data-mood-id="${m.id}" style="border-top: 3px solid ${m.color};">
          <span class="mood-card-icon">${m.icon}</span>
          <div class="mood-card-title">${m.name}</div>
          <div class="mood-card-tagline">${m.tagline}</div>
        </div>
      `).join("");

      grid.querySelectorAll(".mood-card").forEach(card => {
        card.addEventListener("click", () => {
          const mId = card.dataset.moodId;
          this.loadMoodStation(mId);
        });
      });

      // If no mood active, load default "feel_good"
      if (!this.activeMoodKey) {
        this.loadMoodStation("love");
      }
    } catch (e) {
      console.warn("Failed to load mood categories:", e);
    }
  }

  async loadMoodStation(moodKey) {
    this.activeMoodKey = moodKey;
    if (this.activeView !== "moods") {
      this.switchView("moods");
    }

    // Highlight active card
    document.querySelectorAll(".mood-card").forEach(card => {
      card.classList.toggle("active", card.dataset.moodId === moodKey);
    });

    const container = document.getElementById("active-mood-playlist-container");
    if (!container) return;
    container.style.display = "block";
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 0; color: var(--silver-muted);">
        <div style="font-size: 24px; margin-bottom: 8px;">✦</div>
        <div>Loading high-fidelity mood station for ${this.userProfile.languages.join(", ")}...</div>
      </div>
    `;

    try {
      const langsParam = encodeURIComponent(this.userProfile.languages.join(","));
      const res = await fetch(`${API_BASE}/api/moods/${moodKey}?languages=${langsParam}`);
      const data = await res.json();
      const mood = data.mood || {};
      const tracks = this.registerTracks(data.tracks || []);

      if (tracks.length === 0) {
        container.innerHTML = `<div style="color: var(--silver-muted); padding: 40px;">No tracks found for this mood. Try changing preferred languages.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="hero-banner" style="background: ${mood.gradient || 'linear-gradient(135deg, rgba(245, 197, 66, 0.2), rgba(17, 17, 21, 0.95))'}; margin-bottom: 24px;">
          <div class="hero-content">
            <span class="hero-badge" style="color: ${mood.color}; border-color: ${mood.color};">✦ ${mood.icon} ACTIVE MOOD STATION</span>
            <h1 class="hero-title">${mood.name}</h1>
            <p class="hero-desc">${mood.tagline} • Tailored for ${this.userProfile.languages.join(", ")} (${tracks.length} tracks)</p>
            <div class="hero-actions">
              <button class="btn-luxury btn-gold-action" id="mood-play-all-btn">▶ Play All</button>
              <button class="btn-luxury" id="mood-shuffle-all-btn">🔀 Shuffle</button>
            </div>
          </div>
        </div>
        <table class="track-table">
          <thead>
            <tr>
              <th class="row-index-col">#</th>
              <th>Title</th>
              <th>Album</th>
              <th>Duration</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tracks.map((t, idx) => `
              <tr class="track-row ${this.currentTrack && (this.currentTrack.id === t.id) ? 'active' : ''}" data-track-id="${t.id}">
                <td class="row-index-col">${idx + 1}</td>
                <td class="row-track-col">
                  <img class="row-thumb" src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                  <div>
                    <div class="row-title">${t.title}</div>
                    <div class="row-artist">${t.artist}</div>
                  </div>
                </td>
                <td>${t.album || 'Oxyzen Audio'}</td>
                <td>${t.duration || '3:30'}</td>
                <td style="text-align: right;">
                  <div class="row-actions">
                    <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Save to Liked">
                      ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                    </button>
                    <button class="btn-row-action" data-action="add-queue" title="Add to Queue">➕</button>
                    <button class="btn-row-action" data-action="download" title="Download">⬇️</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;

      this.attachTrackRowEventListeners(container, tracks);

      const playAllBtn = document.getElementById("mood-play-all-btn");
      if (playAllBtn) {
        playAllBtn.addEventListener("click", () => {
          this.setQueue(tracks, 0);
          this.playTrack(tracks[0]);
        });
      }

      const shuffleAllBtn = document.getElementById("mood-shuffle-all-btn");
      if (shuffleAllBtn) {
        shuffleAllBtn.addEventListener("click", () => {
          this.isShuffle = true;
          this.setQueue(tracks, 0);
          this.playTrack(tracks[Math.floor(Math.random() * tracks.length)]);
        });
      }
    } catch (err) {
      container.innerHTML = `<div style="color: #EF4444; padding: 40px;">Failed to load mood station: ${err.message}</div>`;
    }
  }

  // -------------------------------------------------------------
  // EXPLORE FEED
  // -------------------------------------------------------------
  async refreshPersonalizedSections() {
    try {
      const res = await fetch(`${API_BASE}/api/explore`);
      const data = await res.json();
      if (data.sections) {
        this.renderExploreFeed(data);
      }
    } catch (e) {
      console.warn("Failed to refresh explore feed:", e);
    }
  }

  renderExploreFeed(exploreData) {
    const container = document.getElementById("explore-feed-container");
    if (!container || !exploreData.sections) return;

    // Register all tracks in local registry
    exploreData.sections.forEach(sec => {
      if (sec.tracks) this.registerTracks(sec.tracks);
    });

    let html = "";
    exploreData.sections.forEach((section, sIdx) => {
      const isPersonal = section.is_personalized;
      html += `
        <div class="feed-section ${isPersonal ? 'personalized-section' : ''}" data-section-idx="${sIdx}">
          <div class="section-header">
            <div>
              <h2 class="section-title">
                ${isPersonal ? '✨ ' : ''}${section.title}
              </h2>
              <p class="section-tagline">${section.tagline}</p>
            </div>
            <span class="brand-tag" style="border-color: ${section.color}; color: ${section.color}">${section.badge}</span>
          </div>
          <div class="cards-grid">
            ${section.tracks.map(t => this.renderMusicCardHTML(t)).join("")}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach click listeners with section queue context
    container.querySelectorAll(".feed-section").forEach((secEl, sIdx) => {
      const sectionObj = exploreData.sections[sIdx];
      if (!sectionObj || !sectionObj.tracks) return;

      secEl.querySelectorAll(".music-card").forEach((card, cIdx) => {
        card.addEventListener("click", () => {
          const track = sectionObj.tracks[cIdx];
          if (track) {
            this.setQueue(sectionObj.tracks, cIdx);
            this.playTrack(track);
          }
        });
      });
    });
  }

  renderMusicCardHTML(track) {
    const thumb = track.thumbnail || `https://i.ytimg.com/vi/${track.id || track.videoId}/hqdefault.jpg`;
    return `
      <div class="music-card" data-track-id="${track.id || track.videoId}">
        <div class="card-img-wrapper">
          <img class="card-img" src="${thumb}" onerror="this.src='/static/assets/logo.png'" loading="lazy" alt="${track.title}">
          <button class="card-play-btn" data-action="play">▶</button>
        </div>
        <div class="card-title" title="${track.title}">${track.title}</div>
        <div class="card-subtitle" title="${track.artist}">${track.artist}</div>
      </div>
    `;
  }

  // -------------------------------------------------------------
  // SEARCH & AUTOCOMPLETE
  // -------------------------------------------------------------
  async fetchSuggestions(query) {
    try {
      const res = await fetch(`${API_BASE}/api/suggestions?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.suggestions && data.suggestions.length > 0) {
        this.renderSuggestions(data.suggestions);
      } else {
        this.hideSuggestions();
      }
    } catch (e) {
      this.hideSuggestions();
    }
  }

  renderSuggestions(suggestions) {
    if (!this.suggestionsBox) return;
    this.suggestionsBox.innerHTML = suggestions.map(s => `
      <div class="suggestion-item" data-val="${s}">
        <span class="suggestion-icon">🔍</span>
        <span>${s}</span>
      </div>
    `).join("");
    this.suggestionsBox.classList.add("active");

    this.suggestionsBox.querySelectorAll(".suggestion-item").forEach(item => {
      item.addEventListener("click", () => {
        const val = item.dataset.val;
        this.searchInput.value = val;
        this.hideSuggestions();
        this.performSearch(val);
      });
    });
  }

  hideSuggestions() {
    if (this.suggestionsBox) this.suggestionsBox.classList.remove("active");
  }

  async performSearch(query) {
    this.searchQuery = query;
    this.switchView("search");

    const resultsContainer = document.getElementById("search-results-container");
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 28px; margin-bottom: 12px;">✦</div>
          <div>Unlocking pure high-res audio stream for "${query}"...</div>
        </div>
      `;
    }

    try {
      let url = `${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=50`;
      if (this.searchFilter) url += `&filter=${this.searchFilter}`;

      const res = await fetch(url);
      const data = await res.json();
      this.renderSearchResults(data);
    } catch (err) {
      if (resultsContainer) {
        resultsContainer.innerHTML = `<div style="color: #EF4444; padding: 40px;">Failed to search: ${err.message}</div>`;
      }
    }
  }

  renderSearchResults(data) {
    const container = document.getElementById("search-results-container");
    if (!container) return;

    const tracks = data.tracks || [];
    this.registerTracks(tracks);

    if (tracks.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div>No tracks found for "${this.searchQuery}". Try another search term.</div>
        </div>
      `;
      return;
    }

    let html = `
      <div style="margin-bottom: 24px;">
        <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 4px;">Top Results for "${this.searchQuery}"</h2>
        <p style="font-size: 13px; color: var(--silver-muted);">${tracks.length} high-fidelity tracks found • Zero Ads</p>
      </div>
      <table class="track-table">
        <thead>
          <tr>
            <th class="row-index-col">#</th>
            <th>Title</th>
            <th>Album</th>
            <th>Duration</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${tracks.map((t, idx) => `
            <tr class="track-row ${this.currentTrack && (this.currentTrack.id === t.id) ? 'active' : ''}" data-track-id="${t.id}">
              <td class="row-index-col">${idx + 1}</td>
              <td class="row-track-col">
                <img class="row-thumb" src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                <div>
                  <div class="row-title">${t.title}</div>
                  <div class="row-artist">${t.artist}</div>
                </div>
              </td>
              <td>${t.album || 'Oxyzen Audio'}</td>
              <td>${t.duration || '3:30'}</td>
              <td style="text-align: right;">
                <div class="row-actions">
                  <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Save to Liked">
                    ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                  </button>
                  <button class="btn-row-action" data-action="add-playlist" title="Add to Playlist">📁</button>
                  <button class="btn-row-action" data-action="add-queue" title="Add to Queue">➕</button>
                  <button class="btn-row-action" data-action="download" title="Download High-Res">⬇️</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    this.attachTrackRowEventListeners(container, tracks);
  }

  attachTrackRowEventListeners(container, tracksList) {
    container.querySelectorAll(".track-row").forEach(row => {
      const trackId = row.dataset.trackId;
      const trackObj = tracksList.find(t => t.id === trackId) || this.findTrackById(trackId);

      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        if (trackObj) {
          this.setQueue(tracksList, tracksList.indexOf(trackObj));
          this.playTrack(trackObj);
        }
      });

      const likeBtn = row.querySelector('[data-action="like"]');
      if (likeBtn && trackObj) {
        likeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.toggleLikeTrack(trackObj, likeBtn);
        });
      }

      const plBtn = row.querySelector('[data-action="add-playlist"]');
      if (plBtn && trackObj) {
        plBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.openAddToPlaylistModal(trackObj);
        });
      }

      const queueBtn = row.querySelector('[data-action="add-queue"]');
      if (queueBtn && trackObj) {
        queueBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.addToQueue(trackObj);
        });
      }

      const dlBtn = row.querySelector('[data-action="download"]');
      if (dlBtn && trackObj) {
        dlBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.downloadTrack(trackObj);
        });
      }
    });
  }

  // -------------------------------------------------------------
  // PLAYBACK MANAGEMENT
  // -------------------------------------------------------------
  async playTrack(track, startTime = 0) {
    if (!track) return;
    const registered = this.registerTrack(track);
    this.currentTrack = registered;
    this.updatePlayerDockUI(registered);

    // Save to local device storage history & settings
    this.storage.addToHistory(registered);
    this.storage.saveSettings({ lastTrack: registered, lastPosition: startTime });

    // If SoundSync lounge is connected and user is host/admin, broadcast to room
    if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin)) {
      this.sync.broadcastPlayTrack(registered);
    }

    // Prefetch next track in queue for zero-latency gapless feel
    if (this.queue.length > this.queueIndex + 1) {
      this.audio.prefetchTrack(this.queue[this.queueIndex + 1]);
    }

    // Log to server history in background
    fetch(`${API_BASE}/api/library/history/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registered)
    }).catch(() => {});

    // Fetch synced lyrics
    this.fetchLyrics(registered);

    // Fetch smart recommendations for Vibe Radar and SoundSync space suggestions
    this.fetchVibeQueue(registered);

    // Load & play in Web Audio Engine
    await this.audio.loadAndPlay(registered, startTime);
  }

  togglePlayPause() {
    if (!this.currentTrack) {
      if (this.queue.length > 0) {
        this.playTrack(this.queue[0]);
      }
      return;
    }
    if (this.audio.isPlaying) {
      this.audio.pause();
    } else {
      this.audio.play();
    }
  }

  playNext() {
    if (this.queue.length === 0) return;
    if (this.repeatMode === "one" && this.currentTrack) {
      this.audio.seek(0);
      this.audio.play();
      return;
    }

    let nextIndex = this.queueIndex + 1;
    if (this.isShuffle) {
      nextIndex = Math.floor(Math.random() * this.queue.length);
    }

    if (nextIndex >= this.queue.length) {
      if (this.repeatMode === "all") {
        nextIndex = 0;
      } else if (this.infiniteRadio && this.vibeTracks && this.vibeTracks.length > 0) {
        this.queue.push(...this.vibeTracks.slice(0, 5));
        this.vibeTracks = this.vibeTracks.slice(5);
        this.updateQueueBadge();
      } else {
        return;
      }
    }

    this.queueIndex = nextIndex;
    this.playTrack(this.queue[this.queueIndex]);
  }

  playPrevious() {
    if (this.audio.audio.currentTime > 3) {
      this.audio.seek(0);
      return;
    }
    if (this.queue.length === 0) return;
    let prevIndex = this.queueIndex - 1;
    if (prevIndex < 0) prevIndex = this.queue.length - 1;
    this.queueIndex = prevIndex;
    this.playTrack(this.queue[this.queueIndex]);
  }

  handleTrackEnded() {
    if (this.repeatMode === "one") {
      this.audio.seek(0);
      this.audio.play();
    } else {
      this.playNext();
    }
  }

  setQueue(trackList, startIndex = 0) {
    this.queue = this.registerTracks(trackList);
    this.queueIndex = startIndex;
    this.updateQueueBadge();
  }

  addToQueue(track) {
    const reg = this.registerTrack(track);
    this.queue.push(reg);
    this.updateQueueBadge();
    this.showToast(`➕ Added "${reg.title}" to queue`);

    if (this.sync.connected) {
      this.sync.broadcastAddQueue(reg);
    }
  }

  updateQueueBadge() {
    if (this.queueBadge) {
      this.queueBadge.innerText = this.queue.length;
    }
  }

  updatePlayerDockUI(track) {
    const thumb = track.thumbnail || `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`;
    if (this.playerThumb) this.playerThumb.src = thumb;
    if (this.playerTitle) this.playerTitle.innerText = track.title || "Unknown Track";
    if (this.playerArtist) this.playerArtist.innerText = track.artist || "Unknown Artist";
    if (this.totalTimeLabel) this.totalTimeLabel.innerText = track.duration || "0:00";

    const isLiked = this.likedIds.has(track.id || track.videoId);
    if (this.playerLikeBtn) {
      this.playerLikeBtn.innerHTML = isLiked ? "❤️" : "🤍";
      this.playerLikeBtn.classList.toggle("liked", isLiked);
    }

    // Update Ambient Cinema Mode Elements
    if (this.cinemaArt) this.cinemaArt.src = thumb;
    const cinemaJacketArt = document.getElementById("cinema-jacket-art");
    if (cinemaJacketArt) cinemaJacketArt.src = thumb;
    if (this.cinemaTitle) this.cinemaTitle.innerText = track.title || "Unknown Track";
    if (this.cinemaArtist) this.cinemaArtist.innerText = track.artist || "Unknown Artist";
    if (this.cinemaBackdrop) {
      this.cinemaBackdrop.style.backgroundImage = `url(${thumb})`;
    }
    if (this.cinemaLikeBtn) {
      this.cinemaLikeBtn.innerHTML = isLiked ? "❤️" : "🤍";
    }

    // Update SoundSync Space Stage
    const stageArt = document.getElementById("sync-stage-art");
    const stageTitle = document.getElementById("sync-stage-title");
    const stageArtist = document.getElementById("sync-stage-artist");
    if (stageArt) stageArt.src = thumb;
    if (stageTitle) stageTitle.innerText = track.title || "No Track Playing";
    if (stageArtist) stageArtist.innerText = track.artist || "Select a song to start the party";
  }

  updateActiveRowHighlight() {
    document.querySelectorAll(".track-row").forEach(row => {
      row.classList.toggle("active", this.currentTrack && row.dataset.trackId === this.currentTrack.id);
    });
  }

  // -------------------------------------------------------------
  // LYRICS ENGINE (ULTRA-AESTHETIC SYNCED & PLAIN KARAOKE)
  // -------------------------------------------------------------
  async fetchLyrics(track) {
    this.lyricsData = {
      synced: true,
      lines: [
        { time: 0.0, text: `♪ ${track.title} ♪` },
        { time: 4.0, text: `Artist: ${track.artist}` },
        { time: 8.0, text: "Searching studio synchronized lyrics..." }
      ],
      plain: ""
    };
    this.activeLyricIndex = -1;
    this.renderLyrics();

    try {
      const res = await fetch(`${API_BASE}/api/lyrics?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}&duration=${track.duration_sec || 0}`);
      const data = await res.json();
      if (data && (data.lines && data.lines.length > 0)) {
        this.lyricsData = data;
      } else if (data && data.plain) {
        // Break plain lyrics into lines with simulated stanzas
        const plainLines = data.plain.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const dur = track.duration_sec || 180;
        const step = Math.max(dur / Math.max(plainLines.length, 1), 4);
        this.lyricsData = {
          synced: true,
          lines: plainLines.map((l, i) => ({ time: Math.round(i * step * 10) / 10, text: l })),
          plain: data.plain
        };
      }
      this.renderLyrics();
    } catch (e) {
      this.lyricsData = {
        synced: true,
        lines: [
          { time: 0.0, text: `♪ ${track.title} ♪` },
          { time: 5.0, text: `Artist: ${track.artist}` },
          { time: 15.0, text: "✦ Pure Unchained High-Fidelity Audio Stream ✦" },
          { time: 30.0, text: "✦ Spatial Stereo Hi-Fi Master Active ✦" }
        ],
        plain: "Enjoying high fidelity audio on Oxyzen."
      };
      this.renderLyrics();
    }
  }

  renderLyrics() {
    const panels = [this.lyricsContent, this.cinemaLyrics];
    panels.forEach(panel => {
      if (!panel) return;
      if (this.lyricsData.lines && this.lyricsData.lines.length > 0) {
        panel.innerHTML = this.lyricsData.lines.map((l, idx) => `
          <div class="cinema-lyric-line ${idx === 0 ? 'active' : ''}" data-index="${idx}" data-time="${l.time}">
            ${this.escapeHTML(l.text || '♪')}
          </div>
        `).join("");

        panel.querySelectorAll(".cinema-lyric-line").forEach(lineEl => {
          lineEl.addEventListener("click", () => {
            const time = parseFloat(lineEl.dataset.time);
            if (!isNaN(time) && time >= 0) {
              this.audio.seek(time);
            }
          });
        });
      } else {
        panel.innerHTML = `
          <div style="font-size: 18px; color: var(--silver-muted); line-height: 2; padding: 40px 0; text-align: center;">
            ✦ Pure High-Fidelity Audio on Oxyzen ✦
          </div>
        `;
      }
    });
  }

  updateActiveLyricLine(currentTime) {
    if (!this.lyricsData.lines || this.lyricsData.lines.length === 0) return;

    let activeIdx = -1;
    for (let i = 0; i < this.lyricsData.lines.length; i++) {
      if (currentTime >= this.lyricsData.lines[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx === -1 && this.lyricsData.lines.length > 0) {
      activeIdx = 0;
    }

    if (activeIdx !== this.activeLyricIndex) {
      this.activeLyricIndex = activeIdx;
      
      // Update Slide panel
      if (this.lyricsContent) {
        const slideLines = this.lyricsContent.querySelectorAll(".cinema-lyric-line");
        slideLines.forEach((el, idx) => {
          const isActive = (idx === activeIdx);
          const isPast = (idx < activeIdx);
          el.classList.toggle("active", isActive);
          el.classList.toggle("past", isPast);
          if (isActive) el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }

      // Update Cinema Mode (locked internal scroll container only)
      if (this.cinemaLyrics) {
        const cinemaLines = this.cinemaLyrics.querySelectorAll(".cinema-lyric-line");
        cinemaLines.forEach((el, idx) => {
          const isActive = (idx === activeIdx);
          const isPast = (idx < activeIdx);
          el.classList.toggle("active", isActive);
          el.classList.toggle("past", isPast);
          if (isActive) {
            const containerH = this.cinemaLyrics.clientHeight || 400;
            const targetTop = el.offsetTop - (containerH / 2) + (el.clientHeight / 2);
            this.cinemaLyrics.scrollTo({
              top: Math.max(0, targetTop),
              behavior: "smooth"
            });
          }
        });
      }
    }
  }

  // -------------------------------------------------------------
  // VIBE RADAR & MUSIC RECOMMENDATIONS (COVER IMAGE FIX)
  // -------------------------------------------------------------
  async fetchVibeQueue(track) {
    try {
      const res = await fetch(`${API_BASE}/api/recommendations?video_id=${track.id || track.videoId}&artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`);
      const data = await res.json();
      this.vibeTracks = this.registerTracks(data.recommendations || []);
      
      // Update SoundSync suggestions
      this.renderSoundSyncPartySuggestions();
      
      // If currently on Vibe view, refresh
      if (this.activeView === "vibe") {
        this.loadVibeStationView();
      }
    } catch (e) {
      this.vibeTracks = [];
    }
  }

  async loadVibeStationView() {
    const container = document.getElementById("vibe-station-container");
    if (!container) return;

    if (!this.currentTrack) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">📡</div>
          <div style="font-size: 18px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">Vibe Radar Matrix</div>
          <div>Play any song to activate real-time acoustic matching and tailored frequencies.</div>
        </div>
      `;
      return;
    }

    const currentThumb = this.currentTrack.thumbnail || `https://i.ytimg.com/vi/${this.currentTrack.id}/hqdefault.jpg`;

    container.innerHTML = `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(34, 211, 238, 0.2), rgba(17, 17, 21, 0.95)); margin-bottom: 28px;">
        <div style="display: flex; gap: 24px; align-items: center;">
          <img src="${currentThumb}" onerror="this.src='/static/assets/logo.png'" style="width: 110px; height: 110px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.7), 0 0 20px rgba(34, 211, 238, 0.3);">
          <div class="hero-content">
            <span class="hero-badge">✦ AI ACOUSTIC VIBE MATRIX</span>
            <h1 class="hero-title" style="font-size: 26px;">${this.currentTrack.title}</h1>
            <p class="hero-desc">${this.currentTrack.artist} • Frequency matched soundscapes and kindred harmonies</p>
          </div>
        </div>
      </div>

      <div class="cards-grid">
        ${(this.vibeTracks || []).map(t => this.renderMusicCardHTML(t)).join("")}
      </div>
    `;

    container.querySelectorAll(".music-card").forEach((card, idx) => {
      card.addEventListener("click", () => {
        const track = this.vibeTracks[idx];
        if (track) {
          this.setQueue(this.vibeTracks, idx);
          this.playTrack(track);
        }
      });
    });
  }

  // -------------------------------------------------------------
  // LIKED SONGS & LIBRARY (ZERO-BACKEND CLIENT STORAGE)
  // -------------------------------------------------------------
  toggleLikeTrack(track, buttonEl = null) {
    if (!track) return;
    const isLiked = this.storage.toggleLike(track);
    this.likedIds = this.storage.getLikedIds();

    if (buttonEl) {
      buttonEl.innerHTML = isLiked ? "❤️" : "🤍";
      buttonEl.classList.toggle("liked", isLiked);
    }
    if (this.currentTrack && (this.currentTrack.id === track.id || this.currentTrack.videoId === track.id) && this.playerLikeBtn) {
      this.playerLikeBtn.innerHTML = isLiked ? "❤️" : "🤍";
      this.playerLikeBtn.classList.toggle("liked", isLiked);
    }
    if (this.cinemaLikeBtn) {
      this.cinemaLikeBtn.innerHTML = isLiked ? "❤️" : "🤍";
    }

    this.updateLikesBadge(this.likedIds.size);
    this.showToast(isLiked ? `❤️ Saved "${track.title}" to Liked` : `🤍 Removed "${track.title}" from Liked`);

    // Optional background sync
    fetch(`${API_BASE}/api/library/likes/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(track)
    }).catch(() => {});
  }

  updateLikesBadge(count) {
    const badge = document.getElementById("likes-badge");
    if (badge) badge.innerText = count;
    const statLikes = document.getElementById("profile-stat-likes");
    if (statLikes) statLikes.innerText = count;
  }

  updatePlaylistsBadge(count) {
    const badge = document.getElementById("playlists-badge");
    if (badge) badge.innerText = count;
    const statPl = document.getElementById("profile-stat-playlists");
    if (statPl) statPl.innerText = count;
  }

  loadLikedView() {
    const container = document.getElementById("liked-songs-container");
    if (!container) return;

    const likes = this.registerTracks(this.storage.getLikedTracks());
    this.updateLikesBadge(likes.length);

    if (likes.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 36px; margin-bottom: 14px;">❤️</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">Your Liked Songs Collection is Empty</div>
          <div>Click the heart icon on any track to save it to your local collection.</div>
        </div>
      `;
      return;
    }

    let html = `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.2), rgba(17, 17, 21, 0.9)); margin-bottom: 28px;">
        <div class="hero-content">
          <span class="hero-badge" style="color: #EF4444; border-color: rgba(239, 68, 68, 0.3);">FAVORITES</span>
          <h1 class="hero-title">Liked Songs</h1>
          <p class="hero-desc">${likes.length} unchained high-fidelity favorites stored on this device</p>
          <div class="hero-actions">
            <button class="btn-luxury btn-gold-action" id="liked-play-all-btn">▶ Play All</button>
            <button class="btn-luxury" id="liked-shuffle-play-btn">🔀 Shuffle Play</button>
          </div>
        </div>
      </div>
      <table class="track-table">
        <thead>
          <tr>
            <th class="row-index-col">#</th>
            <th>Title</th>
            <th>Album</th>
            <th>Duration</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${likes.map((t, idx) => `
            <tr class="track-row ${this.currentTrack && (this.currentTrack.id === t.id) ? 'active' : ''}" data-track-id="${t.id}">
              <td class="row-index-col">${idx + 1}</td>
              <td class="row-track-col">
                <img class="row-thumb" src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                <div>
                  <div class="row-title">${t.title}</div>
                  <div class="row-artist">${t.artist}</div>
                </div>
              </td>
              <td>${t.album || 'Oxyzen Audio'}</td>
              <td>${t.duration || '3:30'}</td>
              <td style="text-align: right;">
                <div class="row-actions">
                  <button class="btn-row-action liked" data-action="like" title="Remove Like">❤️</button>
                  <button class="btn-row-action" data-action="add-playlist" title="Add to Playlist">📁</button>
                  <button class="btn-row-action" data-action="add-queue" title="Add to Queue">➕</button>
                  <button class="btn-row-action" data-action="download" title="Download">⬇️</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    this.attachTrackRowEventListeners(container, likes);

    const playAllBtn = document.getElementById("liked-play-all-btn");
    if (playAllBtn) {
      playAllBtn.addEventListener("click", () => {
        this.setQueue(likes, 0);
        this.playTrack(likes[0]);
      });
    }

    const shuffleBtn = document.getElementById("liked-shuffle-play-btn");
    if (shuffleBtn) {
      shuffleBtn.addEventListener("click", () => {
        this.isShuffle = true;
        this.setQueue(likes, 0);
        this.playTrack(likes[Math.floor(Math.random() * likes.length)]);
      });
    }
  }

  loadHistoryView() {
    const container = document.getElementById("history-container");
    if (!container) return;

    const history = this.registerTracks(this.storage.getHistory(50));

    if (history.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">🕒</div>
          <div style="font-size: 18px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">No Recent Listening Sessions</div>
          <div>Play any song to start logging your high-fidelity history!</div>
        </div>
      `;
      return;
    }

    let html = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 24px; font-weight: 800;">Listening History</h2>
          <p style="font-size: 13px; color: var(--silver-muted);">${history.length} recently played audio sessions on this device</p>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-luxury btn-gold-action" id="history-play-all-btn">▶ Play All</button>
          <button class="btn-luxury" style="background: rgba(239, 68, 68, 0.15); color: #EF4444;" id="clear-history-btn">Clear History</button>
        </div>
      </div>
      <table class="track-table">
        <thead>
          <tr>
            <th class="row-index-col">#</th>
            <th>Title</th>
            <th>Album</th>
            <th>Duration</th>
            <th style="text-align: right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${history.map((t, idx) => `
            <tr class="track-row ${this.currentTrack && (this.currentTrack.id === t.id) ? 'active' : ''}" data-track-id="${t.id}">
              <td class="row-index-col">${idx + 1}</td>
              <td class="row-track-col">
                <img class="row-thumb" src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                <div>
                  <div class="row-title">${t.title}</div>
                  <div class="row-artist">${t.artist}</div>
                </div>
              </td>
              <td>${t.album || 'Oxyzen Audio'}</td>
              <td>${t.duration || '3:30'}</td>
              <td style="text-align: right;">
                <div class="row-actions">
                  <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Like">
                    ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                  </button>
                  <button class="btn-row-action" data-action="add-playlist" title="Add to Playlist">📁</button>
                  <button class="btn-row-action" data-action="add-queue" title="Add to Queue">➕</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    this.attachTrackRowEventListeners(container, history);

    const playAllBtn = document.getElementById("history-play-all-btn");
    if (playAllBtn) {
      playAllBtn.addEventListener("click", () => {
        this.setQueue(history, 0);
        this.playTrack(history[0]);
      });
    }

    const clearBtn = document.getElementById("clear-history-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        this.storage.clearHistory();
        this.loadHistoryView();
        this.showToast("🧹 History cleared");
      });
    }
  }

  // -------------------------------------------------------------
  // CUSTOM PLAYLISTS (DEVICE-BASED LOCAL DATABASE)
  // -------------------------------------------------------------
  loadPlaylistsView() {
    const container = document.getElementById("playlists-container");
    if (!container) return;

    this.playlists = this.storage.getPlaylists();
    this.updatePlaylistsBadge(this.playlists.length);

    let html = `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(17, 17, 21, 0.95)); margin-bottom: 28px;">
        <div class="hero-content">
          <span class="hero-badge" style="color: var(--accent-violet); border-color: rgba(168, 85, 247, 0.3);">CUSTOM PLAYLISTS</span>
          <h1 class="hero-title">My Playlists</h1>
          <p class="hero-desc">${this.playlists.length} acoustic collections stored locally on this device</p>
          <div class="hero-actions">
            <button class="btn-luxury btn-gold-action" id="create-playlist-btn">
              <span>➕</span>
              <span>Create New Playlist</span>
            </button>
            <button class="btn-luxury" id="playlists-export-btn">
              <span>📥</span>
              <span>Export All Playlists (.JSON)</span>
            </button>
          </div>
        </div>
      </div>
    `;

    if (this.playlists.length === 0) {
      html += `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 36px; margin-bottom: 14px;">📁</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">No Playlists Created Yet</div>
          <p style="margin-bottom: 18px;">Create your first playlist and start curating your favorite acoustic frequencies!</p>
          <button class="btn-luxury btn-gold-action" id="empty-create-playlist-btn">➕ Create Your First Playlist</button>
        </div>
      `;
    } else {
      html += `
        <div class="cards-grid">
          ${this.playlists.map(pl => `
            <div class="music-card playlist-card" data-playlist-id="${pl.id}">
              <div class="card-img-wrapper">
                <img class="card-img" src="${pl.cover_url || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                <button class="card-play-btn" data-action="play-playlist">▶</button>
              </div>
              <div class="card-title">${this.escapeHTML(pl.name)}</div>
              <div class="card-subtitle">${(pl.tracks || []).length} tracks • ${this.escapeHTML(pl.description || 'Custom collection')}</div>
            </div>
          `).join("")}
        </div>
      `;
    }

    container.innerHTML = html;

    const createBtn = document.getElementById("create-playlist-btn");
    if (createBtn) createBtn.addEventListener("click", () => this.openCreatePlaylistModal());

    const emptyCreateBtn = document.getElementById("empty-create-playlist-btn");
    if (emptyCreateBtn) emptyCreateBtn.addEventListener("click", () => this.openCreatePlaylistModal());

    const expBtn = document.getElementById("playlists-export-btn");
    if (expBtn) expBtn.addEventListener("click", () => {
      this.storage.downloadBackupFile();
      this.showToast("📥 Exported Oxyzen playlists backup (.json)");
    });

    container.querySelectorAll(".playlist-card").forEach(card => {
      const plId = card.dataset.playlistId;
      const plObj = this.storage.getPlaylist(plId);

      card.addEventListener("click", (e) => {
        if (e.target.dataset.action === "play-playlist") {
          e.stopPropagation();
          if (plObj && plObj.tracks && plObj.tracks.length > 0) {
            this.setQueue(plObj.tracks, 0);
            this.playTrack(plObj.tracks[0]);
          } else {
            this.showToast("📁 Playlist is empty. Open and add songs!");
          }
          return;
        }
        this.loadPlaylistDetailView(plId);
      });
    });
  }

  loadPlaylistDetailView(playlistId) {
    const pl = this.storage.getPlaylist(playlistId);
    if (!pl) {
      this.showToast("❌ Playlist not found");
      this.switchView("playlists");
      return;
    }

    this.currentPlaylistId = playlistId;
    this.switchView("playlist-detail");

    const container = document.getElementById("playlist-detail-container");
    if (!container) return;

    const tracks = this.registerTracks(pl.tracks || []);
    const coverUrl = pl.cover_url || (tracks.length > 0 ? tracks[0].thumbnail : "/static/assets/logo.png");

    let html = `
      <div style="margin-bottom: 20px;">
        <button class="btn-luxury" id="playlist-back-btn" style="padding: 6px 14px; font-size: 12px; margin-bottom: 16px;">
          ← Back to Playlists
        </button>
      </div>

      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(17, 17, 21, 0.95)); margin-bottom: 28px;">
        <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          <img src="${coverUrl}" onerror="this.src='/static/assets/logo.png'" style="width: 120px; height: 120px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 8px 30px rgba(0,0,0,0.8), 0 0 25px rgba(168, 85, 247, 0.3);">
          <div class="hero-content" style="flex: 1; min-width: 250px;">
            <span class="hero-badge" style="color: var(--accent-violet); border-color: rgba(168, 85, 247, 0.4);">PLAYLIST</span>
            <h1 class="hero-title" style="font-size: 28px;">${this.escapeHTML(pl.name)}</h1>
            <p class="hero-desc">${this.escapeHTML(pl.description || 'Custom curation')} • ${tracks.length} tracks</p>
            <div class="hero-actions" style="margin-top: 14px;">
              ${tracks.length > 0 ? `
                <button class="btn-luxury btn-gold-action" id="pl-detail-play-btn">▶ Play All</button>
                <button class="btn-luxury" id="pl-detail-shuffle-btn">🔀 Shuffle</button>
              ` : ''}
              <button class="btn-luxury" id="pl-detail-rename-btn">✏️ Rename</button>
              <button class="btn-luxury" id="pl-detail-delete-btn" style="background: rgba(239, 68, 68, 0.15); color: #EF4444;">🗑️ Delete Playlist</button>
            </div>
          </div>
        </div>
      </div>
    `;

    if (tracks.length === 0) {
      html += `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">🎵</div>
          <div style="font-size: 18px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">This playlist is currently empty</div>
          <div>Click the 📁 icon on any track in Explore, Search, or Liked songs to add tracks here!</div>
        </div>
      `;
    } else {
      html += `
        <table class="track-table">
          <thead>
            <tr>
              <th class="row-index-col">#</th>
              <th>Title</th>
              <th>Album</th>
              <th>Duration</th>
              <th style="text-align: right;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${tracks.map((t, idx) => `
              <tr class="track-row ${this.currentTrack && (this.currentTrack.id === t.id) ? 'active' : ''}" data-track-id="${t.id}">
                <td class="row-index-col">${idx + 1}</td>
                <td class="row-track-col">
                  <img class="row-thumb" src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" loading="lazy">
                  <div>
                    <div class="row-title">${t.title}</div>
                    <div class="row-artist">${t.artist}</div>
                  </div>
                </td>
                <td>${t.album || 'Oxyzen Audio'}</td>
                <td>${t.duration || '3:30'}</td>
                <td style="text-align: right;">
                  <div class="row-actions">
                    <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Like">
                      ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                    </button>
                    <button class="btn-row-action" data-action="add-queue" title="Add to Queue">➕</button>
                    <button class="btn-row-action" data-action="remove-from-playlist" data-track-id="${t.id}" title="Remove from Playlist" style="color: #EF4444;">✕</button>
                    <button class="btn-row-action" data-action="download" title="Download">⬇️</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
    }

    container.innerHTML = html;
    this.attachTrackRowEventListeners(container, tracks);

    const backBtn = document.getElementById("playlist-back-btn");
    if (backBtn) backBtn.addEventListener("click", () => this.switchView("playlists"));

    const playBtn = document.getElementById("pl-detail-play-btn");
    if (playBtn && tracks.length > 0) {
      playBtn.addEventListener("click", () => {
        this.setQueue(tracks, 0);
        this.playTrack(tracks[0]);
      });
    }

    const shuffleBtn = document.getElementById("pl-detail-shuffle-btn");
    if (shuffleBtn && tracks.length > 0) {
      shuffleBtn.addEventListener("click", () => {
        this.isShuffle = true;
        this.setQueue(tracks, 0);
        this.playTrack(tracks[Math.floor(Math.random() * tracks.length)]);
      });
    }

    const renameBtn = document.getElementById("pl-detail-rename-btn");
    if (renameBtn) {
      renameBtn.addEventListener("click", () => {
        const newName = prompt("Enter new playlist name:", pl.name);
        if (newName && newName.trim()) {
          this.storage.updatePlaylist(playlistId, { name: newName.trim() });
          this.loadPlaylistDetailView(playlistId);
          this.showToast(`✏️ Renamed playlist to "${newName.trim()}"`);
        }
      });
    }

    const deleteBtn = document.getElementById("pl-detail-delete-btn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => {
        if (confirm(`Are you sure you want to delete "${pl.name}"?`)) {
          this.storage.deletePlaylist(playlistId);
          this.showToast(`🗑️ Deleted playlist "${pl.name}"`);
          this.switchView("playlists");
        }
      });
    }

    container.querySelectorAll('[data-action="remove-from-playlist"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const tId = btn.dataset.trackId;
        this.storage.removeTrackFromPlaylist(playlistId, tId);
        this.loadPlaylistDetailView(playlistId);
        this.showToast("Removed track from playlist");
      });
    });
  }

  openCreatePlaylistModal(trackToAdd = null) {
    const modal = document.getElementById("create-playlist-modal");
    const nameInput = document.getElementById("new-playlist-name-input");
    const descInput = document.getElementById("new-playlist-desc-input");
    const submitBtn = document.getElementById("create-playlist-submit-btn");
    const closeBtn = document.getElementById("create-playlist-close-btn");

    if (!modal) return;
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";

    modal.classList.add("active");
    if (nameInput) nameInput.focus();

    const closeModal = () => modal.classList.remove("active");
    if (closeBtn) closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    if (submitBtn) {
      submitBtn.onclick = () => {
        const name = (nameInput && nameInput.value.trim()) || "My Playlist";
        const desc = descInput ? descInput.value.trim() : "";
        const newPl = this.storage.createPlaylist(name, desc);
        if (trackToAdd) {
          this.storage.addTrackToPlaylist(newPl.id, trackToAdd);
        }
        closeModal();
        this.showToast(`✨ Created playlist "${name}"`);
        if (this.activeView === "playlists") {
          this.loadPlaylistsView();
        } else {
          this.loadPlaylistDetailView(newPl.id);
        }
      };
    }
  }

  openAddToPlaylistModal(track) {
    if (!track) return;
    const modal = document.getElementById("add-to-playlist-modal");
    const listContainer = document.getElementById("add-to-playlist-list");
    const closeBtn = document.getElementById("add-to-playlist-close-btn");
    const quickCreateBtn = document.getElementById("modal-quick-create-playlist-btn");

    if (!modal || !listContainer) return;
    modal.classList.add("active");

    const closeModal = () => modal.classList.remove("active");
    if (closeBtn) closeBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    const playlists = this.storage.getPlaylists();
    if (playlists.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--silver-muted); font-size: 13px;">
          No playlists yet. Create one below!
        </div>
      `;
    } else {
      listContainer.innerHTML = playlists.map(pl => {
        const hasTrack = (pl.tracks || []).some(t => (t.id === track.id || t.videoId === track.id));
        return `
          <div class="playlist-picker-item" data-pl-id="${pl.id}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; border-radius: var(--radius-sm); margin-bottom: 6px; background: rgba(255,255,255,0.03); cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 16px;">📁</span>
              <div>
                <div style="font-weight: 700; font-size: 13.5px; color: #fff;">${this.escapeHTML(pl.name)}</div>
                <div style="font-size: 11px; color: var(--silver-muted);">${(pl.tracks || []).length} tracks</div>
              </div>
            </div>
            <span style="font-size: 12px; color: ${hasTrack ? 'var(--gold-accent)' : 'var(--silver-muted)'};">
              ${hasTrack ? '✓ Added' : '➕ Add'}
            </span>
          </div>
        `;
      }).join("");

      listContainer.querySelectorAll(".playlist-picker-item").forEach(item => {
        item.addEventListener("click", () => {
          const plId = item.dataset.plId;
          const added = this.storage.addTrackToPlaylist(plId, track);
          const pl = this.storage.getPlaylist(plId);
          if (added) {
            this.showToast(`📁 Added "${track.title}" to ${pl ? pl.name : 'playlist'}`);
          } else {
            this.showToast(`ℹ️ "${track.title}" is already in ${pl ? pl.name : 'playlist'}`);
          }
          closeModal();
        });
      });
    }

    if (quickCreateBtn) {
      quickCreateBtn.onclick = () => {
        closeModal();
        this.openCreatePlaylistModal(track);
      };
    }
  }

  // -------------------------------------------------------------
  // SOUNDSYNC SPACE WITH SONG REQUESTS & CO-HOST ADMINS
  // -------------------------------------------------------------
  setupSoundSyncSpaceUI() {
    // 1. Avatar Selectors
    const hostPicker = document.getElementById("host-avatar-picker");
    if (hostPicker) {
      hostPicker.querySelectorAll(".sync-avatar-btn, .avatar-option").forEach(opt => {
        opt.addEventListener("click", () => {
          hostPicker.querySelectorAll(".sync-avatar-btn, .avatar-option").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");
          this.selectedHostAvatar = opt.dataset.avatar || "👑";
        });
      });
    }

    const listenerPicker = document.getElementById("listener-avatar-picker");
    if (listenerPicker) {
      listenerPicker.querySelectorAll(".sync-avatar-btn, .avatar-option").forEach(opt => {
        opt.addEventListener("click", () => {
          listenerPicker.querySelectorAll(".sync-avatar-btn, .avatar-option").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");
          this.selectedListenerAvatar = opt.dataset.avatar || "🎧";
        });
      });
    }

    // Real-time room code input formatting & status preview
    const joinCodeInput = document.getElementById("sync-join-code-input");
    const codeStatusMsg = document.getElementById("sync-code-status-msg");
    let checkRoomTimer = null;
    if (joinCodeInput) {
      joinCodeInput.addEventListener("input", (e) => {
        e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const val = e.target.value.trim();
        if (codeStatusMsg) {
          codeStatusMsg.className = "sync-code-status";
          codeStatusMsg.innerText = "";
        }
        clearTimeout(checkRoomTimer);
        if (val.length >= 3) {
          checkRoomTimer = setTimeout(async () => {
            try {
              const res = await fetch(`${API_BASE}/api/rooms/${val}`);
              if (res.ok) {
                const data = await res.json();
                if (codeStatusMsg) {
                  codeStatusMsg.className = "sync-code-status success";
                  codeStatusMsg.innerText = `✓ Active Lounge: ${data.room_name} (${data.listener_count || 1} online)`;
                }
              } else {
                if (codeStatusMsg) {
                  codeStatusMsg.className = "sync-code-status error";
                  codeStatusMsg.innerText = "✕ Lounge not found (invalid code)";
                }
              }
            } catch (err) {}
          }, 300);
        }
      });
    }

    // 2. Launch Host Lounge
    const hostLaunchBtn = document.getElementById("sync-host-launch-btn");
    if (hostLaunchBtn) {
      hostLaunchBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("sync-host-name-input");
        const customCodeInput = document.getElementById("sync-custom-code-input");
        const hostName = (nameInput && nameInput.value.trim()) || this.userProfile.name || "DJ Master";
        const customCode = customCodeInput ? customCodeInput.value.trim() : null;

        this.sync.setProfile(hostName, this.selectedHostAvatar);

        try {
          const res = await fetch(`${API_BASE}/api/rooms/create`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              host_name: hostName,
              host_id: this.sync.userId,
              room_name: `${hostName}'s SoundSync Lounge`,
              room_code: customCode
            })
          });
          const data = await res.json();
          this.sync.joinRoom(data.room_code, data.room_name);
        } catch (e) {
          this.showToast("Failed to create room: " + e.message);
        }
      });
    }

    // 3. Join Listener Lounge (Strictly allow only valid and existing rooms)
    const joinEnterBtn = document.getElementById("sync-join-enter-btn");
    if (joinEnterBtn) {
      joinEnterBtn.addEventListener("click", async () => {
        const codeInput = document.getElementById("sync-join-code-input");
        const nameInput = document.getElementById("sync-listener-name-input");
        const code = codeInput ? codeInput.value.trim().toUpperCase() : "";
        const name = (nameInput && nameInput.value.trim()) || this.userProfile.name || "Listener";

        if (!code || code.length < 3) {
          if (codeInput) {
            codeInput.focus();
            codeInput.classList.add("input-error-shake");
            setTimeout(() => codeInput.classList.remove("input-error-shake"), 500);
          }
          if (codeStatusMsg) {
            codeStatusMsg.className = "sync-code-status error";
            codeStatusMsg.innerText = "Please enter a valid room code";
          }
          this.showToast("⚠️ Please enter a valid room code");
          return;
        }

        // VERIFY ROOM EXISTENCE BEFORE CONNECTING
        try {
          const res = await fetch(`${API_BASE}/api/rooms/${code}`);
          if (!res.ok) {
            if (codeInput) {
              codeInput.focus();
              codeInput.classList.add("input-error-shake");
              setTimeout(() => codeInput.classList.remove("input-error-shake"), 500);
            }
            if (codeStatusMsg) {
              codeStatusMsg.className = "sync-code-status error";
              codeStatusMsg.innerText = `✕ Lounge "${code}" does not exist or has closed`;
            }
            this.showToast(`❌ Lounge "${code}" not found. Please check the code or host a new lounge.`);
            return;
          }
          const roomData = await res.json();
          this.sync.setProfile(name, this.selectedListenerAvatar);
          this.sync.joinRoom(code, roomData.room_name);
        } catch (e) {
          this.showToast(`❌ Failed to verify lounge "${code}". Please check your network.`);
        }
      });
    }

    // 4. COPY ROOM CODE ONLY
    const copyCodeBtn = document.getElementById("sync-copy-code-btn");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", () => {
        if (!this.sync.roomCode) return;
        navigator.clipboard.writeText(this.sync.roomCode);
        this.showToast(`📋 Room Code "${this.sync.roomCode}" copied to clipboard!`);
      });
    }

    // 5. Leave Room
    const leaveBtn = document.getElementById("sync-space-leave-btn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        this.sync.leaveRoom();
        this.renderSoundSyncSpace();
        this.showToast("🚪 Left SoundSync Room");
      });
    }

    // 6. Profile Quick Edit in Room
    const profileEditPill = document.getElementById("sync-profile-edit-pill");
    if (profileEditPill) {
      profileEditPill.addEventListener("click", () => {
        const newName = prompt("Change your display name:", this.sync.userName);
        if (newName && newName.trim()) {
          this.sync.setProfile(newName.trim(), this.sync.avatar);
          this.renderSoundSyncSpace();
          this.showToast(`✨ Updated nickname to "${newName.trim()}"`);
        }
      });
    }

    // 7. In-Room Search & Track Selector (Supports Play, Queue, and Song Requests)
    const inroomSearchInput = document.getElementById("sync-inroom-search-input");
    const inroomSearchBtn = document.getElementById("sync-inroom-search-btn");
    if (inroomSearchBtn && inroomSearchInput) {
      const executeInroomSearch = async () => {
        const query = inroomSearchInput.value.trim();
        if (!query) return;
        const resultsBox = document.getElementById("sync-search-results-list");
        if (resultsBox) resultsBox.innerHTML = `<div style="color: var(--silver-muted); padding: 8px;">Searching...</div>`;
        try {
          const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=15`);
          const data = await res.json();
          this.renderInroomSearchResults(data.tracks || []);
        } catch (e) {
          if (resultsBox) resultsBox.innerHTML = `<div style="color: #EF4444;">Search failed</div>`;
        }
      };

      inroomSearchBtn.addEventListener("click", executeInroomSearch);
      inroomSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") executeInroomSearch();
      });
    }

    // 8. SoundSync Stage Controls
    const syncPlayBtn = document.getElementById("sync-ctrl-play");
    if (syncPlayBtn) syncPlayBtn.addEventListener("click", () => this.togglePlayPause());
    const syncNextBtn = document.getElementById("sync-ctrl-next");
    if (syncNextBtn) syncNextBtn.addEventListener("click", () => this.playNext());
    const syncPrevBtn = document.getElementById("sync-ctrl-prev");
    if (syncPrevBtn) syncPrevBtn.addEventListener("click", () => this.playPrevious());

    // 9. Live Chat Messaging
    const chatForm = document.getElementById("sync-chat-form");
    const chatInput = document.getElementById("sync-chat-input");
    if (chatForm && chatInput) {
      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
          this.sync.sendChat(text);
          chatInput.value = "";
        }
      });
    }

    // 10. Live Floating Emoji Reactions
    document.querySelectorAll(".sync-emoji-bubble").forEach(btn => {
      btn.addEventListener("click", () => {
        const emoji = btn.dataset.emoji || "🔥";
        this.sync.sendReaction(emoji);
        this.spawnReactionParticle(emoji);
      });
    });

    // 11. Global WebSocket Event Bindings
    window.addEventListener("oxyzen:sync_connected", (e) => {
      this.showToast(`🎧 Connected to SoundSync Lounge ${e.detail.roomCode}`);
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_state", () => {
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_play_track", (e) => {
      const { track, currentTime, isPlaying, triggeredBy } = e.detail;
      const reg = this.registerTrack(track);
      if (!this.currentTrack || this.currentTrack.id !== reg.id) {
        this.currentTrack = reg;
        this.updatePlayerDockUI(reg);
        this.audio.loadAndPlay(reg, currentTime);
      } else {
        if (Math.abs(this.audio.audio.currentTime - currentTime) > 1.5) {
          this.audio.seek(currentTime);
        }
        if (isPlaying && !this.audio.isPlaying) this.audio.play();
      }
      if (triggeredBy) {
        this.appendSystemNotice(`▶ Playing "${reg.title}" (Triggered by ${triggeredBy})`);
      }
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_play_state", (e) => {
      const { isPlaying, currentTime } = e.detail;
      if (Math.abs(this.audio.audio.currentTime - currentTime) > 1.5) {
        this.audio.seek(currentTime);
      }
      if (isPlaying) {
        this.audio.play();
      } else {
        this.audio.pause();
      }
    });

    window.addEventListener("oxyzen:sync_seek", (e) => {
      this.audio.seek(e.detail.time);
    });

    window.addEventListener("oxyzen:sync_queue", (e) => {
      this.renderSoundSyncQueue(e.detail.queue || []);
    });

    window.addEventListener("oxyzen:sync_request_added", (e) => {
      const { request, requester } = e.detail;
      this.appendSystemNotice(`🙋‍♂️ ${requester || 'A listener'} requested "${request.track.title}"`);
      this.renderSoundSyncRequests();
    });

    window.addEventListener("oxyzen:sync_request_accepted", () => {
      this.renderSoundSyncRequests();
    });

    window.addEventListener("oxyzen:sync_request_dismissed", () => {
      this.renderSoundSyncRequests();
    });

    window.addEventListener("oxyzen:sync_admin_updated", (e) => {
      if (e.detail.message) this.appendSystemNotice(e.detail.message);
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_reaction", (e) => {
      this.spawnReactionParticle(e.detail.emoji);
    });

    window.addEventListener("oxyzen:sync_chat", (e) => {
      this.appendChatMessage(e.detail);
    });

    window.addEventListener("oxyzen:sync_user_joined", (e) => {
      this.appendSystemNotice(`✨ ${e.detail.name} joined the lounge`);
      this.renderSoundSyncListeners();
    });

    window.addEventListener("oxyzen:sync_user_left", (e) => {
      this.appendSystemNotice(`👋 ${e.detail.user_name} left`);
      this.renderSoundSyncListeners();
    });

    window.addEventListener("oxyzen:sync_host_changed", (e) => {
      this.appendSystemNotice(`👑 DJ Host changed to ${e.detail.new_host_name}`);
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_error", (e) => {
      this.showToast(`❌ ${e.detail.message || "SoundSync Lounge not found"}`);
      this.renderSoundSyncSpace();
    });
  }

  renderSoundSyncSpace() {
    const lobbyView = document.getElementById("sync-space-lobby");
    const roomView = document.getElementById("sync-space-room");

    if (!this.sync.connected) {
      if (lobbyView) lobbyView.style.display = "block";
      if (roomView) roomView.style.display = "none";
      return;
    }

    if (lobbyView) lobbyView.style.display = "none";
    if (roomView) roomView.style.display = "block";

    // Room Header Updates
    const roomCodeBadge = document.getElementById("room-code-badge");
    if (roomCodeBadge) roomCodeBadge.innerText = this.sync.roomCode || "---";

    const roomNameLabel = document.getElementById("room-display-name");
    if (roomNameLabel) roomNameLabel.innerText = this.sync.roomName || `Lounge ${this.sync.roomCode}`;

    const hostDisplay = document.getElementById("room-host-display");
    if (hostDisplay) {
      if (this.sync.isHost) {
        hostDisplay.innerHTML = "👑 Host: You (DJ Master)";
      } else if (this.sync.isAdmin) {
        hostDisplay.innerHTML = "🛡️ You: Co-Host Admin";
      } else {
        hostDisplay.innerHTML = "🎧 Listener";
      }
    }

    const myAvatar = document.getElementById("sync-my-avatar");
    const myName = document.getElementById("sync-my-name");
    if (myAvatar) myAvatar.innerText = this.sync.avatar || "🎧";
    if (myName) myName.innerText = this.sync.userName || "You";

    const roleIndicator = document.getElementById("sync-role-indicator");
    if (roleIndicator) {
      if (this.sync.isHost) {
        roleIndicator.innerHTML = '<span style="color: var(--gold-accent); font-weight: 700;">👑 DJ Host (You control playback & admins)</span>';
      } else if (this.sync.isAdmin) {
        roleIndicator.innerHTML = '<span style="color: var(--accent-cyan); font-weight: 700;">🛡️ Co-Host Admin (You can control playback & accept requests)</span>';
      } else {
        roleIndicator.innerHTML = '<span style="color: var(--silver-muted); font-weight: 500;">🎧 Synchronized Live (Listening with Host)</span>';
      }
    }

    this.renderSoundSyncListeners();
    this.renderSoundSyncRequests();
    this.renderSoundSyncPartySuggestions();
  }

  renderSoundSyncListeners() {
    const row = document.getElementById("sync-active-listeners-row");
    const countBadge = document.getElementById("sync-listener-count-badge");
    if (!row) return;

    const listeners = this.sync.listeners || [];
    if (countBadge) countBadge.innerText = listeners.length;

    row.innerHTML = listeners.map(l => {
      const isMe = (l.user_id === this.sync.userId);
      const isHost = l.is_host;
      const isAdmin = l.is_admin;
      return `
        <div class="sync-listener-bubble ${isHost ? 'host' : isAdmin ? 'admin' : ''}">
          <span>${isHost ? '👑' : isAdmin ? '🛡️' : l.avatar || '🎧'}</span>
          <span>${l.name}</span>
          ${isMe ? '<span style="opacity: 0.6;">(You)</span>' : ''}
          ${(this.sync.isHost && !isHost && !isMe) ? `
            <button class="btn-admin-toggle" data-user-id="${l.user_id}" data-is-admin="${isAdmin}" title="${isAdmin ? 'Remove Co-Host Admin' : 'Make Co-Host Admin'}">
              ${isAdmin ? '🛡️❌' : '🛡️➕'}
            </button>
          ` : ''}
        </div>
      `;
    }).join("");

    if (this.sync.isHost) {
      row.querySelectorAll(".btn-admin-toggle").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const targetId = btn.dataset.userId;
          const isCurrentlyAdmin = btn.dataset.isAdmin === "true";
          if (isCurrentlyAdmin) {
            this.sync.demoteAdmin(targetId);
          } else {
            this.sync.promoteAdmin(targetId);
          }
        });
      });
    }
  }

  renderSoundSyncRequests() {
    const card = document.getElementById("sync-requests-card");
    const list = document.getElementById("sync-requests-list");
    const count = document.getElementById("sync-requests-count");
    if (!card || !list) return;

    const canManage = (this.sync.isHost || this.sync.isAdmin);
    const requests = this.sync.requests || [];

    if (count) count.innerText = requests.length;

    if (!canManage || requests.length === 0) {
      card.style.display = "none";
      return;
    }

    card.style.display = "block";
    list.innerHTML = requests.map(r => `
      <div class="sync-request-item">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <img src="${r.track.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" style="width: 34px; height: 34px; border-radius: 4px; object-fit: cover;">
          <div style="min-width: 0;">
            <div style="font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.track.title}</div>
            <div style="font-size: 11px; color: var(--silver-muted);">Requested by ${r.avatar} ${r.user_name}</div>
          </div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-luxury btn-gold-action" style="padding: 4px 8px; font-size: 11px;" data-req-id="${r.id}" data-action="play">▶ Play Now</button>
          <button class="btn-luxury" style="padding: 4px 8px; font-size: 11px;" data-req-id="${r.id}" data-action="queue">➕ Queue</button>
          <button class="btn-row-action" style="opacity: 1;" data-req-id="${r.id}" data-action="dismiss">✕</button>
        </div>
      </div>
    `).join("");

    list.querySelectorAll("[data-req-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const reqId = btn.dataset.reqId;
        const act = btn.dataset.action;
        if (act === "play") {
          this.sync.acceptRequest(reqId, true);
        } else if (act === "queue") {
          this.sync.acceptRequest(reqId, false);
        } else if (act === "dismiss") {
          this.sync.dismissRequest(reqId);
        }
      });
    });
  }

  renderInroomSearchResults(tracks) {
    const list = document.getElementById("sync-search-results-list");
    if (!list) return;
    this.registerTracks(tracks);

    if (tracks.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); padding: 8px;">No songs found.</div>`;
      return;
    }

    const canControl = (this.sync.isHost || this.sync.isAdmin);

    list.innerHTML = tracks.map((t, i) => `
      <div class="sync-inroom-row" data-idx="${i}">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <img src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0;">
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff;">${t.title}</div>
            <div style="font-size: 11.5px; color: var(--silver-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.artist}</div>
          </div>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          ${canControl ? `
            <button class="btn-luxury" style="padding: 5px 10px; font-size: 11px;" data-action="queue">➕ Queue</button>
            <button class="btn-luxury btn-gold-action" style="padding: 5px 10px; font-size: 11px;" data-action="play">▶ Play Now</button>
          ` : `
            <button class="btn-luxury" style="padding: 5px 10px; font-size: 11px;" data-action="queue">➕ Add to Queue</button>
            <button class="btn-luxury btn-gold-action" style="padding: 5px 10px; font-size: 11px;" data-action="request">🙋‍♂️ Request</button>
          `}
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".sync-inroom-row").forEach(row => {
      const idx = parseInt(row.dataset.idx);
      const track = tracks[idx];
      if (!track) return;

      const qBtn = row.querySelector('[data-action="queue"]');
      if (qBtn) {
        qBtn.addEventListener("click", () => {
          this.addToQueue(track);
        });
      }

      const pBtn = row.querySelector('[data-action="play"]');
      if (pBtn) {
        pBtn.addEventListener("click", () => {
          this.playTrack(track);
        });
      }

      const rBtn = row.querySelector('[data-action="request"]');
      if (rBtn) {
        rBtn.addEventListener("click", () => {
          this.sync.requestSong(track);
          this.showToast(`🙋‍♂️ Requested "${track.title}" to Host`);
        });
      }
    });
  }

  renderSoundSyncQueue(queueList) {
    const list = document.getElementById("sync-room-queue-list");
    const count = document.getElementById("sync-room-queue-count");
    if (!list) return;
    if (count) count.innerText = queueList.length;

    if (queueList.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); font-size: 13px; padding: 12px 0;">Queue is empty. Search and add tracks above!</div>`;
      return;
    }

    const canControl = (this.sync.isHost || this.sync.isAdmin);

    list.innerHTML = queueList.map((t, idx) => `
      <div class="sync-inroom-row ${canControl ? 'clickable' : ''}" data-queue-idx="${idx}">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
          <span style="font-size: 12px; font-weight: 800; color: var(--gold-accent); width: 22px;">#${idx + 1}</span>
          <img src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0;">
          <div style="min-width: 0; flex: 1;">
            <div style="font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff;">${t.title}</div>
            <div style="font-size: 11.5px; color: var(--silver-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.artist}</div>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
          ${canControl ? `
            <button class="btn-luxury btn-gold-action" data-action="play-queue-track" data-idx="${idx}" style="padding: 4px 10px; font-size: 11px;">▶ Play</button>
            <button class="btn-row-action" data-action="remove-queue-track" data-idx="${idx}" style="opacity: 1;" title="Remove from queue">✕</button>
          ` : `
            <span style="font-size: 11px; color: var(--silver-muted); padding: 4px 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">In Queue</span>
          `}
        </div>
      </div>
    `).join("");

    if (canControl) {
      list.querySelectorAll('[data-action="play-queue-track"]').forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          const track = queueList[idx];
          if (track) {
            this.playTrack(track);
            this.sync.broadcastRemoveQueue(idx);
          }
        });
      });

      list.querySelectorAll('[data-action="remove-queue-track"]').forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          this.sync.broadcastRemoveQueue(idx);
        });
      });

      list.querySelectorAll('.sync-inroom-row').forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          const idx = parseInt(row.dataset.queueIdx);
          const track = queueList[idx];
          if (track) {
            this.playTrack(track);
            this.sync.broadcastRemoveQueue(idx);
          }
        });
      });
    }
  }

  renderSoundSyncPartySuggestions() {
    const list = document.getElementById("sync-party-suggestions-list");
    if (!list) return;

    const tracks = (this.vibeTracks || []).slice(0, 6);
    if (tracks.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); font-size: 12px; grid-column: 1/-1;">Play a song to get live party recommendations.</div>`;
      return;
    }

    list.innerHTML = tracks.map(t => this.renderMusicCardHTML(t)).join("");
    list.querySelectorAll(".music-card").forEach((card, idx) => {
      card.addEventListener("click", () => {
        const track = tracks[idx];
        if (track) {
          if (this.sync.isHost || this.sync.isAdmin) {
            this.playTrack(track);
          } else {
            this.addToQueue(track);
            this.showToast(`➕ Added "${track.title}" to shared queue`);
          }
        }
      });
    });
  }

  appendChatMessage(msg) {
    const stream = document.getElementById("sync-chat-stream");
    if (!stream) return;

    const isMine = (msg.user_id === this.sync.userId);
    const timeStr = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const item = document.createElement("div");
    item.className = `sync-chat-item ${isMine ? 'mine' : ''}`;
    item.innerHTML = `
      <div class="sync-chat-user-header">
        <span>${msg.avatar || '🎧'}</span>
        <span>${msg.user_name || 'Listener'}</span>
        <span style="font-weight: 400; font-size: 10px; margin-left: auto;">${timeStr}</span>
      </div>
      <div class="sync-chat-msg-text">${this.escapeHTML(msg.text)}</div>
    `;

    stream.appendChild(item);
    stream.scrollTop = stream.scrollHeight;
  }

  appendSystemNotice(text) {
    const stream = document.getElementById("sync-chat-stream");
    if (!stream) return;
    const item = document.createElement("div");
    item.className = "chat-system-msg";
    item.innerText = text;
    stream.appendChild(item);
    stream.scrollTop = stream.scrollHeight;
  }

  escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  spawnReactionParticle(emoji) {
    const el = document.createElement("div");
    el.className = "floating-reaction";
    el.innerText = emoji;
    el.style.left = `${Math.random() * 70 + 15}vw`;
    el.style.bottom = "120px";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  // -------------------------------------------------------------
  // CINEMA FULLSCREEN AMBIENT MODE (LOCKED ULTRA-AESTHETIC)
  // -------------------------------------------------------------
  toggleCinemaMode(enable = true) {
    if (!this.cinemaOverlay) return;
    this.cinemaOverlay.classList.toggle("active", enable);
    if (enable && this.currentTrack) {
      this.updatePlayerDockUI(this.currentTrack);
      this.renderLyrics();
    }
  }

  // -------------------------------------------------------------
  // OFFLINE DOWNLOAD
  // -------------------------------------------------------------
  downloadTrack(track) {
    this.showToast(`⬇️ Starting download for "${track.title}"...`);
    const downloadUrl = `${API_BASE}/api/download/${track.id}?title=${encodeURIComponent(track.title)}&artist=${encodeURIComponent(track.artist)}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${track.artist} - ${track.title}.m4a`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // -------------------------------------------------------------
  // EQUALIZER STUDIO UI
  // -------------------------------------------------------------
  setupEqualizerUI() {
    const slidersContainer = document.getElementById("eq-sliders-container");
    if (!slidersContainer || !this.audio) return;

    const freqs = this.audio.eqFrequencies;
    slidersContainer.innerHTML = freqs.map((f, i) => {
      const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
      return `
        <div class="eq-col">
          <span class="eq-gain-val" id="eq-val-${i}">0dB</span>
          <input type="range" class="eq-slider-vertical" orient="vertical" min="-12" max="12" step="1" value="0" data-index="${i}">
          <span class="eq-freq-label">${label}Hz</span>
        </div>
      `;
    }).join("");

    slidersContainer.querySelectorAll(".eq-slider-vertical").forEach(slider => {
      slider.addEventListener("input", (e) => {
        const idx = parseInt(e.target.dataset.index);
        const gain = parseFloat(e.target.value);
        this.audio.setEqBandGain(idx, gain);
        const label = document.getElementById(`eq-val-${idx}`);
        if (label) label.innerText = `${gain > 0 ? '+' : ''}${gain}dB`;
      });
    });

    document.querySelectorAll(".eq-preset-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        document.querySelectorAll(".eq-preset-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const preset = chip.dataset.preset;
        const gains = this.audio.applyEqPreset(preset);
        gains.forEach((g, i) => {
          const slider = slidersContainer.querySelector(`[data-index="${i}"]`);
          if (slider) slider.value = g;
          const label = document.getElementById(`eq-val-${i}`);
          if (label) label.innerText = `${g > 0 ? '+' : ''}${g}dB`;
        });
        this.showToast(`🎛️ Equalizer Preset: ${chip.innerText}`);
      });
    });
  }

  // -------------------------------------------------------------
  // UTILITIES & SHORTCUTS
  // -------------------------------------------------------------
  setupKeyboardShortcuts() {
    window.addEventListener("keydown", (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) return;

      if (e.code === "Space") {
        e.preventDefault();
        this.togglePlayPause();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        this.audio.seek(this.audio.audio.currentTime - 5);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        this.audio.seek(this.audio.audio.currentTime + 5);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        this.audio.setVolume(this.audio.audio.volume + 0.1);
        if (this.volumeSlider) this.volumeSlider.value = this.audio.audio.volume;
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        this.audio.setVolume(this.audio.audio.volume - 0.1);
        if (this.volumeSlider) this.volumeSlider.value = this.audio.audio.volume;
      } else if (e.code === "KeyL") {
        if (this.currentTrack) this.toggleLikeTrack(this.currentTrack);
      } else if (e.code === "KeyF") {
        this.toggleCinemaMode(!this.cinemaOverlay.classList.contains("active"));
      } else if (e.code === "Escape") {
        this.toggleCinemaMode(false);
        if (this.eqModal) this.eqModal.classList.remove("active");
        if (this.profileModal) this.profileModal.classList.remove("active");
        if (this.lyricsPanel) this.lyricsPanel.classList.remove("open");
        if (this.queuePanel) this.queuePanel.classList.remove("open");
      }
    });
  }

  renderQueuePanel() {
    if (!this.queueList) return;
    if (this.queue.length === 0) {
      this.queueList.innerHTML = `<div style="color: var(--silver-muted); padding: 20px;">Queue is empty.</div>`;
      return;
    }
    this.queueList.innerHTML = this.queue.map((t, idx) => `
      <div class="track-row ${idx === this.queueIndex ? 'active' : ''}" style="display: flex; align-items: center; justify-content: space-between; padding: 10px; border-radius: var(--radius-sm); margin-bottom: 4px;" data-queue-idx="${idx}">
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
          <img src="${t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;">
          <div style="min-width: 0;">
            <div style="font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.title}</div>
            <div style="font-size: 11px; color: var(--silver-muted);">${t.artist}</div>
          </div>
        </div>
        <button class="btn-row-action" data-action="remove-queue" style="opacity: 1;">✕</button>
      </div>
    `).join("");

    this.queueList.querySelectorAll("[data-queue-idx]").forEach(el => {
      const idx = parseInt(el.dataset.queueIdx);
      el.addEventListener("click", (e) => {
        if (e.target.dataset.action === "remove-queue") {
          e.stopPropagation();
          this.queue.splice(idx, 1);
          if (idx < this.queueIndex) this.queueIndex--;
          this.renderQueuePanel();
          this.updateQueueBadge();
          return;
        }
        this.queueIndex = idx;
        this.playTrack(this.queue[idx]);
      });
    });
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  updateSliderFill(slider) {
    if (!slider) return;
    const min = slider.min ? parseFloat(slider.min) : 0;
    const max = slider.max ? parseFloat(slider.max) : (slider.id.includes("volume") ? 1 : 100);
    const val = parseFloat(slider.value);
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(to right, #F5C542 0%, #F5C542 ${percent}%, rgba(255, 255, 255, 0.12) ${percent}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  showToast(message) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.innerHTML = `<span>✦</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }
}

// Instantiate on DOM load
window.addEventListener("DOMContentLoaded", () => {
  window.oxyzen = new OxyzenApp();
  window.app = window.oxyzen;
});
