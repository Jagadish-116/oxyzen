/**
 * OXYZEN - Pure Unchained High-Fidelity Music Engine
 * Powered by Hono & JioSaavn API
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'fs';
import path from 'path';

import {
  searchSongs,
  getSongDetails,
  getSearchSuggestions,
  getTrending,
  getCharts,
  getExploreFeed,
  getMoodCategories,
  getMoodFeed,
  getVibeRecommendations
} from './services/jiosaavn.js';

import { getLyrics } from './services/lyrics.js';

import {
  getDb,
  getLikes,
  getLikedIds,
  toggleLike,
  getPlaylists,
  createPlaylist,
  getPlaylistDetails,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  deletePlaylist,
  getHistory,
  addToHistory,
  clearHistory,
  getUserProfile,
  saveUserProfile,
  getUserListeningProfile
} from './services/db.js';

import { syncManager } from './services/sync.js';

// Initialize SQLite database
getDb();

const app = new Hono();

// Global Middlewares
app.use('*', logger());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['*'],
  exposeHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges', 'Content-Disposition'],
  maxAge: 86400
}));

// ----------------- HEALTH & SYSTEM ----------------- //

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'OXYZEN Luxury Music Platform',
    engine: 'Hono + JioSaavn Engine 2.0',
    version: '2.0.0',
    time: Date.now() / 1000
  });
});

// ----------------- SEARCH & SUGGESTIONS ----------------- //

app.get('/api/suggestions', async (c) => {
  const q = c.req.query('q') || '';
  if (!q.trim()) return c.json({ query: '', suggestions: [] });

  const suggestions = await getSearchSuggestions(q);
  return c.json({ query: q, suggestions });
});

app.get('/api/search', async (c) => {
  const q = c.req.query('q') || c.req.query('query') || '';
  const page = parseInt(c.req.query('page') || '1', 10) || 1;
  const limit = parseInt(c.req.query('limit') || '30', 10) || 30;

  if (!q.trim()) {
    return c.json({ query: '', total: 0, page, results: [], tracks: [] });
  }

  try {
    const results = await searchSongs(q, page, limit);
    return c.json({
      ...results,
      tracks: results.results
    });
  } catch (err: any) {
    console.error(`Search error for "${q}":`, err);
    return c.json({ query: q, total: 0, page, results: [], tracks: [], error: err.message }, 500);
  }
});

// ----------------- SONG DETAILS & STREAM RESOLUTION ----------------- //

app.get('/api/song/:id', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'Song ID is required' }, 400);

  try {
    const song = await getSongDetails(id);
    if (!song) {
      return c.json({ error: 'Song not found' }, 404);
    }
    return c.json(song);
  } catch (err: any) {
    console.error(`Error resolving song ${id}:`, err);
    return c.json({ error: err.message }, 500);
  }
});

// Alias for stream_info to ensure 100% backward compatibility
app.get('/api/stream_info/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const song = await getSongDetails(id);
    if (!song) return c.json({ error: 'Track not found' }, 404);

    return c.json({
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      thumbnail: song.thumbnail,
      image: song.image,
      duration_sec: song.duration_sec,
      stream_url: song.stream_url,
      direct_url: song.stream_url,
      downloadUrl: song.downloadUrl
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Direct streaming redirection / proxy
app.get('/api/stream/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const song = await getSongDetails(id);
    if (!song || !song.stream_url) {
      return c.json({ error: 'Audio stream not found' }, 404);
    }

    // If stream_url is a direct CDN link (e.g. https://aac.saavncdn.com/...), redirect immediately
    if (song.stream_url.startsWith('http')) {
      return c.redirect(song.stream_url, 302);
    }

    return c.json({ error: 'Stream URL not available' }, 404);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ----------------- EXPLORE, TRENDING & CHARTS ----------------- //

app.get('/api/trending', async (c) => {
  const trending = await getTrending();
  return c.json(trending);
});

app.get('/api/charts', async (c) => {
  const charts = await getCharts();
  return c.json({ charts });
});

app.get('/api/explore', async (c) => {
  const profile = getUserListeningProfile();
  const feed = await getExploreFeed(profile);
  return c.json(feed);
});

app.get('/api/personalized', async (c) => {
  const stats = getUserListeningProfile();
  const feed = await getExploreFeed();
  return c.json({
    profile: stats,
    sections: feed.sections
  });
});

// ----------------- MOODS & RECOMMENDATIONS ----------------- //

app.get('/api/moods', (c) => {
  const moods = getMoodCategories();
  return c.json({ moods });
});

app.get('/api/moods/:mood_key', async (c) => {
  const moodKey = c.req.param('mood_key');
  const langsParam = c.req.query('languages');
  const langs = langsParam ? langsParam.split(',').map(l => l.trim()).filter(Boolean) : ['Hindi', 'English', 'Telugu'];

  const feed = await getMoodFeed(moodKey, langs);
  return c.json(feed);
});

app.get('/api/recommendations', async (c) => {
  const songId = c.req.query('video_id') || c.req.query('song_id') || c.req.query('id');
  const artist = c.req.query('artist');
  const title = c.req.query('title');

  const recommendations = await getVibeRecommendations(songId, artist, title);
  return c.json({ recommendations });
});

// ----------------- LYRICS ----------------- //

app.get('/api/lyrics', async (c) => {
  const title = c.req.query('title') || '';
  const artist = c.req.query('artist') || '';
  const duration = parseInt(c.req.query('duration') || '0', 10) || undefined;

  if (!title.trim()) {
    return c.json({ synced: false, lines: [], plain: '' });
  }

  const lyricsData = await getLyrics(title, artist, duration);
  return c.json(lyricsData);
});

// ----------------- USER PROFILE & PREFERENCES ----------------- //

app.get('/api/user/profile', (c) => {
  const profile = getUserProfile();
  const stats = getUserListeningProfile();
  return c.json({ profile, stats });
});

app.post('/api/user/profile', async (c) => {
  const payload = await c.req.json().catch(() => ({}));
  const updated = saveUserProfile(payload);
  return c.json({ success: true, profile: updated });
});

// ----------------- LIBRARY: LIKES, PLAYLISTS, HISTORY ----------------- //

app.get('/api/library/likes', (c) => {
  const likes = getLikes();
  const liked_ids = getLikedIds();
  return c.json({ likes, liked_ids, total: likes.length });
});

app.post('/api/library/likes/toggle', async (c) => {
  const track = await c.req.json().catch(() => ({}));
  const liked = toggleLike(track);
  return c.json({ liked, id: track.id || track.videoId });
});

app.get('/api/library/playlists', (c) => {
  const playlists = getPlaylists();
  return c.json({ playlists });
});

app.post('/api/library/playlists/create', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const name = data.name || 'New Playlist';
  const desc = data.description || '';
  const cover = data.cover_url || '';
  const pl = createPlaylist(name, desc, cover);
  return c.json(pl);
});

app.get('/api/library/playlists/:id', (c) => {
  const id = c.req.param('id');
  const pl = getPlaylistDetails(id);
  if (!pl) return c.json({ error: 'Playlist not found' }, 404);
  return c.json(pl);
});

app.post('/api/library/playlists/:id/add', async (c) => {
  const id = c.req.param('id');
  const track = await c.req.json().catch(() => ({}));
  const success = addTrackToPlaylist(id, track);
  return c.json({ success });
});

app.delete('/api/library/playlists/:id/track/:track_id', (c) => {
  const plId = c.req.param('id');
  const trackId = c.req.param('track_id');
  const success = removeTrackFromPlaylist(plId, trackId);
  return c.json({ success });
});

app.delete('/api/library/playlists/:id', (c) => {
  const id = c.req.param('id');
  const success = deletePlaylist(id);
  return c.json({ success });
});

app.get('/api/library/history', (c) => {
  const limit = parseInt(c.req.query('limit') || '50', 10) || 50;
  const history = getHistory(limit);
  return c.json({ history });
});

app.post('/api/library/history/add', async (c) => {
  const track = await c.req.json().catch(() => ({}));
  addToHistory(track);
  return c.json({ status: 'ok' });
});

app.post('/api/library/history/clear', (c) => {
  clearHistory();
  return c.json({ status: 'cleared' });
});

// ----------------- SOUNDSYNC LISTENING ROOMS ----------------- //

app.post('/api/rooms/create', async (c) => {
  const data = await c.req.json().catch(() => ({}));
  const roomName = data.room_name || 'Oxyzen SoundSync Lounge';
  const hostName = data.host_name || 'Host';
  const hostId = data.host_id || `user_${Math.floor(Date.now()) % 10000}`;
  const customCode = data.room_code;

  const room = syncManager.createRoom(roomName, hostId, hostName, customCode);
  return c.json({
    room_code: room.code,
    room_name: room.name,
    host_id: room.host_id,
    created_at: room.created_at
  });
});

app.get('/api/rooms/:code', (c) => {
  const code = c.req.param('code');
  const room = syncManager.getRoom(code);
  if (!room) return c.json({ error: 'Listening room not found' }, 404);
  return c.json(room.toStateDict());
});

app.post('/api/rooms/:code/sync', async (c) => {
  const code = c.req.param('code');
  const room = syncManager.getRoom(code);
  if (!room) return c.json({ error: 'Listening room not found' }, 404);

  const body = await c.req.json().catch(() => ({}));
  if (body.current_track) {
    room.updatePlayback(body.current_track, body.position || 0, body.is_playing ?? true);
  }

  return c.json(room.toStateDict());
});

// ----------------- DIRECT DOWNLOAD ----------------- //

app.get('/api/download/:id', async (c) => {
  const id = c.req.param('id');
  const title = c.req.query('title') || 'Track';
  const artist = c.req.query('artist') || 'Artist';

  try {
    const song = await getSongDetails(id);
    if (!song || !song.stream_url) {
      return c.json({ error: 'Download link not available' }, 404);
    }

    // Redirect to direct CDN stream link
    return c.redirect(song.stream_url, 302);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ----------------- STATIC FILES & FRONTEND ----------------- //

const STATIC_DIR = path.resolve(process.cwd(), 'static');

// Serve static assets from /static/*
app.use('/static/*', serveStatic({ root: './' }));

// Serve main index.html for root /
app.get('/', (c) => {
  const indexPath = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf-8');
    return c.html(html);
  }
  return c.text('Oxyzen Music Platform - Static files initializing...');
});

// Start Server
const port = parseInt(process.env.PORT || '8000', 10);
const host = process.env.HOST || '0.0.0.0';

console.log(`==================================================`);
console.log(`✦ OXYZEN LUXURY MUSIC ENGINE RUNNING ON http://localhost:${port} ✦`);
console.log(`✦ Powered by Hono & High-Fidelity JioSaavn CDN Engine ✦`);
console.log(`==================================================`);

serve({
  fetch: app.fetch,
  port,
  hostname: host
});
