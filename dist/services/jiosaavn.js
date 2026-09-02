/**
 * High-Performance JioSaavn API Service for Oxyzen 2.0
 * Features direct 320kbps Akamai CDN stream extraction,
 * deep multilingual mood matching, and hyper-accurate kindred vibe radar.
 */
const SAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php';
const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8,te;q=0.7',
    'Referer': 'https://www.jiosaavn.com/',
};
// In-memory cache for fast repeat lookups
const streamUrlCache = new Map();
const searchCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Decodes HTML entities commonly returned by JioSaavn
 */
function decodeHtmlEntities(str) {
    if (!str)
        return '';
    return str
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&#039;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&apos;/g, "'")
        .trim();
}
/**
 * Extracts and replaces JioSaavn low-res image URLs with pristine 500x500 resolution
 */
function formatImageUrl(imageUrl, quality = '500x500') {
    if (!imageUrl)
        return '/static/assets/logo.png';
    let formatted = imageUrl.replace(/^http:\/\//, 'https://');
    formatted = formatted.replace(/_\d+x\d+\.(?:jpg|png|jpeg)/i, `_${quality}.jpg`);
    formatted = formatted.replace(/-\d+x\d+\.(?:jpg|png|jpeg)/i, `-${quality}.jpg`);
    return formatted;
}
/**
 * Formats seconds into mm:ss format
 */
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds <= 0)
        return '3:30';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
/**
 * Generates direct high-bitrate CDN audio stream links (320kbps, 160kbps, 96kbps)
 * Uses clean unexpired Akamai CDN URLs on https://aac.saavncdn.com with full CORS & Range 206 support.
 */
export async function generateStreamUrls(encryptedUrl) {
    if (!encryptedUrl)
        return [];
    if (streamUrlCache.has(encryptedUrl)) {
        return streamUrlCache.get(encryptedUrl);
    }
    try {
        const authUrl = `${SAAVN_BASE_URL}?__call=song.generateAuthToken&_format=json&_marker=0&cc=in&url=${encodeURIComponent(encryptedUrl)}&bitrate=320`;
        const res = await fetch(authUrl, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            throw new Error(`generateAuthToken failed: ${res.status}`);
        const data = await res.json();
        if (data && typeof data.auth_url === 'string') {
            // Clean query string parameters (which have expiring tokens) to produce permanent Akamai CDN URLs
            const rawBase = data.auth_url.split('?')[0];
            const normalizedBase = rawBase.replace(/^https?:\/\/[^\/]+/, 'https://aac.saavncdn.com');
            // Strip existing bitrate suffix to prevent _320_160 duplicates
            const cleanStem = normalizedBase.replace(/_(?:12|48|96|160|320)(?:\.mp4|\.m4a)?$/i, '');
            const qualities = [
                { bitrate: '96kbps', url: `${cleanStem}_96.mp4` },
                { bitrate: '160kbps', url: `${cleanStem}_160.mp4` },
                { bitrate: '320kbps', url: `${cleanStem}_320.mp4` },
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
    const language = raw.language || (raw.more_info && raw.more_info.language) || '';
    let downloadUrl = [];
    let streamUrl = '';
    if (resolveStreams && encryptedUrl) {
        downloadUrl = await generateStreamUrls(encryptedUrl);
        if (downloadUrl.length > 0) {
            // Prioritize 320kbps master stream
            const highest = downloadUrl[downloadUrl.length - 1];
            streamUrl = highest.url;
        }
    }
    return {
        id,
        title,
        artist,
        album,
        image,
        thumbnail: image,
        duration: formatDuration(durationSec),
        duration_sec: durationSec,
        duration_formatted: formatDuration(durationSec),
        year: raw.year || (raw.more_info && raw.more_info.year) || '',
        language,
        has_lyrics: hasLyrics,
        stream_url: streamUrl,
        downloadUrl,
    };
}
/**
 * Searches songs on JioSaavn with pagination and caching
 */
export async function searchSongs(query, page = 1, limit = 20) {
    if (!query || !query.trim()) {
        return { results: [], total: 0, start: 0 };
    }
    const cacheKey = `search_${query.trim().toLowerCase()}_p${page}_l${limit}`;
    if (searchCache.has(cacheKey)) {
        const cached = searchCache.get(cacheKey);
        if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
            return cached.data;
        }
    }
    try {
        const url = `${SAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=${page}&n=${limit}&q=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            throw new Error(`Search API HTTP ${res.status}`);
        const data = await res.json();
        const rawResults = data.results || (data.data && data.data.results) || [];
        const total = parseInt(String(data.total || 0), 10) || rawResults.length;
        const start = parseInt(String(data.start || 0), 10);
        const formatPromises = rawResults.map((raw) => formatSongObject(raw, true));
        const results = await Promise.all(formatPromises);
        const out = { results, total, start };
        searchCache.set(cacheKey, { timestamp: Date.now(), data: out });
        return out;
    }
    catch (err) {
        console.error('JioSaavn search error:', err);
        return { results: [], total: 0, start: 0 };
    }
}
/**
 * Search suggestions autocomplete for searchbar
 */
export async function getSearchSuggestions(query) {
    if (!query || query.trim().length < 2)
        return [];
    try {
        const url = `${SAAVN_BASE_URL}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            return [];
        const data = await res.json();
        const suggestions = [];
        if (data.songs && Array.isArray(data.songs.data)) {
            data.songs.data.slice(0, 5).forEach((s) => {
                if (s.title)
                    suggestions.push(decodeHtmlEntities(s.title));
            });
        }
        if (data.albums && Array.isArray(data.albums.data)) {
            data.albums.data.slice(0, 3).forEach((a) => {
                if (a.title)
                    suggestions.push(decodeHtmlEntities(a.title));
            });
        }
        if (data.artists && Array.isArray(data.artists.data)) {
            data.artists.data.slice(0, 3).forEach((ar) => {
                if (ar.name)
                    suggestions.push(decodeHtmlEntities(ar.name));
            });
        }
        return Array.from(new Set(suggestions)).slice(0, 8);
    }
    catch (err) {
        console.warn('Error fetching search suggestions:', err);
        return [];
    }
}
/**
 * Resolves full song details by JioSaavn song ID
 */
export async function getSongDetails(songId) {
    if (!songId)
        return null;
    try {
        const url = `${SAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${songId}`;
        const res = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!res.ok)
            return null;
        const data = await res.json();
        const rawSong = data[songId];
        if (!rawSong)
            return null;
        return await formatSongObject(rawSong, true);
    }
    catch (err) {
        console.error(`Error retrieving song details for ${songId}:`, err);
        return null;
    }
}
/**
 * Top trending tracks in India
 */
export async function getTrending() {
    try {
        const res = await searchSongs('Trending India Hits Top 50', 1, 25);
        return { tracks: res.results };
    }
    catch (err) {
        return { tracks: [] };
    }
}
/**
 * Popular charts definition
 */
export async function getCharts() {
    return [
        { id: 'trending_india', title: 'Trending India 50', image: '/static/assets/logo.png', count: 50 },
        { id: 'telugu_superhits', title: 'Telugu Chartbusters', image: '/static/assets/logo.png', count: 50 },
        { id: 'hindi_romantic', title: 'Hindi Romantic Hits', image: '/static/assets/logo.png', count: 50 },
        { id: 'global_top_50', title: 'Global Top 50', image: '/static/assets/logo.png', count: 50 },
        { id: 'punjabi_bangers', title: 'Punjabi Fresh Hits', image: '/static/assets/logo.png', count: 50 },
        { id: 'tamil_mass', title: 'Tamil Blockbuster Beats', image: '/static/assets/logo.png', count: 50 }
    ];
}
/**
 * Deep Kindred Vibe Radar recommendations algorithm
 * Adapts to the genre and language of the playing song (and artist/composer style)
 * rather than searching for song title words. Returns 50+ deduplicated songs!
 */
export async function getVibeRecommendations(songId, artist, title, language) {
    try {
        const lang = (language && language.trim()) ? language.trim() : 'Telugu';
        // Artist / Composer extractions
        const artistParts = (artist || '').split(/[,&/|]/).map(a => a.trim()).filter(a => a.length > 0 && a !== 'Unknown Artist');
        const primaryArtist = artistParts[0] || '';
        const secondaryArtist = artistParts[1] || '';
        const queries = [];
        // 1. Language & Artist Genre Catalog
        if (primaryArtist) {
            queries.push(`${lang} ${primaryArtist} Top Hits`);
            queries.push(`${lang} ${primaryArtist} Best Melodies`);
            queries.push(`${lang} ${primaryArtist} Chartbusters`);
        }
        if (secondaryArtist) {
            queries.push(`${lang} ${secondaryArtist} Melodies`);
        }
        // 2. Language Genre & Musical Style Anthems (NOT song title words)
        queries.push(`${lang} Romantic Melodies Chartbusters`);
        queries.push(`${lang} Superhit Movie Melodies`);
        queries.push(`${lang} Trending Beats and Hits`);
        queries.push(`${lang} Acoustic Chill Songs`);
        // Execute multi-query search in parallel across multiple pages
        const searchPromises = [];
        for (const q of queries) {
            searchPromises.push(searchSongs(q, 1, 20).catch(() => ({ results: [] })));
            searchPromises.push(searchSongs(q, 2, 20).catch(() => ({ results: [] })));
        }
        const resultsArrays = await Promise.all(searchPromises);
        const mergedTracks = [];
        const seenIds = new Set();
        if (songId)
            seenIds.add(songId);
        for (const res of resultsArrays) {
            for (const track of res.results) {
                if (!seenIds.has(track.id)) {
                    seenIds.add(track.id);
                    mergedTracks.push(track);
                }
            }
        }
        // Ensure plenty of songs (at least 50 songs)
        if (mergedTracks.length < 50) {
            const fallbackRes = await searchSongs(`${lang} evergreen melodies superhits`, 1, 40);
            for (const track of fallbackRes.results) {
                if (!seenIds.has(track.id)) {
                    seenIds.add(track.id);
                    mergedTracks.push(track);
                }
            }
        }
        return mergedTracks.slice(0, 50);
    }
    catch (err) {
        console.warn('Error in getVibeRecommendations:', err);
        return [];
    }
}
/**
 * Explore feed generation:
 * - NEW USER: Top English Trending hits + Nationwide & Regional Chartbusters (strictly non-repeated, 500x500 covers)
 * - REGULAR USER: Adapted to user's full history AND liked songs (matching genres, artists, and languages without title repetition)
 */
export async function getExploreFeed(profile, currentTrack) {
    try {
        const userLangs = (profile && profile.languages && profile.languages.length > 0)
            ? profile.languages
            : ['Telugu', 'Hindi', 'English'];
        const lang1 = userLangs[0] || 'Telugu';
        const lang2 = userLangs[1] || 'Hindi';
        const historyList = (profile && profile.history && Array.isArray(profile.history)) ? profile.history : [];
        const likesList = (profile && profile.likes && Array.isArray(profile.likes)) ? profile.likes : [];
        const userCombinedTracks = [...likesList, ...historyList];
        const isNewUser = userCombinedTracks.length === 0;
        const globalSeenIds = new Set();
        const sections = [];
        if (isNewUser) {
            // ================= NEW USER FEED =================
            // 1. Global English Trending Hits
            // 2. Primary Language Trending Hits
            // 3. Nationwide Indian Blockbusters
            // 4. Evergreen Masterpiece Melodies
            // 5. Party Dance & Club Bangers
            const [englishPopRes, globalTopRes, langHitsRes, langTrendingRes, trendingIndiaRes, hindiMelodyRes, evergreenRes, partyRes] = await Promise.all([
                searchSongs(`English Pop Hits`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`Global Top 50`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`${lang1} Top Hits`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`${lang1} Trending Hits`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`Trending India`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`Hindi Romantic Melodies`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`${lang1} Evergreen Melodies`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`${lang1} Party Dance Hits`, 1, 25).catch(() => ({ results: [] }))
            ]);
            const dedupeTracks = (list, limit = 30) => {
                const out = [];
                for (const t of list) {
                    if (!globalSeenIds.has(t.id)) {
                        globalSeenIds.add(t.id);
                        out.push(t);
                        if (out.length >= limit)
                            break;
                    }
                }
                return out;
            };
            const englishTracks = dedupeTracks([...(englishPopRes.results || []), ...(globalTopRes.results || [])], 30);
            const regionalTracks = dedupeTracks([...(langHitsRes.results || []), ...(langTrendingRes.results || [])], 30);
            const nationwideTracks = dedupeTracks([...(trendingIndiaRes.results || []), ...(hindiMelodyRes.results || [])], 30);
            const classicTracks = dedupeTracks(evergreenRes.results || [], 25);
            const partyTracks = dedupeTracks(partyRes.results || [], 25);
            const hero = regionalTracks[0] || englishTracks[0] || nationwideTracks[0] || null;
            if (englishTracks.length > 0) {
                sections.push({
                    id: 'trending_english_hits',
                    title: '🌐 Global & English Trending Chartbusters',
                    tagline: 'Billboard Hot 100, viral sensation pop, and international hits',
                    badge: 'GLOBAL POP',
                    color: '#38BDF8',
                    tracks: englishTracks
                });
            }
            if (regionalTracks.length > 0) {
                sections.push({
                    id: 'popular_chartbusters',
                    title: `🔥 All-Time Popular & Trending Hits in ${lang1}`,
                    tagline: `Top streamed tracks and viral blockbusters in ${lang1}`,
                    badge: 'HOTTEST HITS',
                    color: '#F5C542',
                    tracks: regionalTracks
                });
            }
            if (nationwideTracks.length > 0) {
                sections.push({
                    id: 'nationwide_chartbusters',
                    title: `🌟 Nationwide & Bollywood Blockbusters`,
                    tagline: 'Mega-streamed anthems, cinematic romantic melodies, and trending tracks',
                    badge: 'TOP INDIA',
                    color: '#EC4899',
                    tracks: nationwideTracks
                });
            }
            if (classicTracks.length > 0) {
                sections.push({
                    id: 'evergreen_classics',
                    title: `💎 All-Time Masterpiece Melodies (${lang1})`,
                    tagline: 'Unforgettable musical milestones and essential acoustic melodies',
                    badge: 'LEGENDARY',
                    color: '#10B981',
                    tracks: classicTracks
                });
            }
            if (partyTracks.length > 0) {
                sections.push({
                    id: 'party_bangers',
                    title: `🚀 High-Energy Party & Dancefloor Hits`,
                    tagline: 'Bass-boosted club bangers and celebration soundtracks',
                    badge: 'PARTY',
                    color: '#A855F7',
                    tracks: partyTracks
                });
            }
            return { hero, sections: sections.filter(s => s.tracks && s.tracks.length > 0) };
        }
        // ================= REGULAR USER FEED =================
        // Extract unique artists, languages, and genre patterns from BOTH history and likes
        const artistCounts = {};
        for (const item of userCombinedTracks) {
            if (item.artist && item.artist !== 'Unknown Artist') {
                const parts = item.artist.split(/[,&/|]/).map((p) => p.trim());
                parts.forEach((p) => {
                    if (p.length > 1) {
                        artistCounts[p] = (artistCounts[p] || 0) + 1;
                    }
                });
            }
        }
        const topArtists = Object.entries(artistCounts)
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0])
            .slice(0, 5);
        // 1. Fetch Popular Hits (at the start)
        const [popularRes, langPopRes, langHitsRes] = await Promise.all([
            searchSongs(`Trending India`, 1, 25).catch(() => ({ results: [] })),
            searchSongs(`${lang1} Trending Hits`, 1, 25).catch(() => ({ results: [] })),
            searchSongs(`${lang1} Top Hits`, 1, 25).catch(() => ({ results: [] }))
        ]);
        const dedupeTracks = (list, limit = 30) => {
            const out = [];
            for (const t of list) {
                if (!globalSeenIds.has(t.id)) {
                    globalSeenIds.add(t.id);
                    out.push(t);
                    if (out.length >= limit)
                        break;
                }
            }
            return out;
        };
        const popularTracks = dedupeTracks([...(langPopRes.results || []), ...(langHitsRes.results || []), ...(popularRes.results || [])], 30);
        const hero = popularTracks[0] || null;
        sections.push({
            id: 'popular_chartbusters',
            title: `🔥 All-Time Popular & Trending Chartbusters`,
            tagline: `Nationwide & ${lang1} chart-topping blockbusters with millions of streams`,
            badge: 'HOTTEST HITS',
            color: '#F5C542',
            tracks: popularTracks
        });
        // 2. Tailored to User's History & Liked Songs Genre / Artist Clusters
        const historyQueries = [];
        topArtists.slice(0, 3).forEach(art => {
            historyQueries.push(`${lang1} ${art} Best Melodies`);
            historyQueries.push(`${art} Superhit Songs`);
        });
        historyQueries.push(`${lang1} Romantic Melodies`);
        historyQueries.push(`${lang1} Acoustic Chill`);
        historyQueries.push(`${lang1} Movie Soundtracks`);
        const histResultsArrays = await Promise.all(historyQueries.map(q => searchSongs(q, 1, 20).catch(() => ({ results: [] }))));
        const rawHistoryTracks = [];
        for (const res of histResultsArrays) {
            for (const t of res.results || []) {
                rawHistoryTracks.push(t);
            }
        }
        const historyPersonalizedTracks = dedupeTracks(rawHistoryTracks, 30);
        if (historyPersonalizedTracks.length > 0) {
            sections.push({
                id: 'history_based_recommendations',
                title: `✨ Tailored to Your Favorite Songs & History`,
                tagline: (topArtists.length > 0)
                    ? `Harmonized from your rotation of ${topArtists.slice(0, 3).join(', ')} and kindred melodies`
                    : `Curated genre acoustic suggestions in ${lang1}`,
                badge: 'FOR YOU',
                color: '#22D3EE',
                tracks: historyPersonalizedTracks
            });
        }
        // 3. Artist Spotlight
        if (topArtists.length > 0) {
            const featuredArtist = topArtists[0];
            const [artRes1, artRes2] = await Promise.all([
                searchSongs(`${featuredArtist} Hits`, 1, 25).catch(() => ({ results: [] })),
                searchSongs(`${featuredArtist} ${lang1} Songs`, 1, 25).catch(() => ({ results: [] }))
            ]);
            const artistTracks = dedupeTracks([...(artRes1.results || []), ...(artRes2.results || [])], 25);
            if (artistTracks.length > 0) {
                sections.push({
                    id: 'top_artist_spotlight',
                    title: `🎤 Spotlight: Best of ${featuredArtist}`,
                    tagline: `Signature masterworks and timeless vocal classics`,
                    badge: 'ARTIST ROTATION',
                    color: '#A855F7',
                    tracks: artistTracks
                });
            }
        }
        // 4. Regional Evergreen Classics
        const classicRes = await searchSongs(`${lang1} Evergreen Melodies`, 1, 25).catch(() => ({ results: [] }));
        const classicTracks = dedupeTracks(classicRes.results || [], 25);
        if (classicTracks.length > 0) {
            sections.push({
                id: 'regional_classics',
                title: `💎 ${lang1} Melody Masterpieces & Soundtracks`,
                tagline: `Essential melodies and immortal classics in ${lang1}`,
                badge: 'MASTERPIECES',
                color: '#10B981',
                tracks: classicTracks
            });
        }
        // 5. Secondary Language / Global Spotlight
        if (lang2 && lang2 !== lang1) {
            const lang2Res = await searchSongs(`${lang2} Top Melodies Chartbusters`, 1, 25).catch(() => ({ results: [] }));
            const lang2Tracks = dedupeTracks(lang2Res.results || [], 25);
            if (lang2Tracks.length > 0) {
                sections.push({
                    id: 'lang2_spotlight',
                    title: `🌟 ${lang2} Chartbusters & Melodies`,
                    tagline: `Popular music and melodic masterpieces in ${lang2}`,
                    badge: lang2.toUpperCase(),
                    color: '#F97316',
                    tracks: lang2Tracks
                });
            }
        }
        return { hero, sections: sections.filter(s => s.tracks && s.tracks.length > 0) };
    }
    catch (err) {
        console.error('Error generating explore feed:', err);
        const searchRes = await searchSongs('Top India Hits', 1, 25);
        return {
            hero: searchRes.results[0] || null,
            sections: [{
                    id: 'popular_chartbusters',
                    title: '🔥 All-Time Popular & Trending Hits',
                    tagline: 'Top streamed tracks across India',
                    badge: 'POPULAR',
                    color: '#F5C542',
                    tracks: searchRes.results
                }]
        };
    }
}
/**
 * 12 Curated Multilingual Mood Categories with Language-Specific Genre Mapping
 */
export function getMoodCategories() {
    return [
        {
            id: 'love',
            key: 'love',
            name: 'Love, Romance & Melodies',
            icon: '💖',
            tagline: 'Heartfelt duets, sweet acoustic harmonies, and timeless romantic ballads',
            color: '#EC4899',
            gradient: 'linear-gradient(135deg, rgba(236, 72, 153, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Romantic Melodies', 'Sid Sriram Telugu Love Hits', 'Anurag Kulkarni Telugu Melodies', 'Telugu Love Songs Superhits'],
                hindi: ['Hindi Romantic Melodies', 'Arijit Singh Love Songs', 'Pritam Romantic Hits', 'Shreya Ghoshal Melodies'],
                tamil: ['Tamil Romantic Melodies', 'Anirudh Love Hits', 'Sid Sriram Tamil Melodies', 'Tamil Love Songs'],
                english: ['English Romantic Pop Hits', 'Ed Sheeran Romantic Love', 'Acoustic Love Ballads English'],
                punjabi: ['Punjabi Romantic Songs', 'B Praak Romantic Hits', 'Jaani Punjabi Melodies'],
                kannada: ['Kannada Romantic Melodies', 'Sanjith Hegde Kannada Love', 'Kannada Love Songs'],
                malayalam: ['Malayalam Romantic Melodies', 'Hesham Abdul Wahab Love', 'Malayalam Love Hits']
            }
        },
        {
            id: 'lofi',
            key: 'lofi',
            name: 'Midnight Lofi & Chillhop',
            icon: '🌌',
            tagline: 'Slowed + reverb vibes, mellow Rhodes chords, and soothing bedroom beats',
            color: '#10B981',
            gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Lofi Slowed Reverb', 'Telugu Chill Acoustic', 'Telugu Midnight Lofi Beats', 'Telugu Peaceful Melodies'],
                hindi: ['Hindi Slowed Reverb Lofi', 'Bollywood Lofi Mix', 'Midnight Hindi Chillhop', 'Arijit Lofi Slowed'],
                tamil: ['Tamil Lofi Slowed Reverb', 'Tamil Midnight Chill', 'Tamil Acoustic Lofi'],
                english: ['Lofi Hip Hop Chill Beats', 'Midnight Bedroom Pop Lofi', 'Acoustic Chillhop Relax'],
                punjabi: ['Punjabi Lofi Slowed', 'Punjabi Acoustic Chill', 'Punjabi Midnight Reverb'],
                kannada: ['Kannada Lofi Slowed', 'Kannada Acoustic Chill'],
                malayalam: ['Malayalam Lofi Slowed', 'Malayalam Acoustic Chill']
            }
        },
        {
            id: 'breakup',
            key: 'breakup',
            name: 'Heartbreak & Breakup Ballads',
            icon: '💔',
            tagline: 'Soul-stirring melancholy, emotional acoustics, and poignant vocal performances',
            color: '#8B5CF6',
            gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Sad Heartbreak Melodies', 'Devi Sri Prasad Emotional Songs', 'Sid Sriram Sad Telugu', 'Telugu Breakup Songs'],
                hindi: ['Hindi Sad Melodies', 'Arijit Singh Heartbreak Songs', 'B Praak Sad Ballads', 'Bollywood Emotional Songs'],
                tamil: ['Tamil Sad Melodies', 'Dhanush Heartbreak Songs', 'Yuvan Shankar Raja Sad Hits'],
                english: ['Sad Pop Ballads', 'Lewis Capaldi Heartbreak', 'Adele Emotional Ballads'],
                punjabi: ['Punjabi Sad Songs', 'B Praak Heartbreak Hits', 'Kaka Sad Punjabi'],
                kannada: ['Kannada Sad Melodies', 'Kannada Breakup Songs'],
                malayalam: ['Malayalam Sad Melodies', 'Malayalam Heartbreak Hits']
            }
        },
        {
            id: 'feel_good',
            key: 'feel_good',
            name: 'Feel Good & Cheerful Sunshine',
            icon: '☀️',
            tagline: 'Bright acoustic chords, joyful rhythms, and sunny uplifting positivity',
            color: '#F59E0B',
            gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Feel Good Songs', 'Telugu Upbeat Cheerful Hits', 'Thaman S Joyful Melodies', 'Telugu Happy Morning Songs'],
                hindi: ['Hindi Feel Good Pop', 'Bollywood Happy Songs', 'Upbeat Cheerful Hindi Hits', 'Amit Trivedi Joyful Melodies'],
                tamil: ['Tamil Feel Good Songs', 'Anirudh Upbeat Hits', 'Tamil Cheerful Melodies'],
                english: ['Happy Upbeat Pop Anthems', 'Feel Good Radio Hits', 'Sunny Morning Acoustic Pop'],
                punjabi: ['Punjabi Happy Songs', 'Diljit Dosanjh Upbeat Hits', 'Punjabi Joyful Hits'],
                kannada: ['Kannada Feel Good Songs', 'Kannada Happy Melodies'],
                malayalam: ['Malayalam Feel Good Songs', 'Malayalam Happy Hits']
            }
        },
        {
            id: 'workout',
            key: 'workout',
            name: 'Gym Pump & High BPM Adrenaline',
            icon: '🔥',
            tagline: 'Hard-hitting EDM drops, trap beats, and high-energy workout motivation',
            color: '#F43F5E',
            gradient: 'linear-gradient(135deg, rgba(244, 63, 94, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Gym Motivation Songs', 'Telugu Mass High BPM Beats', 'Telugu Fast Beat Energetic', 'Thaman S Mass Beats'],
                hindi: ['Hindi Gym Motivation High BPM', 'Bollywood Workout Songs', 'Hindi Trap Heavy Beats', 'Ranveer Singh High Energy'],
                tamil: ['Tamil Gym Motivation', 'Tamil Mass Fast Beats', 'Anirudh High Energy BGM'],
                english: ['Gym Motivation Heavy EDM', 'Workout Trap Bass Boosted', 'High BPM Cardio Adrenaline'],
                punjabi: ['Punjabi Gym Workout Hits', 'Sidhu Moose Wala Energetic', 'AP Dhillon High Energy'],
                kannada: ['Kannada Mass Workout Songs', 'KGF High Energy Beats'],
                malayalam: ['Malayalam Mass Workout Songs', 'Malayalam Energetic Beats']
            }
        },
        {
            id: 'party',
            key: 'party',
            name: 'Party, Club & Dancefloor Bangers',
            icon: '💃',
            tagline: 'Bass-heavy club remixes, wedding dancefloor hits, and festival EDM anthems',
            color: '#A855F7',
            gradient: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Party Dance Hits', 'Telugu DJ Remix Nonstop', 'Telugu Wedding Dance Songs', 'Telugu Mass Party Bangers'],
                hindi: ['Bollywood Party Songs', 'Hindi Club Bangers', 'Badshah Neha Kakkar Dance', 'Bollywood Wedding DJ Remix'],
                tamil: ['Tamil Party Dance Songs', 'Tamil DJ Remix Club', 'Anirudh Dancefloor Bangers'],
                english: ['Club Dance EDM Bangers', 'Festival Electronic Dance', 'Top Dance Pop Hits'],
                punjabi: ['Punjabi Party Dance Songs', 'Bhangra Club Bangers', 'Yo Yo Honey Singh Party Hits'],
                kannada: ['Kannada Party Dance Songs', 'Kannada Club Remix'],
                malayalam: ['Malayalam Party Dance Songs', 'Malayalam Club Hits']
            }
        },
        {
            id: 'sufi',
            key: 'sufi',
            name: 'Soulful Sufi & Mystic Qawwali',
            icon: '🕊️',
            tagline: 'Transcendent Sufi vocals, divine harmonium, and Coke Studio mystic gems',
            color: '#06B6D4',
            gradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Soulful Melodies', 'Telugu Classical Fusion Songs', 'SPB Soulful Melodies'],
                hindi: ['Rahat Fateh Ali Khan Sufi', 'Nusrat Fateh Ali Khan Qawwali', 'Coke Studio Sufi Classics', 'Kailash Kher Sufi'],
                tamil: ['Tamil Sufi Fusion', 'AR Rahman Sufi Melodies'],
                english: ['Spiritual Acoustic Soul', 'Meditative Ambient Mystic'],
                punjabi: ['Punjabi Sufi Songs', 'Satinder Sartaaj Sufi', 'Wadali Brothers Qawwali'],
                kannada: ['Kannada Soulful Bhavageethe', 'Kannada Classical Fusion'],
                malayalam: ['Malayalam Soulful Melodies', 'Malayalam Semi Classical']
            }
        },
        {
            id: 'rock',
            key: 'rock',
            name: 'Rock, Metal & Electric Riffs',
            icon: '⚡',
            tagline: 'Heavy distortion, blistering guitar solos, and legendary Indian rock anthems',
            color: '#EF4444',
            gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Rock Songs', 'Devi Sri Prasad Rock Hits', 'Telugu High Voltage Rock'],
                hindi: ['Indian Rock Anthems', 'Euphoria Band Hindi Rock', 'Junoon Rock Songs', 'Bollywood Rock Songs'],
                tamil: ['Tamil Rock Songs', 'Anirudh Rock Anthems'],
                english: ['Classic Rock Anthems', 'Modern Alternative Rock', 'Hard Rock Heavy Guitar'],
                punjabi: ['Punjabi Rock Beats', 'Punjabi Alternative Metal'],
                kannada: ['Kannada Rock Songs', 'Raghu Dixit Folk Rock'],
                malayalam: ['Avial Band Malayalam Rock', 'Thaikkudam Bridge Rock']
            }
        },
        {
            id: 'heroic',
            key: 'heroic',
            name: 'Heroic Cinema & Epic Scores',
            icon: '🛡️',
            tagline: 'Massive orchestral builds, goosebumps BGM themes, and dramatic film scores',
            color: '#3B82F6',
            gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Mass BGM Themes', 'MM Keeravaani Epic Soundtracks', 'Telugu Heroic Cinema Scores', 'Bahubali RRR BGM'],
                hindi: ['Bollywood Epic BGM Themes', 'Ajay Atul Heroic Scores', 'Brahmastra Epic Soundtracks'],
                tamil: ['Tamil Heroic Cinema BGM', 'Anirudh Mass Theme Scores', 'AR Rahman Epic Themes'],
                english: ['Hans Zimmer Epic Soundtracks', 'Two Steps From Hell Cinematic', 'Trailer Orchestral Scores'],
                punjabi: ['Punjabi Cinema Mass BGM', 'Punjabi Action Soundtracks'],
                kannada: ['KGF Ravi Basrur Mass BGM', 'Kantara Epic Folk Scores'],
                malayalam: ['Malayalam Action Cinema BGM', 'Sushin Shyam Epic Soundtracks']
            }
        },
        {
            id: 'acoustic',
            key: 'acoustic',
            name: 'Acoustic Coffeehouse & Unplugged',
            icon: '☕',
            tagline: 'Fingerstyle acoustic guitars, intimate vocals, and warm wooden melodies',
            color: '#D97706',
            gradient: 'linear-gradient(135deg, rgba(217, 119, 6, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Acoustic Unplugged', 'Telugu Coffeehouse Guitar', 'Telugu Soft Acoustic Melodies'],
                hindi: ['Bollywood Acoustic Unplugged', 'Hindi Coffeehouse Guitar Songs', 'Prateek Kuhad Acoustic Hits'],
                tamil: ['Tamil Acoustic Unplugged', 'Tamil Soft Guitar Melodies'],
                english: ['Acoustic Fingerstyle Singer Songwriter', 'Coffeehouse Acoustic Pop', 'Soft Acoustic Folk'],
                punjabi: ['Punjabi Acoustic Unplugged', 'Punjabi Soft Guitar Songs'],
                kannada: ['Kannada Acoustic Unplugged', 'Kannada Soft Melodies'],
                malayalam: ['Malayalam Acoustic Unplugged', 'Malayalam Guitar Melodies']
            }
        },
        {
            id: 'devotional',
            key: 'devotional',
            name: 'Devotional, Bhakti & Mantras',
            icon: '🕉️',
            tagline: 'Sacred morning prayers, spiritual chants, peaceful stotrams, and divine bhajans',
            color: '#F97316',
            gradient: 'linear-gradient(135deg, rgba(249, 115, 22, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Devotional Songs', 'SPB Bhakti Geethalu', 'Lord Shiva Stotram Telugu', 'Venkateswara Suprabhatam Telugu'],
                hindi: ['Hindi Bhakti Bhajan', 'Gulshan Kumar Bhakti Sagar', 'Shiva Tandava Stotram', 'Hanuman Chalisa Hindi'],
                tamil: ['Tamil Devotional Songs', 'TM Soundararajan Murugan Bhakti', 'Tamil Temple Chants'],
                english: ['Sacred Peace Chants', 'Spiritual Meditation Mantras'],
                punjabi: ['Gurbani Kirtan Shabad', 'Golden Temple Gurbani Live'],
                kannada: ['Kannada Devotional Songs', 'Kannada Bhakti Geethegalu'],
                malayalam: ['Malayalam Devotional Songs', 'Yesudas Ayyappa Bhakti']
            }
        },
        {
            id: 'classical',
            key: 'classical',
            name: 'Classical & Fusion Ragas',
            icon: '🪕',
            tagline: 'Carnatic & Hindustani classical mastery, sitar, flute, and instrumental ragas',
            color: '#14B8A6',
            gradient: 'linear-gradient(135deg, rgba(20, 184, 166, 0.22), rgba(17, 17, 24, 0.95))',
            genreQueries: {
                telugu: ['Telugu Carnatic Classical Ragas', 'Mangalampalli Balamuralikrishna', 'Thyagaraja Kritis Telugu', 'Telugu Classical Fusion'],
                hindi: ['Hindustani Classical Vocal', 'Pandit Bhimsen Joshi Classical', 'Pandit Ravi Shankar Sitar', 'Hindustani Flute Ragas'],
                tamil: ['Carnatic Classical Vocal Tamil', 'MS Subbulakshmi Carnatic', 'Tamil Classical Fusion'],
                english: ['Classical Orchestral Masterpieces', 'Violin and Cello Classical Melodies'],
                punjabi: ['Classical Sufi Punjabi Ragas', 'Punjabi Classical Folk'],
                kannada: ['Kannada Carnatic Classical', 'Kannada Vachana Classical'],
                malayalam: ['Malayalam Classical Ragas', 'Swathi Thirunal Kritis']
            }
        }
    ];
}
/**
 * Rich multilingual Mood Feed: Queries language-specific genre matrices across ALL preferred languages,
 * yielding 50 to 80+ songs!
 */
export async function getMoodFeed(moodKey, languages = ['Telugu', 'Hindi', 'English']) {
    const categories = getMoodCategories();
    const normalizedKey = (moodKey || 'love').toLowerCase().trim();
    const category = categories.find((c) => c.key === normalizedKey || c.id === normalizedKey) || categories[0];
    const userLangs = (languages && languages.length > 0) ? languages : ['Telugu', 'Hindi', 'English'];
    // Collect specific queries for each preferred language
    const searchQueries = [];
    for (const rawLang of userLangs) {
        const lKey = rawLang.toLowerCase().trim();
        const specificQueries = category.genreQueries[lKey] || category.genreQueries['hindi'] || [`${rawLang} ${category.name}`];
        specificQueries.forEach(q => searchQueries.push(q));
    }
    // If few queries, add fallback queries for primary language
    if (searchQueries.length < 4) {
        const lKey = (userLangs[0] || 'telugu').toLowerCase();
        const specificQueries = category.genreQueries[lKey] || [];
        searchQueries.push(...specificQueries);
    }
    try {
        // Search page 1 and page 2 across all queries
        const searchPromises = [];
        for (const q of searchQueries) {
            searchPromises.push(searchSongs(q, 1, 20).catch(() => ({ results: [] })));
            searchPromises.push(searchSongs(q, 2, 20).catch(() => ({ results: [] })));
        }
        const searchResults = await Promise.all(searchPromises);
        const mergedTracks = [];
        const seenIds = new Set();
        for (const res of searchResults) {
            for (const track of res.results) {
                if (!seenIds.has(track.id)) {
                    seenIds.add(track.id);
                    mergedTracks.push(track);
                }
            }
        }
        // Return up to 80 high quality tracks
        return { mood: category, tracks: mergedTracks.slice(0, 80) };
    }
    catch (err) {
        console.error('Error in getMoodFeed:', err);
        return { mood: category, tracks: [] };
    }
}
