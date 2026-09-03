/**
 * OXYZEN MUSIC PLATFORM - MASTER CONTROLLER 2.0
 * Pure Unchained High-Fidelity Audio Engine Powered by Hono + JioSaavn API
 * Features: Direct 320kbps Akamai CDN Playback, Real-time SoundSync WebSockets,
 * Studio Synchronized Lyrics, 10-Band EQ, 8D Spatial Audio, Multilingual Mood Hubs,
 * AI Vibe Radar, Living Dynamic Aurora Mesh Ambient Mode, and Luxury Audiophile Profile.
 */

const API_BASE = window.location.origin;

class OxyzenApp {
  constructor() {
    this.audio = window.oxyzenAudio;
    this.storage = window.oxyzenStorage;
    this.sync = window.oxyzenSync;

    // Application State
    this.currentTrack = null;
    this.queue = [];
    this.queueIndex = 0;
    this.isShuffle = false;
    this.repeatMode = "off"; // "off" | "all" | "one"
    this.infiniteRadio = true;
    this.isSeeking = false;
    this.trackRegistry = new Map(); // Global O(1) track lookup
    this.likedIds = new Set();
    this.playlists = [];
    this.activeView = "explore";
    this.activeMoodKey = "love";
    this.lyricsData = { synced: false, lines: [], plain: "" };
    this.activeLyricIndex = -1;
    this.vibeTracks = [];
    this.searchQuery = "";
    this.searchFilter = null;
    this.searchDebounceTimer = null;
    this.selectedHostAvatar = "👑";
    this.selectedListenerAvatar = "🎧";

    this.userProfile = {
      name: localStorage.getItem("oxyzen_user_name") || "Oxyzen Listener",
      avatar: localStorage.getItem("oxyzen_user_avatar") || "👑",
      languages: JSON.parse(localStorage.getItem("oxyzen_user_languages") || '["Hindi", "English"]'),
      audio_quality: localStorage.getItem("oxyzen_audio_quality") || "320k",
      theme: localStorage.getItem("oxyzen_theme") || "gold"
    };

    // Apply saved theme immediately
    document.body.setAttribute("data-theme", this.userProfile.theme);

    // Initialize UI Cache and Bindings
    this.cacheDOMElements();
    this.initEventListeners();
    this.setupSoundSyncSpaceUI();
    this.setupProfileUI();
    this.setupEqualizerUI();
    this.setupKeyboardShortcuts();
    this.initServiceWorker();

    // Load Initial Data
    this.loadInitialData();
  }

  // -------------------------------------------------------------
  // DOM ELEMENT CACHING
  // -------------------------------------------------------------
  cacheDOMElements() {
    // Navigation (Desktop Sidebar & Mobile Bottom Navigation Bar)
    this.navItems = document.querySelectorAll(".nav-item[data-view], .mobile-nav-tab[data-view]");
    this.pageViews = document.querySelectorAll(".page-view");

    // Topbar Search & Suggestions
    this.searchInput = document.getElementById("search-input");
    this.searchClearBtn = document.getElementById("search-clear");
    this.searchSuggestionsDropdown = document.getElementById("search-suggestions");
    this.searchFilterChips = document.querySelectorAll(".search-filter-chip");

    // Player Dock
    this.playerDock = document.getElementById("player-dock");
    this.playerThumb = document.getElementById("player-thumb");
    this.playerTitle = document.getElementById("player-title");
    this.playerArtist = document.getElementById("player-artist");
    this.playPauseBtn = document.getElementById("play-pause-btn");
    this.prevBtn = document.getElementById("prev-btn");
    this.nextBtn = document.getElementById("next-btn");
    this.shuffleBtn = document.getElementById("shuffle-btn");
    this.repeatBtn = document.getElementById("repeat-btn");
    this.seekSlider = document.getElementById("seek-slider");
    this.currentTimeLabel = document.getElementById("current-time-label");
    this.totalTimeLabel = document.getElementById("total-time-label");
    this.volumeSlider = document.getElementById("volume-slider");
    this.volumeIcon = document.getElementById("volume-icon");
    this.playerLikeBtn = document.getElementById("player-like-btn");
    this.playerAddPlaylistBtn = document.getElementById("player-add-playlist-btn");
    this.spatial8DBtn = document.getElementById("spatial-8d-btn");

    // Cinema Mode / Mobile Now Playing Drawer
    this.cinemaOverlay = document.getElementById("cinema-mode-overlay");
    this.cinemaToggleBtn = document.getElementById("cinema-toggle-btn");
    this.cinemaCloseBtn = document.getElementById("cinema-close-btn");
    this.cinemaArt = document.getElementById("cinema-art");
    this.cinemaTitle = document.getElementById("cinema-title");
    this.cinemaArtist = document.getElementById("cinema-artist");
    this.cinemaBackdrop = document.getElementById("cinema-backdrop");
    this.cinemaSeekSlider = document.getElementById("cinema-seek-slider");
    this.cinemaCurrentTime = document.getElementById("cinema-current-time");
    this.cinemaTotalTime = document.getElementById("cinema-total-time");
    this.cinemaPlayPauseBtn = document.getElementById("cinema-play-pause-btn");
    this.cinemaPrevBtn = document.getElementById("cinema-prev-btn");
    this.cinemaNextBtn = document.getElementById("cinema-next-btn");
    this.cinemaShuffleBtn = document.getElementById("cinema-shuffle-btn");
    this.cinemaRepeatBtn = document.getElementById("cinema-repeat-btn");
    this.cinemaLikeBtn = document.getElementById("cinema-like-btn");
    this.cinemaAddPlaylistBtn = document.getElementById("cinema-add-playlist-btn");
    this.cinemaSpatialBtn = document.getElementById("cinema-spatial-btn");
    this.cinemaVolumeSlider = document.getElementById("cinema-volume-slider");
    this.cinemaLyrics = document.getElementById("cinema-lyrics");
    this.cinemaFullscreenBtn = document.getElementById("cinema-fullscreen-btn");
    this.cinemaLyricsToggleBtn = document.getElementById("cinema-lyrics-toggle-btn");

    // Slide-over Panels & Modals
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

    // Profile Topbar/Sidebar Buttons
    this.profileOpenBtn = document.getElementById("topbar-profile-btn");
    this.profileSidebarBtn = document.getElementById("sidebar-user-profile-btn");
  }

  // -------------------------------------------------------------
  // TRACK REGISTRY & NORMALIZATION
  // -------------------------------------------------------------
  registerTrack(track) {
    if (!track) return null;
    const id = String(track.id || track.videoId || "");
    const existing = this.trackRegistry.get(id);

    const thumb = track.image || track.thumbnail || (existing ? (existing.image || existing.thumbnail) : '/static/assets/logo.png');
    const streamUrl = track.stream_url || track.direct_url || (track.downloadUrl && track.downloadUrl.length > 0 ? track.downloadUrl[track.downloadUrl.length - 1].url : (existing ? existing.stream_url : `/api/stream/${id}`));

    const normalized = {
      id: id,
      videoId: id,
      title: this.decodeHTML(track.title || (existing ? existing.title : 'Unknown Title')),
      artist: this.decodeHTML(track.artist || (existing ? existing.artist : 'Unknown Artist')),
      album: this.decodeHTML(track.album || (existing ? existing.album : 'Oxyzen Audio')),
      image: thumb,
      thumbnail: thumb,
      duration: track.duration_sec || track.duration || (existing ? existing.duration : 210),
      duration_sec: track.duration_sec || track.duration || (existing ? existing.duration_sec : 210),
      duration_formatted: track.duration_formatted || this.formatTime(track.duration_sec || track.duration || 210),
      downloadUrl: track.downloadUrl || (existing ? existing.downloadUrl : []),
      stream_url: streamUrl,
      direct_url: streamUrl,
      language: track.language || (existing ? existing.language : 'hindi'),
      year: track.year || (existing ? existing.year : ''),
      has_lyrics: track.has_lyrics ?? (existing ? existing.has_lyrics : true)
    };

    this.trackRegistry.set(id, normalized);
    return normalized;
  }

  registerTracks(tracks) {
    if (!Array.isArray(tracks)) return [];
    return tracks.map(t => this.registerTrack(t)).filter(Boolean);
  }

  decodeHTML(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
      .trim();
  }

  // -------------------------------------------------------------
  // EVENT LISTENERS INITIALIZATION
  // -------------------------------------------------------------
  initEventListeners() {
    // 1. Navigation clicks (Desktop Sidebar & Mobile Bottom Navigation Bar)
    this.navItems.forEach(item => {
      item.addEventListener("click", () => {
        const view = item.dataset.view;
        this.switchView(view);
        if (view === "search" && this.searchInput) {
          setTimeout(() => this.searchInput.focus(), 120);
        }
      });
    });

    // Tap-to-expand Mini Player on mobile / floating player
    if (this.playerDock) {
      this.playerDock.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".range-slider")) return;
        this.toggleCinemaMode(true);
      });
    }

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

    // Search Filter Chips
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
      if (this.cinemaPlayPauseBtn) this.cinemaPlayPauseBtn.innerHTML = "❚❚";
      const syncPlayBtn = document.getElementById("sync-ctrl-play");
      if (syncPlayBtn) syncPlayBtn.innerHTML = "❚❚";

      if (this.playerThumb) this.playerThumb.classList.add("spinning");
      const overlay = document.getElementById("cinema-mode-overlay");
      if (overlay) overlay.classList.add("is-playing");
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.classList.add("spinning");
      
      this.updateActiveRowHighlight();
      this.updateBrowserMediaNotification();
      if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
        this.sync.broadcastPlayState(true, this.audio.audio.currentTime);
      }
    });

    window.addEventListener("oxyzen:pause", () => {
      if (this.playPauseBtn) this.playPauseBtn.innerHTML = "▶";
      if (this.cinemaPlayPauseBtn) this.cinemaPlayPauseBtn.innerHTML = "▶";
      const syncPlayBtn = document.getElementById("sync-ctrl-play");
      if (syncPlayBtn) syncPlayBtn.innerHTML = "▶";

      if (this.playerThumb) this.playerThumb.classList.remove("spinning");
      const overlay = document.getElementById("cinema-mode-overlay");
      if (overlay) overlay.classList.remove("is-playing");
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.classList.remove("spinning");

      this.updateBrowserMediaNotification();
      if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
        this.sync.broadcastPlayState(false, this.audio.audio.currentTime);
      }
    });

    // Mobile OS MediaSession & Notification Remote Action Listeners
    window.addEventListener("oxyzen:request_prev", () => {
      this.playPrevious();
    });

    window.addEventListener("oxyzen:request_next", () => {
      this.playNext();
    });

    window.addEventListener("oxyzen:request_toggle_like", () => {
      if (this.currentTrack) {
        this.toggleLikeTrack(this.currentTrack);
      }
    });

    window.addEventListener("oxyzen:media_inactive", () => {
      this.clearBrowserMediaNotification();
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

        // Synchronized Lyrics Line Highlighting
        this.updateActiveLyricLine(cur);
      }
    });

    window.addEventListener("oxyzen:ended", () => {
      this.handleTrackEnded();
    });

    // 4. Player Dock Transport Controls
    if (this.playPauseBtn) this.playPauseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.togglePlayPause();
    });
    if (this.prevBtn) this.prevBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.playPrevious();
    });
    if (this.nextBtn) this.nextBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.playNext();
    });

    if (this.shuffleBtn) {
      this.shuffleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.isShuffle = !this.isShuffle;
        this.shuffleBtn.classList.toggle("active", this.isShuffle);
        if (this.cinemaShuffleBtn) this.cinemaShuffleBtn.classList.toggle("active", this.isShuffle);
        this.showToast(this.isShuffle ? "🔀 Shuffle On" : "🔀 Shuffle Off");
      });
    }

    if (this.repeatBtn) {
      this.repeatBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.repeatMode === "off") this.repeatMode = "all";
        else if (this.repeatMode === "all") this.repeatMode = "one";
        else this.repeatMode = "off";

        const text = this.repeatMode === "one" ? "🔂" : "🔁";
        this.repeatBtn.innerHTML = text;
        this.repeatBtn.classList.toggle("active", this.repeatMode !== "off");
        if (this.cinemaRepeatBtn) {
          this.cinemaRepeatBtn.innerHTML = text;
          this.cinemaRepeatBtn.classList.toggle("active", this.repeatMode !== "off");
        }
        this.showToast(`Repeat: ${this.repeatMode.toUpperCase()}`);
      });
    }

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
        if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
          this.sync.broadcastSeek(targetSec);
        }
      });
    }

    if (this.volumeSlider) {
      this.volumeSlider.addEventListener("input", (e) => {
        const val = parseFloat(e.target.value);
        this.audio.setVolume(val);
        this.updateSliderFill(e.target);
        if (this.cinemaVolumeSlider) {
          this.cinemaVolumeSlider.value = val;
          this.updateSliderFill(this.cinemaVolumeSlider);
        }
      });
    }

    if (this.volumeIcon) {
      this.volumeIcon.addEventListener("click", () => {
        if (this.audio.audio.volume > 0) {
          this.lastVolume = this.audio.audio.volume;
          this.audio.setVolume(0);
          if (this.volumeSlider) this.volumeSlider.value = 0;
          this.volumeIcon.innerText = "🔇";
        } else {
          const restore = this.lastVolume || 0.8;
          this.audio.setVolume(restore);
          if (this.volumeSlider) this.volumeSlider.value = restore;
          this.volumeIcon.innerText = "🔊";
        }
      });
    }

    if (this.spatial8DBtn) {
      this.spatial8DBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggle8DMode();
      });
    }

    if (this.playerLikeBtn) {
      this.playerLikeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.currentTrack) {
          this.toggleLikeTrack(this.currentTrack);
        }
      });
    }

    if (this.playerAddPlaylistBtn) {
      this.playerAddPlaylistBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (this.currentTrack) {
          this.openAddToPlaylistModal(this.currentTrack);
        } else {
          this.showToast("No track currently playing");
        }
      });
    }

    // 5. Cinema Mode & Mobile Drawer Controls
    if (this.cinemaToggleBtn) {
      this.cinemaToggleBtn.addEventListener("click", () => this.toggleCinemaMode(true));
    }
    if (this.cinemaCloseBtn) {
      this.cinemaCloseBtn.addEventListener("click", () => this.toggleCinemaMode(false));
    }
    if (this.cinemaPlayPauseBtn) {
      this.cinemaPlayPauseBtn.addEventListener("click", () => this.togglePlayPause());
    }
    if (this.cinemaPrevBtn) {
      this.cinemaPrevBtn.addEventListener("click", () => this.playPrevious());
    }
    if (this.cinemaNextBtn) {
      this.cinemaNextBtn.addEventListener("click", () => this.playNext());
    }
    if (this.cinemaShuffleBtn) {
      this.cinemaShuffleBtn.addEventListener("click", () => {
        this.isShuffle = !this.isShuffle;
        if (this.shuffleBtn) this.shuffleBtn.classList.toggle("active", this.isShuffle);
        this.cinemaShuffleBtn.classList.toggle("active", this.isShuffle);
        this.showToast(this.isShuffle ? "🔀 Shuffle On" : "🔀 Shuffle Off");
      });
    }
    if (this.cinemaRepeatBtn) {
      this.cinemaRepeatBtn.addEventListener("click", () => {
        if (this.repeatMode === "off") this.repeatMode = "all";
        else if (this.repeatMode === "all") this.repeatMode = "one";
        else this.repeatMode = "off";
        
        const text = this.repeatMode === "one" ? "🔂" : "🔁";
        if (this.repeatBtn) {
          this.repeatBtn.innerHTML = text;
          this.repeatBtn.classList.toggle("active", this.repeatMode !== "off");
        }
        this.cinemaRepeatBtn.innerHTML = text;
        this.cinemaRepeatBtn.classList.toggle("active", this.repeatMode !== "off");
        this.showToast(`Repeat: ${this.repeatMode.toUpperCase()}`);
      });
    }
    if (this.cinemaLyricsToggleBtn) {
      this.cinemaLyricsToggleBtn.addEventListener("click", () => {
        const lyricsCol = document.getElementById("ambient-lyrics-column");
        if (lyricsCol) {
          lyricsCol.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
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
        if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
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

    if (this.cinemaAddPlaylistBtn) {
      this.cinemaAddPlaylistBtn.addEventListener("click", () => {
        if (this.currentTrack) {
          this.openAddToPlaylistModal(this.currentTrack);
        } else {
          this.showToast("No track currently playing");
        }
      });
    }

    if (this.cinemaSpatialBtn) {
      this.cinemaSpatialBtn.addEventListener("click", () => this.toggle8DMode());
    }

    // Mobile Pull Handle to dismiss Cinema mode
    const drawerHandle = document.getElementById("mobile-drawer-handle-bar");
    if (drawerHandle) {
      drawerHandle.addEventListener("click", () => this.toggleCinemaMode(false));
    }

    // Panels & Modals
    if (this.lyricsToggleBtn) {
      this.lyricsToggleBtn.addEventListener("click", () => {
        this.lyricsPanel.classList.toggle("open");
        this.queuePanel.classList.remove("open");
        if (this.lyricsPanel.classList.contains("open")) {
          try { history.pushState({ modal: "lyrics" }, "", location.hash); } catch(e) {}
        }
      });
    }
    if (this.lyricsCloseBtn) {
      this.lyricsCloseBtn.addEventListener("click", () => this.lyricsPanel.classList.remove("open"));
    }

    if (this.queueToggleBtn) {
      this.queueToggleBtn.addEventListener("click", () => {
        this.queuePanel.classList.toggle("open");
        this.lyricsPanel.classList.remove("open");
        if (this.queuePanel.classList.contains("open")) {
          this.renderQueuePanel();
          try { history.pushState({ modal: "queue" }, "", location.hash); } catch(e) {}
        }
      });
    }
    if (this.queueCloseBtn) {
      this.queueCloseBtn.addEventListener("click", () => this.queuePanel.classList.remove("open"));
    }

    if (this.eqOpenBtn) {
      this.eqOpenBtn.addEventListener("click", () => {
        this.eqModal.classList.add("active");
        try { history.pushState({ modal: "equalizer" }, "", location.hash); } catch(e) {}
      });
    }
    if (this.eqCloseBtn) {
      this.eqCloseBtn.addEventListener("click", () => this.eqModal.classList.remove("active"));
    }
    if (this.eqModal) {
      this.eqModal.addEventListener("click", (e) => {
        if (e.target === this.eqModal) this.eqModal.classList.remove("active");
      });
    }

    this.setupPlaylistImportListeners();
    this.setupHistoryNavigation();
  }

  // -------------------------------------------------------------
  // BROWSER HISTORY & BACK BUTTON SPA NAVIGATION
  // -------------------------------------------------------------
  setupHistoryNavigation() {
    const currentHash = location.hash ? location.hash.replace("#", "") : "explore";
    const validViews = ["explore", "search", "moods", "vibe", "sync-space", "collection", "liked", "playlists", "history", "profile"];
    const startView = validViews.includes(currentHash) ? currentHash : "explore";

    try {
      history.replaceState({ view: startView }, "", `#${startView}`);
    } catch (e) {}

    window.addEventListener("popstate", (e) => {
      // 1. If any modal, overlay or slide-over drawer is open, close it first!
      if (this.cinemaOverlay && this.cinemaOverlay.classList.contains("active")) {
        this.toggleCinemaMode(false, false);
        return;
      }
      if (this.eqModal && this.eqModal.classList.contains("active")) {
        this.eqModal.classList.remove("active");
        return;
      }
      if (this.lyricsPanel && (this.lyricsPanel.classList.contains("open") || this.lyricsPanel.classList.contains("active"))) {
        this.lyricsPanel.classList.remove("open", "active");
        return;
      }
      if (this.queuePanel && (this.queuePanel.classList.contains("open") || this.queuePanel.classList.contains("active"))) {
        this.queuePanel.classList.remove("open", "active");
        return;
      }
      const addPlModal = document.getElementById("add-to-playlist-modal");
      if (addPlModal && addPlModal.classList.contains("active")) {
        addPlModal.classList.remove("active");
        return;
      }
      const createPlModal = document.getElementById("create-playlist-modal");
      if (createPlModal && createPlModal.classList.contains("active")) {
        createPlModal.classList.remove("active");
        return;
      }
      const importPlModal = document.getElementById("import-playlist-modal");
      if (importPlModal && importPlModal.classList.contains("active")) {
        importPlModal.classList.remove("active");
        return;
      }

      // 2. Playlist detail navigation
      if (e.state && e.state.view === "playlist-detail" && e.state.plId) {
        this.loadPlaylistDetailView(e.state.plId, false);
        return;
      }

      // 3. Regular SPA Views
      const targetView = (e.state && e.state.view) || (location.hash ? location.hash.replace("#", "") : "explore");
      if (validViews.includes(targetView)) {
        this.switchView(targetView, false);
      } else if (this.activeView !== "explore") {
        this.switchView("explore", false);
      }
    });
  }

  // -------------------------------------------------------------
  // VIEW SWITCHER & SPA NAVIGATION
  // -------------------------------------------------------------
  switchView(viewName, pushHistory = true) {
    if (pushHistory && viewName !== this.activeView) {
      try {
        history.pushState({ view: viewName }, "", `#${viewName}`);
      } catch (e) {}
    }
    this.activeView = viewName;
    document.querySelectorAll(".nav-item[data-view], .mobile-nav-tab[data-view]").forEach(item => {
      const isMatch = item.dataset.view === viewName || 
        (item.classList.contains("mobile-nav-tab") && item.dataset.view === "collection" && ["liked", "playlists", "playlist-detail", "history", "collection"].includes(viewName)) ||
        (item.classList.contains("mobile-nav-tab") && item.dataset.view === "vibe" && viewName === "vibe");
      item.classList.toggle("active", isMatch);
    });
    this.pageViews.forEach(view => {
      view.classList.toggle("active", view.id === `view-${viewName}`);
      view.scrollTop = 0;
    });

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const mainContent = document.getElementById("main-content");
    if (mainContent) mainContent.scrollTop = 0;
    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.scrollTop = 0;

    if (viewName === "explore") {
      this.refreshPersonalizedSections();
    } else if (viewName === "moods") {
      this.loadMoodCategories();
    } else if (viewName === "collection") {
      this.loadCollectionView();
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
    } else if (viewName === "profile") {
      this.loadProfileView();
    }
  }

  // -------------------------------------------------------------
  // INITIAL DATA & FEED LOADING
  // -------------------------------------------------------------
  async loadInitialData() {
    try {
      await this.loadUserProfile();

      // Local storage fast-path
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

      // Server DB Hydration if local storage was empty
      try {
        const [likesRes, plRes] = await Promise.all([
          fetch(`${API_BASE}/api/library/likes`),
          fetch(`${API_BASE}/api/library/playlists`)
        ]);
        if (likesRes.ok) {
          const lData = await likesRes.json();
          if (Array.isArray(lData.likes) && lData.likes.length > 0 && localLikes.length === 0) {
            localStorage.setItem("oxyzen_liked_tracks", JSON.stringify(lData.likes));
            this.likedIds = new Set(lData.likes.map(t => t.id || t.videoId));
            this.updateLikesBadge(lData.likes.length);
            this.registerTracks(lData.likes);
          }
        }
        if (plRes.ok) {
          const pData = await plRes.json();
          if (Array.isArray(pData.playlists) && pData.playlists.length > 0 && this.playlists.length === 0) {
            localStorage.setItem("oxyzen_custom_playlists", JSON.stringify(pData.playlists));
            this.playlists = pData.playlists;
            this.updatePlaylistsBadge(this.playlists.length);
          }
        }
      } catch (e) {}

      this.refreshPersonalizedSections();
    } catch (err) {
      console.warn("Error loading initial data:", err);
    }
  }

  // -------------------------------------------------------------
  // USER PROFILE & PREFERENCES
  // -------------------------------------------------------------
  async loadUserProfile() {
    const localProfile = this.storage.getUserProfile();
    this.userProfile = { ...this.userProfile, ...localProfile };
    try {
      const res = await fetch(`${API_BASE}/api/user/profile`);
      const data = await res.json();
      if (data && data.profile) {
        const serverName = data.profile.name || data.profile.username;
        if (serverName && serverName !== "Oxyzen Listener" && serverName !== "Guest") {
          this.userProfile = { ...this.userProfile, ...data.profile, name: serverName };
        } else {
          this.userProfile = { ...this.userProfile, ...data.profile, name: localProfile.name };
        }
      }
    } catch (e) {}
    this.updateProfileUI();
  }

  updateProfileUI() {
    const avatar = this.userProfile.avatar || "👑";
    const name = this.userProfile.name || (this.storage ? this.storage.getUserProfile().name : "AcousticVoyager_500");
    const langs = this.userProfile.languages || ["Telugu", "Hindi", "English"];

    // Sidebar
    const sideAvatar = document.getElementById("sidebar-user-avatar");
    const sideName = document.getElementById("sidebar-user-name");
    const sideLangs = document.getElementById("sidebar-user-langs");
    if (sideAvatar) sideAvatar.innerText = avatar;
    if (sideName) sideName.innerText = name;
    if (sideLangs) sideLangs.innerText = langs.map(l => l.slice(0, 2).toUpperCase()).join(" • ");

    // Topbar
    const topAvatar = document.getElementById("topbar-avatar");
    const topName = document.getElementById("topbar-username");
    if (topAvatar) topAvatar.innerText = avatar;
    if (topName) topName.innerText = name.split(" ")[0] || name;

    // SoundSync Inputs
    const hostInput = document.getElementById("sync-host-name-input");
    if (hostInput && (!hostInput.value || hostInput.value === "DJ Master")) {
      hostInput.value = name;
    }
    const listenerInput = document.getElementById("sync-listener-name-input");
    if (listenerInput && (!listenerInput.value || listenerInput.value === "Listener")) {
      listenerInput.value = name;
    }

    // Moods subtitle
    const moodSub = document.getElementById("mood-hub-languages-desc");
    if (moodSub) {
      moodSub.innerText = `Curated emotional albums tailored to your preferred languages (${langs.join(", ")})`;
    }

    // Sync sound sync profile
    this.sync.setProfile(name, avatar);
  }

  setupProfileUI() {
    if (this.profileOpenBtn) this.profileOpenBtn.addEventListener("click", () => this.switchView("profile"));
    if (this.profileSidebarBtn) this.profileSidebarBtn.addEventListener("click", () => this.switchView("profile"));
  }

  loadProfileView() {
    const avatar = this.userProfile.avatar || "👑";
    const name = this.userProfile.name || "Oxyzen Listener";
    const langs = this.userProfile.languages || ["Telugu", "Hindi", "English"];

    // Profile Page Hero
    const pageAvatar = document.getElementById("page-user-avatar");
    const pageName = document.getElementById("page-user-name");
    if (pageAvatar) pageAvatar.innerText = avatar;
    if (pageName) pageName.innerText = name;

    // Stats
    const history = this.storage.getHistory(100);
    const likes = this.storage.getLikedTracks();
    const pls = this.storage.getPlaylists();

    const pageStatPlays = document.getElementById("page-stat-plays");
    const pageStatLikes = document.getElementById("page-stat-likes");
    const pageStatPlaylists = document.getElementById("page-stat-playlists");
    const pageStatSyncs = document.getElementById("page-stat-syncs");

    if (pageStatPlays) pageStatPlays.innerText = history.length;
    if (pageStatLikes) pageStatLikes.innerText = likes.length;
    if (pageStatPlaylists) pageStatPlaylists.innerText = pls.length;
    if (pageStatSyncs) pageStatSyncs.innerText = this.sync.connected ? `Room: ${this.sync.roomCode}` : "Live";

    // Nickname input on Profile Page
    const pageNameInput = document.getElementById("page-profile-name-input");
    const pageSaveNameBtn = document.getElementById("page-save-name-btn");
    if (pageNameInput) pageNameInput.value = name;
    if (pageSaveNameBtn && pageNameInput) {
      pageSaveNameBtn.onclick = () => {
        const newName = pageNameInput.value.trim() || "Oxyzen Listener";
        this.userProfile.name = newName;
        localStorage.setItem("oxyzen_user_name", newName);
        this.updateProfileUI();
        this.loadProfileView();
        this.showToast(`✨ Updated nickname to "${newName}"`);
        fetch(`${API_BASE}/api/user/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.userProfile)
        }).catch(() => {});
      };
    }

    // Avatar selector on Profile Page
    const pageAvatarPicker = document.getElementById("page-avatar-picker");
    if (pageAvatarPicker) {
      pageAvatarPicker.querySelectorAll(".avatar-pill").forEach(pill => {
        pill.classList.toggle("active", pill.dataset.avatar === avatar);
        pill.onclick = () => {
          pageAvatarPicker.querySelectorAll(".avatar-pill").forEach(p => p.classList.remove("active"));
          pill.classList.add("active");
          const av = pill.dataset.avatar || "👑";
          this.userProfile.avatar = av;
          localStorage.setItem("oxyzen_user_avatar", av);
          this.updateProfileUI();
          this.loadProfileView();
          this.showToast(`✨ Changed avatar to ${av}`);
          fetch(`${API_BASE}/api/user/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.userProfile)
          }).catch(() => {});
        };
      });
    }

    // Streaming Quality Selector
    const qualitySelector = document.getElementById("page-quality-selector");
    if (qualitySelector) {
      qualitySelector.querySelectorAll(".quality-pill").forEach(pill => {
        pill.classList.toggle("active", pill.dataset.quality === (this.userProfile.audio_quality || "320k"));
        pill.onclick = () => {
          qualitySelector.querySelectorAll(".quality-pill").forEach(p => p.classList.remove("active"));
          pill.classList.add("active");
          this.userProfile.audio_quality = pill.dataset.quality;
          localStorage.setItem("oxyzen_audio_quality", pill.dataset.quality);
          this.showToast(`🔥 Audio streaming quality set to ${pill.innerText}`);
        };
      });
    }

    // 8D Spatial Audio Switch
    const spatialToggle = document.getElementById("page-spatial-toggle");
    if (spatialToggle) {
      spatialToggle.checked = !!(this.audio && this.audio.is8DActive);
      spatialToggle.onchange = () => {
        this.toggle8DMode();
      };
    }

    // Neon Theme Accent Switcher
    const currentTheme = localStorage.getItem("oxyzen_theme") || "gold";
    document.body.setAttribute("data-theme", currentTheme);
    const themeAccents = document.getElementById("page-theme-accents");
    if (themeAccents) {
      themeAccents.querySelectorAll(".theme-dot").forEach(dot => {
        dot.classList.toggle("active", dot.dataset.theme === currentTheme);
        dot.onclick = () => {
          themeAccents.querySelectorAll(".theme-dot").forEach(d => d.classList.remove("active"));
          dot.classList.add("active");
          const theme = dot.dataset.theme || "gold";
          document.body.setAttribute("data-theme", theme);
          localStorage.setItem("oxyzen_theme", theme);
          this.showToast(`✨ Switched theme to ${dot.title}`);
        };
      });
    }

    // Languages Grid on Page with Real-Time Search Filter
    const pageLangsGrid = document.getElementById("page-languages-grid");
    const langSearchInput = document.getElementById("profile-lang-search-input");

    if (langSearchInput && pageLangsGrid) {
      langSearchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase().trim();
        pageLangsGrid.querySelectorAll(".lang-chip").forEach(chip => {
          const lText = (chip.dataset.lang || chip.innerText).toLowerCase();
          const match = !term || lText.includes(term);
          chip.style.display = match ? "inline-flex" : "none";
        });
      };
    }

    if (pageLangsGrid) {
      pageLangsGrid.querySelectorAll(".lang-chip").forEach(chip => {
        chip.classList.toggle("active", langs.includes(chip.dataset.lang));
        chip.onclick = () => {
          chip.classList.toggle("active");
          const selected = [];
          pageLangsGrid.querySelectorAll(".lang-chip.active").forEach(c => {
            if (c.dataset.lang) selected.push(c.dataset.lang);
          });
          this.userProfile.languages = selected.length > 0 ? selected : ["Hindi", "English"];
          this.activeMoodLanguage = this.userProfile.languages[0];
          localStorage.setItem("oxyzen_user_languages", JSON.stringify(this.userProfile.languages));
          this.updateProfileUI();
          this.showToast(`🌐 Preferred languages updated: ${this.userProfile.languages.join(", ")}`);
          fetch(`${API_BASE}/api/user/profile`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(this.userProfile)
          }).catch(() => {});
          this.refreshPersonalizedSections();
        };
      });
    }

    // Export, Import, Clear History
    const exportBtn = document.getElementById("page-export-backup-btn");
    if (exportBtn) {
      exportBtn.onclick = () => {
        this.storage.downloadBackupFile();
        this.showToast("📥 Exported Oxyzen library backup (.json)");
      };
    }

    const importBtn = document.getElementById("page-import-backup-btn");
    if (importBtn) {
      importBtn.onclick = () => {
        const input = document.getElementById("profile-import-file-input");
        if (input) input.click();
      };
    }

    const clearHistoryBtn = document.getElementById("page-clear-history-btn");
    if (clearHistoryBtn) {
      clearHistoryBtn.onclick = () => {
        if (confirm("Are you sure you want to clear your local listening history?")) {
          this.storage.clearHistory();
          this.loadProfileView();
          this.showToast("🗑️ Listening history cleared");
        }
      };
    }
  }

  // -------------------------------------------------------------
  // AUTOCOMPLETE SEARCH ENGINE & RESULTS RENDERER
  // -------------------------------------------------------------
  async fetchSuggestions(query) {
    if (!this.searchSuggestionsDropdown || !query || query.trim().length < 2) {
      this.hideSuggestions();
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/suggestions?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      const suggestions = (data.suggestions || []).slice(0, 8);

      if (suggestions.length === 0) {
        this.hideSuggestions();
        return;
      }

      this.searchSuggestionsDropdown.innerHTML = suggestions.map(s => `
        <div class="search-suggestion-item" data-suggestion="${this.escapeHTML(s)}">
          <span class="search-suggestion-icon">🔍</span>
          <span class="search-suggestion-text">${this.escapeHTML(s)}</span>
        </div>
      `).join("");

      this.searchSuggestionsDropdown.classList.add("visible");

      this.searchSuggestionsDropdown.querySelectorAll(".search-suggestion-item").forEach(item => {
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          const val = item.dataset.suggestion;
          if (this.searchInput) this.searchInput.value = val;
          this.hideSuggestions();
          this.performSearch(val);
        });
      });
    } catch (e) {
      this.hideSuggestions();
    }
  }

  hideSuggestions() {
    if (this.searchSuggestionsDropdown) {
      this.searchSuggestionsDropdown.classList.remove("visible");
      this.searchSuggestionsDropdown.innerHTML = "";
    }
  }

  async performSearch(query) {
    if (!query || !query.trim()) return;
    this.searchQuery = query.trim();
    if (this.searchInput) this.searchInput.value = this.searchQuery;
    if (this.searchClearBtn) this.searchClearBtn.classList.add("visible");
    this.hideSuggestions();

    if (this.activeView !== "search") {
      this.switchView("search");
    }

    const container = document.getElementById("search-results-container");
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
        <div class="sync-spinner" style="margin: 0 auto 16px;"></div>
        <div>Searching high-fidelity catalog for "${this.escapeHTML(this.searchQuery)}"...</div>
      </div>
    `;

    try {
      const filterParam = this.searchFilter ? `&type=${encodeURIComponent(this.searchFilter)}` : '';
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(this.searchQuery)}&limit=40${filterParam}`);
      const data = await res.json();
      const tracks = this.registerTracks(data.tracks || data.results || []);

      if (tracks.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 80px 0; color: var(--silver-muted);">
            <div style="font-size: 40px; margin-bottom: 12px;">🔎</div>
            <div style="font-size: 18px; font-weight: 700; color: #FFFFFF; margin-bottom: 6px;">No Results Found for "${this.escapeHTML(this.searchQuery)}"</div>
            <div>Try checking the spelling or searching for another song, artist, or album.</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div class="hero-banner" style="background: linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 24px;">
          <div class="hero-content">
            <span class="hero-badge" style="color: var(--accent-cyan); border-color: rgba(34, 211, 238, 0.4);">SEARCH RESULTS</span>
            <h1 class="hero-title">"${this.escapeHTML(this.searchQuery)}"</h1>
            <p class="hero-desc">${tracks.length} master-quality results found</p>
            <div class="hero-actions" style="margin-top: 14px;">
              <button class="btn-luxury btn-gold-action" id="search-play-all-btn">▶ Play Top Result</button>
              <button class="btn-luxury" id="search-queue-all-btn">➕ Add All to Queue</button>
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
                    <div class="row-title">${this.escapeHTML(t.title)}</div>
                    <div class="row-artist">${this.escapeHTML(t.artist)}</div>
                  </div>
                </td>
                <td>${this.escapeHTML(t.album || 'Oxyzen Audio')}</td>
                <td>${t.duration_formatted || '3:30'}</td>
                <td style="text-align: right;">
                  <div class="row-actions">
                    <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Like">
                      ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                    </button>
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

      this.attachTrackRowEventListeners(container, tracks);

      const playAllBtn = document.getElementById("search-play-all-btn");
      if (playAllBtn && tracks.length > 0) {
        playAllBtn.addEventListener("click", () => {
          this.setQueue(tracks, 0);
          this.playTrack(tracks[0]);
        });
      }

      const queueAllBtn = document.getElementById("search-queue-all-btn");
      if (queueAllBtn && tracks.length > 0) {
        queueAllBtn.addEventListener("click", () => {
          tracks.forEach(t => this.addToQueue(t));
          this.showToast(`➕ Added ${tracks.length} tracks to queue`);
        });
      }
    } catch (e) {
      container.innerHTML = `<div style="color: #EF4444; padding: 40px;">Search failed: ${e.message}</div>`;
    }
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
        <div class="mood-card" data-mood-id="${m.key || m.id}" style="border-top: 3px solid ${m.color};">
          <span class="mood-card-icon">${m.icon}</span>
          <div class="mood-card-title">${m.name}</div>
          <div class="mood-card-tagline">${m.tagline}</div>
        </div>
      `).join("");

      grid.querySelectorAll(".mood-card").forEach(card => {
        card.addEventListener("click", () => {
          const mId = card.dataset.moodId;
          this.loadMoodStation(mId, this.activeMoodLanguage);
        });
      });

      const userLangs = (this.userProfile && this.userProfile.languages && this.userProfile.languages.length > 0)
        ? this.userProfile.languages
        : ['Hindi', 'English'];
      if (!this.activeMoodLanguage || !userLangs.includes(this.activeMoodLanguage)) {
        this.activeMoodLanguage = userLangs[0] || 'Hindi';
      }

      // Default load active mood station
      if (this.activeMoodKey) {
        this.loadMoodStation(this.activeMoodKey, this.activeMoodLanguage);
      } else {
        this.loadMoodStation("love", this.activeMoodLanguage);
      }
    } catch (e) {
      console.warn("Failed to load mood categories:", e);
    }
  }

  async loadMoodStation(moodKey, targetLang) {
    this.activeMoodKey = moodKey;
    const userLangs = (this.userProfile && this.userProfile.languages && this.userProfile.languages.length > 0)
      ? this.userProfile.languages
      : ['Hindi', 'English'];

    if (targetLang) {
      this.activeMoodLanguage = targetLang;
    } else if (!this.activeMoodLanguage || !userLangs.includes(this.activeMoodLanguage)) {
      this.activeMoodLanguage = userLangs[0] || 'Hindi';
    }

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
      <div style="text-align: center; padding: 40px; color: var(--silver-muted);">
        <div class="sync-spinner" style="margin: 0 auto 12px;"></div>
        <div>Loading ${this.escapeHTML(this.activeMoodLanguage)} Mood Station...</div>
      </div>
    `;

    try {
      const langsParam = encodeURIComponent((this.userProfile.languages || ['Telugu', 'Hindi', 'English']).join(","));
      const selectedLangParam = encodeURIComponent(this.activeMoodLanguage);
      const res = await fetch(`${API_BASE}/api/moods/${moodKey}?languages=${langsParam}&language=${selectedLangParam}`);
      const data = await res.json();
      const mood = data.mood || {};
      const tracks = this.registerTracks(data.tracks || []);
      const activeLanguage = data.activeLanguage || this.activeMoodLanguage;
      const availableLangs = this.userProfile.languages || ['Telugu', 'Hindi', 'English'];

      container.innerHTML = `
        <div class="hero-banner" style="background: ${mood.gradient || 'linear-gradient(135deg, rgba(245, 197, 66, 0.2), rgba(17, 17, 21, 0.95))'}; margin-bottom: 24px;">
          <div class="hero-content">
            <span class="hero-badge" style="color: ${mood.color}; border-color: ${mood.color};">✦ ${mood.icon || '🎵'} ACTIVE MOOD STATION</span>
            <h1 class="hero-title">${mood.name || 'Mood Station'}</h1>
            <p class="hero-desc">${mood.tagline || ''} • Curated for <strong>${activeLanguage}</strong> (${tracks.length} tracks)</p>
            
            <div class="mood-lang-filter-bar">
              ${availableLangs.map(l => `
                <button class="mood-lang-pill ${activeLanguage.toLowerCase() === l.toLowerCase() ? 'active' : ''}" data-lang="${l}">
                  ${l === 'Telugu' || l === 'Hindi' || l === 'Tamil' || l === 'Punjabi' || l === 'Kannada' || l === 'Malayalam' ? '🇮🇳' : '🌐'} ${l}
                </button>
              `).join('')}
            </div>

            <div class="hero-actions" style="margin-top: 18px;">
              <button class="btn-luxury btn-gold-action" id="mood-play-all-btn">▶ Play All (${tracks.length})</button>
              <button class="btn-luxury" id="mood-shuffle-all-btn">🔀 Shuffle</button>
            </div>
          </div>
        </div>

        ${tracks.length === 0 ? `
          <div style="color: var(--silver-muted); padding: 40px; text-align: center;">
            No tracks found for this mood in ${activeLanguage}. Tap another language tab above!
          </div>
        ` : `
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
                      <div class="row-title">${this.escapeHTML(t.title)}</div>
                      <div class="row-artist">${this.escapeHTML(t.artist)}</div>
                    </div>
                  </td>
                  <td>${this.escapeHTML(t.album || 'Oxyzen Audio')}</td>
                  <td>${t.duration_formatted || '3:30'}</td>
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
        `}
      `;

      // Attach language pill click listeners
      container.querySelectorAll('.mood-lang-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
          e.stopPropagation();
          const target = pill.dataset.lang;
          this.loadMoodStation(moodKey, target);
        });
      });

      this.attachTrackRowEventListeners(container, tracks);

      const playAllBtn = document.getElementById("mood-play-all-btn");
      if (playAllBtn && tracks.length > 0) {
        playAllBtn.addEventListener("click", () => {
          this.setQueue(tracks, 0);
          this.playTrack(tracks[0]);
        });
      }

      const shuffleAllBtn = document.getElementById("mood-shuffle-all-btn");
      if (shuffleAllBtn && tracks.length > 0) {
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
  // EXPLORE FEED & LIVE ADAPTIVE RESONANCE
  // -------------------------------------------------------------
  async refreshPersonalizedSections() {
    try {
      const history = this.storage.getHistory() || [];
      const likes = this.storage.getLikedSongs() || [];
      const languages = this.userProfile.languages || ["Telugu", "Hindi", "English"];
      
      const payload = {
        languages,
        history,
        likes,
        currentTrack: this.currentTrack ? {
          id: this.currentTrack.id,
          title: this.currentTrack.title,
          artist: this.currentTrack.artist,
          language: this.currentTrack.language
        } : undefined
      };

      const res = await fetch(`${API_BASE}/api/explore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data && data.sections) {
        this.renderExploreFeed(data);
      }
    } catch (e) {
      console.warn("Failed to refresh explore feed:", e);
    }
  }

  async refreshAdaptiveExploreSection(track) {
    const container = document.getElementById("explore-adaptive-resonance");
    if (!container || !track) return;

    try {
      const lang = encodeURIComponent(track.language || this.userProfile.languages[0] || 'Telugu');
      const res = await fetch(`${API_BASE}/api/recommendations?video_id=${track.id}&artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&language=${lang}`);
      const data = await res.json();
      const kindred = this.registerTracks(data.recommendations || []);
      if (kindred.length === 0) {
        container.innerHTML = "";
        return;
      }

      container.innerHTML = `
        <div class="feed-section" style="background: linear-gradient(135deg, rgba(245, 197, 66, 0.14) 0%, rgba(14, 14, 20, 0.88) 60%); border: 1.5px solid rgba(245, 197, 66, 0.35); border-radius: var(--radius-lg); padding: 22px 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); margin-bottom: 24px;">
          <div class="section-header" style="margin-bottom: 16px;">
            <div>
              <span class="hero-badge" style="margin-bottom: 6px;">✨ LIVE ADAPTIVE RESONANCE</span>
              <h2 class="section-title" style="font-size: 20px;">Because You Listened to "${this.escapeHTML(track.title)}"</h2>
              <p class="section-tagline">Kindred ${track.language || 'acoustic'} harmonies & genre hits matching ${this.escapeHTML(track.artist)}</p>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button class="btn-luxury btn-gold-action" id="adaptive-play-all-btn" style="padding: 6px 14px; font-size: 12px;">▶ Play All (${kindred.length})</button>
              <span class="brand-tag" style="border-color: var(--gold-accent); color: var(--gold-accent);">AI MATCH</span>
            </div>
          </div>
          <div class="cards-grid">
            ${kindred.slice(0, 30).map(t => this.renderMusicCardHTML(t)).join("")}
          </div>
        </div>
      `;

      const playAllBtn = document.getElementById("adaptive-play-all-btn");
      if (playAllBtn) {
        playAllBtn.addEventListener("click", () => {
          this.setQueue(kindred, 0);
          this.playTrack(kindred[0]);
        });
      }

      container.querySelectorAll(".music-card").forEach((card, idx) => {
        card.addEventListener("click", () => {
          const selected = kindred[idx];
          if (selected) {
            this.setQueue(kindred, idx);
            this.playTrack(selected);
          }
        });
      });
    } catch (e) {
      console.warn("Failed to load adaptive explore section:", e);
    }
  }

  renderExploreFeed(exploreData) {
    const container = document.getElementById("explore-feed-container");
    if (!container || !exploreData.sections) return;

    exploreData.sections.forEach(sec => {
      const trackList = sec.tracks || sec.items || [];
      if (trackList.length > 0) this.registerTracks(trackList);
    });

    let html = "";
    exploreData.sections.forEach((section, sIdx) => {
      const trackList = section.tracks || section.items || [];
      if (trackList.length === 0) return;

      html += `
        <div class="feed-section" data-section-idx="${sIdx}">
          <div class="section-header">
            <div>
              <h2 class="section-title">
                ${section.title}
              </h2>
              <p class="section-tagline">${section.tagline || section.subtitle || ''}</p>
            </div>
            <span class="brand-tag" style="border-color: ${section.color || '#F5C542'}; color: ${section.color || '#F5C542'}">${section.badge || 'PRO'}</span>
          </div>
          <div class="cards-grid">
            ${trackList.map(t => this.renderMusicCardHTML(t)).join("")}
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll(".feed-section").forEach((secEl) => {
      const sIdx = parseInt(secEl.dataset.sectionIdx, 10);
      const sectionObj = exploreData.sections[sIdx];
      const trackList = sectionObj ? (sectionObj.tracks || sectionObj.items || []) : [];

      secEl.querySelectorAll(".music-card").forEach((card, cIdx) => {
        card.addEventListener("click", () => {
          const track = trackList[cIdx];
          if (track) {
            this.setQueue(trackList, cIdx);
            this.playTrack(track);
          }
        });
      });
    });
  }

  renderMusicCardHTML(track) {
    const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
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
    if (!this.searchSuggestionsDropdown) return;
    this.searchSuggestionsDropdown.innerHTML = suggestions.map(s => `
      <div class="suggestion-item">
        <span class="suggestion-icon">🔍</span>
        <span class="suggestion-text">${this.escapeHTML(s)}</span>
      </div>
    `).join("");

    this.searchSuggestionsDropdown.querySelectorAll(".suggestion-item").forEach((item, idx) => {
      item.addEventListener("click", () => {
        const text = suggestions[idx];
        this.searchInput.value = text;
        this.hideSuggestions();
        this.performSearch(text);
      });
    });

    this.searchSuggestionsDropdown.classList.add("visible");
  }

  hideSuggestions() {
    if (this.searchSuggestionsDropdown) {
      this.searchSuggestionsDropdown.classList.remove("visible");
    }
  }

  async performSearch(query) {
    this.searchQuery = query;
    this.switchView("search");

    const container = document.getElementById("search-results-container");
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
        <div class="sync-spinner" style="margin: 0 auto 16px;"></div>
        <div style="font-size: 16px; font-weight: 600;">Searching "${this.escapeHTML(query)}"...</div>
      </div>
    `;

    try {
      const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=40`);
      const data = await res.json();
      const rawTracks = data.tracks || data.results || [];
      const tracks = this.registerTracks(rawTracks);

      if (tracks.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
            <div style="font-size: 36px; margin-bottom: 12px;">🔍</div>
            <div style="font-size: 18px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">No audio matches found for "${this.escapeHTML(query)}"</div>
            <div>Try searching for another song, artist, album, or genre keyword.</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; flex-wrap: wrap; gap: 8px;">
          <div>
            <h2 style="font-size: 22px; font-weight: 800;">Results for "${this.escapeHTML(query)}"</h2>
            <span style="font-size: 13px; color: var(--silver-muted);">${tracks.length} lossless high-fidelity streams</span>
          </div>
          <button class="btn-luxury btn-gold-action" id="search-play-all-btn">▶ Play All</button>
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
                <td>${t.duration_formatted || '3:30'}</td>
                <td style="text-align: right;">
                  <div class="row-actions">
                    <button class="btn-row-action ${this.likedIds.has(t.id) ? 'liked' : ''}" data-action="like" title="Save to Liked">
                      ${this.likedIds.has(t.id) ? '❤️' : '🤍'}
                    </button>
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

      this.attachTrackRowEventListeners(container, tracks);

      const playAllBtn = document.getElementById("search-play-all-btn");
      if (playAllBtn) {
        playAllBtn.addEventListener("click", () => {
          this.setQueue(tracks, 0);
          this.playTrack(tracks[0]);
        });
      }
    } catch (err) {
      container.innerHTML = `<div style="color: #EF4444; padding: 40px;">Search failed: ${err.message}</div>`;
    }
  }

  attachTrackRowEventListeners(container, trackList) {
    container.querySelectorAll(".track-row").forEach((row, idx) => {
      const trackId = row.dataset.trackId;
      const trackObj = trackList.find(t => t.id === trackId) || trackList[idx];

      row.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("a") || e.target.closest(".row-actions")) return;
        if (trackObj) {
          this.setQueue(trackList, idx);
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

    // Save history
    this.storage.addToHistory(registered);
    this.storage.saveSettings({ lastTrack: registered, lastPosition: startTime });

    // SoundSync broadcast
    if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
      this.sync.broadcastPlayTrack(registered);
    }

    // Prefetch next track
    if (this.queue.length > this.queueIndex + 1) {
      this.audio.prefetchTrack(this.queue[this.queueIndex + 1]);
    }

    // Background server logging
    fetch(`${API_BASE}/api/library/history/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(registered)
    }).catch(() => {});

    // Synced lyrics & vibe queue & live adaptive explore feed
    this.fetchLyrics(registered);
    this.fetchVibeQueue(registered);
    this.refreshAdaptiveExploreSection(registered);

    // Play in audio engine
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
  }

  updateQueueBadge() {
    if (this.queueBadge) {
      this.queueBadge.innerText = this.queue.length;
    }
  }

  updatePlayerDockUI(track) {
    const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
    if (this.playerThumb) this.playerThumb.src = thumb;
    if (this.playerTitle) this.playerTitle.innerText = track.title || "Unknown Track";
    if (this.playerArtist) this.playerArtist.innerText = track.artist || "Unknown Artist";
    if (this.totalTimeLabel) this.totalTimeLabel.innerText = track.duration_formatted || "3:30";

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
    if (stageArtist) stageArtist.innerText = track.artist || "Select a song to play";

    this.updateActiveRowHighlight();
  }

  updateActiveRowHighlight() {
    document.querySelectorAll(".track-row").forEach(row => {
      row.classList.toggle("active", this.currentTrack && row.dataset.trackId === this.currentTrack.id);
    });
  }

  // -------------------------------------------------------------
  // LYRICS ENGINE (STUDIO SYNCHRONIZED)
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
  // VIBE RADAR & MUSIC RECOMMENDATIONS
  // -------------------------------------------------------------
  async fetchVibeQueue(track) {
    try {
      const lang = encodeURIComponent(track.language || this.userProfile.languages[0] || 'Telugu');
      const res = await fetch(`${API_BASE}/api/recommendations?video_id=${track.id || track.videoId}&artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&language=${lang}`);
      const data = await res.json();
      this.vibeTracks = this.registerTracks(data.recommendations || []);
      
      this.renderSoundSyncPartySuggestions();
      
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
        <div class="hero-banner" style="background: linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 28px;">
          <div class="hero-content">
            <span class="hero-badge" style="color: var(--accent-cyan); border-color: var(--accent-cyan);">✦ AI ACOUSTIC VIBE MATRIX</span>
            <h1 class="hero-title">Vibe Radar Matrix</h1>
            <p class="hero-desc">Discover kindred acoustic harmonies, matching BPM frequencies, and AI-predicted music clusters.</p>
            <div class="hero-actions">
              <button class="btn-luxury btn-gold-action" id="vibe-launch-trending-btn">🚀 Ignite Radar with Trending Hits</button>
            </div>
          </div>
        </div>
        <div style="text-align: center; padding: 40px; color: var(--silver-muted);">
          <div style="font-size: 32px; margin-bottom: 10px;">📡</div>
          <div>Play any song to activate real-time acoustic matching.</div>
        </div>
      `;

      const launchBtn = document.getElementById("vibe-launch-trending-btn");
      if (launchBtn) {
        launchBtn.onclick = async () => {
          const res = await fetch(`${API_BASE}/api/search?q=Trending%20India%20Hits&limit=20`);
          const data = await res.json();
          const tracks = this.registerTracks(data.tracks || data.results || []);
          if (tracks.length > 0) {
            this.setQueue(tracks, 0);
            this.playTrack(tracks[0]);
            this.loadVibeStationView();
          }
        };
      }
      return;
    }

    const currentThumb = this.currentTrack.image || this.currentTrack.thumbnail || '/static/assets/logo.png';
    const trackList = this.vibeTracks || [];

    container.innerHTML = `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 28px;">
        <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          <img src="${currentThumb}" onerror="this.src='/static/assets/logo.png'" style="width: 100px; height: 100px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.7), 0 0 20px rgba(34, 211, 238, 0.35);">
          <div class="hero-content">
            <span class="hero-badge" style="color: var(--accent-cyan); border-color: var(--accent-cyan);">✦ AI ACOUSTIC VIBE RADAR</span>
            <h1 class="hero-title" style="font-size: 26px;">${this.escapeHTML(this.currentTrack.title)}</h1>
            <p class="hero-desc">${this.escapeHTML(this.currentTrack.artist)} • ${this.currentTrack.album || ''} • Kindred frequency matching in ${this.currentTrack.language || 'Telugu'}</p>
            <div class="hero-actions" style="margin-top: 14px;">
              <button class="btn-luxury btn-gold-action" id="vibe-play-all-btn">▶ Play All (${trackList.length} Tracks)</button>
              <button class="btn-luxury" id="vibe-shuffle-all-btn">🔀 Shuffle Radar</button>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 16px; font-size: 16px; font-weight: 700; color: #FFFFFF; display: flex; justify-content: space-between; align-items: center;">
        <span>✦ Kindred Soundtracks, Artists & Genre Hits (${trackList.length})</span>
        <span class="brand-tag" style="border-color: var(--accent-cyan); color: var(--accent-cyan);">98% MATCH</span>
      </div>

      <div class="cards-grid">
        ${trackList.map(t => this.renderMusicCardHTML(t)).join("")}
      </div>
    `;

    const playAllBtn = document.getElementById("vibe-play-all-btn");
    if (playAllBtn && trackList.length > 0) {
      playAllBtn.onclick = () => {
        this.setQueue(trackList, 0);
        this.playTrack(trackList[0]);
      };
    }

    const shuffleAllBtn = document.getElementById("vibe-shuffle-all-btn");
    if (shuffleAllBtn && trackList.length > 0) {
      shuffleAllBtn.onclick = () => {
        this.isShuffle = true;
        this.setQueue(trackList, 0);
        this.playTrack(trackList[Math.floor(Math.random() * trackList.length)]);
      };
    }

    container.querySelectorAll(".music-card").forEach((card, idx) => {
      card.addEventListener("click", () => {
        const track = trackList[idx];
        if (track) {
          this.setQueue(trackList, idx);
          this.playTrack(track);
        }
      });
    });
  }

  // -------------------------------------------------------------
  // LIKED SONGS & LIBRARY
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
    this.updateBrowserMediaNotification();
    this.showToast(isLiked ? `❤️ Saved "${track.title}" to Liked` : `🤍 Removed "${track.title}" from Liked`);

    fetch(`${API_BASE}/api/library/likes/toggle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(track)
    }).catch(() => {});
  }

  updateLikesBadge(count) {
    const badge = document.getElementById("likes-badge");
    if (badge) badge.innerText = count;
  }

  updatePlaylistsBadge(count) {
    const badge = document.getElementById("playlists-badge");
    if (badge) badge.innerText = count;
  }

  loadCollectionView() {
    const container = document.getElementById("collection-hub-container");
    if (!container) return;

    const liked = this.storage.getLikedTracks();
    const playlists = this.storage.getPlaylists();
    const history = this.storage.getHistory(30);

    let html = `
      <div class="collection-hub-wrapper">
        <div class="collection-header">
          <div class="hero-badge" style="color: var(--gold-accent); border-color: rgba(245, 197, 66, 0.35); margin-bottom: 8px;">✦ YOUR PERSONAL VAULT</div>
          <h1 class="collection-title">Music Collection</h1>
          <p class="collection-desc">${liked.length} Favorites • ${playlists.length} Playlists • ${history.length} Recently Played</p>
        </div>

        <div class="collection-cards-grid">
          <!-- 1. Favorites / Liked Card -->
          <div class="collection-hub-card card-favorites" id="col-card-liked">
            <div class="col-card-icon-wrap" style="background: rgba(239, 68, 68, 0.15); color: #EF4444;">
              ❤️
            </div>
            <div class="col-card-body">
              <div class="col-card-badge" style="color: #EF4444;">${liked.length} TRACKS</div>
              <h2 class="col-card-title">Liked Songs</h2>
              <p class="col-card-sub">Your personal hall of fame. All tracks you have hearted across stations.</p>
              <div class="col-card-actions">
                <button class="btn-luxury btn-gold-action" id="col-open-liked-btn">Open Favorites →</button>
                ${liked.length > 0 ? `<button class="btn-luxury" id="col-play-liked-btn" style="padding: 8px 12px;">▶ Play All</button>` : ''}
              </div>
            </div>
          </div>

          <!-- 2. Custom Playlists Card -->
          <div class="collection-hub-card card-playlists" id="col-card-playlists">
            <div class="col-card-icon-wrap" style="background: rgba(168, 85, 247, 0.15); color: #A855F7;">
              📁
            </div>
            <div class="col-card-body">
              <div class="col-card-badge" style="color: #A855F7;">${playlists.length} PLAYLISTS</div>
              <h2 class="col-card-title">My Playlists</h2>
              <p class="col-card-sub">Custom acoustic vibe curations, Spotify/JioSaavn imports, and JSON backups.</p>
              <div class="col-card-actions">
                <button class="btn-luxury" id="col-open-playlists-btn" style="border-color: rgba(168, 85, 247, 0.4); color: #A855F7;">Open Playlists →</button>
                <button class="btn-luxury btn-gold-action" id="col-create-playlist-btn" style="padding: 8px 12px;">➕ New</button>
              </div>
            </div>
          </div>

          <!-- 3. History Card -->
          <div class="collection-hub-card card-history" id="col-card-history">
            <div class="col-card-icon-wrap" style="background: rgba(34, 211, 238, 0.15); color: #22D3EE;">
              🕒
            </div>
            <div class="col-card-body">
              <div class="col-card-badge" style="color: #22D3EE;">${history.length} PLAYED</div>
              <h2 class="col-card-title">Listening History</h2>
              <p class="col-card-sub">Trace your listening timeline and rediscover tracks played across sessions.</p>
              <div class="col-card-actions">
                <button class="btn-luxury" id="col-open-history-btn" style="border-color: rgba(34, 211, 238, 0.4); color: #22D3EE;">View History →</button>
                ${history.length > 0 ? `<button class="btn-luxury" id="col-clear-history-btn" style="padding: 8px 12px; color: #EF4444;">Clear</button>` : ''}
              </div>
            </div>
          </div>
        </div>

        ${playlists.length > 0 ? `
          <div style="margin-top: 32px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
              <h3 style="font-size: 16px; font-weight: 700; color: #fff;">Your Playlists Quick Access</h3>
              <button class="btn-luxury" id="col-see-all-playlists-btn" style="padding: 4px 10px; font-size: 11px;">See All</button>
            </div>
            <div class="playlists-grid">
              ${playlists.slice(0, 4).map(pl => {
                const first = pl.tracks && pl.tracks[0];
                const cover = pl.cover_url || (first ? (first.image || first.thumbnail) : '/static/assets/logo.png');
                return `
                  <div class="playlist-card" data-col-pl-id="${pl.id}" style="cursor: pointer;">
                    <div class="card-img-wrapper" style="position: relative; aspect-ratio: 1; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 10px;">
                      <img src="${cover}" onerror="this.src='/static/assets/logo.png'" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <div style="font-weight: 700; font-size: 13px; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHTML(pl.name)}</div>
                    <div style="font-size: 11px; color: var(--silver-muted); margin-top: 4px;">${(pl.tracks || []).length} tracks</div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = html;

    // Attach Action Listeners
    const openLikedBtn = document.getElementById("col-open-liked-btn");
    if (openLikedBtn) openLikedBtn.onclick = () => this.switchView("liked");

    const playLikedBtn = document.getElementById("col-play-liked-btn");
    if (playLikedBtn && liked.length > 0) {
      playLikedBtn.onclick = () => {
        this.setQueue(liked, 0);
        this.playTrack(liked[0]);
      };
    }

    const openPlBtn = document.getElementById("col-open-playlists-btn");
    if (openPlBtn) openPlBtn.onclick = () => this.switchView("playlists");

    const seeAllPlBtn = document.getElementById("col-see-all-playlists-btn");
    if (seeAllPlBtn) seeAllPlBtn.onclick = () => this.switchView("playlists");

    const createPlBtn = document.getElementById("col-create-playlist-btn");
    if (createPlBtn) createPlBtn.onclick = () => this.openCreatePlaylistModal();

    const openHistBtn = document.getElementById("col-open-history-btn");
    if (openHistBtn) openHistBtn.onclick = () => this.switchView("history");

    const clearHistBtn = document.getElementById("col-clear-history-btn");
    if (clearHistBtn) {
      clearHistBtn.onclick = () => {
        if (confirm("Clear your listening history?")) {
          this.storage.clearHistory();
          this.loadCollectionView();
          this.showToast("History cleared");
        }
      };
    }

    container.querySelectorAll('[data-col-pl-id]').forEach(card => {
      card.onclick = () => {
        const plId = card.getAttribute('data-col-pl-id');
        if (plId) this.loadPlaylistDetailView(plId);
      };
    });
  }

  loadLikedView() {
    const container = document.getElementById("liked-songs-container");
    if (!container) return;

    const likes = this.registerTracks(this.storage.getLikedTracks());

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
              <td>${t.duration_formatted || '3:30'}</td>
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
          <button class="btn-luxury btn-danger-action" id="clear-history-btn">Clear History</button>
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
              <td>${t.duration_formatted || '3:30'}</td>
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
        this.showToast("🗑️ Cleared listening history");
      });
    }
  }

  // -------------------------------------------------------------
  // CUSTOM PLAYLISTS (MANUAL, LINK IMPORT, & JSON EXPORT/IMPORT)
  // -------------------------------------------------------------
  loadPlaylistsView() {
    const container = document.getElementById("playlists-container");
    if (!container) return;

    this.playlists = this.storage.getPlaylists();

    let html = `
      <div class="playlists-header">
        <div>
          <h2 style="font-size: 24px; font-weight: 800;">My Playlists</h2>
          <p style="font-size: 13px; color: var(--silver-muted);">${this.playlists.length} playlists stored on this device</p>
        </div>
        <div class="playlists-action-buttons">
          <button class="btn-luxury btn-gold-action" id="create-new-playlist-btn">
            <span>➕</span>
            <span>Create Playlist</span>
          </button>
          <button class="btn-luxury" id="import-playlist-link-btn" style="border-color: rgba(34, 211, 238, 0.4); color: var(--accent-cyan);">
            <span>🔗</span>
            <span>Import via Link (Spotify / JioSaavn)</span>
          </button>
          <button class="btn-luxury" id="import-playlist-json-btn">
            <span>📤</span>
            <span>Import JSON</span>
          </button>
        </div>
      </div>
    `;

    if (this.playlists.length === 0) {
      html += `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted); background: rgba(18, 18, 26, 0.5); border-radius: var(--radius-lg); border: 1px dashed rgba(255,255,255,0.1);">
          <div style="font-size: 40px; margin-bottom: 14px;">📁</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">No Playlists Created Yet</div>
          <p style="font-size: 13.5px; max-width: 480px; margin: 0 auto 20px; color: var(--silver-muted);">
            Create a custom playlist manually, import any public playlist from Spotify or JioSaavn, or restore an Oxyzen JSON playlist!
          </p>
          <div style="display: flex; justify-content: center; gap: 12px; flex-wrap: wrap;">
            <button class="btn-luxury btn-gold-action" onclick="window.oxyzenApp.openCreatePlaylistModal()">➕ Create Manually</button>
            <button class="btn-luxury" onclick="window.oxyzenApp.openImportPlaylistModal()">🔗 Import from Spotify / JioSaavn</button>
          </div>
        </div>
      `;
    } else {
      html += `
        <div class="playlists-grid">
          ${this.playlists.map(pl => {
            const firstTrack = pl.tracks && pl.tracks[0];
            const cover = pl.cover_url || (firstTrack ? (firstTrack.image || firstTrack.thumbnail) : '/static/assets/logo.png');
            return `
              <div class="playlist-card" data-pl-id="${pl.id}">
                <div class="card-img-wrapper" style="position: relative; aspect-ratio: 1; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 12px;">
                  <img src="${cover}" onerror="this.src='/static/assets/logo.png'" style="width: 100%; height: 100%; object-fit: cover;">
                  <button class="card-play-btn" data-action="play-pl" data-pl-id="${pl.id}">▶</button>
                </div>
                <div style="font-weight: 700; font-size: 14px; color: #fff; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHTML(pl.name)}</div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--silver-muted); margin-top: 6px;">
                  <span>${(pl.tracks || []).length} tracks</span>
                  <button class="btn-row-action" data-action="export-pl" data-pl-id="${pl.id}" title="Export Playlist (.json)" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; background: rgba(255,255,255,0.06);">📥 Export</button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    container.innerHTML = html;

    const createBtn = document.getElementById("create-new-playlist-btn");
    if (createBtn) {
      createBtn.addEventListener("click", () => this.openCreatePlaylistModal());
    }

    const importLinkBtn = document.getElementById("import-playlist-link-btn");
    if (importLinkBtn) {
      importLinkBtn.addEventListener("click", () => this.openImportPlaylistModal());
    }

    const importJsonBtn = document.getElementById("import-playlist-json-btn");
    if (importJsonBtn) {
      importJsonBtn.addEventListener("click", () => {
        const fileInput = document.getElementById("playlist-import-json-input");
        if (fileInput) fileInput.click();
      });
    }

    container.querySelectorAll(".playlist-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest('[data-action="export-pl"]')) {
          e.stopPropagation();
          const plId = e.target.closest('[data-action="export-pl"]').dataset.plId;
          if (this.storage.exportPlaylistToFile(plId)) {
            this.showToast("📥 Exported playlist as .json");
          }
          return;
        }
        if (e.target.closest('[data-action="play-pl"]')) {
          e.stopPropagation();
          const plId = card.dataset.plId;
          const pl = this.storage.getPlaylist(plId);
          if (pl && pl.tracks && pl.tracks.length > 0) {
            this.setQueue(pl.tracks, 0);
            this.playTrack(pl.tracks[0]);
          }
          return;
        }
        const plId = card.dataset.plId;
        this.loadPlaylistDetailView(plId);
      });
    });
  }

  loadPlaylistDetailView(playlistId, pushHistory = true) {
    const pl = this.storage.getPlaylist(playlistId);
    if (!pl) return;

    if (pushHistory) {
      try {
        history.pushState({ view: "playlist-detail", plId: playlistId }, "", `#playlist-${playlistId}`);
      } catch (e) {}
    }

    this.switchView("playlist-detail", false);
    const container = document.getElementById("playlist-detail-container");
    if (!container) return;

    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const mainContent = document.getElementById("main-content");
    if (mainContent) mainContent.scrollTop = 0;
    const targetView = document.getElementById("view-playlist-detail");
    if (targetView) targetView.scrollTop = 0;

    const tracks = this.registerTracks(pl.tracks || []);
    const firstTrack = tracks[0];
    const cover = pl.cover_url || (firstTrack ? (firstTrack.image || firstTrack.thumbnail) : '/static/assets/logo.png');

    let html = `
      <div style="margin-bottom: 20px;">
        <button class="btn-luxury" id="playlist-back-btn" style="padding: 6px 12px; font-size: 12px;">← Back to Playlists</button>
      </div>
      <div class="hero-banner playlist-detail-hero" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 28px;">
        <div class="playlist-hero-inner">
          <img class="playlist-detail-cover" src="${cover}" onerror="this.src='/static/assets/logo.png'">
          <div class="hero-content playlist-hero-content">
            <span class="hero-badge" style="color: #A855F7; border-color: rgba(168, 85, 247, 0.3);">PLAYLIST</span>
            <h1 class="hero-title playlist-title-text" style="font-size: 28px;">${this.escapeHTML(pl.name)}</h1>
            <p class="hero-desc">${this.escapeHTML(pl.description || '')} • ${tracks.length} lossless tracks</p>
            <div class="hero-actions playlist-hero-actions">
              <button class="btn-luxury btn-gold-action" id="pl-detail-play-btn">▶ Play All</button>
              <button class="btn-luxury" id="pl-detail-shuffle-btn">🔀 Shuffle</button>
              <button class="btn-luxury" id="pl-detail-export-btn">📥 Export JSON</button>
              <button class="btn-luxury" id="pl-detail-rename-btn">✏️ Rename</button>
              <button class="btn-luxury btn-danger-action" id="pl-detail-delete-btn">🗑️ Delete</button>
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
                    <div class="row-title">${this.escapeHTML(t.title)}</div>
                    <div class="row-artist">${this.escapeHTML(t.artist)}</div>
                  </div>
                </td>
                <td>${this.escapeHTML(t.album || 'Oxyzen Audio')}</td>
                <td>${t.duration_formatted || '3:30'}</td>
                <td style="text-align: right;">
                  <div class="row-actions">
                    <button class="btn-row-action ${this.storage.isLiked(t.id) ? 'liked' : ''}" data-action="like" data-track-id="${t.id}" title="Like">
                      ${this.storage.isLiked(t.id) ? '❤️' : '🤍'}
                    </button>
                    <button class="btn-row-action" data-action="add-queue" data-track-id="${t.id}" title="Add to Queue">➕</button>
                    <button class="btn-row-action" data-action="remove-from-playlist" data-track-id="${t.id}" title="Remove from Playlist" style="color: #EF4444;">✕</button>
                    <button class="btn-row-action" data-action="download" data-track-id="${t.id}" title="Download">⬇️</button>
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
    if (backBtn) backBtn.addEventListener("click", () => {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        this.switchView("playlists");
      }
    });

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

    const exportBtn = document.getElementById("pl-detail-export-btn");
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        if (this.storage.exportPlaylistToFile(playlistId)) {
          this.showToast(`📥 Exported "${pl.name}" as JSON`);
        }
      });
    }

    const renameBtn = document.getElementById("pl-detail-rename-btn");
    if (renameBtn) {
      renameBtn.addEventListener("click", () => {
        const newName = prompt("Enter new playlist name:", pl.name);
        if (newName && newName.trim()) {
          this.storage.updatePlaylist(playlistId, { name: newName.trim() });
          this.loadPlaylistDetailView(playlistId, false);
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
        this.loadPlaylistDetailView(playlistId, false);
        this.showToast("Removed track from playlist");
      });
    });
  }

  openImportPlaylistModal(pushHistory = true) {
    const modal = document.getElementById("import-playlist-modal");
    const urlInput = document.getElementById("import-playlist-url-input");
    const statusDiv = document.getElementById("import-playlist-status");
    const submitBtn = document.getElementById("import-playlist-submit-btn");
    const cancelBtn = document.getElementById("import-playlist-cancel-btn");
    const closeBtn = document.getElementById("import-playlist-close-btn");

    if (!modal) return;
    if (urlInput) urlInput.value = "";
    if (statusDiv) {
      statusDiv.style.display = "none";
      statusDiv.innerHTML = "";
    }

    modal.classList.add("active");
    if (pushHistory) {
      try { history.pushState({ modal: "import-playlist" }, "", location.hash); } catch(e) {}
    }
    if (urlInput) urlInput.focus();

    const closeModal = () => modal.classList.remove("active");
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    if (submitBtn) {
      submitBtn.onclick = async () => {
        const url = urlInput ? urlInput.value.trim() : "";
        if (!url) {
          if (statusDiv) {
            statusDiv.style.display = "block";
            statusDiv.style.color = "#EF4444";
            statusDiv.innerText = "Please paste a valid Spotify or JioSaavn playlist/album URL.";
          }
          return;
        }

        submitBtn.disabled = true;
        if (statusDiv) {
          statusDiv.style.display = "block";
          statusDiv.style.color = "var(--gold-accent)";
          statusDiv.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="sync-spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>
              <span>Resolving tracks and converting audio streams...</span>
            </div>
          `;
        }

        try {
          const res = await fetch(`${API_BASE}/api/playlist/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url })
          });
          const data = await res.json();

          if (!res.ok || !data.success) {
            throw new Error(data.error || "Failed to import playlist");
          }

          // Register tracks and save playlist
          const importedTracks = this.registerTracks(data.tracks || []);
          const newPl = this.storage.createPlaylist(data.name, data.description, data.cover_url);
          for (const t of importedTracks) {
            this.storage.addTrackToPlaylist(newPl.id, t);
          }

          closeModal();
          this.showToast(`🎉 Imported "${data.name}" with ${importedTracks.length} tracks!`);
          this.loadPlaylistDetailView(newPl.id);
        } catch (err) {
          if (statusDiv) {
            statusDiv.style.display = "block";
            statusDiv.style.color = "#EF4444";
            statusDiv.innerText = `Import failed: ${err.message}`;
          }
        } finally {
          submitBtn.disabled = false;
        }
      };
    }
  }

  setupPlaylistImportListeners() {
    const fileInput = document.getElementById("playlist-import-json-input");
    if (!fileInput) return;

    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const result = this.storage.importBackupData(event.target.result);
          if (result.success) {
            this.showToast(`📥 ${result.message}`);
            if (result.playlist) {
              this.loadPlaylistDetailView(result.playlist.id);
            } else if (this.activeView === "playlists") {
              this.loadPlaylistsView();
            }
          } else {
            this.showToast(`⚠️ ${result.message}`);
          }
        } catch (err) {
          this.showToast(`⚠️ Import error: ${err.message}`);
        }
        fileInput.value = "";
      };
      reader.readAsText(file);
    });
  }

  openCreatePlaylistModal(trackToAdd = null, pushHistory = true) {
    const modal = document.getElementById("create-playlist-modal");
    const nameInput = document.getElementById("new-playlist-name-input");
    const descInput = document.getElementById("new-playlist-desc-input");
    const submitBtn = document.getElementById("create-playlist-submit-btn");
    const closeBtn = document.getElementById("create-playlist-close-btn");

    if (!modal) return;
    if (nameInput) nameInput.value = "";
    if (descInput) descInput.value = "";

    modal.classList.add("active");
    if (pushHistory) {
      try { history.pushState({ modal: "create-playlist" }, "", location.hash); } catch(e) {}
    }
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

  openAddToPlaylistModal(track, pushHistory = true) {
    if (!track) return;
    const modal = document.getElementById("add-to-playlist-modal");
    const listContainer = document.getElementById("add-to-playlist-list");
    const closeBtn = document.getElementById("add-to-playlist-close-btn");
    const quickCreateBtn = document.getElementById("modal-quick-create-playlist-btn");

    if (!modal || !listContainer) return;
    modal.classList.add("active");
    if (pushHistory) {
      try { history.pushState({ modal: "add-playlist" }, "", location.hash); } catch(e) {}
    }

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
  // SOUNDSYNC SPACE WITH SONG REQUESTS & AUTO-SYNC
  // -------------------------------------------------------------
  setupSoundSyncSpaceUI() {
    // Avatar Selectors
    const hostPicker = document.getElementById("host-avatar-picker");
    if (hostPicker) {
      hostPicker.querySelectorAll(".sync-avatar-btn").forEach(opt => {
        opt.addEventListener("click", () => {
          hostPicker.querySelectorAll(".sync-avatar-btn").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");
          this.selectedHostAvatar = opt.dataset.avatar || "👑";
        });
      });
    }

    const listenerPicker = document.getElementById("listener-avatar-picker");
    if (listenerPicker) {
      listenerPicker.querySelectorAll(".sync-avatar-btn").forEach(opt => {
        opt.addEventListener("click", () => {
          listenerPicker.querySelectorAll(".sync-avatar-btn").forEach(o => o.classList.remove("active"));
          opt.classList.add("active");
          this.selectedListenerAvatar = opt.dataset.avatar || "🎧";
        });
      });
    }

    // Launch Host Lounge
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

    // Join Listener Lounge
    const joinEnterBtn = document.getElementById("sync-join-enter-btn");
    if (joinEnterBtn) {
      joinEnterBtn.addEventListener("click", async () => {
        const codeInput = document.getElementById("sync-join-code-input");
        const nameInput = document.getElementById("sync-listener-name-input");
        const code = codeInput ? codeInput.value.trim().toUpperCase() : "";
        const name = (nameInput && nameInput.value.trim()) || this.userProfile.name || "Listener";

        if (!code || code.length < 3) {
          this.showToast("⚠️ Please enter a valid room code");
          return;
        }

        try {
          const res = await fetch(`${API_BASE}/api/rooms/${code}`);
          if (!res.ok) {
            this.showToast(`❌ Lounge "${code}" not found.`);
            return;
          }
          const roomData = await res.json();
          this.sync.setProfile(name, this.selectedListenerAvatar);
          this.sync.joinRoom(code, roomData.room_name);
        } catch (e) {
          this.showToast(`❌ Failed to connect to room "${code}"`);
        }
      });
    }

    // Copy Code Button & Pill
    const copyCodeBtn = document.getElementById("sync-copy-code-btn");
    const codeBadge = document.getElementById("room-code-badge");
    const codePill = document.getElementById("sync-code-pill");

    const triggerCopyCode = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      this.copyRoomCode();
    };

    if (copyCodeBtn) copyCodeBtn.addEventListener("click", triggerCopyCode);
    if (codeBadge) codeBadge.addEventListener("click", triggerCopyCode);
    if (codePill) codePill.addEventListener("click", triggerCopyCode);

    // Leave Room Button
    const leaveBtn = document.getElementById("sync-space-leave-btn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        this.sync.leaveRoom();
        this.clearChatStream();
        this.renderSoundSyncSpace();
        this.showToast("🚪 Left SoundSync Room");
      });
    }

    // Autoplay Unlock Prompt Banner
    const autoplayBanner = document.getElementById("sync-autoplay-banner");
    if (autoplayBanner) {
      autoplayBanner.onclick = () => {
        this.audio.ensureContextActive();
        if (this.currentTrack) {
          this.audio.play().then(() => {
            autoplayBanner.style.display = "none";
          }).catch(() => {});
        } else {
          autoplayBanner.style.display = "none";
        }
      };
    }

    // In-Room Search & Track Selector
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
          this.renderInroomSearchResults(data.tracks || data.results || []);
        } catch (e) {
          if (resultsBox) resultsBox.innerHTML = `<div style="color: #EF4444;">Search failed</div>`;
        }
      };

      inroomSearchBtn.addEventListener("click", executeInroomSearch);
      inroomSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") executeInroomSearch();
      });
    }

    // Stage Controls
    const syncPlayBtn = document.getElementById("sync-ctrl-play");
    if (syncPlayBtn) syncPlayBtn.addEventListener("click", () => this.togglePlayPause());
    const syncNextBtn = document.getElementById("sync-ctrl-next");
    if (syncNextBtn) syncNextBtn.addEventListener("click", () => this.playNext());
    const syncPrevBtn = document.getElementById("sync-ctrl-prev");
    if (syncPrevBtn) syncPrevBtn.addEventListener("click", () => this.playPrevious());

    // Live Chat & Typing State
    const chatForm = document.getElementById("sync-chat-form");
    const chatInput = document.getElementById("sync-chat-input");
    if (chatForm && chatInput) {
      let typingTimeout = null;
      let isTyping = false;

      chatInput.addEventListener("input", () => {
        if (!isTyping) {
          isTyping = true;
          this.sync.sendTyping(true);
        }
        if (typingTimeout) clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
          isTyping = false;
          this.sync.sendTyping(false);
        }, 2200);
      });

      chatInput.addEventListener("blur", () => {
        if (isTyping) {
          isTyping = false;
          if (typingTimeout) clearTimeout(typingTimeout);
          this.sync.sendTyping(false);
        }
      });

      chatForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) {
          if (isTyping) {
            isTyping = false;
            if (typingTimeout) clearTimeout(typingTimeout);
            this.sync.sendTyping(false);
          }
          this.sync.sendChat(text);
          chatInput.value = "";
        }
      });
    }

    // Floating Reaction Emojis
    document.querySelectorAll(".sync-emoji-bubble").forEach(btn => {
      btn.addEventListener("click", () => {
        const emoji = btn.dataset.emoji || "🔥";
        this.sync.sendReaction(emoji);
        this.spawnReactionParticle(emoji);
      });
    });

    // Global Sync WebSocket Event Handlers
    window.addEventListener("oxyzen:sync_connected", (e) => {
      this.clearChatStream();
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
        this.audio.loadAndPlay(reg, currentTime).catch(() => {
          const banner = document.getElementById("sync-autoplay-banner");
          if (banner) banner.style.display = "flex";
        });
      } else {
        if (Math.abs(this.audio.audio.currentTime - currentTime) > 0.8) {
          this.audio.seek(currentTime);
        }
        if (isPlaying && !this.audio.isPlaying) {
          this.audio.play().catch(() => {
            const banner = document.getElementById("sync-autoplay-banner");
            if (banner) banner.style.display = "flex";
          });
        }
      }
      if (triggeredBy) {
        this.appendSystemNotice(`▶ Playing "${reg.title}"`);
      }
      this.renderSoundSyncSpace();
    });

    window.addEventListener("oxyzen:sync_play_state", (e) => {
      const { isPlaying, currentTime } = e.detail;
      if (Math.abs(this.audio.audio.currentTime - currentTime) > 0.8) {
        this.audio.seek(currentTime);
      }
      if (isPlaying) {
        this.audio.play().catch(() => {
          const banner = document.getElementById("sync-autoplay-banner");
          if (banner) banner.style.display = "flex";
        });
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
      this.appendSystemNotice(`🙋‍♂️ ${requester ? requester.name : 'A listener'} requested "${request.track.title}"`);
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

    window.addEventListener("oxyzen:sync_reset_chat", () => {
      this.clearChatStream();
    });

    window.addEventListener("oxyzen:sync_history", (e) => {
      this.clearChatStream();
      if (e.detail && Array.isArray(e.detail.chats)) {
        e.detail.chats.forEach(msg => this.appendChatMessage(msg));
      }
    });

    window.addEventListener("oxyzen:sync_chat", (e) => {
      this.appendChatMessage(e.detail);
    });

    window.addEventListener("oxyzen:sync_typing", (e) => {
      this.handleTypingIndicator(e.detail);
    });

    window.addEventListener("oxyzen:sync_user_joined", (e) => {
      this.appendSystemNotice(`✨ ${e.detail.name} joined the lounge`);
      this.renderSoundSyncListeners();
    });

    window.addEventListener("oxyzen:sync_user_left", (e) => {
      this.appendSystemNotice(`👋 ${e.detail.user_name} left`);
      this.renderSoundSyncListeners();
    });

    window.addEventListener("oxyzen:sync_host_changed", () => {
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

    const roomTitle = document.getElementById("room-display-name");
    if (roomTitle) roomTitle.innerText = this.sync.roomName || "SoundSync Lounge";

    const hostTag = document.getElementById("room-host-display");
    if (hostTag) {
      hostTag.innerText = this.sync.isHost ? "👑 Host: You (DJ Master)" : "👑 Host: Co-Host Active";
    }

    const myAvatar = document.getElementById("sync-my-avatar");
    const myName = document.getElementById("sync-my-name");
    if (myAvatar) myAvatar.innerText = this.sync.avatar || "🎧";
    if (myName) myName.innerText = this.sync.userName || "You";

    // Role Indicator
    const roleIndicator = document.getElementById("sync-role-indicator");
    if (roleIndicator) {
      if (this.sync.isHost) {
        roleIndicator.innerHTML = `<span>👑 Master DJ (You control playback & queue)</span>`;
      } else if (this.sync.isAdmin) {
        roleIndicator.innerHTML = `<span>🛡️ Co-Host Admin (You can play & manage songs)</span>`;
      } else {
        roleIndicator.innerHTML = `<span>🎧 Listener (Request songs to the DJ queue below)</span>`;
      }
    }

    this.renderSoundSyncListeners();
    this.renderSoundSyncRequests();
    this.renderSoundSyncQueue(this.sync.queue || []);
    this.renderSoundSyncPartySuggestions();
  }

  renderSoundSyncListeners() {
    const row = document.getElementById("sync-active-listeners-row");
    const badge = document.getElementById("sync-listener-count-badge");
    if (!row) return;

    const listeners = this.sync.listeners || [];
    if (badge) badge.innerText = listeners.length;

    row.innerHTML = listeners.map(l => {
      const isHost = l.is_host;
      const isAdmin = l.is_admin && !isHost;
      const isMe = (l.id === this.sync.userId);

      return `
        <div class="sync-listener-chip ${isHost ? 'host' : ''} ${isAdmin ? 'admin' : ''}" data-user-id="${l.id}">
          <span class="listener-avatar">${l.avatar || '🎧'}</span>
          <div class="listener-info">
            <span class="listener-name">${this.escapeHTML(l.name)} ${isMe ? '(You)' : ''}</span>
            <span class="listener-role-badge ${isHost ? 'role-host' : (isAdmin ? 'role-admin' : 'role-listener')}">
              ${isHost ? '👑 HOST' : (isAdmin ? '⚡ SUB-ADMIN' : '🎧 LISTENER')}
            </span>
          </div>
          ${(this.sync.isHost && !isHost && !isMe) ? `
            <div class="listener-admin-actions">
              ${isAdmin ? `
                <button class="btn-demote-admin" data-action="demote-admin" data-uid="${l.id}" title="Remove Sub-Admin role">✕ Demote</button>
              ` : `
                <button class="btn-promote-admin" data-action="promote-admin" data-uid="${l.id}" title="Promote to Sub-Admin (Can skip & queue songs)">⚡ Promote</button>
              `}
            </div>
          ` : ''}
        </div>
      `;
    }).join("");

    if (this.sync.isHost) {
      row.querySelectorAll('[data-action="promote-admin"]').forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const uid = btn.dataset.uid;
          if (uid) {
            this.sync.promoteAdmin(uid);
            this.showToast("⚡ Promoted user to Sub-Admin!");
          }
        });
      });

      row.querySelectorAll('[data-action="demote-admin"]').forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const uid = btn.dataset.uid;
          if (uid) {
            this.sync.demoteAdmin(uid);
            this.showToast("User demoted from Sub-Admin.");
          }
        });
      });
    }
  }

  renderSoundSyncRequests() {
    const card = document.getElementById("sync-requests-card");
    const list = document.getElementById("sync-requests-list");
    const countBadge = document.getElementById("sync-requests-count");

    const requests = this.sync.requests || [];
    if (countBadge) countBadge.innerText = requests.length;

    if (!card || !list) return;

    if (this.sync.isHost || this.sync.isAdmin) {
      card.style.display = requests.length > 0 ? "block" : "none";
    } else {
      card.style.display = "none";
      return;
    }

    list.innerHTML = requests.map(r => `
      <div class="sync-request-item" data-req-id="${r.id}" style="display: flex; align-items: center; gap: 10px; padding: 8px; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 6px;">
        <img src="${r.track.image || r.track.thumbnail || '/static/assets/logo.png'}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${r.track.title}</div>
          <div style="font-size: 11px; color: var(--silver-muted);">Requested by ${this.escapeHTML(r.requester_name || 'Listener')}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          <button class="btn-luxury btn-gold-action" data-action="accept-play" data-req-id="${r.id}" style="padding: 4px 8px; font-size: 11px;">▶ Play</button>
          <button class="btn-luxury" data-action="accept-queue" data-req-id="${r.id}" style="padding: 4px 8px; font-size: 11px;">➕ Queue</button>
          <button class="btn-row-action" data-action="dismiss" data-req-id="${r.id}" style="opacity: 1;">✕</button>
        </div>
      </div>
    `).join("");

    list.querySelectorAll('[data-action="accept-play"]').forEach(btn => {
      btn.addEventListener("click", () => {
        this.sync.acceptRequest(btn.dataset.reqId, true);
      });
    });

    list.querySelectorAll('[data-action="accept-queue"]').forEach(btn => {
      btn.addEventListener("click", () => {
        this.sync.acceptRequest(btn.dataset.reqId, false);
      });
    });

    list.querySelectorAll('[data-action="dismiss"]').forEach(btn => {
      btn.addEventListener("click", () => {
        this.sync.dismissRequest(btn.dataset.reqId);
      });
    });
  }

  renderInroomSearchResults(tracks) {
    const list = document.getElementById("sync-search-results-list");
    if (!list) return;

    if (!tracks || tracks.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); padding: 8px;">No songs found.</div>`;
      return;
    }

    const canControl = (this.sync.isHost || this.sync.isAdmin);

    list.innerHTML = tracks.map((t, idx) => `
      <div class="sync-inroom-row" data-idx="${idx}">
        <img src="${t.image || t.thumbnail || '/static/assets/logo.png'}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.title}</div>
          <div style="font-size: 11px; color: var(--silver-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.artist}</div>
        </div>
        <div style="display: flex; gap: 6px;">
          ${canControl ? `
            <button class="btn-luxury btn-gold-action" data-action="room-play" data-idx="${idx}" style="padding: 4px 8px; font-size: 11px;">▶ Play</button>
            <button class="btn-luxury" data-action="room-queue" data-idx="${idx}" style="padding: 4px 8px; font-size: 11px;">➕ Queue</button>
          ` : `
            <button class="btn-luxury btn-gold-action" data-action="room-request" data-idx="${idx}" style="padding: 4px 8px; font-size: 11px;">🙋‍♂️ Request</button>
          `}
        </div>
      </div>
    `).join("");

    list.querySelectorAll('[data-action="room-play"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const track = tracks[parseInt(btn.dataset.idx)];
        if (track) this.playTrack(track);
      });
    });

    list.querySelectorAll('[data-action="room-queue"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const track = tracks[parseInt(btn.dataset.idx)];
        if (track) this.sync.broadcastAddQueue(track);
      });
    });

    list.querySelectorAll('[data-action="room-request"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const track = tracks[parseInt(btn.dataset.idx)];
        if (track) {
          this.sync.requestSong(track);
          this.showToast(`🙋‍♂️ Submitted request for "${track.title}"`);
        }
      });
    });
  }

  renderSoundSyncQueue(queueList) {
    const list = document.getElementById("sync-room-queue-list");
    const countBadge = document.getElementById("sync-room-queue-count");
    if (!list) return;

    if (countBadge) countBadge.innerText = queueList.length;

    if (queueList.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); font-size: 13px; padding: 12px 0;">Queue is empty. Search and add tracks above!</div>`;
      return;
    }

    const canControl = (this.sync.isHost || this.sync.isAdmin);

    list.innerHTML = queueList.map((t, idx) => `
      <div class="sync-inroom-row" data-queue-idx="${idx}">
        <span style="font-size: 12px; font-weight: 800; color: var(--gold-accent); width: 20px;">#${idx + 1}</span>
        <img src="${t.image || t.thumbnail || '/static/assets/logo.png'}" style="width: 36px; height: 36px; border-radius: 6px; object-fit: cover;">
        <div style="flex: 1; min-width: 0;">
          <div style="font-size: 13px; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.title}</div>
          <div style="font-size: 11px; color: var(--silver-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${t.artist}</div>
        </div>
        ${canControl ? `
          <button class="btn-luxury btn-gold-action" data-action="play-queue-track" data-idx="${idx}" style="padding: 4px 8px; font-size: 11px;">▶ Play</button>
          <button class="btn-row-action" data-action="remove-queue-track" data-idx="${idx}" style="opacity: 1;">✕</button>
        ` : ''}
      </div>
    `).join("");

    if (canControl) {
      list.querySelectorAll('[data-action="play-queue-track"]').forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx);
          const track = queueList[idx];
          if (track) {
            this.playTrack(track);
            this.sync.broadcastRemoveQueue(idx);
          }
        });
      });

      list.querySelectorAll('[data-action="remove-queue-track"]').forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.idx);
          this.sync.broadcastRemoveQueue(idx);
        });
      });
    }
  }

  renderSoundSyncPartySuggestions() {
    const list = document.getElementById("sync-party-suggestions-list");
    if (!list) return;

    const tracks = (this.vibeTracks || []).slice(0, 8);
    if (tracks.length === 0) {
      list.innerHTML = `<div style="color: var(--silver-muted); font-size: 12px; padding: 10px 0;">Play a track to get live party recommendations.</div>`;
      return;
    }

    const canControl = (this.sync.isHost || this.sync.isAdmin);

    list.innerHTML = tracks.map((t, idx) => `
      <div class="sync-suggestion-item" data-idx="${idx}">
        <img src="${t.image || t.thumbnail || '/static/assets/logo.png'}" alt="Cover" class="sync-sugg-img">
        <div class="sync-sugg-meta">
          <div class="sync-sugg-title">${this.escapeHTML(t.title)}</div>
          <div class="sync-sugg-artist">${this.escapeHTML(t.artist)}</div>
        </div>
        <div class="sync-sugg-actions">
          ${canControl ? `
            <button class="btn-sugg-play" data-action="play-sugg" data-idx="${idx}" title="Play Now">▶</button>
            <button class="btn-sugg-queue" data-action="queue-sugg" data-idx="${idx}" title="Add to Queue">➕</button>
          ` : `
            <button class="btn-sugg-request" data-action="req-sugg" data-idx="${idx}" title="Request Track">🙋‍♂️</button>
          `}
        </div>
      </div>
    `).join("");

    list.querySelectorAll('[data-action="play-sugg"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = tracks[parseInt(btn.dataset.idx)];
        if (t) this.playTrack(t);
      });
    });

    list.querySelectorAll('[data-action="queue-sugg"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = tracks[parseInt(btn.dataset.idx)];
        if (t) {
          this.sync.broadcastAddQueue(t);
          this.showToast(`➕ Queued "${t.title}"`);
        }
      });
    });

    list.querySelectorAll('[data-action="req-sugg"]').forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = tracks[parseInt(btn.dataset.idx)];
        if (t) {
          this.sync.requestSong(t);
          this.showToast(`🙋‍♂️ Requested "${t.title}"`);
        }
      });
    });
  }

  appendChatMessage(msg) {
    const stream = document.getElementById("sync-chat-stream");
    if (!stream) return;

    // Hide typing indicator when chat message arrives
    const typingInd = document.getElementById("sync-typing-indicator");
    if (typingInd) typingInd.style.display = "none";
    if (this._typingHideTimer) {
      clearTimeout(this._typingHideTimer);
      this._typingHideTimer = null;
    }

    const isMine = (msg.user_id === this.sync.userId);
    const timeStr = new Date(msg.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const item = document.createElement("div");
    item.className = `sync-chat-item ${isMine ? 'mine' : 'other'}`;
    item.innerHTML = `
      <div class="sync-chat-user-header">
        ${isMine ? `
          <span style="font-weight: 400; font-size: 10px; opacity: 0.75; margin-right: auto;">${timeStr}</span>
          <span style="font-weight: 700; color: var(--gold-accent);">You</span>
          <span>${msg.avatar || '👑'}</span>
        ` : `
          <span>${msg.avatar || '🎧'}</span>
          <span style="font-weight: 700; color: var(--accent-cyan);">${this.escapeHTML(msg.user_name || 'Listener')}</span>
          <span style="font-weight: 400; font-size: 10px; margin-left: auto; opacity: 0.75;">${timeStr}</span>
        `}
      </div>
      <div class="sync-chat-msg-text">${this.escapeHTML(msg.text)}</div>
    `;

    stream.appendChild(item);
    stream.scrollTop = stream.scrollHeight;
  }

  handleTypingIndicator(detail) {
    const indicator = document.getElementById("sync-typing-indicator");
    const avatarEl = document.getElementById("typing-user-avatar");
    const textEl = document.getElementById("typing-user-text");
    if (!indicator) return;

    if (this._typingHideTimer) {
      clearTimeout(this._typingHideTimer);
      this._typingHideTimer = null;
    }

    if (detail && detail.is_typing) {
      if (avatarEl) avatarEl.innerText = detail.avatar || "🎧";
      if (textEl) textEl.innerText = `${detail.user_name || "Listener"} is typing`;
      indicator.style.display = "flex";

      // Auto-expire after 3.5s in case user disconnects or navigates away
      this._typingHideTimer = setTimeout(() => {
        indicator.style.display = "none";
      }, 3500);
    } else {
      indicator.style.display = "none";
    }
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

  clearChatStream() {
    const stream = document.getElementById("sync-chat-stream");
    if (stream) {
      stream.innerHTML = '<div class="chat-system-msg">Welcome to the SoundSync Lounge! Send messages or tap reactions below.</div>';
    }
    const indicator = document.getElementById("sync-typing-indicator");
    if (indicator) indicator.style.display = "none";
    if (this._typingHideTimer) {
      clearTimeout(this._typingHideTimer);
      this._typingHideTimer = null;
    }
  }

  copyRoomCode() {
    const code = (this.sync && this.sync.roomCode) || "";
    if (!code) {
      this.showToast("⚠️ No active room code to copy");
      return;
    }

    const onSuccess = () => {
      const btn = document.getElementById("sync-copy-code-btn");
      const pill = document.getElementById("sync-code-pill");
      if (btn) btn.innerText = "✅";
      if (pill) pill.classList.add("copied-pulse");
      setTimeout(() => {
        if (btn) btn.innerText = "📋";
        if (pill) pill.classList.remove("copied-pulse");
      }, 2000);
      this.showToast(`📋 Room Code "${code}" copied to clipboard!`);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code)
        .then(onSuccess)
        .catch(() => {
          this.fallbackCopyText(code, onSuccess);
        });
    } else {
      this.fallbackCopyText(code, onSuccess);
    }
  }

  fallbackCopyText(text, callback) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "0";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      if (successful) {
        if (callback) callback();
      } else {
        this.showToast(`Room ID: ${text}`);
      }
    } catch (err) {
      this.showToast(`Room ID: ${text}`);
    }
    document.body.removeChild(textArea);
  }

  // -------------------------------------------------------------
  // MOBILE BROWSER PERSISTENT MEDIA NOTIFICATION CONTROLLER
  // -------------------------------------------------------------
  initServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then((reg) => {
          console.info('Oxyzen Mobile Media ServiceWorker registered:', reg.scope);
        })
        .catch((err) => {
          console.warn('ServiceWorker registration error:', err);
        });

      navigator.serviceWorker.addEventListener('message', (event) => {
        if (!event.data) return;
        const action = event.data.type;
        if (action === 'PREV_TRACK') {
          this.playPrevious();
        } else if (action === 'TOGGLE_PLAY') {
          this.togglePlayPause();
        } else if (action === 'NEXT_TRACK') {
          this.playNext();
        } else if (action === 'LIKE_TRACK') {
          if (this.currentTrack) {
            this.toggleLikeTrack(this.currentTrack);
          }
        }
      });
    }

    // Connect Profile View Notification UI
    const statusEl = document.getElementById("notification-permission-status");
    const enableBtn = document.getElementById("enable-mobile-notification-btn");

    const updateStatusUI = () => {
      if (!('Notification' in window)) {
        if (statusEl) statusEl.innerText = "Native MediaSession Active (Lockscreen Controls Ready)";
        if (enableBtn) enableBtn.style.display = "none";
        return;
      }

      if (Notification.permission === 'granted') {
        if (statusEl) statusEl.innerHTML = "✅ Notification Bar Active (Change, Pause & Like ready in drawer)";
        if (enableBtn) {
          enableBtn.innerHTML = "<span>✅</span> <span>Notification Bar Active</span>";
          enableBtn.classList.remove("btn-gold-action");
          enableBtn.style.opacity = "0.85";
        }
      } else if (Notification.permission === 'denied') {
        if (statusEl) statusEl.innerText = "⚠️ Browser notifications blocked. Lockscreen controls active via MediaSession.";
        if (enableBtn) enableBtn.innerText = "Permission Blocked in Browser";
      } else {
        if (statusEl) statusEl.innerText = "Tap Enable to show persistent notification bar with Like & Play controls in phone drawer";
      }
    };

    updateStatusUI();

    if (enableBtn) {
      enableBtn.addEventListener("click", async () => {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          updateStatusUI();
          if (perm === 'granted') {
            this.showToast("🔔 Mobile notification controller enabled!");
            this.updateBrowserMediaNotification();
          } else {
            this.showToast("Media controls active via lockscreen MediaSession");
          }
        }
      });
    }
  }

  updateBrowserMediaNotification() {
    if (!this.currentTrack) return;
    const isLiked = this.likedIds ? this.likedIds.has(this.currentTrack.id) : false;
    const isPlaying = this.audio ? this.audio.isPlaying : false;

    // Send payload to Service Worker
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      if ('Notification' in window && Notification.permission === 'granted') {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_MEDIA_NOTIFICATION',
          title: this.currentTrack.title || 'Unknown Title',
          artist: this.currentTrack.artist || 'Unknown Artist',
          image: this.currentTrack.image || this.currentTrack.thumbnail || '/static/assets/logo.png',
          isPlaying: isPlaying,
          isLiked: isLiked
        });
      }
    }
  }

  clearBrowserMediaNotification() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'CLEAR_MEDIA_NOTIFICATION'
      });
    }
  }

  spawnReactionParticle(emoji) {
    const el = document.createElement("div");
    el.className = "floating-reaction";
    el.innerText = emoji;
    el.style.position = "fixed";
    el.style.fontSize = "28px";
    el.style.pointerEvents = "none";
    el.style.zIndex = "99999";
    el.style.left = `${Math.random() * 70 + 15}vw`;
    el.style.bottom = "120px";
    el.style.transition = "transform 1.8s ease-out, opacity 1.8s ease-out";
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.transform = `translateY(-180px) scale(1.4)`;
      el.style.opacity = "0";
    }, 20);
    setTimeout(() => el.remove(), 1900);
  }

  // -------------------------------------------------------------
  // CINEMA FULLSCREEN AMBIENT MODE
  // -------------------------------------------------------------
  toggleCinemaMode(enable = true, pushHistory = true) {
    if (!this.cinemaOverlay) return;
    this.cinemaOverlay.classList.toggle("active", enable);
    if (enable) {
      if (pushHistory) {
        try { history.pushState({ modal: "cinema" }, "", location.hash); } catch(e) {}
      }
      if (this.currentTrack) {
        this.updatePlayerDockUI(this.currentTrack);
        this.renderLyrics();
      }
      const handleBar = document.getElementById("mobile-drawer-handle-bar");
      if (handleBar && !handleBar._wired) {
        handleBar._wired = true;
        handleBar.addEventListener("click", () => this.toggleCinemaMode(false));
      }
    }
  }

  toggle8DMode() {
    const active = this.audio.toggle8D();
    if (this.spatial8DBtn) {
      this.spatial8DBtn.classList.toggle("active", active);
      this.spatial8DBtn.innerText = active ? "8D ON" : "8D";
    }
    if (this.cinemaSpatialBtn) {
      this.cinemaSpatialBtn.classList.toggle("active", active);
      this.cinemaSpatialBtn.innerText = active ? "8D SPATIAL ON" : "8D SPATIAL";
    }
    const toggle = document.getElementById("page-spatial-toggle");
    if (toggle) toggle.checked = active;
    this.showToast(active ? "🌐 8D Spatial Binaural Audio Enabled" : "Stereo Master Mode");
  }

  // -------------------------------------------------------------
  // OFFLINE DOWNLOAD
  // -------------------------------------------------------------
  downloadTrack(track) {
    this.showToast(`⬇️ Starting download for "${track.title}"...`);
    const downloadUrl = `${API_BASE}/api/download/${track.id}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${track.artist} - ${track.title}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // -------------------------------------------------------------
  // EQUALIZER STUDIO UI & RESPONSE CURVE VISUALIZER
  // -------------------------------------------------------------
  setupEqualizerUI() {
    const slidersContainer = document.getElementById("eq-sliders-container");
    const modal = document.getElementById("equalizer-modal");
    const closeBtn = document.getElementById("eq-close-btn");
    const openBtn = document.getElementById("eq-open-btn");
    const resetBtn = document.getElementById("eq-reset-btn");
    const spatialBtn = document.getElementById("eq-spatial-toggle-btn");
    const presetBadge = document.getElementById("eq-active-preset-badge");
    const curveCanvas = document.getElementById("eq-curve-canvas");

    if (!slidersContainer || !this.audio) return;

    if (closeBtn && modal) {
      closeBtn.addEventListener("click", () => modal.classList.remove("active"));
    }
    if (openBtn && modal) {
      openBtn.addEventListener("click", () => {
        modal.classList.add("active");
        drawCurve();
      });
    }

    const freqs = this.audio.eqFrequencies;

    // Draw Live Acoustic Response Curve
    const drawCurve = () => {
      if (!curveCanvas) return;
      const ctx = curveCanvas.getContext("2d");
      if (!ctx) return;

      const w = curveCanvas.width;
      const h = curveCanvas.height;
      ctx.clearRect(0, 0, w, h);

      // Draw Center 0dB Reference Grid
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const gains = freqs.map((_, i) => this.audio.getEqBandGain ? this.audio.getEqBandGain(i) : 0);
      const points = [];

      // Edge Padding Points
      points.push({ x: 0, y: h / 2 - (gains[0] / 12) * (h / 2 - 12) });

      freqs.forEach((_, i) => {
        const x = ((i + 0.5) / freqs.length) * w;
        const gain = gains[i] || 0;
        const y = h / 2 - (gain / 12) * (h / 2 - 12);
        points.push({ x, y });
      });

      points.push({ x: w, y: h / 2 - (gains[gains.length - 1] / 12) * (h / 2 - 12) });

      // Draw Spline Curve Fill
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(245, 197, 66, 0.35)");
      grad.addColorStop(0.5, "rgba(34, 211, 238, 0.15)");
      grad.addColorStop(1, "rgba(10, 10, 16, 0.0)");

      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Draw Glowing Stroke Curve
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length - 1; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
      ctx.strokeStyle = "#F5C542";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = "rgba(245, 197, 66, 0.6)";
      ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw Node Dots
      for (let i = 1; i <= freqs.length; i++) {
        const pt = points[i];
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = "#22D3EE";
        ctx.shadowColor = "#22D3EE";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    };

    // Render 10 Precision Vertical Faders
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
        if (label) {
          label.innerText = `${gain > 0 ? '+' : ''}${gain}dB`;
          label.style.color = gain > 0 ? 'var(--gold-accent)' : (gain < 0 ? 'var(--accent-cyan)' : 'var(--silver-muted)');
        }
        if (presetBadge) presetBadge.innerText = "PRESET: CUSTOM USER EQ";
        document.querySelectorAll(".eq-preset-chip").forEach(c => c.classList.remove("active"));
        drawCurve();
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
          if (label) {
            label.innerText = `${g > 0 ? '+' : ''}${g}dB`;
            label.style.color = g > 0 ? 'var(--gold-accent)' : (g < 0 ? 'var(--accent-cyan)' : 'var(--silver-muted)');
          }
        });
        if (presetBadge) presetBadge.innerText = `PRESET: ${chip.innerText.toUpperCase()}`;
        drawCurve();
        this.showToast(`🎛️ EQ Preset Applied: ${chip.innerText}`);
      });
    });

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const flatGains = this.audio.applyEqPreset("flat");
        flatGains.forEach((g, i) => {
          const slider = slidersContainer.querySelector(`[data-index="${i}"]`);
          if (slider) slider.value = 0;
          const label = document.getElementById(`eq-val-${i}`);
          if (label) {
            label.innerText = "0dB";
            label.style.color = "var(--silver-muted)";
          }
        });
        document.querySelectorAll(".eq-preset-chip").forEach(c => c.classList.toggle("active", c.dataset.preset === "flat"));
        if (presetBadge) presetBadge.innerText = "PRESET: FLAT STUDIO";
        drawCurve();
        this.showToast("🔄 Equalizer Reset to Flat Master Profile");
      });
    }

    if (spatialBtn) {
      spatialBtn.addEventListener("click", () => {
        const active = this.toggle8DMode();
        spatialBtn.innerText = active ? "Disable 8D Spatial" : "Enable 8D Spatial";
        spatialBtn.classList.toggle("btn-gold-action", active);
      });
    }

    // Initial curve draw
    setTimeout(drawCurve, 150);
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
          <img src="${t.image || t.thumbnail || '/static/assets/logo.png'}" onerror="this.src='/static/assets/logo.png'" style="width: 36px; height: 36px; border-radius: 4px; object-fit: cover;">
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
    slider.style.background = `linear-gradient(to right, var(--gold-accent) 0%, var(--gold-accent) ${percent}%, rgba(255, 255, 255, 0.12) ${percent}%, rgba(255, 255, 255, 0.12) 100%)`;
  }

  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
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
