/**
 * JioSaavn API Service for Oxyzen
 * Handles track search, stream URL generation (320kbps Akamai CDN), high-res artwork,
 * explore feeds, multilingual mood stations, autocomplete, and acoustic vibe radar.
 */
const SAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php';
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8,te;q=0.7',
    'Cookie': 'L=hindi%2Cenglish%2Ctelugu%2Ctamil%2Cpunjabi;'
};
const streamUrlCache = new Map();
/**
 * Decodes HTML entities commonly returned by JioSaavn
 */
export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string')
        return '';
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
/**
 * Enhances JioSaavn image URL to high definition (500x500)
 */
export function formatImageUrl(url, quality = '500x500') {
    if (!url || typeof url !== 'string')
        return '/static/assets/logo.png';
    return url
        .replace(/50x50/g, quality)
        .replace(/150x150/g, quality)
        .replace(/^http:\/\//, 'https://');
}
/**
 * Formats duration in seconds to mm:ss format
 */
export function formatDuration(seconds) {
    if (!seconds || isNaN(seconds))
        return '3:30';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
/**
 * Generates direct high-bitrate CDN audio stream links (320kbps, 160kbps, 96kbps, 48kbps, 12kbps)
 * from an encrypted media URL using JioSaavn's song.generateAuthToken on Akamai CDN.
 */
export async function generateStreamUrls(encryptedUrl) {
    if (!encryptedUrl)
        return [];
    if (streamUrlCache.has(encryptedUrl)) {
        return streamUrlCache.get(encryptedUrl);
    }
    try {
        const authUrl = `${SAAVN_BASE_URL}?__call=song.generateAuthToken&_format=json&_marker=0&cc=in&url=${encodeURIComponent(encryptedUrl)}&bitrate=96`;
        const res = await fetch(authUrl, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            throw new Error(`generateAuthToken failed: ${res.status}`);
        const data = await res.json();
        if (data && typeof data.auth_url === 'string') {
            const rawBase = data.auth_url.split('?')[0];
            // Normalize to Akamai open streaming host
            const normalizedBase = rawBase.replace(/^https?:\/\/[^\/]+/, 'https://aac.saavncdn.com');
            const qualities = [
                { bitrate: '12kbps', url: normalizedBase.replace('_96', '_12') },
                { bitrate: '48kbps', url: normalizedBase.replace('_96', '_48') },
                { bitrate: '96kbps', url: normalizedBase.replace('_96', '_96') },
                { bitrate: '160kbps', url: normalizedBase.replace('_96', '_160') },
                { bitrate: '320kbps', url: normalizedBase.replace('_96', '_320') },
            ];
            streamUrlCache.set(encryptedUrl, qualities);
            return qualities;
        }
    }
    catch (err) {
        console.warn('Failed to generate stream URLs via generateAuthToken:', err);
    }
    return [];
}
/**
 * Normalizes raw JioSaavn song object into Oxyzen's clean FormattedSong model
 */
export async function formatSongObject(raw, resolveStreams = true) {
    const id = String(raw.id || raw.songId || '');
    const title = decodeHtmlEntities(raw.song || raw.title || 'Unknown Title');
    const artist = decodeHtmlEntities(raw.primary_artists || raw.singers || raw.music || raw.artist || (raw.more_info && raw.more_info.primary_artists) || 'Unknown Artist');
    const album = decodeHtmlEntities(raw.album || (raw.more_info && raw.more_info.album) || 'Single');
    const rawImage = raw.image || (raw.more_info && raw.more_info.image) || '';
    const image = formatImageUrl(rawImage, '500x500');
    const durationSec = parseInt(String(raw.duration || (raw.more_info && raw.more_info.duration) || 210), 10) || 210;
    const encryptedUrl = raw.encrypted_media_url || (raw.more_info && raw.more_info.encrypted_media_url) || '';
    const hasLyrics = raw.has_lyrics === 'true' || raw.has_lyrics === true || (raw.more_info && raw.more_info.has_lyrics === 'true');
    let downloadUrl = [];
    let streamUrl = '';
    if (resolveStreams && encryptedUrl) {
        downloadUrl = await generateStreamUrls(encryptedUrl);
        if (downloadUrl.length > 0) {
            // 320kbps is the last item in the array
            const highest = downloadUrl[downloadUrl.length - 1];
            streamUrl = highest.url;
        }
    }
    if (!streamUrl) {
        streamUrl = `/api/stream/${id}`;
    }
    return {
        id,
        videoId: id,
        title,
        artist,
        album,
        image,
        thumbnail: image,
        duration: durationSec,
        duration_sec: durationSec,
        duration_formatted: formatDuration(durationSec),
        language: String(raw.language || 'hindi').toLowerCase(),
        year: raw.year || (raw.more_info && raw.more_info.year) || '',
        has_lyrics: hasLyrics,
        downloadUrl,
        stream_url: streamUrl,
        direct_url: streamUrl,
        encrypted_media_url: encryptedUrl,
        perma_url: raw.perma_url || (raw.more_info && raw.more_info.perma_url),
        copyright: raw.copyright_text || ''
    };
}
/**
 * Searches JioSaavn for tracks matching query
 */
export async function searchSongs(query, page = 1, limit = 30) {
    if (!query || !query.trim()) {
        return { query: '', total: 0, page, results: [] };
    }
    try {
        const url = `${SAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=${page}&n=${limit}&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok) {
            throw new Error(`JioSaavn search failed with status ${res.status}`);
        }
        const data = await res.json();
        const rawResults = Array.isArray(data.results) ? data.results : [];
        const total = parseInt(String(data.total || rawResults.length), 10) || rawResults.length;
        // Resolve stream URLs in parallel
        const results = await Promise.all(rawResults.map((raw) => formatSongObject(raw, true)));
        return {
            query,
            total,
            page,
            results
        };
    }
    catch (err) {
        console.error(`Search error for "${query}":`, err);
        return { query, total: 0, page, results: [] };
    }
}
/**
 * Fetches full details for a single song ID
 */
export async function getSongDetails(songId) {
    if (!songId)
        return null;
    try {
        const url = `${SAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${encodeURIComponent(songId)}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok) {
            throw new Error(`JioSaavn song details failed with status ${res.status}`);
        }
        const data = await res.json();
        const rawSong = data[songId] || (Array.isArray(data.songs) ? data.songs[0] : null) || Object.values(data)[0];
        if (!rawSong || typeof rawSong !== 'object' || !rawSong.id) {
            return null;
        }
        return await formatSongObject(rawSong, true);
    }
    catch (err) {
        console.error(`Error in getSongDetails for ${songId}:`, err);
        return null;
    }
}
/**
 * Fetches search autocomplete suggestions
 */
export async function getSearchSuggestions(query) {
    if (!query || !query.trim())
        return [];
    try {
        const url = `${SAAVN_BASE_URL}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            return [];
        const data = await res.json();
        const suggestions = [];
        if (data.topquery && Array.isArray(data.topquery.data)) {
            for (const item of data.topquery.data) {
                if (item.title)
                    suggestions.push(decodeHtmlEntities(item.title));
            }
        }
        if (data.songs && Array.isArray(data.songs.data)) {
            for (const song of data.songs.data) {
                const title = decodeHtmlEntities(song.title);
                const artist = decodeHtmlEntities(song.more_info?.primary_artists || song.description || '');
                suggestions.push(artist ? `${title} - ${artist}` : title);
            }
        }
        if (data.albums && Array.isArray(data.albums.data)) {
            for (const album of data.albums.data) {
                if (album.title)
                    suggestions.push(decodeHtmlEntities(album.title));
            }
        }
        return Array.from(new Set(suggestions)).slice(0, 10);
    }
    catch (err) {
        console.warn('Error fetching search suggestions:', err);
        return [];
    }
}
/**
 * Fetches trending tracks from JioSaavn with robust search fallback
 */
export async function getTrending() {
    try {
        const fallback = await searchSongs('Trending India Hits 2026', 1, 25);
        return {
            songs: fallback.results,
            albums: [],
            playlists: []
        };
    }
    catch (err) {
        console.warn('Error in getTrending:', err);
        return { songs: [], albums: [], playlists: [] };
    }
}
/**
 * Fetches top charts and editorial playlists
 */
export async function getCharts() {
    try {
        const url = `${SAAVN_BASE_URL}?__call=content.getCharts&_format=json&_marker=0&cc=in`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            throw new Error(`getCharts failed: ${res.status}`);
        const data = await res.json();
        const rawList = Array.isArray(data) ? data : [];
        return rawList.map((item) => ({
            id: item.id || item.listid,
            title: decodeHtmlEntities(item.title || item.listname),
            image: formatImageUrl(item.image, '500x500'),
            count: item.count || 50,
            type: 'playlist',
            perma_url: item.perma_url
        }));
    }
    catch (err) {
        console.warn('Error fetching charts:', err);
        return [];
    }
}
/**
 * Curated Explore Feed organized into luxury sections
 */
export async function getExploreFeed(profile) {
    try {
        const [trendingRes, bollywoodRes, globalRes, southRes, lofiRes, partyRes, punjabiRes] = await Promise.all([
            searchSongs('Trending India Top Hits', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Latest Bollywood Blockbusters', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Billboard Global Top 50 Hits', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Latest Telugu Superhits', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Midnight Bollywood Lofi Chill', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Club EDM High Energy Dance', 1, 12).catch(() => ({ results: [] })),
            searchSongs('Top Punjabi Beats Sidhu Moose Wala Diljit', 1, 12).catch(() => ({ results: [] }))
        ]);
        const heroTrack = trendingRes.results[0] || bollywoodRes.results[0] || null;
        const hero = heroTrack
            ? {
                id: heroTrack.id,
                title: heroTrack.title,
                subtitle: `${heroTrack.artist} • ${heroTrack.album}`,
                image: heroTrack.image,
                track: heroTrack,
                badge: 'FEATURED MASTER'
            }
            : null;
        const sections = [
            {
                id: 'trending_now',
                title: '🔥 Trending Now',
                tagline: 'The hottest tracks spinning right now across the nation',
                badge: 'HOT',
                color: '#F5C542',
                tracks: trendingRes.results.length > 0 ? trendingRes.results : bollywoodRes.results
            },
            {
                id: 'bollywood_spotlight',
                title: '✨ Bollywood Spotlight',
                tagline: 'Latest cinema chart-toppers & soulful melodies',
                badge: 'PREMIERE',
                color: '#A855F7',
                tracks: bollywoodRes.results
            },
            {
                id: 'global_hits',
                title: '🌍 Global Top Anthems',
                tagline: 'Worldwide viral sensation tracks & Billboard chart-toppers',
                badge: 'GLOBAL',
                color: '#22D3EE',
                tracks: globalRes.results
            },
            {
                id: 'south_wave',
                title: '🌟 South Cinema Wave',
                tagline: 'High-octane Telugu & Tamil blockbuster soundtracks',
                badge: 'MASS',
                color: '#F97316',
                tracks: southRes.results
            },
            {
                id: 'lofi_chill',
                title: '🌙 Midnight Lofi & Chill',
                tagline: 'Relaxing ambient beats for late night vibes & deep focus',
                badge: 'ZEN',
                color: '#10B981',
                tracks: lofiRes.results
            },
            {
                id: 'party_edm',
                title: '⚡ High Energy Party & EDM',
                tagline: 'Bass-heavy club bangers to ignite the floor',
                badge: 'CLUB',
                color: '#EF4444',
                tracks: partyRes.results
            },
            {
                id: 'punjabi_swag',
                title: '🔥 Punjabi Swag & Hip-Hop',
                tagline: 'Loud brass, 808 bass, and heavy urban rhythms',
                badge: 'SWAG',
                color: '#EC4899',
                tracks: punjabiRes.results
            }
        ].filter(s => s.tracks && s.tracks.length > 0);
        return { hero, sections };
    }
    catch (err) {
        console.error('Error generating explore feed:', err);
        const searchRes = await searchSongs('Top India Hits', 1, 20);
        return {
            hero: searchRes.results[0] || null,
            sections: [
                {
                    id: 'trending',
                    title: '🔥 Trending Hits',
                    tagline: 'Top high-fidelity audio streams',
                    badge: 'FEATURED',
                    color: '#F5C542',
                    tracks: searchRes.results
                }
            ]
        };
    }
}
/**
 * Mood categories definition - fully aligned with all frontend shortcut keys
 */
export function getMoodCategories() {
    return [
        {
            id: 'love',
            key: 'love',
            name: 'Romantic Love & Melodies',
            icon: '💖',
            tagline: 'Heartfelt acoustics, romantic duets, and timeless love ballads',
            query: 'Love Songs',
            color: '#EC4899',
            gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'breakup',
            key: 'breakup',
            name: 'Breakup & Heartbreak',
            icon: '💔',
            tagline: 'Soulful melancholy, emotional vocals, and deep healing cuts',
            query: 'Breakup Songs',
            color: '#8B5CF6',
            gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'feel_good',
            key: 'feel_good',
            name: 'Feel Good & Uplifting',
            icon: '☀️',
            tagline: 'Bright acoustic chords, joyful rhythms, and sunny optimism',
            query: 'Feel Good Songs',
            color: '#F59E0B',
            gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'rock',
            key: 'rock',
            name: 'Rock, Metal & Heavy Riffs',
            icon: '⚡',
            tagline: 'Electric distortion, explosive drums, and legendary guitar anthems',
            query: 'Rock Songs',
            color: '#EF4444',
            gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'heroic',
            key: 'heroic',
            name: 'Heroic & Epic Cinema',
            icon: '🛡️',
            tagline: 'Massive orchestral builds, thundering brass, and cinematic soundtracks',
            query: 'Epic Cinema Soundtracks',
            color: '#3B82F6',
            gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'lofi',
            key: 'lofi',
            name: 'Midnight Lofi & Chill',
            icon: '🌌',
            tagline: 'Mellow Rhodes chords, rain textures, and cozy bedroom beats',
            query: 'Lofi Songs',
            color: '#10B981',
            gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'workout',
            key: 'workout',
            name: 'Workout & Gym Pump',
            icon: '🔥',
            tagline: 'High-BPM adrenaline, phonk drops, and heavy workout motivation',
            query: 'Workout Songs',
            color: '#F43F5E',
            gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'party',
            key: 'party',
            name: 'Party, Club & EDM Drops',
            icon: '💃',
            tagline: 'Floor-filling basslines, celebratory drops, and festival bangers',
            query: 'Party Hits',
            color: '#A855F7',
            gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(17, 17, 24, 0.95))'
        },
        {
            id: 'sad',
            key: 'sad',
            name: 'Soulful Melancholy',
            icon: '🌧️',
            tagline: 'Poignant lyricism, gentle piano, and introspective soundscapes',
            query: 'Sad Songs',
            color: '#64748B',
            gradient: 'linear-gradient(135deg, rgba(100, 116, 139, 0.22), rgba(17, 17, 24, 0.95))'
        }
    ];
}
/**
 * Mood feed tracks with multilingual customization
 */
export async function getMoodFeed(moodKey, languages = ['Hindi', 'English', 'Telugu']) {
    const categories = getMoodCategories();
    const normalizedKey = (moodKey || 'love').toLowerCase().trim();
    const category = categories.find((c) => c.key === normalizedKey || c.id === normalizedKey) || categories[0];
    const primaryLang = languages[0] || 'Hindi';
    let res = await searchSongs(`${primaryLang} ${category.query}`, 1, 30);
    if (res.results.length < 5) {
        res = await searchSongs(category.query, 1, 30);
    }
    return {
        mood: category,
        tracks: res.results
    };
}
/**
 * Smart track and acoustic vibe recommendations
 */
export async function getVibeRecommendations(songId, artist, title) {
    try {
        let query = '';
        if (artist && artist !== 'Unknown Artist') {
            const cleanArtist = artist.split(',')[0].split('&')[0].trim();
            query = `${cleanArtist} best songs hits`;
        }
        else if (title) {
            const cleanTitle = title.replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '').trim();
            query = `${cleanTitle} mix recommendations`;
        }
        else {
            query = 'Top Acoustic Hi-Fi Hits';
        }
        const res = await searchSongs(query, 1, 18);
        // Filter out the active track to return 10 distinct kindred tracks
        return res.results.filter((t) => t.id !== songId).slice(0, 12);
    }
    catch (err) {
        console.warn('Error fetching vibe recommendations:', err);
        return [];
    }
}
