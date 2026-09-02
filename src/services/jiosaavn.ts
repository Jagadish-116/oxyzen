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

export interface SongQuality {
  bitrate: string;
  url: string;
}

export interface FormattedSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  duration: string;
  duration_sec: number;
  duration_formatted: string;
  year?: string;
  language?: string;
  has_lyrics: boolean;
  stream_url?: string;
  downloadUrl: SongQuality[];
  thumbnail?: string;
}

export interface MoodCategory {
  id: string;
  key: string;
  name: string;
  icon: string;
  tagline: string;
  genreQueries: Record<string, string[]>;
  color: string;
  gradient: string;
}

// In-memory cache for fast repeat lookups
const streamUrlCache = new Map<string, SongQuality[]>();
const searchCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Decodes HTML entities commonly returned by JioSaavn
 */
function decodeHtmlEntities(str: string): string {
  if (!str) return '';
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
function formatImageUrl(imageUrl: string, quality: '50x50' | '150x150' | '500x500' = '500x500'): string {
  if (!imageUrl) return '/static/assets/logo.png';
  let formatted = imageUrl.replace(/^http:\/\//, 'https://');
  formatted = formatted.replace(/_\d+x\d+\.(?:jpg|png|jpeg)/i, `_${quality}.jpg`);
  formatted = formatted.replace(/-\d+x\d+\.(?:jpg|png|jpeg)/i, `-${quality}.jpg`);
  return formatted;
}

/**
 * Formats seconds into mm:ss format
 */
function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds <= 0) return '3:30';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

/**
 * Generates direct high-bitrate CDN audio stream links (320kbps, 160kbps, 96kbps)
 * Uses clean unexpired Akamai CDN URLs on https://aac.saavncdn.com with full CORS & Range 206 support.
 */
export async function generateStreamUrls(encryptedUrl: string): Promise<SongQuality[]> {
  if (!encryptedUrl) return [];

  if (streamUrlCache.has(encryptedUrl)) {
    return streamUrlCache.get(encryptedUrl)!;
  }

  try {
    const authUrl = `${SAAVN_BASE_URL}?__call=song.generateAuthToken&_format=json&_marker=0&cc=in&url=${encodeURIComponent(encryptedUrl)}&bitrate=320`;
    const res = await fetch(authUrl, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`generateAuthToken failed: ${res.status}`);

    const data: any = await res.json();
    if (data && typeof data.auth_url === 'string') {
      // Clean query string parameters (which have expiring tokens) to produce permanent Akamai CDN URLs
      const rawBase = data.auth_url.split('?')[0];
      const normalizedBase = rawBase.replace(/^https?:\/\/[^\/]+/, 'https://aac.saavncdn.com');

      // Strip existing bitrate suffix to prevent _320_160 duplicates
      const cleanStem = normalizedBase.replace(/_(?:12|48|96|160|320)(?:\.mp4|\.m4a)?$/i, '');

      const qualities: SongQuality[] = [
        { bitrate: '96kbps', url: `${cleanStem}_96.mp4` },
        { bitrate: '160kbps', url: `${cleanStem}_160.mp4` },
        { bitrate: '320kbps', url: `${cleanStem}_320.mp4` },
      ];

      streamUrlCache.set(encryptedUrl, qualities);
      return qualities;
    }
  } catch (err) {
    console.warn('Failed to generate stream URLs via generateAuthToken:', err);
  }

  return [];
}

/**
 * Normalizes raw JioSaavn song object into Oxyzen's clean FormattedSong model
 */
export async function formatSongObject(raw: any, resolveStreams = true): Promise<FormattedSong> {
  const id = String(raw.id || raw.songId || '');
  const title = decodeHtmlEntities(raw.song || raw.title || 'Unknown Title');
  const artist = decodeHtmlEntities(
    raw.primary_artists || raw.singers || raw.music || raw.artist || (raw.more_info && raw.more_info.primary_artists) || 'Unknown Artist'
  );
  const album = decodeHtmlEntities(raw.album || (raw.more_info && raw.more_info.album) || 'Single');
  const rawImage = raw.image || (raw.more_info && raw.more_info.image) || '';
  const image = formatImageUrl(rawImage, '500x500');
  const durationSec = parseInt(String(raw.duration || (raw.more_info && raw.more_info.duration) || 210), 10) || 210;
  const encryptedUrl = raw.encrypted_media_url || (raw.more_info && raw.more_info.encrypted_media_url) || '';
  const hasLyrics = raw.has_lyrics === 'true' || raw.has_lyrics === true || (raw.more_info && raw.more_info.has_lyrics === 'true');
  const language = raw.language || (raw.more_info && raw.more_info.language) || '';

  let downloadUrl: SongQuality[] = [];
  let streamUrl = `/api/stream/${id}`;

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
export async function searchSongs(query: string, page = 1, limit = 20, resolveStreams = false): Promise<{ results: FormattedSong[]; total: number; start: number }> {
  if (!query || !query.trim()) {
    return { results: [], total: 0, start: 0 };
  }

  const cacheKey = `search_${query.trim().toLowerCase()}_p${page}_l${limit}`;
  if (searchCache.has(cacheKey)) {
    const cached = searchCache.get(cacheKey)!;
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const url = `${SAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=${page}&n=${limit}&q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          ...DEFAULT_HEADERS,
          'User-Agent': attempt === 0
            ? DEFAULT_HEADERS['User-Agent']
            : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
        }
      });
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        throw new Error(`Search API HTTP ${res.status}`);
      }

      const data: any = await res.json();
      const rawResults = data.results || (data.data && data.data.results) || [];
      const total = parseInt(String(data.total || 0), 10) || rawResults.length;
      const start = parseInt(String(data.start || 0), 10);

      const formatPromises = rawResults.map((raw: any) => formatSongObject(raw, resolveStreams));
      const results = await Promise.all(formatPromises);

      const out = { results, total, start };
      searchCache.set(cacheKey, { timestamp: Date.now(), data: out });
      return out;
    } catch (err) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      console.warn(`JioSaavn search notice for "${query}":`, err);
      return { results: [], total: 0, start: 0 };
    }
  }

  return { results: [], total: 0, start: 0 };
}

/**
 * Search suggestions autocomplete for searchbar
 */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  if (!query || query.trim().length < 2) return [];

  try {
    const url = `${SAAVN_BASE_URL}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) return [];

    const data: any = await res.json();
    const suggestions: string[] = [];

    if (data.songs && Array.isArray(data.songs.data)) {
      data.songs.data.slice(0, 5).forEach((s: any) => {
        if (s.title) suggestions.push(decodeHtmlEntities(s.title));
      });
    }
    if (data.albums && Array.isArray(data.albums.data)) {
      data.albums.data.slice(0, 3).forEach((a: any) => {
        if (a.title) suggestions.push(decodeHtmlEntities(a.title));
      });
    }
    if (data.artists && Array.isArray(data.artists.data)) {
      data.artists.data.slice(0, 3).forEach((ar: any) => {
        if (ar.name) suggestions.push(decodeHtmlEntities(ar.name));
      });
    }

    return Array.from(new Set(suggestions)).slice(0, 8);
  } catch (err) {
    console.warn('Error fetching search suggestions:', err);
    return [];
  }
}

/**
 * Resolves full song details by JioSaavn song ID
 */
export async function getSongDetails(songId: string): Promise<FormattedSong | null> {
  if (!songId) return null;

  try {
    const url = `${SAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${songId}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) return null;

    const data: any = await res.json();
    const rawSong = data[songId];
    if (!rawSong) return null;

    return await formatSongObject(rawSong, true);
  } catch (err) {
    console.error(`Error retrieving song details for ${songId}:`, err);
    return null;
  }
}

/**
 * Top trending tracks in India
 */
export async function getTrending(): Promise<{ tracks: FormattedSong[] }> {
  try {
    const res = await searchSongs('Trending India Hits Top 50', 1, 25);
    return { tracks: res.results };
  } catch (err) {
    return { tracks: [] };
  }
}

/**
 * Popular charts definition
 */
export async function getCharts(): Promise<{ id: string; title: string; image: string; count: number }[]> {
  return [
    { id: 'trending_india', title: 'Trending India 50', image: '/static/assets/logo.png', count: 50 },
    { id: 'telugu_superhits', title: 'Telugu Chartbusters', image: '/static/assets/logo.png', count: 50 },
    { id: 'hindi_romantic', title: 'Hindi Romantic Hits', image: '/static/assets/logo.png', count: 50 },
    { id: 'global_top_50', title: 'Global Top 50', image: '/static/assets/logo.png', count: 50 },
    { id: 'punjabi_bangers', title: 'Punjabi Fresh Hits', image: '/static/assets/logo.png', count: 50 },
    { id: 'tamil_mass', title: 'Tamil Blockbuster Beats', image: '/static/assets/logo.png', count: 50 }
  ];
}

function getNormalizedTitleKey(title: string): string {
  return (title || '')
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

const KINDRED_ARTIST_CLUSTERS: Record<string, Record<string, string[]>> = {
  telugu: {
    'sid sriram': ['Anurag Kulkarni', 'Devi Sri Prasad', 'Thaman S', 'Ram Miriyala', 'Mickey J Meyer', 'Haricharan', 'Karthik', 'Armaan Malik'],
    'anurag kulkarni': ['Sid Sriram', 'Ram Miriyala', 'Devi Sri Prasad', 'Thaman S', 'Chaitan Bharadwaj', 'Kaala Bhairava'],
    'devi sri prasad': ['Thaman S', 'Sid Sriram', 'Sagar', 'Jaspreet Jasz', 'Shankar Mahadevan', 'Anirudh Ravichander'],
    'thaman s': ['Devi Sri Prasad', 'Anirudh Ravichander', 'Sid Sriram', 'Armaan Malik', 'Sri Krishna'],
    'ram miriyala': ['Anurag Kulkarni', 'Sid Sriram', 'Mangli', 'Bheems Ceciroleo', 'Chaitan Bharadwaj'],
    'spb': ['S.P. Balasubrahmanyam', 'K.J. Yesudas', 'K.S. Chithra', 'S. Janaki', 'Ilaiyaraaja', 'Mano'],
    'ilaiyaraaja': ['S.P. Balasubrahmanyam', 'K.S. Chithra', 'S. Janaki', 'Mano', 'K.J. Yesudas']
  },
  hindi: {
    'arijit singh': ['Atif Aslam', 'Mohit Chauhan', 'KK', 'Vishal Mishra', 'Pritam', 'Armaan Malik', 'Jubin Nautiyal', 'Sachin-Jigar', 'Mithoon'],
    'atif aslam': ['Arijit Singh', 'KK', 'Mohit Chauhan', 'Mustafa Zahid', 'Pritam', 'Rahat Fateh Ali Khan'],
    'kk': ['Mohit Chauhan', 'Shaan', 'Lucky Ali', 'Pritam', 'Arijit Singh', 'Sonu Nigam'],
    'pritam': ['Arijit Singh', 'Mohit Chauhan', 'KK', 'Atif Aslam', 'Amit Trivedi', 'Vishal-Shekhar'],
    'ar rahman': ['A.R. Rahman', 'Mohit Chauhan', 'Javed Ali', 'Hariharan', 'Shankar Mahadevan', 'Sonu Nigam'],
    'sonu nigam': ['Shaan', 'Udit Narayan', 'Kumar Sanu', 'Alka Yagnik', 'Abhijeet Bhattacharya', 'KK']
  },
  tamil: {
    'anirudh': ['Anirudh Ravichander', 'A.R. Rahman', 'Yuvan Shankar Raja', 'Harris Jayaraj', 'Sid Sriram', 'Santhosh Narayanan'],
    'yuvan shankar raja': ['Harris Jayaraj', 'Anirudh Ravichander', 'A.R. Rahman', 'Ilaiyaraaja', 'Vijay Antony'],
    'ar rahman': ['Harris Jayaraj', 'Yuvan Shankar Raja', 'Anirudh Ravichander', 'Sid Sriram', 'Karthik', 'Unni Menon']
  },
  english: {
    'the weeknd': ['Bruno Mars', 'Post Malone', 'Dua Lipa', 'Zayn', 'Drake', 'Frank Ocean', 'Kendrick Lamar'],
    'taylor swift': ['Olivia Rodrigo', 'Billie Eilish', 'Sabrina Carpenter', 'Gracie Abrams', 'Lana Del Rey', 'Dua Lipa', 'Ed Sheeran'],
    'ed sheeran': ['Shawn Mendes', 'Lewis Capaldi', 'James Arthur', 'Sam Smith', 'Charlie Puth', 'Harry Styles'],
    'eminem': ['Dr. Dre', '50 Cent', 'Kendrick Lamar', 'J. Cole', 'Snoop Dogg', 'NF'],
    'coldplay': ['Imagine Dragons', 'OneRepublic', 'The Script', 'Maroon 5', 'Keane', 'Snow Patrol']
  }
};

/**
 * Deep Kindred Vibe Radar recommendations algorithm
 * Adapts strictly to the language and kindred musical style/genre of the playing track
 * with ZERO language cross-interference and strict normalized title deduplication.
 * Returns 50+ rich, authentic songs!
 */
export async function getVibeRecommendations(
  songId?: string,
  artist?: string,
  title?: string,
  language?: string
): Promise<FormattedSong[]> {
  try {
    let rawLang = (language && language.trim()) ? language.trim().toLowerCase() : 'telugu';
    if (rawLang === 'unknown' || rawLang === 'null') rawLang = 'telugu';
    const capitalizedLang = rawLang.charAt(0).toUpperCase() + rawLang.slice(1);

    // Primary & Secondary Artist extractions
    const cleanArtistStr = (artist || '').replace(/\s*\([^)]*\)/g, '');
    const artistParts = cleanArtistStr.split(/[,&/|]/).map(a => a.trim()).filter(a => a.length > 0 && a !== 'Unknown Artist');
    const primaryArtist = artistParts[0] || '';
    const secondaryArtist = artistParts[1] || '';

    // Find kindred cluster artists in this language
    const langCluster = KINDRED_ARTIST_CLUSTERS[rawLang] || {};
    let kindredArtists: string[] = [];
    const pLow = primaryArtist.toLowerCase();

    for (const [key, cluster] of Object.entries(langCluster)) {
      if (pLow.includes(key) || key.includes(pLow)) {
        kindredArtists = cluster;
        break;
      }
    }

    const queries: string[] = [];

    // 1. Primary Artist & Kindred Artist Catalog in target language
    if (primaryArtist) {
      queries.push(`${capitalizedLang} ${primaryArtist} Best Songs`);
      queries.push(`${capitalizedLang} ${primaryArtist} Hits`);
    }

    if (secondaryArtist) {
      queries.push(`${capitalizedLang} ${secondaryArtist} Songs`);
    }

    // Add up to 3 kindred artists from the cluster
    kindredArtists.slice(0, 3).forEach(k => {
      queries.push(`${capitalizedLang} ${k} Hits`);
    });

    // 2. Pure Genre & Musical Style Anthems in target language
    queries.push(`${capitalizedLang} Romantic Melodies`);
    queries.push(`${capitalizedLang} Superhit Movie Melodies`);
    queries.push(`${capitalizedLang} Top Hits Chartbusters`);
    queries.push(`${capitalizedLang} Acoustic Chill`);
    queries.push(`${capitalizedLang} Evergreen Masterpieces`);

    // Execute multi-query search in parallel
    const searchPromises = queries.map(q => searchSongs(q, 1, 20).catch(() => ({ results: [] })));
    const resultsArrays = await Promise.all(searchPromises);

    const mergedTracks: FormattedSong[] = [];
    const seenIds = new Set<string>();
    const seenTitleKeys = new Set<string>();

    if (songId) seenIds.add(songId);
    if (title) seenTitleKeys.add(getNormalizedTitleKey(title));

    for (const res of resultsArrays) {
      for (const track of (res.results || [])) {
        // STRICT LANGUAGE ENFORCEMENT: Filter out songs from other languages
        const trackLang = (track.language || '').trim().toLowerCase();
        if (trackLang && trackLang !== rawLang) {
          continue; // Skip foreign / other language songs!
        }

        const titleKey = getNormalizedTitleKey(track.title);

        if (!seenIds.has(track.id) && (!titleKey || !seenTitleKeys.has(titleKey))) {
          seenIds.add(track.id);
          if (titleKey) seenTitleKeys.add(titleKey);
          mergedTracks.push(track);
        }
      }
    }

    // Ensure plenty of songs (at least 50 songs in that language)
    if (mergedTracks.length < 50) {
      const fallbackRes = await searchSongs(`${capitalizedLang} Top Trending Songs Hits`, 1, 40).catch(() => ({ results: [] }));
      for (const track of (fallbackRes.results || [])) {
        const trackLang = (track.language || '').trim().toLowerCase();
        if (trackLang && trackLang !== rawLang) continue;

        const titleKey = getNormalizedTitleKey(track.title);
        if (!seenIds.has(track.id) && (!titleKey || !seenTitleKeys.has(titleKey))) {
          seenIds.add(track.id);
          if (titleKey) seenTitleKeys.add(titleKey);
          mergedTracks.push(track);
        }
      }
    }

    return mergedTracks.slice(0, 60);
  } catch (err) {
    console.warn('Error in getVibeRecommendations:', err);
    return [];
  }
}

/**
 * Explore feed generation:
 * - NEW USER: Top English Trending hits + Nationwide & Regional Chartbusters (strictly non-repeated, 500x500 covers)
 * - REGULAR USER: Adapted to user's full history AND liked songs (matching genres, artists, and languages without title repetition)
 */
export async function getExploreFeed(
  profile?: { languages?: string[]; history?: any[]; likes?: any[] },
  currentTrack?: { id?: string; title?: string; artist?: string; language?: string }
): Promise<{ hero: any; sections: any[] }> {
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
    const globalSeenIds = new Set<string>();
    const globalSeenTitles = new Set<string>();
    const sections: any[] = [];

    const dedupeTracks = (list: FormattedSong[], limit = 30, targetLang?: string): FormattedSong[] => {
      const out: FormattedSong[] = [];
      const tLang = (targetLang || '').toLowerCase().trim();
      for (const t of list) {
        if (tLang) {
          const trackLang = (t.language || '').toLowerCase().trim();
          if (trackLang && trackLang !== tLang) continue; // Filter foreign language tracks!
        }
        const titleKey = getNormalizedTitleKey(t.title);
        if (!globalSeenIds.has(t.id) && (!titleKey || !globalSeenTitles.has(titleKey))) {
          globalSeenIds.add(t.id);
          if (titleKey) globalSeenTitles.add(titleKey);
          out.push(t);
          if (out.length >= limit) break;
        }
      }
      return out;
    };

    // Live Playing Track Resonance (if a track is currently active)
    if (currentTrack && currentTrack.title) {
      const adaptiveTracks = await getVibeRecommendations(
        currentTrack.id,
        currentTrack.artist,
        currentTrack.title,
        currentTrack.language || lang1
      );
      const topAdaptive = dedupeTracks(adaptiveTracks, 30, currentTrack.language || lang1);
      if (topAdaptive.length > 0) {
        sections.push({
          id: 'live_adaptive_resonance',
          title: `✨ Because You Listened to "${currentTrack.title}"`,
          tagline: `Kindred acoustic harmonies & genre hits matching ${currentTrack.artist || 'the song'}`,
          badge: 'AI RESONANCE',
          color: '#22D3EE',
          tracks: topAdaptive
        });
      }
    }

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

      const englishTracks = dedupeTracks([...(englishPopRes.results || []), ...(globalTopRes.results || [])], 30, 'english');
      const regionalTracks = dedupeTracks([...(langHitsRes.results || []), ...(langTrendingRes.results || [])], 30, lang1);
      const nationwideTracks = dedupeTracks([...(trendingIndiaRes.results || []), ...(hindiMelodyRes.results || [])], 30, 'hindi');
      const classicTracks = dedupeTracks(evergreenRes.results || [], 25, lang1);
      const partyTracks = dedupeTracks(partyRes.results || [], 25, lang1);

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
    const artistCounts: Record<string, number> = {};
    for (const item of userCombinedTracks) {
      if (item.artist && item.artist !== 'Unknown Artist') {
        const parts = item.artist.split(/[,&/|]/).map((p: string) => p.trim());
        parts.forEach((p: string) => {
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

    const popularTracks = dedupeTracks([...(langPopRes.results || []), ...(langHitsRes.results || []), ...(popularRes.results || [])], 30, lang1);
    const hero = popularTracks[0] || null;

    sections.push({
      id: 'popular_chartbusters',
      title: `🔥 All-Time Popular & Trending Chartbusters in ${lang1}`,
      tagline: `${lang1} chart-topping blockbusters with millions of streams`,
      badge: 'HOTTEST HITS',
      color: '#F5C542',
      tracks: popularTracks
    });

    // 2. Tailored to User's History & Liked Songs Genre / Artist Clusters
    const historyQueries: string[] = [];
    topArtists.slice(0, 3).forEach(art => {
      historyQueries.push(`${lang1} ${art} Best Melodies`);
      historyQueries.push(`${lang1} ${art} Superhit Songs`);
    });
    historyQueries.push(`${lang1} Romantic Melodies`);
    historyQueries.push(`${lang1} Acoustic Chill`);
    historyQueries.push(`${lang1} Movie Soundtracks`);

    const histResultsArrays = await Promise.all(
      historyQueries.map(q => searchSongs(q, 1, 20).catch(() => ({ results: [] })))
    );

    const rawHistoryTracks: FormattedSong[] = [];
    for (const res of histResultsArrays) {
      for (const t of res.results || []) {
        rawHistoryTracks.push(t);
      }
    }

    const historyPersonalizedTracks = dedupeTracks(rawHistoryTracks, 30, lang1);

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
  } catch (err) {
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
export function getMoodCategories(): MoodCategory[] {
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
        telugu: ['Telugu Love Hits', 'Telugu Melody Songs', 'Telugu Romantic Songs', 'Sid Sriram Telugu Hits'],
        hindi: ['Hindi Love Hits', 'Hindi Romantic Songs', 'Bollywood Love Songs', 'Arijit Singh Love Songs'],
        tamil: ['Tamil Love Hits', 'Tamil Romantic Songs', 'Tamil Melody Songs', 'Anirudh Love Hits'],
        english: ['English Love Songs', 'English Romantic Pop', 'Love Ballads English', 'Ed Sheeran Love Songs'],
        punjabi: ['Punjabi Romantic Songs', 'B Praak Love Songs', 'Jaani Punjabi Hits'],
        kannada: ['Kannada Love Hits', 'Kannada Romantic Melodies', 'Kannada Melody Songs'],
        malayalam: ['Malayalam Love Hits', 'Malayalam Romantic Melodies', 'Malayalam Melody Songs']
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
        telugu: ['Telugu Chill Melodies', 'Telugu Acoustic Melodies', 'Telugu Peaceful Songs', 'Telugu Slow Melodies'],
        hindi: ['Hindi Lofi Chill', 'Hindi Acoustic Songs', 'Bollywood Lofi Chill', 'Hindi Chill Melodies'],
        tamil: ['Tamil Lofi Chill', 'Tamil Acoustic Songs', 'Tamil Chill Melodies'],
        english: ['English Lofi Chill', 'Chillout Acoustic Pop', 'Lofi Beats Study', 'Midnight Chill Beats'],
        punjabi: ['Punjabi Acoustic Chill', 'Punjabi Slow Melodies'],
        kannada: ['Kannada Acoustic Melodies', 'Kannada Peaceful Songs'],
        malayalam: ['Malayalam Acoustic Melodies', 'Malayalam Chill Melodies']
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
        telugu: ['Telugu Sad Songs', 'Telugu Emotional Songs', 'Telugu Heartbreak Songs', 'Telugu Breakup Songs'],
        hindi: ['Hindi Sad Songs', 'Hindi Emotional Songs', 'Bollywood Sad Songs', 'Arijit Singh Sad Songs'],
        tamil: ['Tamil Sad Songs', 'Tamil Emotional Songs', 'Tamil Heartbreak Songs'],
        english: ['English Sad Songs', 'Sad Pop Ballads', 'Adele Emotional Songs', 'Heartbreak Pop Hits'],
        punjabi: ['Punjabi Sad Songs', 'B Praak Sad Songs', 'Kaka Sad Songs'],
        kannada: ['Kannada Sad Songs', 'Kannada Emotional Songs'],
        malayalam: ['Malayalam Sad Songs', 'Malayalam Emotional Songs']
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
        telugu: ['Telugu Happy Songs', 'Telugu Feel Good Songs', 'Telugu Upbeat Songs', 'Telugu Joyful Melodies'],
        hindi: ['Hindi Happy Songs', 'Bollywood Feel Good Songs', 'Hindi Joyful Songs', 'Hindi Upbeat Pop'],
        tamil: ['Tamil Happy Songs', 'Tamil Feel Good Songs', 'Tamil Upbeat Songs'],
        english: ['Happy Upbeat Pop', 'Feel Good Radio Hits', 'Sunny Morning Pop', 'Upbeat Radio Hits'],
        punjabi: ['Punjabi Happy Songs', 'Diljit Dosanjh Upbeat Songs', 'Punjabi Joyful Hits'],
        kannada: ['Kannada Happy Songs', 'Kannada Feel Good Songs'],
        malayalam: ['Malayalam Happy Songs', 'Malayalam Feel Good Songs']
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
        telugu: ['Telugu Mass Songs', 'Telugu Fast Beats', 'Telugu Gym Motivation', 'Thaman Mass Beats'],
        hindi: ['Hindi Gym Motivation', 'Bollywood Workout Songs', 'Hindi Fast Beats', 'Hindi High Energy'],
        tamil: ['Tamil Mass Fast Beats', 'Tamil Gym Motivation', 'Anirudh High Energy'],
        english: ['Gym Motivation EDM', 'Workout Trap Bass', 'High BPM Cardio Adrenaline', 'Workout Beast Mode'],
        punjabi: ['Punjabi Gym Workout', 'Sidhu Moose Wala Energetic', 'AP Dhillon Energetic'],
        kannada: ['Kannada Mass Workout', 'KGF High Energy Beats'],
        malayalam: ['Malayalam Mass Songs', 'Malayalam Energetic Beats']
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
        telugu: ['Telugu Party Songs', 'Telugu Dance Hits', 'Telugu Mass Hits', 'Telugu Wedding Dance'],
        hindi: ['Hindi Party Songs', 'Bollywood Dance Hits', 'Hindi Club Songs', 'Bollywood DJ Songs'],
        tamil: ['Tamil Party Songs', 'Tamil Dance Hits', 'Tamil Club Songs'],
        english: ['Club Dance EDM', 'Party Pop Hits', 'Festival Dance Hits', 'Top Dance Pop'],
        punjabi: ['Punjabi Party Songs', 'Bhangra Club Hits', 'Yo Yo Honey Singh Hits'],
        kannada: ['Kannada Party Songs', 'Kannada Dance Hits'],
        malayalam: ['Malayalam Party Songs', 'Malayalam Dance Hits']
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
        telugu: ['Telugu Soulful Melodies', 'Telugu Classical Fusion', 'SPB Soulful Songs'],
        hindi: ['Hindi Sufi Songs', 'Coke Studio Sufi Classics', 'Rahat Fateh Ali Khan Songs', 'Nusrat Fateh Ali Khan'],
        tamil: ['Tamil Soulful Melodies', 'AR Rahman Soulful Hits'],
        english: ['Spiritual Acoustic Soul', 'Meditative Soul Melodies'],
        punjabi: ['Punjabi Sufi Songs', 'Satinder Sartaaj Sufi', 'Wadali Brothers Songs'],
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
        telugu: ['Telugu Rock Songs', 'Telugu High Energy Songs', 'Devi Sri Prasad Rock'],
        hindi: ['Hindi Rock Songs', 'Indian Rock Anthems', 'Bollywood Rock Songs', 'Euphoria Rock Songs'],
        tamil: ['Tamil Rock Songs', 'Anirudh Rock Hits'],
        english: ['English Rock Anthems', 'Alternative Rock Classics', 'Hard Rock Hits', 'Modern Rock Pop'],
        punjabi: ['Punjabi Rock Beats', 'Punjabi Metal Beats'],
        kannada: ['Kannada Rock Songs', 'Raghu Dixit Rock'],
        malayalam: ['Malayalam Rock Songs', 'Thaikkudam Bridge Rock']
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
        telugu: ['Telugu Mass BGM', 'Telugu Movie Soundtracks', 'MM Keeravaani Soundtracks', 'Bahubali RRR BGM'],
        hindi: ['Bollywood BGM Themes', 'Hindi Movie Soundtracks', 'Brahmastra Soundtracks', 'Ajay Atul Scores'],
        tamil: ['Tamil Heroic BGM', 'Anirudh Mass Theme', 'AR Rahman BGM'],
        english: ['Hans Zimmer Soundtracks', 'Cinematic Scores', 'Epic Orchestral Scores', 'Two Steps From Hell'],
        punjabi: ['Punjabi Movie Soundtracks', 'Punjabi Action BGM'],
        kannada: ['KGF BGM Themes', 'Kantara Soundtracks'],
        malayalam: ['Malayalam Movie Soundtracks', 'Sushin Shyam Soundtracks']
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
        telugu: ['Telugu Acoustic Unplugged', 'Telugu Guitar Melodies', 'Telugu Soft Melodies'],
        hindi: ['Hindi Acoustic Unplugged', 'Bollywood Acoustic Songs', 'Prateek Kuhad Songs', 'Hindi Guitar Melodies'],
        tamil: ['Tamil Acoustic Unplugged', 'Tamil Guitar Melodies', 'Tamil Soft Melodies'],
        english: ['English Acoustic Songs', 'Singer Songwriter Pop', 'Acoustic Coffeehouse Pop', 'Fingerstyle Guitar Songs'],
        punjabi: ['Punjabi Acoustic Unplugged', 'Punjabi Guitar Songs'],
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
        telugu: ['Telugu Devotional Songs', 'Telugu Bhakti Songs', 'Telugu Stotram', 'SPB Bhakti Geethalu'],
        hindi: ['Hindi Devotional Songs', 'Hindi Bhakti Songs', 'Hindi Bhajan Songs', 'Hanuman Chalisa Hindi'],
        tamil: ['Tamil Devotional Songs', 'Tamil Bhakti Songs', 'Tamil Temple Chants'],
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
        telugu: ['Telugu Carnatic Classical', 'Telugu Classical Vocal', 'Thyagaraja Kritis Telugu', 'Telugu Classical Fusion'],
        hindi: ['Hindustani Classical Vocal', 'Indian Classical Instrumental', 'Pandit Bhimsen Joshi', 'Pandit Ravi Shankar Sitar'],
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
 * Rich multilingual Mood Feed: Queries language-specific genre matrices for user's desired language,
 * with strict language isolation, title deduplication, and returning 60+ authentic tracks!
 */
export async function getMoodFeed(
  moodKey: string,
  languages: string[] = ['Telugu', 'Hindi', 'English'],
  targetLanguage?: string
): Promise<{ mood: MoodCategory; tracks: FormattedSong[]; activeLanguage: string; availableLanguages: string[] }> {
  const categories = getMoodCategories();
  const normalizedKey = (moodKey || 'love').toLowerCase().trim();
  const category = categories.find((c) => c.key === normalizedKey || c.id === normalizedKey) || categories[0];

  const userLangs = (languages && languages.length > 0) ? languages : ['Telugu', 'Hindi', 'English'];
  const activeLang = (targetLanguage && targetLanguage.trim())
    ? targetLanguage.trim().toLowerCase()
    : (userLangs[0] || 'Telugu').toLowerCase();

  const capitalizedLang = activeLang.charAt(0).toUpperCase() + activeLang.slice(1);

  // Collect specific queries for the desired language
  const searchQueries: string[] = [];
  const specificQueries = category.genreQueries[activeLang] || category.genreQueries['telugu'] || [`${capitalizedLang} ${category.name} Songs`];
  specificQueries.forEach(q => searchQueries.push(q));

  // Add broad genre queries for desired language
  searchQueries.push(`${capitalizedLang} ${category.name} Chartbusters`);
  searchQueries.push(`${capitalizedLang} ${category.name} Top Hits`);

  try {
    const searchResults: any[] = [];
    for (let i = 0; i < searchQueries.length; i += 2) {
      const chunk = searchQueries.slice(i, i + 2);
      const chunkRes = await Promise.all(
        chunk.map(q => searchSongs(q, 1, 25).catch(() => ({ results: [] })))
      );
      searchResults.push(...chunkRes);
      if (i + 2 < searchQueries.length) {
        await new Promise(r => setTimeout(r, 40));
      }
    }

    const mergedTracks: FormattedSong[] = [];
    const seenIds = new Set<string>();
    const seenTitleKeys = new Set<string>();

    for (const res of searchResults) {
      for (const track of (res.results || [])) {
        // STRICT LANGUAGE ENFORCEMENT: Filter out tracks from other languages
        const trackLang = (track.language || '').trim().toLowerCase();
        if (trackLang && trackLang !== activeLang && activeLang !== 'all') {
          continue;
        }

        const titleKey = getNormalizedTitleKey(track.title);
        if (!seenIds.has(track.id) && (!titleKey || !seenTitleKeys.has(titleKey))) {
          seenIds.add(track.id);
          if (titleKey) seenTitleKeys.add(titleKey);
          mergedTracks.push(track);
        }
      }
    }

    // Fallback if results are low
    if (mergedTracks.length < 30) {
      const fallbackRes = await searchSongs(`${capitalizedLang} ${category.name} Superhits`, 1, 40).catch(() => ({ results: [] }));
      for (const track of (fallbackRes.results || [])) {
        const trackLang = (track.language || '').trim().toLowerCase();
        if (trackLang && trackLang !== activeLang && activeLang !== 'all') continue;

        const titleKey = getNormalizedTitleKey(track.title);
        if (!seenIds.has(track.id) && (!titleKey || !seenTitleKeys.has(titleKey))) {
          seenIds.add(track.id);
          if (titleKey) seenTitleKeys.add(titleKey);
          mergedTracks.push(track);
        }
      }
    }

    return {
      mood: category,
      tracks: mergedTracks.slice(0, 80),
      activeLanguage: capitalizedLang,
      availableLanguages: userLangs
    };
  } catch (err) {
    console.error('Error in getMoodFeed:', err);
    return {
      mood: category,
      tracks: [],
      activeLanguage: capitalizedLang,
      availableLanguages: userLangs
    };
  }
}
