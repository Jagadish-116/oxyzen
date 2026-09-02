# ✦ OXYZEN v2.0 — High-Fidelity Music Streaming & SoundSync Lounge 
[Oxyzen.onrender.com](https://Oxyzen.onrender.com/)
<div align="center">

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8+-3178C6.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.7+-E36002.svg?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933.svg?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Web Audio API](https://img.shields.io/badge/Web_Audio_API-8D_Spatial-F5C542.svg?style=for-the-badge&logo=soundcharts&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![Render Ready](https://img.shields.io/badge/Deploy_to-Render-46E3B7.svg?style=for-the-badge&logo=render&logoColor=white)](https://render.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)

**A luxury high-fidelity music streaming platform powered by Hono, high-bitrate JioSaavn Akamai streams, 8D Spatial Audio, beat-reactive Cinema Studio, real-time WebSocket SoundSync lounges with Sub-Admin co-host controls, and multilingual genre adaptation.**

[Key Features](#-key-features) • [Architecture](#-architecture--tech-stack) • [Quickstart Guide](#-quickstart-guide) • [SoundSync Protocol](#-soundsync-20-real-time-protocol) • [API Reference](#-api-endpoints) • [License](#-license)

</div>

---

## ✨ Key Features

- **⚡ Ultra-Fast Hono Backend**:
  Built on modern TypeScript and Hono with zero external Python dependencies, delivering instant response times, low memory footprint, and high concurrent WebSocket throughput.
- **🎵 High-Fidelity 320kbps / 160kbps Direct Akamai Audio**:
  High-bitrate audio streams sourced directly from JioSaavn CDN with encrypted media link resolution, high-resolution 500x500 cover art, and intelligent fallback bitrate negotiation.
- **🎧 8D Spatial Binaural Audio & 10-Band Studio Equalizer**:
  Studio-grade acoustic soundstage using native `Web Audio API` (`StereoPannerNode`, `BiquadFilterNode`). Features 10-band interactive frequency control (32Hz – 16kHz) with presets (*Bass Boost*, *Vocal Clarity*, *Club Electronic*, *Acoustic*, *Rock*, *Flat Master*) and 360° spherical sound panning.
- **🎬 Cinema Mode with Beat-Driven Transient Reaction**:
  Interactive 3D vinyl platter and full-screen immersive studio. Background aurora lighting and audio spectrum visualizer respond strictly to instantaneous **sub-bass kicks and transients** (`--bass-scale` and `--beat-glow`) without artificial rhythmic drift.
- **📜 Synced Lyrics Engine (LRCLIB & JioSaavn)**:
  Apple Music Sing style fluid lyrics display with active line highlighting, warm golden typography, ambient Gaussian blur, and instant seek jumping on verse click.
- **👥 SoundSync Space 2.0 (WebSocket Collaborative Lounges)**:
  Real-time synchronized multi-device listening rooms. Sub-50ms synchronized playback, host & **Sub-Admin co-host promotion controls**, shared in-room queue, listener song requests, live room chat stream, and floating animated emoji reactions.
- **🪐 Explore Feed 2.0 (Adaptive Multi-User Engine)**:
  - **New Users**: Curated **🔥 Global English Trending Chartbusters** (Billboard Hot 100 / English Pop) and nationwide top hits.
  - **Regular Users**: Automatically harmonizes your **entire listening history and liked songs** to generate genre and artist recommendations without title repetition.
- **📡 Vibe Radar 2.0 (Acoustic Kindred Matching)**:
  Detects active song language, artist repertoire, and musical style to suggest 50+ kindred tracks from that exact genre and language.
- **🎭 12 Multilingual Mood Stations Matrix**:
  Authentic genre-mapped mood stations (*Love & Romance*, *Midnight Lofi*, *Heartbreak Ballads*, *Feel Good Sunshine*, *Gym Pump*, *Party Club*, *Soulful Sufi*, *Rock & Riffs*, *Heroic Cinema*, *Devotional*, *Deep Focus*, *Retro Gold*) tailored across Telugu, Hindi, Tamil, English, Punjabi, Kannada, and Malayalam.
- **📱 Touch-First Responsive Mobile Web App**:
  Smooth horizontal touch-swipe carousels (`scroll-snap-type: x mandatory`), fixed frosted glass bottom navigation bar, floating mini-player capsule, and comfortable one-handed usability.

---

## 🛠️ Architecture & Tech Stack

```
oxyzen/
├── src/
│   ├── index.ts               # Hono web server, REST API & WebSocket SoundSync router
│   └── services/
│       ├── jiosaavn.ts        # JioSaavn API client, DES-CBC media decryptor, recommendations
│       ├── lrclib.ts          # LRCLIB synchronized LRC lyrics client & caching
│       └── sync.ts            # SoundSync multi-room manager, state broadcast & admin roles
├── static/
│   ├── index.html             # Single-page application shell
│   ├── css/
│   │   └── style.css          # Luxury Obsidian & Gold design system, animations & mobile styles
│   └── js/
│       ├── app.js             # Main SPA orchestrator, navigation & UI state management
│       ├── audio-engine.js    # Web Audio API 10-band EQ, 8D panner, visualizer & beat detector
│       ├── storage.js         # LocalStorage persistence for likes, history, playlists & profile
│       └── sync-client.js     # WebSocket SoundSync client with auto-reconnect & heartbeat
├── dist/                      # Compiled JavaScript bundle
├── package.json               # Dependencies and scripts
└── tsconfig.json              # TypeScript compilation configuration
```

---

## 🚀 Quickstart Guide

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- `npm` or `bun`

### Installation & Run

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Jagadish-116/oxyzen.git
   cd oxyzen
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build TypeScript:**
   ```bash
   npm run build
   ```

4. **Start the server:**
   ```bash
   npm start
   ```

5. **Open in browser:**
   ```
   http://localhost:8000
   ```

### Development Mode (with hot reloading)
```bash
npm run dev
```

---

## 👥 SoundSync 2.0 Real-Time Protocol

SoundSync operates over WebSockets (`ws://localhost:8000/ws/room/:roomCode`):

| Action / Message Type | Payload Fields | Description |
|---|---|---|
| `JOIN` | `room_code, user_id, user_name, avatar` | Joins or creates a sync room |
| `PLAY_TRACK` | `track, current_time` | Broadcasts song change across all room members |
| `PLAY_STATE` | `is_playing, current_time` | Synchronizes play/pause state and timestamp |
| `SEEK` | `time` | Synchronizes scrub position |
| `REQUEST_SONG` | `track` | Listener submits song request to the host queue |
| `ACCEPT_REQUEST` | `request_id, play_now` | Host/Admin approves request to play or queue |
| `ADD_QUEUE` | `track` | Appends a track to the shared lounge queue |
| `PROMOTE_ADMIN` | `target_user_id` | Host promotes another listener to Co-Host Sub-Admin |
| `DEMOTE_ADMIN` | `target_user_id` | Host removes Sub-Admin role from listener |
| `CHAT_MESSAGE` | `text` | Broadcasts message in room chat stream |
| `REACTION_PULSE` | `emoji` | Broadcasts live reaction particle |

---

## 🌐 API Endpoints

- `GET /api/search?q={query}&page={page}&limit={limit}` — Search songs, artists, and albums
- `GET /api/song/{id}` — Song details with 320kbps Akamai stream link
- `GET /api/lyrics?title={title}&artist={artist}&duration={duration}` — Synced LRC lyrics
- `POST /api/explore` — Personalized explore feed (accepts `{ languages, history, likes }`)
- `GET /api/recommendations?video_id={id}&artist={artist}&title={title}&language={lang}` — Vibe Radar kindred matches
- `GET /api/moods` — All 12 multilingual mood categories
- `GET /api/moods/{mood}?languages={langs}` — Mood station tracklist
- `GET /api/charts` — Popular charts (Trending India, Global 50, Regional Hits)
- `GET /api/user/profile` / `POST /api/user/profile` — User preferences and language matrix
- `GET /ws/room/:roomCode` — WebSocket SoundSync connection endpoint

---

## 📄 License

This project is licensed under the MIT License.
