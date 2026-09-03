/**
 * OXYZEN - Pure Unchained High-Fidelity Music Engine
 * Powered by Hono & JioSaavn API with Real-time SoundSync WebSockets
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createNodeWebSocket } from '@hono/node-ws';
import fs from 'fs';
import path from 'path';
import { searchSongs, getSongDetails, getSearchSuggestions, getTrending, getCharts, getExploreFeed, getMoodCategories, getMoodFeed, getVibeRecommendations, importPlaylistFromUrl } from './services/jiosaavn.js';
import { getLyrics } from './services/lyrics.js';
import { getDb, getLikes, getLikedIds, toggleLike, getPlaylists, createPlaylist, getPlaylistDetails, addTrackToPlaylist, removeTrackFromPlaylist, deletePlaylist, getHistory, addToHistory, clearHistory, getUserProfile, saveUserProfile, getUserListeningProfile } from './services/db.js';
import { syncManager } from './services/sync.js';
// Initialize storage
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
// Initialize Hono Node WebSockets
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
// ----------------- SOUNDSYNC WEBSOCKET HANDLERS ----------------- //
function createRoomWSHandler(defaultRoomCode) {
    let currentRoom = null;
    let currentUserId = '';
    let currentUserName = '';
    let currentUserAvatar = '🎧';
    return {
        onOpen(event, ws) {
            // Socket connected
        },
        onMessage(event, ws) {
            try {
                const raw = typeof event.data === 'string' ? event.data : event.data.toString();
                const msg = JSON.parse(raw);
                const msgType = msg.type || msg.action;
                if (msgType === 'PING') {
                    ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
                    return;
                }
                if (msgType === 'JOIN' || msgType === 'JOIN_ROOM') {
                    const roomCode = (msg.room_code || msg.room || defaultRoomCode || 'OXYZEN').toUpperCase().trim();
                    currentUserId = msg.user_id || `user_${Math.floor(Date.now()) % 10000}`;
                    currentUserName = msg.user_name || msg.username || `Listener ${currentUserId.slice(-4)}`;
                    currentUserAvatar = msg.avatar || '🎧';
                    currentRoom = syncManager.getOrCreateRoom(roomCode, currentUserId, currentUserName);
                    currentRoom.addSocket(ws);
                    const listener = currentRoom.addListener(currentUserId, currentUserName, currentUserAvatar);
                    // Send immediate state back to joiner
                    ws.send(JSON.stringify({
                        type: 'ROOM_STATE',
                        room_code: currentRoom.code,
                        state: currentRoom.toStateDict(),
                        you: listener
                    }));
                    // Notify existing room members
                    currentRoom.broadcast({
                        type: 'USER_JOINED',
                        user: listener,
                        listener_count: currentRoom.listeners.size,
                        listeners: Array.from(currentRoom.listeners.values())
                    }, ws);
                    return;
                }
                if (!currentRoom)
                    return;
                if (msgType === 'SYNC_STATE' || msgType === 'PLAY_STATE') {
                    const isPlaying = msg.is_playing ?? msg.isPlaying ?? true;
                    const currentTime = msg.current_time ?? msg.currentTime ?? msg.position ?? 0;
                    currentRoom.updatePlayback(msg.track || msg.song, currentTime, isPlaying);
                    currentRoom.broadcast({
                        type: 'PLAY_STATE',
                        is_playing: isPlaying,
                        current_time: currentTime,
                        timestamp: msg.timestamp || Date.now() / 1000,
                        triggered_by: currentUserId
                    }, ws);
                }
                else if (msgType === 'PLAY_TRACK') {
                    const track = msg.track || msg.song;
                    const currentTime = msg.current_time || 0;
                    currentRoom.updatePlayback(track, currentTime, true);
                    currentRoom.broadcast({
                        type: 'PLAY_TRACK',
                        track: track,
                        current_time: currentTime,
                        triggered_by: currentUserId
                    }, ws);
                }
                else if (msgType === 'SEEK') {
                    const time = msg.time ?? msg.currentTime ?? 0;
                    currentRoom.position = time;
                    currentRoom.broadcast({
                        type: 'SEEK',
                        time: time,
                        triggered_by: currentUserId
                    }, ws);
                }
                else if (msgType === 'CHAT_MESSAGE') {
                    const text = (msg.text || '').trim();
                    if (text) {
                        const chatMsg = {
                            id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                            user_id: currentUserId,
                            user_name: currentUserName,
                            avatar: currentUserAvatar,
                            text: text.slice(0, 300),
                            timestamp: Date.now() / 1000
                        };
                        currentRoom.addChatMessage(chatMsg);
                        currentRoom.broadcast({
                            type: 'CHAT_MESSAGE',
                            ...chatMsg
                        });
                    }
                }
                else if (msgType === 'TYPING') {
                    currentRoom.broadcast({
                        type: 'USER_TYPING',
                        user_id: currentUserId,
                        user_name: currentUserName,
                        avatar: currentUserAvatar,
                        is_typing: !!msg.is_typing
                    }, ws);
                }
                else if (msgType === 'REACTION_PULSE') {
                    currentRoom.broadcast({
                        type: 'REACTION_PULSE',
                        user_id: currentUserId,
                        user_name: currentUserName,
                        emoji: msg.emoji || '🔥'
                    });
                }
                else if (msgType === 'REQUEST_SONG') {
                    if (msg.track) {
                        const req = currentRoom.addRequest(msg.track, currentUserId, currentUserName);
                        currentRoom.broadcast({
                            type: 'REQUEST_ADDED',
                            request: req,
                            requests: currentRoom.requests,
                            requester: { id: currentUserId, name: currentUserName }
                        });
                    }
                }
                else if (msgType === 'ACCEPT_REQUEST') {
                    const reqId = msg.request_id;
                    const req = currentRoom.requests.find(r => r.id === reqId);
                    if (req) {
                        currentRoom.dismissRequest(reqId);
                        if (msg.play_now) {
                            currentRoom.updatePlayback(req.track, 0, true);
                            currentRoom.broadcast({
                                type: 'PLAY_TRACK',
                                track: req.track,
                                current_time: 0,
                                triggered_by: currentUserId
                            });
                        }
                        else {
                            currentRoom.queue.push(req.track);
                            currentRoom.broadcast({
                                type: 'QUEUE_UPDATED',
                                queue: currentRoom.queue,
                                added_by: currentUserId
                            });
                        }
                        currentRoom.broadcast({
                            type: 'REQUEST_ACCEPTED',
                            request_id: reqId,
                            requests: currentRoom.requests
                        });
                    }
                }
                else if (msgType === 'DISMISS_REQUEST') {
                    currentRoom.dismissRequest(msg.request_id);
                    currentRoom.broadcast({
                        type: 'REQUEST_DISMISSED',
                        request_id: msg.request_id,
                        requests: currentRoom.requests
                    });
                }
                else if (msgType === 'ADD_QUEUE') {
                    if (msg.track) {
                        currentRoom.queue.push(msg.track);
                        currentRoom.broadcast({
                            type: 'QUEUE_UPDATED',
                            queue: currentRoom.queue,
                            added_by: currentUserId
                        });
                    }
                }
                else if (msgType === 'REMOVE_QUEUE') {
                    if (typeof msg.index === 'number' && msg.index >= 0 && msg.index < currentRoom.queue.length) {
                        currentRoom.queue.splice(msg.index, 1);
                        currentRoom.broadcast({
                            type: 'QUEUE_UPDATED',
                            queue: currentRoom.queue,
                            added_by: currentUserId
                        });
                    }
                }
                else if (msgType === 'PROMOTE_ADMIN') {
                    if (currentRoom.host_id === currentUserId && msg.target_user_id) {
                        currentRoom.admins.add(msg.target_user_id);
                        const targetListener = currentRoom.listeners.get(msg.target_user_id);
                        if (targetListener)
                            targetListener.is_admin = true;
                        currentRoom.broadcast({
                            type: 'ADMIN_UPDATED',
                            admins: Array.from(currentRoom.admins),
                            listeners: Array.from(currentRoom.listeners.values()),
                            message: `${targetListener ? targetListener.name : 'User'} is now a Co-Host Admin!`
                        });
                    }
                }
                else if (msgType === 'DEMOTE_ADMIN') {
                    if (currentRoom.host_id === currentUserId && msg.target_user_id) {
                        currentRoom.admins.delete(msg.target_user_id);
                        const targetListener = currentRoom.listeners.get(msg.target_user_id);
                        if (targetListener)
                            targetListener.is_admin = false;
                        currentRoom.broadcast({
                            type: 'ADMIN_UPDATED',
                            admins: Array.from(currentRoom.admins),
                            listeners: Array.from(currentRoom.listeners.values()),
                            message: `${targetListener ? targetListener.name : 'User'} is no longer an Admin.`
                        });
                    }
                }
                else if (msgType === 'TRANSFER_HOST') {
                    if (currentRoom.host_id === currentUserId && msg.target_user_id) {
                        currentRoom.host_id = msg.target_user_id;
                        for (const [uid, l] of currentRoom.listeners.entries()) {
                            l.is_host = (uid === msg.target_user_id);
                        }
                        currentRoom.broadcast({
                            type: 'HOST_CHANGED',
                            new_host_id: msg.target_user_id,
                            listeners: Array.from(currentRoom.listeners.values()),
                            admins: Array.from(currentRoom.admins)
                        });
                    }
                }
            }
            catch (err) {
                console.warn('Error processing WS message:', err);
            }
        },
        onClose(event, ws) {
            if (currentRoom && currentUserId) {
                currentRoom.removeSocket(ws);
                currentRoom.removeListener(currentUserId);
                if (currentRoom.listeners.size === 0 && currentRoom.sockets.size === 0) {
                    syncManager.deleteRoom(currentRoom.code);
                }
                else {
                    currentRoom.broadcast({
                        type: 'USER_LEFT',
                        user_id: currentUserId,
                        user_name: currentUserName,
                        listener_count: currentRoom.listeners.size,
                        listeners: Array.from(currentRoom.listeners.values()),
                        host_id: currentRoom.host_id
                    });
                }
            }
        },
        onError(event, ws) {
            console.warn('SoundSync WebSocket Error:', event);
        }
    };
}
// WebSocket Route at /ws (with ?room= query param)
app.get('/ws', upgradeWebSocket((c) => {
    const roomQuery = c.req.query('room') || c.req.query('code') || '';
    return createRoomWSHandler(roomQuery);
}));
// WebSocket Route at /ws/room/:room_code
app.get('/ws/room/:room_code', upgradeWebSocket((c) => {
    const roomCode = c.req.param('room_code');
    return createRoomWSHandler(roomCode);
}));
// ----------------- HEALTH & SYSTEM ----------------- //
app.get('/health', (c) => {
    return c.json({
        status: 'healthy',
        service: 'OXYZEN Luxury Music Platform',
        engine: 'Hono + JioSaavn + SoundSync WebSocket 2.0',
        version: '2.0.0',
        time: Date.now() / 1000
    });
});
// ----------------- SEARCH & SUGGESTIONS ----------------- //
app.get('/api/suggestions', async (c) => {
    const q = c.req.query('q') || '';
    if (!q.trim())
        return c.json({ query: '', suggestions: [] });
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
    }
    catch (err) {
        console.error(`Search error for "${q}":`, err);
        return c.json({ query: q, total: 0, page, results: [], tracks: [], error: err.message }, 500);
    }
});
// ----------------- SONG DETAILS & STREAM RESOLUTION ----------------- //
app.get('/api/song/:id', async (c) => {
    const id = c.req.param('id');
    if (!id)
        return c.json({ error: 'Song ID is required' }, 400);
    try {
        const song = await getSongDetails(id);
        if (!song) {
            return c.json({ error: 'Song not found' }, 404);
        }
        return c.json(song);
    }
    catch (err) {
        console.error(`Error resolving song ${id}:`, err);
        return c.json({ error: err.message }, 500);
    }
});
// Alias for stream_info to ensure 100% backward compatibility
app.get('/api/stream_info/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const song = await getSongDetails(id);
        if (!song)
            return c.json({ error: 'Track not found' }, 404);
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
    }
    catch (err) {
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
        if (song.stream_url.startsWith('http')) {
            return c.redirect(song.stream_url, 302);
        }
        return c.json({ error: 'Stream URL not available' }, 404);
    }
    catch (err) {
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
app.all('/api/explore', async (c) => {
    let profile = getUserListeningProfile();
    let currentTrack = undefined;
    let customHistory = undefined;
    if (c.req.method === 'POST') {
        try {
            const body = await c.req.json();
            if (body.languages && Array.isArray(body.languages)) {
                profile.languages = body.languages;
            }
            if (body.history && Array.isArray(body.history)) {
                customHistory = body.history;
            }
            if (body.likes && Array.isArray(body.likes)) {
                profile.likes = body.likes;
            }
            if (body.currentTrack) {
                currentTrack = body.currentTrack;
            }
        }
        catch (e) { }
    }
    else {
        const langsParam = c.req.query('languages');
        if (langsParam) {
            profile.languages = langsParam.split(',').map((l) => l.trim()).filter((l) => l.length > 0);
        }
        const currentTrackTitle = c.req.query('current_track_title');
        if (currentTrackTitle) {
            currentTrack = {
                id: c.req.query('current_track_id'),
                title: currentTrackTitle,
                artist: c.req.query('current_track_artist'),
                language: c.req.query('current_track_lang')
            };
        }
    }
    if (customHistory && customHistory.length > 0) {
        profile.history = customHistory;
    }
    const feed = await getExploreFeed(profile, currentTrack);
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
    const targetLang = c.req.query('language') || c.req.query('lang');
    const langs = langsParam ? langsParam.split(',').map(l => l.trim()).filter(Boolean) : ['Hindi', 'English'];
    const feed = await getMoodFeed(moodKey, langs, targetLang);
    return c.json(feed);
});
app.get('/api/recommendations', async (c) => {
    const songId = c.req.query('video_id') || c.req.query('song_id') || c.req.query('id');
    const artist = c.req.query('artist');
    const title = c.req.query('title');
    const language = c.req.query('language') || c.req.query('lang');
    const recommendations = await getVibeRecommendations(songId, artist, title, language);
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
app.post('/api/playlist/import', async (c) => {
    try {
        const payload = await c.req.json().catch(() => ({}));
        const url = payload.url;
        if (!url || typeof url !== 'string') {
            return c.json({ success: false, error: 'Please provide a valid JioSaavn or Spotify playlist URL' }, 400);
        }
        const imported = await importPlaylistFromUrl(url);
        return c.json(imported);
    }
    catch (err) {
        return c.json({ success: false, error: err.message || 'Failed to import playlist' }, 400);
    }
});
app.get('/api/library/playlists/:id', (c) => {
    const id = c.req.param('id');
    const pl = getPlaylistDetails(id);
    if (!pl)
        return c.json({ error: 'Playlist not found' }, 404);
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
// ----------------- SOUNDSYNC REST ENDPOINTS ----------------- //
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
    if (!room)
        return c.json({ error: 'Listening room not found' }, 404);
    return c.json(room.toStateDict());
});
app.post('/api/rooms/:code/sync', async (c) => {
    const code = c.req.param('code');
    const room = syncManager.getRoom(code);
    if (!room)
        return c.json({ error: 'Listening room not found' }, 404);
    const body = await c.req.json().catch(() => ({}));
    if (body.current_track) {
        room.updatePlayback(body.current_track, body.position || 0, body.is_playing ?? true);
    }
    return c.json(room.toStateDict());
});
// ----------------- DIRECT DOWNLOAD ----------------- //
app.get('/api/download/:id', async (c) => {
    const id = c.req.param('id');
    try {
        const song = await getSongDetails(id);
        if (!song || !song.stream_url) {
            return c.json({ error: 'Download link not available' }, 404);
        }
        return c.redirect(song.stream_url, 302);
    }
    catch (err) {
        return c.json({ error: err.message }, 500);
    }
});
// ----------------- STATIC FILES & FRONTEND ----------------- //
const STATIC_DIR = path.resolve(process.cwd(), 'static');
// Serve static assets from /static/*
app.use('/static/*', serveStatic({ root: './' }));
// Serve Service Worker at root /sw.js with global scope
app.get('/sw.js', (c) => {
    const swPath = path.join(STATIC_DIR, 'sw.js');
    if (fs.existsSync(swPath)) {
        c.header('Content-Type', 'application/javascript; charset=utf-8');
        c.header('Service-Worker-Allowed', '/');
        return c.body(fs.readFileSync(swPath, 'utf-8'));
    }
    return c.text('Not found', 404);
});
// Serve main index.html for root /
app.get('/', (c) => {
    const indexPath = path.join(STATIC_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
        const html = fs.readFileSync(indexPath, 'utf-8');
        return c.html(html);
    }
    return c.text('Oxyzen Music Platform - Loading...');
});
// Start Server
const port = parseInt(process.env.PORT || '8000', 10);
const host = process.env.HOST || '0.0.0.0';
console.log(`==================================================`);
console.log(`✦ OXYZEN LUXURY MUSIC ENGINE RUNNING ON http://localhost:${port} ✦`);
console.log(`✦ WebSocket SoundSync Active on ws://localhost:${port}/ws ✦`);
console.log(`==================================================`);
const server = serve({
    fetch: app.fetch,
    port,
    hostname: host
});
// Inject WebSockets into the Node HTTP server
injectWebSocket(server);
