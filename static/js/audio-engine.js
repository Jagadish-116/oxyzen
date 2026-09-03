/**
 * OXYZEN HIGH-FIDELITY WEB AUDIO ENGINE 2.0
 * - 10-Band Parametric Graphic Equalizer
 * - 8D Binaural Spatial Audio Surround Simulator
 * - Real-Time Audio-Reactive Motion Visualizer & Sound Variations
 * - Resilient Multi-Bitrate Audio Stream Fallback
 * - MediaSession API OS Background Lockscreen Controls
 */

class OxyzenAudioEngine {
  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = "anonymous";
    this.audio.preload = "auto";
    
    this.audioCtx = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.masterGainNode = null;
    this.pannerNode = null;
    this.eqFilters = [];
    
    // Equalizer Frequencies (10 standard bands)
    this.eqFrequencies = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    this.eqGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    
    // 8D Audio Variables
    this.spatial8DEnabled = false;
    this.spatialSpeed = 0.05;
    this.spatialAngle = 0;
    this.spatialInterval = null;

    // Track State
    this.currentTrack = null;
    this.isPlaying = false;
    this.isInitialized = false;
    this.pauseInactivityTimer = null;

    // Stream Fallback Candidates
    this.streamCandidates = [];
    this.currentCandidateIdx = 0;

    // Visualizer Canvas & Motion Animation
    this.cinemaCanvas = null;
    this.cinemaCtx = null;
    this.animationFrameId = null;

    this.setupAudioListeners();
    this.setupMediaSession();
  }

  initAudioContext() {
    if (this.isInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext({ latencyHint: 'playback' });
      
      // Source node from HTML5 audio
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);

      // --- STAGE 1: ACOUSTIC CLARITY INPUT CONDITIONING ---
      // 1. Sub-Bass DC Decoupler (Removes inaudible DC rumble & distortion below 18Hz)
      this.subDcFilter = this.audioCtx.createBiquadFilter();
      this.subDcFilter.type = "highpass";
      this.subDcFilter.frequency.value = 18;
      this.subDcFilter.Q.value = 0.707;

      // 2. Mud & Boxiness Clarifier (Gentle dip at 260Hz for clean instrument definition)
      this.clarityDeMud = this.audioCtx.createBiquadFilter();
      this.clarityDeMud.type = "peaking";
      this.clarityDeMud.frequency.value = 260;
      this.clarityDeMud.Q.value = 1.0;
      this.clarityDeMud.gain.value = -0.7;

      // 3. Vocal Presence & Crisp Transient Enhancer (+1.2dB at 3.5kHz)
      this.presenceExciter = this.audioCtx.createBiquadFilter();
      this.presenceExciter.type = "peaking";
      this.presenceExciter.frequency.value = 3500;
      this.presenceExciter.Q.value = 1.1;
      this.presenceExciter.gain.value = 1.2;

      // 4. Studio Air & Top-End Sparkle Exciter (+1.5dB High-Shelf at 9.5kHz)
      this.airExciter = this.audioCtx.createBiquadFilter();
      this.airExciter.type = "highshelf";
      this.airExciter.frequency.value = 9500;
      this.airExciter.gain.value = 1.5;

      // Connect input conditioning chain
      this.sourceNode.connect(this.subDcFilter);
      this.subDcFilter.connect(this.clarityDeMud);
      this.clarityDeMud.connect(this.presenceExciter);
      this.presenceExciter.connect(this.airExciter);

      // --- STAGE 2: 10-BAND PARAMETRIC EQUALIZER ---
      let previousNode = this.airExciter;
      this.eqFilters = this.eqFrequencies.map((freq, index) => {
        const filter = this.audioCtx.createBiquadFilter();
        if (index === 0) {
          filter.type = "lowshelf";
        } else if (index === this.eqFrequencies.length - 1) {
          filter.type = "highshelf";
        } else {
          filter.type = "peaking";
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = this.eqGains[index];

        previousNode.connect(filter);
        previousNode = filter;
        return filter;
      });

      // --- STAGE 3: DYNAMIC STUDIO MASTER LIMITER & COMPRESSOR ---
      this.masterLimiter = this.audioCtx.createDynamicsCompressor();
      this.masterLimiter.threshold.value = -12.0;
      this.masterLimiter.knee.value = 10.0;
      this.masterLimiter.ratio.value = 2.0;
      this.masterLimiter.attack.value = 0.008;
      this.masterLimiter.release.value = 0.20;

      // --- STAGE 4: STEREO PANNER & OUTPUT ---
      if (this.audioCtx.createStereoPanner) {
        this.pannerNode = this.audioCtx.createStereoPanner();
        this.pannerNode.pan.value = 0;
      }

      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = 1.0;

      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.85;

      // Connect DSP chain
      if (this.pannerNode) {
        previousNode.connect(this.pannerNode);
        this.pannerNode.connect(this.masterLimiter);
      } else {
        previousNode.connect(this.masterLimiter);
      }

      this.masterLimiter.connect(this.masterGainNode);
      this.masterGainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);

      this.isInitialized = true;
      this.startVisualizerLoop();
    } catch (e) {
      console.warn("Web Audio API Context initialization postponed until user gesture:", e);
    }
  }

  ensureContextActive() {
    if (!this.isInitialized) {
      this.initAudioContext();
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setupAudioListeners() {
    this.audio.addEventListener("play", () => {
      this.isPlaying = true;
      this.ensureContextActive();
      this.clearPauseInactivityTimer();
      this.updateMediaSessionPlaybackState("playing");
      window.dispatchEvent(new CustomEvent("oxyzen:play", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("pause", () => {
      this.isPlaying = false;
      this.updateMediaSessionPlaybackState("paused");
      this.startPauseInactivityTimer();
      window.dispatchEvent(new CustomEvent("oxyzen:pause", { detail: { track: this.currentTrack } }));
    });

    window.addEventListener("beforeunload", () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
    });
    window.addEventListener("pagehide", () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = "none";
      }
    });

    this.audio.addEventListener("timeupdate", () => {
      window.dispatchEvent(new CustomEvent("oxyzen:timeupdate", {
        detail: {
          currentTime: this.audio.currentTime,
          duration: this.audio.duration || 0
        }
      }));
      this.updateMediaSessionPositionState();
    });

    this.audio.addEventListener("ended", () => {
      window.dispatchEvent(new CustomEvent("oxyzen:ended", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("waiting", () => {
      window.dispatchEvent(new CustomEvent("oxyzen:waiting", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("playing", () => {
      window.dispatchEvent(new CustomEvent("oxyzen:playing", { detail: { track: this.currentTrack } }));
    });

    // Resilient Fallback: If current stream URL errors, try next available bitrate or proxy!
    this.audio.addEventListener("error", async (e) => {
      console.warn("Audio stream playback notice on:", this.audio.src);
      if (this.streamCandidates.length > 0 && this.currentCandidateIdx < this.streamCandidates.length - 1) {
        this.currentCandidateIdx++;
        const nextUrl = this.streamCandidates[this.currentCandidateIdx];
        console.log(`Switching to backup stream candidate (${this.currentCandidateIdx + 1}/${this.streamCandidates.length}):`, nextUrl);
        this.audio.src = nextUrl;
        try {
          await this.audio.play();
          this.isPlaying = true;
        } catch (err) {
          console.warn("Fallback play error:", err);
        }
      }
    });

    this.setupMediaSession();
  }

  // -------------------------------------------------------------
  // PLAYBACK CONTROL METHODS
  // -------------------------------------------------------------
  async loadAndPlay(track, startTime = 0) {
    if (!track) return;
    this.currentTrack = track;
    this.ensureContextActive();

    // Build fallback candidate URLs
    this.streamCandidates = [];
    if (track.stream_url) this.streamCandidates.push(track.stream_url);
    if (track.downloadUrl && Array.isArray(track.downloadUrl)) {
      for (let i = track.downloadUrl.length - 1; i >= 0; i--) {
        const url = track.downloadUrl[i].url;
        if (url && !this.streamCandidates.includes(url)) {
          this.streamCandidates.push(url);
        }
      }
    }
    const proxyUrl = `/api/stream/${track.id}`;
    if (!this.streamCandidates.includes(proxyUrl)) {
      this.streamCandidates.push(proxyUrl);
    }

    this.currentCandidateIdx = 0;
    const initialUrl = this.streamCandidates[0];
    this.audio.src = initialUrl;

    if (startTime > 0) {
      this.audio.currentTime = startTime;
    }

    try {
      await this.audio.play();
      this.isPlaying = true;
      this.updateMediaSessionMetadata(track);
    } catch (err) {
      console.warn("Playback requires user gesture or stream buffering:", err);
      this.isPlaying = false;
    }
  }

  play() {
    this.ensureContextActive();
    return this.audio.play().then(() => {
      this.isPlaying = true;
    });
  }

  pause() {
    this.audio.pause();
    this.isPlaying = false;
  }

  seek(seconds) {
    if (!isNaN(seconds) && isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 9999));
    }
  }

  setVolume(volume) {
    const val = Math.max(0, Math.min(1, volume));
    this.audio.volume = val;
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = val;
    }
  }

  // -------------------------------------------------------------
  // 8D BINAURAL SPATIAL AUDIO PANNER
  // -------------------------------------------------------------
  toggle8D() {
    this.spatial8DEnabled = !this.spatial8DEnabled;
    this.ensureContextActive();

    if (this.spatial8DEnabled) {
      this.spatialAngle = 0;
      if (this.spatialInterval) clearInterval(this.spatialInterval);
      this.spatialInterval = setInterval(() => {
        this.spatialAngle += this.spatialSpeed;
        const pan = Math.sin(this.spatialAngle);
        if (this.pannerNode && this.pannerNode.pan) {
          this.pannerNode.pan.value = pan;
        }
      }, 50);
    } else {
      if (this.spatialInterval) {
        clearInterval(this.spatialInterval);
        this.spatialInterval = null;
      }
      if (this.pannerNode && this.pannerNode.pan) {
        this.pannerNode.pan.value = 0;
      }
    }
    return this.spatial8DEnabled;
  }

  get is8DActive() {
    return this.spatial8DEnabled;
  }

  // -------------------------------------------------------------
  // 10-BAND PARAMETRIC EQUALIZER
  // -------------------------------------------------------------
  getEqBandGain(index) {
    if (index >= 0 && index < this.eqGains.length) {
      return this.eqGains[index] || 0;
    }
    return 0;
  }

  setEqBandGain(index, gainDb) {
    if (index >= 0 && index < this.eqFilters.length) {
      const val = Math.max(-12, Math.min(12, gainDb));
      this.eqGains[index] = val;
      if (this.eqFilters[index]) {
        this.eqFilters[index].gain.value = val;
      }
    }
  }

  applyEqPreset(presetName) {
    const presets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass_boost: [6, 5, 4, 2, 0, 0, 0, 1, 2, 3],
      vocal: [-2, -1, 1, 3, 4, 4, 3, 2, 1, 0],
      electronic: [5, 4, 2, 0, -1, 1, 3, 4, 5, 5],
      rock: [4, 3, 2, -1, -2, 0, 2, 4, 4, 5],
      acoustic: [3, 2, 1, 1, 2, 2, 3, 3, 3, 2],
      lofi_chill: [4, 3, 1, 0, 0, -1, -2, -3, -4, -6]
    };

    const gains = presets[presetName] || presets.flat;
    gains.forEach((g, i) => this.setEqBandGain(i, g));
    return gains;
  }

  // -------------------------------------------------------------
  // REAL-TIME AUDIO-REACTIVE VISUALIZER (STRICT BEATS ONLY)
  // -------------------------------------------------------------
  startVisualizerLoop() {
    let lastBassAvg = 0;

    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      if (!this.analyserNode || !this.isPlaying) return;

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyserNode.getByteFrequencyData(dataArray);

      // Compute instantaneous sub-bass and bass energy for beat impact
      let bassSum = 0;
      for (let i = 0; i < 8; i++) bassSum += dataArray[i];
      const bassAvg = bassSum / 8; // 0 - 255

      // Detect beat hit / transient
      const isBeatHit = (bassAvg > 140 && bassAvg > lastBassAvg * 1.15);
      lastBassAvg = bassAvg * 0.7 + lastBassAvg * 0.3; // Decay

      const bassScale = 1 + (bassAvg / 255) * 0.12;
      const beatGlow = (bassAvg / 255);

      // Update CSS variables for beat-reactive breathing and pulsation
      document.documentElement.style.setProperty('--bass-scale', bassScale.toFixed(3));
      document.documentElement.style.setProperty('--beat-glow', beatGlow.toFixed(3));

      // Render Cinema Mode Beat-Reactive Visualizer Canvas
      if (!this.cinemaCanvas) {
        this.cinemaCanvas = document.getElementById("cinema-visualizer-canvas");
        if (this.cinemaCanvas) this.cinemaCtx = this.cinemaCanvas.getContext("2d");
      }

      if (this.cinemaCanvas && this.cinemaCtx) {
        const ctx = this.cinemaCtx;
        const w = this.cinemaCanvas.width;
        const h = this.cinemaCanvas.height;
        ctx.clearRect(0, 0, w, h);

        // Beat-reactive frequency spectrum bars
        const numBars = 64;
        const barWidth = w / numBars;
        const step = Math.floor((bufferLength / 2) / numBars) || 1;

        for (let i = 0; i < numBars; i++) {
          const val = dataArray[i * step] / 255.0;
          const barHeight = val * h * 0.9;
          const x = i * barWidth;

          const grad = ctx.createLinearGradient(0, h, 0, h - barHeight);
          grad.addColorStop(0, "rgba(245, 197, 66, 0.15)");
          grad.addColorStop(0.6, "rgba(168, 85, 247, 0.65)");
          grad.addColorStop(1, "rgba(34, 211, 238, 0.95)");

          ctx.fillStyle = grad;
          ctx.fillRect(x + 1, h - barHeight, barWidth - 2, barHeight);

          // Glowing peak cap on beat impact
          if (val > 0.4) {
            ctx.fillStyle = "#F5C542";
            ctx.shadowColor = "#F5C542";
            ctx.shadowBlur = 8;
            ctx.fillRect(x + 1, h - barHeight - 2, barWidth - 2, 2);
            ctx.shadowBlur = 0;
          }
        }
      }

      // Render SoundSync Chat Live Audio Level Wave / Spectrum Canvas
      if (!this.syncCanvas) {
        this.syncCanvas = document.getElementById("sync-chat-visualizer-canvas");
        if (this.syncCanvas) this.syncCtx = this.syncCanvas.getContext("2d");
      }

      if (this.syncCanvas && this.syncCtx) {
        const sCtx = this.syncCtx;
        const sw = this.syncCanvas.width;
        const sh = this.syncCanvas.height;
        sCtx.clearRect(0, 0, sw, sh);

        const syncBars = 48;
        const sBarWidth = sw / syncBars;
        const sStep = Math.floor((bufferLength / 2) / syncBars) || 1;

        for (let i = 0; i < syncBars; i++) {
          const val = dataArray[i * sStep] / 255.0;
          const barH = val * sh * 0.85;
          const sx = i * sBarWidth;

          const sGrad = sCtx.createLinearGradient(0, sh, 0, sh - barH);
          sGrad.addColorStop(0, "rgba(245, 197, 66, 0.05)");
          sGrad.addColorStop(0.5, "rgba(168, 85, 247, 0.25)");
          sGrad.addColorStop(1, "rgba(34, 211, 238, 0.45)");

          sCtx.fillStyle = sGrad;
          sCtx.fillRect(sx + 1, sh - barH, sBarWidth - 2, barH);

          if (val > 0.42) {
            sCtx.fillStyle = "rgba(245, 197, 66, 0.75)";
            sCtx.fillRect(sx + 1, sh - barH - 2, sBarWidth - 2, 2);
          }
        }
      }
    };

    render();
  }

  // -------------------------------------------------------------
  // OS MEDIASESSION API & PERSISTENT MOBILE NOTIFICATION CONTROLS
  // -------------------------------------------------------------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    const setHandler = (action, handler) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {}
    };

    setHandler('play', () => this.play());
    setHandler('pause', () => this.pause());
    setHandler('seekto', (details) => {
      if (details.seekTime !== undefined) this.seek(details.seekTime);
    });
    setHandler('previoustrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:request_prev"));
    });
    setHandler('nexttrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:request_next"));
    });
    setHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      this.seek(Math.max(this.audio.currentTime - skipTime, 0));
    });
    setHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      this.seek(Math.min(this.audio.currentTime + skipTime, this.audio.duration || 0));
    });
    setHandler('togglefavorite', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:request_toggle_like"));
    });
    setHandler('stop', () => {
      this.pause();
      this.seek(0);
    });
  }

  startPauseInactivityTimer() {
    this.clearPauseInactivityTimer();
    // Keep notification bar active for 10 minutes of paused inactivity
    this.pauseInactivityTimer = setTimeout(() => {
      if (!this.isPlaying && 'mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'none';
        navigator.mediaSession.metadata = null;
        window.dispatchEvent(new CustomEvent("oxyzen:media_inactive"));
      }
    }, 10 * 60 * 1000);
  }

  clearPauseInactivityTimer() {
    if (this.pauseInactivityTimer) {
      clearTimeout(this.pauseInactivityTimer);
      this.pauseInactivityTimer = null;
    }
  }

  updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        album: track.album || 'Oxyzen Music',
        artwork: [
          { src: thumb, sizes: '96x96', type: 'image/png' },
          { src: thumb, sizes: '128x128', type: 'image/png' },
          { src: thumb, sizes: '192x192', type: 'image/png' },
          { src: thumb, sizes: '256x256', type: 'image/png' },
          { src: thumb, sizes: '384x384', type: 'image/png' },
          { src: thumb, sizes: '512x512', type: 'image/png' }
        ]
      });
    } catch (e) {
      console.warn("MediaSession metadata update failed:", e);
    }
  }

  updateMediaSessionPlaybackState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }

  updateMediaSessionPositionState() {
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
      if (this.audio.duration && !isNaN(this.audio.duration) && isFinite(this.audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: this.audio.duration,
          playbackRate: this.audio.playbackRate || 1.0,
          position: this.audio.currentTime || 0
        });
      }
    }
  }

  prefetchTrack(track) {
    if (!track) return;
    const streamUrl = track.stream_url || track.direct_url || (track.downloadUrl && track.downloadUrl.length > 0 ? track.downloadUrl[track.downloadUrl.length - 1].url : null);
    if (streamUrl) {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = streamUrl;
      document.head.appendChild(link);
    }
  }
}

window.oxyzenAudio = new OxyzenAudioEngine();
