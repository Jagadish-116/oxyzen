/**
 * High-Performance, Zero-Native-Dependency Storage Service for Oxyzen
 * Handles user likes, custom playlists, listening history, and user profiles
 * with atomic persistent file writes.
 */

import fs from 'fs';
import path from 'path';

const DB_FILE = path.resolve(process.cwd(), 'oxyzen_store.json');

export interface TrackData {
  id?: string;
  videoId?: string;
  title: string;
  artist?: string;
  album?: string;
  thumbnail?: string;
  image?: string;
  duration?: string | number;
  duration_sec?: number;
  added_at?: number;
  played_at?: number;
  [key: string]: any;
}

export interface PlaylistData {
  id: string;
  name: string;
  description: string;
  cover_url: string;
  created_at: number;
  updated_at: number;
  tracks: TrackData[];
}

export interface OxyzenStoreSchema {
  likes: TrackData[];
  playlists: PlaylistData[];
  history: TrackData[];
  profile: Record<string, any>;
}

export function generateRandomUsername(): string {
  const adjectives = [
    'Acoustic', 'Sonic', 'Harmonic', 'Astral', 'Velvet', 'Neon', 'Cosmic', 'Golden',
    'Midnight', 'Crystal', 'Ethereal', 'Vibrant', 'Quantum', 'Melodic', 'Celestial',
    'Echo', 'Silken', 'Radiant', 'Zenith', 'Prism', 'Electric', 'Serene', 'Luminous'
  ];
  const nouns = [
    'Voyager', 'Nomad', 'Maestro', 'Pulse', 'Rhythm', 'Cadence', 'Groove', 'Wave',
    'Aura', 'Harmonics', 'Virtuoso', 'Soundscape', 'Chime', 'Drifter', 'Nexus', 'Symphony',
    'Beats', 'Acoustics', 'Cipher', 'Melody', 'Resonance', 'Phantom', 'Orbit'
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(100 + Math.random() * 900);
  return `${adj}${noun}_${num}`;
}

const defaultStore: OxyzenStoreSchema = {
  likes: [],
  playlists: [],
  history: [],
  profile: {
    username: generateRandomUsername(),
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
    audio_quality: 'Extreme (320kbps Lossless CDN)',
    languages: ['Hindi', 'English'],
    spatial_8d: false,
    eq_preset: 'flat'
  }
};

let memoryStore: OxyzenStoreSchema = { ...defaultStore };
let isInitialized = false;

function loadStore(): OxyzenStoreSchema {
  if (isInitialized) return memoryStore;

  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      memoryStore = {
        likes: Array.isArray(parsed.likes) ? parsed.likes : [],
        playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        profile: { ...defaultStore.profile, ...(parsed.profile || {}) }
      };
    } else {
      saveStoreDirect(defaultStore);
    }
  } catch (err) {
    console.warn('Could not load oxyzen_store.json, using default store:', err);
    memoryStore = { ...defaultStore };
  }

  isInitialized = true;
  return memoryStore;
}

function saveStoreDirect(store: OxyzenStoreSchema): void {
  try {
    const tmpFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.error('Failed to persist oxyzen_store.json:', err);
  }
}

// Debounced save to reduce disk I/O on high-frequency actions
let saveTimeout: NodeJS.Timeout | null = null;
function persistStore(): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStoreDirect(memoryStore);
  }, 100);
}

export function getDb(): OxyzenStoreSchema {
  return loadStore();
}

// ----------------- LIKES ----------------- //

export function getLikes(): TrackData[] {
  const store = loadStore();
  return store.likes;
}

export function getLikedIds(): string[] {
  const store = loadStore();
  return store.likes.map(t => t.id || t.videoId || '');
}

export function isLiked(trackId: string): boolean {
  if (!trackId) return false;
  const store = loadStore();
  return store.likes.some(t => t.id === trackId || t.videoId === trackId);
}

export function toggleLike(track: TrackData): boolean {
  const id = track.id || track.videoId;
  if (!id) return false;

  const store = loadStore();
  const index = store.likes.findIndex(t => t.id === id || t.videoId === id);

  if (index >= 0) {
    store.likes.splice(index, 1);
    persistStore();
    return false;
  } else {
    const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
    const durSec = parseInt(String(track.duration_sec || track.duration || 210), 10) || 210;
    const durStr = typeof track.duration === 'string' ? track.duration : `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}`;

    const normalized: TrackData = {
      ...track,
      id,
      videoId: id,
      title: track.title || 'Unknown Title',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Single',
      thumbnail: thumb,
      image: thumb,
      duration: durStr,
      duration_sec: durSec,
      added_at: Date.now() / 1000
    };

    store.likes.unshift(normalized);
    persistStore();
    return true;
  }
}

// ----------------- PLAYLISTS ----------------- //

export function getPlaylists(): any[] {
  const store = loadStore();
  return store.playlists.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description,
    cover_url: p.cover_url,
    created_at: p.created_at,
    updated_at: p.updated_at,
    track_count: p.tracks.length
  }));
}

export function createPlaylist(name: string, description = '', cover_url = ''): PlaylistData {
  const store = loadStore();
  const id = `pl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now() / 1000;

  const newPlaylist: PlaylistData = {
    id,
    name: name || 'New Playlist',
    description,
    cover_url: cover_url || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300',
    created_at: now,
    updated_at: now,
    tracks: []
  };

  store.playlists.unshift(newPlaylist);
  persistStore();
  return newPlaylist;
}

export function getPlaylistDetails(playlistId: string): any | null {
  const store = loadStore();
  const pl = store.playlists.find(p => p.id === playlistId);
  if (!pl) return null;

  return {
    ...pl,
    track_count: pl.tracks.length
  };
}

export function addTrackToPlaylist(playlistId: string, track: TrackData): boolean {
  const store = loadStore();
  const pl = store.playlists.find(p => p.id === playlistId);
  if (!pl) return false;

  const trackId = track.id || track.videoId;
  if (!trackId) return false;

  const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
  const durSec = parseInt(String(track.duration_sec || track.duration || 210), 10) || 210;
  const durStr = typeof track.duration === 'string' ? track.duration : `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}`;

  const normalized: TrackData = {
    ...track,
    id: trackId,
    videoId: trackId,
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    album: track.album || 'Single',
    thumbnail: thumb,
    image: thumb,
    duration: durStr,
    duration_sec: durSec,
    added_at: Date.now() / 1000
  };

  pl.tracks.push(normalized);
  pl.updated_at = Date.now() / 1000;
  persistStore();
  return true;
}

export function removeTrackFromPlaylist(playlistId: string, trackId: string): boolean {
  const store = loadStore();
  const pl = store.playlists.find(p => p.id === playlistId);
  if (!pl) return false;

  const idx = pl.tracks.findIndex(t => t.id === trackId || t.videoId === trackId);
  if (idx >= 0) {
    pl.tracks.splice(idx, 1);
    pl.updated_at = Date.now() / 1000;
    persistStore();
    return true;
  }
  return false;
}

export function deletePlaylist(playlistId: string): boolean {
  const store = loadStore();
  const idx = store.playlists.findIndex(p => p.id === playlistId);
  if (idx >= 0) {
    store.playlists.splice(idx, 1);
    persistStore();
    return true;
  }
  return false;
}

// ----------------- HISTORY ----------------- //

export function addToHistory(track: TrackData): void {
  const id = track.id || track.videoId;
  if (!id) return;

  const store = loadStore();
  const thumb = track.image || track.thumbnail || '/static/assets/logo.png';
  const durSec = parseInt(String(track.duration_sec || track.duration || 210), 10) || 210;
  const durStr = typeof track.duration === 'string' ? track.duration : `${Math.floor(durSec / 60)}:${(durSec % 60).toString().padStart(2, '0')}`;

  const normalized: TrackData = {
    ...track,
    id,
    videoId: id,
    title: track.title || 'Unknown Title',
    artist: track.artist || 'Unknown Artist',
    album: track.album || 'Single',
    thumbnail: thumb,
    image: thumb,
    duration: durStr,
    duration_sec: durSec,
    played_at: Date.now() / 1000
  };

  // Prepend and cap at 200 history items
  store.history.unshift(normalized);
  if (store.history.length > 200) {
    store.history = store.history.slice(0, 200);
  }
  persistStore();
}

export function getHistory(limit = 50): TrackData[] {
  const store = loadStore();
  return store.history.slice(0, limit);
}

export function clearHistory(): void {
  const store = loadStore();
  store.history = [];
  persistStore();
}

// ----------------- USER PROFILE ----------------- //

export function getUserProfile(): Record<string, any> {
  const store = loadStore();
  return store.profile;
}

export function saveUserProfile(data: Record<string, any>): Record<string, any> {
  const store = loadStore();
  store.profile = { ...store.profile, ...data };
  persistStore();
  return store.profile;
}

export function getUserListeningProfile(): any {
  const store = loadStore();
  const artistCounts: Record<string, number> = {};

  for (const track of store.history) {
    const a = track.artist;
    if (a && a !== 'Unknown Artist') {
      artistCounts[a] = (artistCounts[a] || 0) + 1;
    }
  }

  const sortedArtists = Object.entries(artistCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0]);

  return {
    total_plays: store.history.length,
    total_likes: store.likes.length,
    top_history_artists: sortedArtists.slice(0, 5)
  };
}
