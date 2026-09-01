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
      languages: JSON.parse(localStorage.getItem("oxyzen_user_languages") || '["English", "Telugu", "Hindi"]'),
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

    // Load Initial Data
    this.loadInitialData();
  }

  // -------------------------------------------------------------
  // DOM ELEMENT CACHING
  // -------------------------------------------------------------
  cacheDOMElements() {
    // Navigation
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

    // Profile Elements
    this.profileModal = document.getElementById("user-profile-modal");
    this.profileOpenBtn = document.getElementById("topbar-profile-btn");
    this.profileSidebarBtn = document.getElementById("sidebar-user-profile-btn");
    this.profileCloseBtn = document.getElementById("profile-close-btn");
    this.profileSaveBtn = document.getElementById("profile-save-btn");
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

  findTrackById(id) {
    if (!id) return null;
    return this.trackRegistry.get(String(id)) || null;
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
    // 1. Navigation clicks (Desktop Sidebar & Mobile Bottom Navigation)
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
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.style.transform = "translateX(50px)";
      
      this.updateActiveRowHighlight();
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
      const vinylDisc = document.getElementById("cinema-vinyl-disc");
      if (vinylDisc) vinylDisc.style.transform = "translateX(0px)";

      if (this.sync.connected && (this.sync.isHost || this.sync.isAdmin) && !this.sync.isRemoteUpdate) {
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
  }

  // -------------------------------------------------------------
  // VIEW SWITCHER & SPA NAVIGATION
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

      // Fetch explore feed
      const exploreRes = await fetch(`${API_BASE}/api/explore`).then(r => r.json()).catch(() => ({}));
      if (exploreRes && exploreRes.sections) {
        this.renderExploreFeed(exploreRes);
      }
    } catch (err) {
      console.warn("Error loading initial data:", err);
    }
  }

  // -------------------------------------------------------------
  // USER PROFILE & PREFERENCES
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
    if (sideAvatar) sideAvatar.innerText = avatar;
    if (sideName) sideName.innerText = name;
    if (sideLangs) sideLangs.innerText = langs.map(l => l.slice(0, 2).toUpperCase()).join(" • ");

    // Topbar
    const topAvatar = document.getElementById("topbar-avatar");
    const topName = document.getElementById("topbar-username");
    if (topAvatar) topAvatar.innerText = avatar;
    if (topName) topName.innerText = name.split(" ")[0] || name;

    // Moods subtitle
    const moodSub = document.getElementById("mood-hub-languages-desc");
    if (moodSub) {
      moodSub.innerText = `Curated emotional albums tailored to your preferred languages (${langs.join(", ")})`;
    }

    // Profile Modal inputs
    const modalAvatar = document.getElementById("profile-modal-avatar-preview");
    const nameInput = document.getElementById("profile-name-input");
    if (modalAvatar) modalAvatar.innerText = avatar;
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

    if (this.profileOpenBtn) this.profileOpenBtn.addEventListener("click", () => this.switchView("profile"));
    if (this.profileSidebarBtn) this.profileSidebarBtn.addEventListener("click", () => this.switchView("profile"));
    
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

    // Save profile from modal
    if (this.profileSaveBtn) {
      this.profileSaveBtn.addEventListener("click", async () => {
        const nameInput = document.getElementById("profile-name-input");
        const newName = (nameInput && nameInput.value.trim()) || "Oxyzen Listener";
        
        const selectedLangs = [];
        document.querySelectorAll(".lang-chip.active").forEach(chip => {
          if (chip.dataset.lang) selectedLangs.push(chip.dataset.lang);
        });

        this.userProfile.name = newName;
        this.userProfile.languages = selectedLangs.length > 0 ? selectedLangs : ["English", "Telugu", "Hindi"];

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

        if (this.activeView === "profile") {
          this.loadProfileView();
        }
      });
    }
  }

  loadProfileView() {
    const avatar = this.userProfile.avatar || "👑";
    const name = this.userProfile.name || "Oxyzen Listener";
    const langs = this.userProfile.languages || ["English", "Telugu", "Hindi"];

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

    // Customize Persona button
    const customizeBtn = document.getElementById("page-customize-persona-btn");
    if (customizeBtn) {
      customizeBtn.onclick = () => {
        if (this.profileModal) this.profileModal.classList.add("active");
      };
    }

    // Top Artists from history
    const artistCounts = {};
    history.forEach(t => {
      if (t.artist) {
        const primary = t.artist.split(",")[0].trim();
        artistCounts[primary] = (artistCounts[primary] || 0) + 1;
      }
    });

    const topArtistsRow = document.getElementById("page-top-artists-row");
    if (topArtistsRow) {
      const sortedArtists = Object.keys(artistCounts).sort((a, b) => artistCounts[b] - artistCounts[a]);
      if (sortedArtists.length > 0) {
        topArtistsRow.innerHTML = sortedArtists.slice(0, 8).map(art => `
          <div class="artist-pill" data-artist="${this.escapeHTML(art)}">
            <span>🎧</span>
            <span>${this.escapeHTML(art)}</span>
            <span style="font-size: 10px; opacity: 0.6; margin-left: 4px;">(${artistCounts[art]})</span>
          </div>
        `).join("");

        topArtistsRow.querySelectorAll(".artist-pill").forEach(pill => {
          pill.addEventListener("click", () => {
            const art = pill.dataset.artist;
            if (art && this.searchInput) {
              this.searchInput.value = art;
              this.switchView("search");
              this.performSearch(art);
            }
          });
        });
      }
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

    // Languages Grid on Page
    const pageLangsGrid = document.getElementById("page-languages-grid");
    if (pageLangsGrid) {
      pageLangsGrid.querySelectorAll(".lang-chip").forEach(chip => {
        chip.classList.toggle("active", langs.includes(chip.dataset.lang));
        chip.onclick = () => {
          chip.classList.toggle("active");
          const selected = [];
          pageLangsGrid.querySelectorAll(".lang-chip.active").forEach(c => {
            if (c.dataset.lang) selected.push(c.dataset.lang);
          });
          this.userProfile.languages = selected.length > 0 ? selected : ["English", "Telugu", "Hindi"];
          localStorage.setItem("oxyzen_user_languages", JSON.stringify(this.userProfile.languages));
          this.updateProfileUI();
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
          this.loadMoodStation(mId);
        });
      });

      // Default load love station
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
      <div style="text-align: center; padding: 40px; color: var(--silver-muted);">
        <div class="sync-spinner" style="margin: 0 auto 12px;"></div>
        <div>Loading Acoustic Mood Station...</div>
      </div>
    `;

    try {
      const langsParam = encodeURIComponent(this.userProfile.languages.join(","));
      const res = await fetch(`${API_BASE}/api/moods/${moodKey}?languages=${langsParam}`);
      const data = await res.json();
      const mood = data.mood || {};
      const tracks = this.registerTracks(data.tracks || []);

      if (tracks.length === 0) {
        container.innerHTML = `<div style="color: var(--silver-muted); padding: 40px; text-align: center;">No tracks found for this mood. Try changing preferred languages.</div>`;
        return;
      }

      container.innerHTML = `
        <div class="hero-banner" style="background: ${mood.gradient || 'linear-gradient(135deg, rgba(245, 197, 66, 0.2), rgba(17, 17, 21, 0.95))'}; margin-bottom: 24px;">
          <div class="hero-content">
            <span class="hero-badge" style="color: ${mood.color}; border-color: ${mood.color};">✦ ${mood.icon || '🎵'} ACTIVE MOOD STATION</span>
            <h1 class="hero-title">${mood.name || 'Mood Station'}</h1>
            <p class="hero-desc">${mood.tagline || ''} • Tailored for ${this.userProfile.languages.join(", ")} (${tracks.length} tracks)</p>
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

    // Attach click listeners with section queue context
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
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
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

    // Synced lyrics & vibe queue
    this.fetchLyrics(registered);
    this.fetchVibeQueue(registered);

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

      // Update Cinema Mode
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
      const res = await fetch(`${API_BASE}/api/recommendations?video_id=${track.id || track.videoId}&artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`);
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

    container.innerHTML = `
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 28px;">
        <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          <img src="${currentThumb}" onerror="this.src='/static/assets/logo.png'" style="width: 110px; height: 110px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.7), 0 0 20px rgba(34, 211, 238, 0.35);">
          <div class="hero-content">
            <span class="hero-badge" style="color: var(--accent-cyan); border-color: var(--accent-cyan);">✦ AI ACOUSTIC VIBE MATRIX</span>
            <h1 class="hero-title" style="font-size: 26px;">${this.currentTrack.title}</h1>
            <p class="hero-desc">${this.currentTrack.artist} • Frequency matched soundscapes and kindred harmonies</p>
            <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
              <span class="audio-mode-pill" style="border-color: rgba(34, 211, 238, 0.4); color: var(--accent-cyan);">98% Harmonic Match</span>
              <span class="audio-mode-pill">Energy: Peak Dynamic</span>
              <span class="audio-mode-pill">320k Lossless Stream</span>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-bottom: 16px; font-size: 16px; font-weight: 700; color: #FFFFFF;">
        ✦ Kindred Acoustic Recommendations (${(this.vibeTracks || []).length})
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
  // CUSTOM PLAYLISTS
  // -------------------------------------------------------------
  loadPlaylistsView() {
    const container = document.getElementById("playlists-container");
    if (!container) return;

    this.playlists = this.storage.getPlaylists();

    let html = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 style="font-size: 24px; font-weight: 800;">My Playlists</h2>
          <p style="font-size: 13px; color: var(--silver-muted);">${this.playlists.length} custom playlists stored on this device</p>
        </div>
        <button class="btn-luxury btn-gold-action" id="create-new-playlist-btn">
          <span>➕</span>
          <span>Create Playlist</span>
        </button>
      </div>
    `;

    if (this.playlists.length === 0) {
      html += `
        <div style="text-align: center; padding: 60px 0; color: var(--silver-muted);">
          <div style="font-size: 36px; margin-bottom: 14px;">📁</div>
          <div style="font-size: 20px; font-weight: 700; color: var(--silver-light); margin-bottom: 6px;">No Playlists Created Yet</div>
          <div>Create your first playlist and start building your personal sanctuary.</div>
        </div>
      `;
    } else {
      html += `
        <div class="cards-grid">
          ${this.playlists.map(pl => {
            const firstTrack = pl.tracks && pl.tracks[0];
            const cover = pl.cover_url || (firstTrack ? (firstTrack.image || firstTrack.thumbnail) : '/static/assets/logo.png');
            return `
              <div class="playlist-card" data-pl-id="${pl.id}" style="background: rgba(18, 18, 26, 0.85); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--radius-md); padding: 14px; cursor: pointer; transition: all 0.2s ease;">
                <div class="card-img-wrapper" style="position: relative; aspect-ratio: 1; border-radius: var(--radius-sm); overflow: hidden; margin-bottom: 12px;">
                  <img src="${cover}" onerror="this.src='/static/assets/logo.png'" style="width: 100%; height: 100%; object-fit: cover;">
                  <button class="card-play-btn">▶</button>
                </div>
                <div style="font-weight: 700; font-size: 14px; color: #fff; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.escapeHTML(pl.name)}</div>
                <div style="font-size: 12px; color: var(--silver-muted);">${(pl.tracks || []).length} tracks</div>
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

    container.querySelectorAll(".playlist-card").forEach(card => {
      card.addEventListener("click", () => {
        const plId = card.dataset.plId;
        this.loadPlaylistDetailView(plId);
      });
    });
  }

  loadPlaylistDetailView(playlistId) {
    const pl = this.storage.getPlaylist(playlistId);
    if (!pl) return;

    this.switchView("playlist-detail");
    const container = document.getElementById("playlist-detail-container");
    if (!container) return;

    const tracks = this.registerTracks(pl.tracks || []);
    const firstTrack = tracks[0];
    const cover = pl.cover_url || (firstTrack ? (firstTrack.image || firstTrack.thumbnail) : '/static/assets/logo.png');

    let html = `
      <div style="margin-bottom: 20px;">
        <button class="btn-luxury" id="playlist-back-btn" style="padding: 6px 12px; font-size: 12px;">← Back to Playlists</button>
      </div>
      <div class="hero-banner" style="background: linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(17, 17, 24, 0.95)); margin-bottom: 28px;">
        <div style="display: flex; gap: 24px; align-items: center; flex-wrap: wrap;">
          <img src="${cover}" onerror="this.src='/static/assets/logo.png'" style="width: 120px; height: 120px; border-radius: var(--radius-md); object-fit: cover; box-shadow: 0 8px 24px rgba(0,0,0,0.7), 0 0 20px rgba(168, 85, 247, 0.3);">
          <div class="hero-content">
            <span class="hero-badge" style="color: #A855F7; border-color: rgba(168, 85, 247, 0.3);">PLAYLIST</span>
            <h1 class="hero-title" style="font-size: 28px;">${this.escapeHTML(pl.name)}</h1>
            <p class="hero-desc">${this.escapeHTML(pl.description || '')} • ${tracks.length} tracks</p>
            <div class="hero-actions" style="margin-top: 12px;">
              <button class="btn-luxury btn-gold-action" id="pl-detail-play-btn">▶ Play All</button>
              <button class="btn-luxury" id="pl-detail-shuffle-btn">🔀 Shuffle</button>
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

    // Copy Code Button
    const copyCodeBtn = document.getElementById("sync-copy-code-btn");
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener("click", () => {
        if (!this.sync.roomCode) return;
        navigator.clipboard.writeText(this.sync.roomCode);
        this.showToast(`📋 Room Code "${this.sync.roomCode}" copied to clipboard!`);
      });
    }

    // Leave Room Button
    const leaveBtn = document.getElementById("sync-space-leave-btn");
    if (leaveBtn) {
      leaveBtn.addEventListener("click", () => {
        this.sync.leaveRoom();
        this.renderSoundSyncSpace();
        this.showToast("🚪 Left SoundSync Room");
      });
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

    // Live Chat
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
        this.appendSystemNotice(`▶ Playing "${reg.title}"`);
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
      const isAdmin = l.is_admin;
      const isMe = (l.id === this.sync.userId);

      return `
        <div class="sync-listener-chip ${isHost ? 'host' : ''} ${isAdmin ? 'admin' : ''}" data-user-id="${l.id}">
          <span class="listener-avatar">${l.avatar || '🎧'}</span>
          <span class="listener-name">${this.escapeHTML(l.name)} ${isMe ? '(You)' : ''}</span>
          ${isHost ? '<span class="listener-role-badge">HOST</span>' : (isAdmin ? '<span class="listener-role-badge">ADMIN</span>' : '')}
        </div>
      `;
    }).join("");
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
      <div class="sync-request-item" data-req-id="${r.id}">
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
            this.sync.requestSong(track);
            this.showToast(`🙋‍♂️ Requested "${track.title}"`);
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
        <span>${this.escapeHTML(msg.user_name || 'Listener')}</span>
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
  // CINEMA FULLSCREEN AMBIENT MODE
  // -------------------------------------------------------------
  toggleCinemaMode(enable = true) {
    if (!this.cinemaOverlay) return;
    this.cinemaOverlay.classList.toggle("active", enable);
    if (enable) {
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
