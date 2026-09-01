/**
 * OXYZEN HIGH-FIDELITY WEB AUDIO ENGINE
 * - 10-Band Parametric Graphic Equalizer
 * - 8D Binaural Spatial Audio Surround Simulator
 * - 60fps Real-Time Web Audio Canvas Spectrum Visualizer
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
    this.spatialSpeed = 0.05; // oscillation speed
    this.spatialAngle = 0;
    this.spatialInterval = null;
    
    // Track State
    this.currentTrack = null;
    this.isPlaying = false;
    this.isInitialized = false;

    // Visualizer Canvases
    this.dockCanvas = null;
    this.dockCtx = null;
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
      this.analyserNode.fftSize = 256;
      this.analyserNode.smoothingTimeConstant = 0.82;

      // Master Gain
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = 1.0;

      // Stereo Panner for 8D Spatial Audio
      if (this.audioCtx.createStereoPanner) {
        this.pannerNode = this.audioCtx.createStereoPanner();
        this.pannerNode.pan.value = 0;
      }

      // Build 10-band Equalizer chain
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

    this.retryCount = 0;
    this.maxRetries = 2;

    this.audio.addEventListener("waiting", () => {
      window.dispatchEvent(new CustomEvent("oxyzen:waiting", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("playing", () => {
      this.retryCount = 0;
      window.dispatchEvent(new CustomEvent("oxyzen:playing", { detail: { track: this.currentTrack } }));
    });

    this.audio.addEventListener("stalled", () => {
      console.warn("Audio stream stalled, checking buffer...");
    });

    this.audio.addEventListener("error", async (e) => {
      console.warn("Audio playback stream error:", e);
      if (this.currentTrack && this.retryCount < this.maxRetries) {
        this.retryCount++;
        const id = this.currentTrack.id || this.currentTrack.videoId;
        console.info(`Attempting resilient stream recovery (attempt ${this.retryCount}/${this.maxRetries}) for ${id}...`);
        try {
          // Fetch fresh song details to obtain fresh direct CDN link
          const res = await fetch(`/api/song/${id}`);
          if (res.ok) {
            const data = await res.json();
            if (data.stream_url) {
              this.currentTrack.stream_url = data.stream_url;
              this.currentTrack.downloadUrl = data.downloadUrl;
              this.audio.src = data.stream_url;
              await this.audio.play();
              this.isPlaying = true;
              return;
            }
          }
        } catch (retryErr) {
          console.warn("Resilient audio recovery attempt failed:", retryErr);
        }
      }
      // If retries exhausted or failed
      window.dispatchEvent(new CustomEvent("oxyzen:stream_failed", { detail: { track: this.currentTrack, error: e } }));
      window.dispatchEvent(new CustomEvent("oxyzen:error", { detail: { error: e, track: this.currentTrack } }));
    });
  }

  async loadAndPlay(track, startTime = 0) {
    this.ensureContextActive();
    this.currentTrack = track;
    this.retryCount = 0;
    
    // Resolve direct high-bitrate JioSaavn CDN audio stream URL
    let streamUrl = track.stream_url || track.direct_url || '';
    if (!streamUrl && Array.isArray(track.downloadUrl) && track.downloadUrl.length > 0) {
      // Use highest bitrate quality (last element in array, e.g. 320kbps)
      streamUrl = track.downloadUrl[track.downloadUrl.length - 1].url;
    }
    
    const id = track.id || track.videoId;
    if (!streamUrl && id) {
      streamUrl = `/api/stream/${id}`;
    }

    this.audio.src = streamUrl;
    
    if (startTime > 0) {
      this.audio.currentTime = startTime;
    }

    this.updateMediaSessionMetadata(track);

    try {
      await this.audio.play();
      this.isPlaying = true;
    } catch (err) {
      console.warn("Autoplay was prevented, waiting for user interaction:", err);
    }
  }

  prefetchTrack(track) {
    if (!track) return;
    const id = track.id || track.videoId;
    if (!id) return;
    try {
      if (!track.stream_url) {
        fetch(`/api/song/${id}`).catch(() => {});
      }
    } catch (e) {}
  }

  play() {
    this.ensureContextActive();
    return this.audio.play();
  }

  pause() {
    this.audio.pause();
  }

  seek(seconds) {
    if (Number.isFinite(seconds)) {
      this.audio.currentTime = Math.max(0, Math.min(seconds, this.audio.duration || 99999));
      this.updateMediaSessionPositionState();
    }
  }

  setVolume(vol) {
    const v = Math.max(0, Math.min(1, vol));
    this.audio.volume = v;
  }

  // 10-Band Equalizer Methods
  setEqBandGain(index, gainDb) {
    if (index >= 0 && index < this.eqFilters.length) {
      this.eqGains[index] = gainDb;
      if (this.eqFilters[index]) {
        this.eqFilters[index].gain.setTargetAtTime(gainDb, this.audioCtx.currentTime, 0.05);
      }
    }
  }

  applyEqPreset(presetName) {
    const presets = {
      flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      bass_boost: [8, 6, 4, 2, 0, 0, 1, 2, 3, 4],
      vocal: [-2, -2, -1, 1, 3, 5, 4, 3, 1, 0],
      electronic: [6, 5, 2, 0, -2, 2, 1, 3, 5, 6],
      rock: [5, 3, 2, 0, -1, 1, 3, 4, 5, 5],
      acoustic: [3, 2, 1, 2, 3, 3, 2, 3, 4, 3],
      lofi_chill: [4, 3, 1, 0, -1, -1, 0, 1, -2, -4]
    };
    const gains = presets[presetName] || presets.flat;
    gains.forEach((g, i) => this.setEqBandGain(i, g));
    return gains;
  }

  // 8D Spatial Audio Methods
  toggle8DSpatial(enable = null) {
    this.spatial8DEnabled = (enable !== null) ? enable : !this.spatial8DEnabled;
    if (this.spatial8DEnabled) {
      if (!this.spatialInterval) {
        this.spatialInterval = setInterval(() => {
          if (!this.pannerNode || !this.isPlaying) return;
          this.spatialAngle += this.spatialSpeed;
          const pan = Math.sin(this.spatialAngle);
          this.pannerNode.pan.setTargetAtTime(pan, this.audioCtx.currentTime, 0.1);
        }, 50);
      }
    } else {
      if (this.spatialInterval) {
        clearInterval(this.spatialInterval);
        this.spatialInterval = null;
      }
      if (this.pannerNode) {
        this.pannerNode.pan.setTargetAtTime(0, this.audioCtx.currentTime, 0.1);
      }
    }
    return this.spatial8DEnabled;
  }

  set8DSpeed(speed) {
    this.spatialSpeed = Math.max(0.01, Math.min(0.2, speed));
  }

  // Visualizer Setup
  setVisualizerCanvases(dockCanvas, cinemaCanvas) {
    this.dockCanvas = dockCanvas;
    this.cinemaCanvas = cinemaCanvas;
    if (dockCanvas) this.dockCtx = dockCanvas.getContext("2d");
    if (cinemaCanvas) this.cinemaCtx = cinemaCanvas.getContext("2d");
  }

  startVisualizerLoop() {
    if (this.animationFrameId) return;

    const render = () => {
      this.animationFrameId = requestAnimationFrame(render);
      if (!this.analyserNode) return;

      const bufferLength = this.analyserNode.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyserNode.getByteFrequencyData(dataArray);

      // 1. Render Dock Canvas Preview
      if (this.dockCtx && this.dockCanvas) {
        const ctx = this.dockCtx;
        const width = this.dockCanvas.width;
        const height = this.dockCanvas.height;
        ctx.clearRect(0, 0, width, height);

        const barCount = 16;
        const barWidth = width / barCount - 1.5;
        for (let i = 0; i < barCount; i++) {
          const val = dataArray[i * 4] || 0;
          const percent = val / 255;
          const barHeight = Math.max(2, percent * height);
          
          const grad = ctx.createLinearGradient(0, height, 0, 0);
          grad.addColorStop(0, "#F5C542");
          grad.addColorStop(1, "#22D3EE");
          
          ctx.fillStyle = grad;
          ctx.fillRect(i * (barWidth + 1.5), height - barHeight, barWidth, barHeight);
        }
      }

      // 2. Render Fullscreen Cinema Spectrum
      if (this.cinemaCtx && this.cinemaCanvas) {
        const ctx = this.cinemaCtx;
        const width = this.cinemaCanvas.width;
        const height = this.cinemaCanvas.height;
        ctx.clearRect(0, 0, width, height);

        const barCount = 64;
        const barWidth = width / barCount - 3;
        for (let i = 0; i < barCount; i++) {
          const val = dataArray[i * 2] || 0;
          const percent = val / 255;
          const barHeight = Math.max(4, percent * height * 0.9);

          const grad = ctx.createLinearGradient(0, height, 0, height - barHeight);
          grad.addColorStop(0, "rgba(245, 197, 66, 0.2)");
          grad.addColorStop(0.5, "rgba(34, 211, 238, 0.6)");
          grad.addColorStop(1, "rgba(168, 85, 247, 0.9)");

          ctx.fillStyle = grad;
          ctx.shadowBlur = 12;
          ctx.shadowColor = "#22D3EE";
          ctx.fillRect(i * (barWidth + 3), height - barHeight, barWidth, barHeight);
        }
      }
    };
    render();
  }

  // OS MediaSession Lockscreen & Bluetooth Controls
  updateMediaSessionMetadata(track) {
    if (!('mediaSession' in navigator) || !track) return;
    const artworkUrl = track.image || track.thumbnail || "/static/assets/logo.png";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || "Oxyzen Track",
      artist: track.artist || "Oxyzen Artist",
      album: track.album || "Oxyzen Pure Music",
      artwork: [
        { src: artworkUrl, sizes: '512x512', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: artworkUrl, sizes: '96x96', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => this.play());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:prev"));
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      window.dispatchEvent(new CustomEvent("oxyzen:next"));
    });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
  }

  updateMediaSessionPlaybackState(state) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = state;
    }
  }

  updateMediaSessionPositionState() {
    if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
      if (this.audio.duration && !isNaN(this.audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: this.audio.duration,
          playbackRate: this.audio.playbackRate || 1.0,
          position: Math.min(this.audio.currentTime, this.audio.duration)
        });
      }
    }
  }
}

window.oxyzenAudio = new OxyzenAudioEngine();
