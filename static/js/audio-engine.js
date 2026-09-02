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

    // Stream Fallback Candidates
    this.streamCandidates = [];
    this.currentCandidateIdx = 0;

    // Visualizer Canvas & Motion Animation
    this.cinemaCanvas = null;
    this.cinemaCtx = null;
    this.animationFrameId = null;

    this.setupAudioListeners();
  }

  initAudioContext() {
    if (this.isInitialized) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContext();
      
      // Source node from HTML5 audio
      this.sourceNode = this.audioCtx.createMediaElementSource(this.audio);
      
      // Analyser for Visualizer
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.85;

      // Master Gain
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = 1.0;

      // Stereo Panner for 8D Spatial Audio
      if (this.audioCtx.createStereoPanner) {
        this.pannerNode = this.audioCtx.createStereoPanner();
        this.pannerNode.pan.value = 0;
      }

      // Build 10-band Equalizer chain (default 0dB clean passthrough)
      let previousNode = this.sourceNode;
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

      // Connect EQ chain -> Panner -> Master Gain -> Analyser -> Speakers
      if (this.pannerNode) {
        previousNode.connect(this.pannerNode);
        this.pannerNode.connect(this.masterGainNode);
      } else {
        previousNode.connect(this.masterGainNode);
      }
      
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
      this.updateMediaSessionPlaybackState("playing");
      window.dispatchEvent(new CustomEvent("oxyzen:play", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("pause", () => {
      this.isPlaying = false;
      this.updateMediaSessionPlaybackState("paused");
      window.dispatchEvent(new CustomEvent("oxyzen:pause", { detail: { track: this.currentTrack } }));
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
    };

    render();
  }

  // -------------------------------------------------------------
  // OS MEDIASESSION API
  // -------------------------------------------------------------
  setupMediaSession() {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime) this.seek(details.seekTime);
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:request_prev"));
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:request_next"));
    });
  }

  updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Oxyzen Audio',
      artwork: [
        { src: thumb, sizes: '500x500', type: 'image/png' },
        { src: thumb, sizes: '150x150', type: 'image/png' }
      ]
    });
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
