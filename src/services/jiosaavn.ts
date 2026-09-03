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
  let rawArtist = '';
  if (raw.more_info?.artistMap?.primary_artists && Array.isArray(raw.more_info.artistMap.primary_artists) && raw.more_info.artistMap.primary_artists.length > 0) {
    rawArtist = raw.more_info.artistMap.primary_artists.map((a: any) => a.name).join(', ');
  } else if (raw.more_info?.artistMap?.artists && Array.isArray(raw.more_info.artistMap.artists) && raw.more_info.artistMap.artists.length > 0) {
    rawArtist = raw.more_info.artistMap.artists.map((a: any) => a.name).join(', ');
  } else if (raw.primary_artists) {
    rawArtist = raw.primary_artists;
  } else if (raw.more_info?.music) {
    rawArtist = raw.more_info.music;
  } else if (raw.singers || raw.more_info?.singers) {
    rawArtist = raw.singers || raw.more_info?.singers;
  } else if (raw.artist) {
    rawArtist = raw.artist;
  } else if (raw.subtitle) {
    rawArtist = raw.subtitle;
  } else {
    rawArtist = 'Unknown Artist';
  }
  const artist = decodeHtmlEntities(rawArtist);
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
    'ar rahman': ['Harris Jayaraj', 'Yuvan Shankar Raja', 'Anirudh Ravichander', 'Sid Sriram', 'Karthik', 'Unni Menon'],
    'harris jayaraj': ['Anirudh Ravichander', 'Yuvan Shankar Raja', 'Karthik', 'A.R. Rahman']
  },
  punjabi: {
    'diljit dosanjh': ['AP Dhillon', 'Karan Aujla', 'Sidhu Moose Wala', 'Guru Randhawa', 'B Praak', 'Amrinder Gill'],
    'ap dhillon': ['Gurinder Gill', 'Shubh', 'Diljit Dosanjh', 'Karan Aujla', 'PropheC'],
    'sidhu moose wala': ['Karan Aujla', 'Amrit Maan', 'Diljit Dosanjh', 'Prem Dhillon'],
    'b praak': ['Jaani', 'B Praak', 'Asees Kaur', 'Harrdy Sandhu', 'Jassie Gill']
  },
  malayalam: {
    'sushin shyam': ['Shaan Rahman', 'Hesham Abdul Wahab', 'Jakes Bejoy', 'Vineeth Sreenivasan'],
    'hesham abdul wahab': ['Sushin Shyam', 'Shaan Rahman', 'K.S. Harisankar', 'Sid Sriram'],
    'kj yesudas': ['K.J. Yesudas', 'K.S. Chithra', 'M.G. Sreekumar', 'Sujatha Mohan']
  },
  kannada: {
    'sanjith hegde': ['Charan Raj', 'Arjun Janya', 'Vijay Prakash', 'Vasuki Vaibhav'],
    'arjun janya': ['Vijay Prakash', 'Sanjith Hegde', 'Armaan Malik', 'Charan Raj']
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
 */
export async function getVibeRecommendations(
  songId?: string,
  artist?: string,
  title?: string,
  language?: string
): Promise<FormattedSong[]> {
  try {
    let rawLang = (language && language.trim()) ? language.trim().toLowerCase() : '';
    if (rawLang === 'unknown' || rawLang === 'null') rawLang = '';
    const capitalizedLang = rawLang ? (rawLang.charAt(0).toUpperCase() + rawLang.slice(1)) : '';

    // Primary & Secondary Artist extractions
    const cleanArtistStr = (artist || '').replace(/\s*\([^)]*\)/g, '');
    const artistParts = cleanArtistStr.split(/[,&/|]/).map(a => a.trim()).filter(a => a.length > 0 && a !== 'Unknown Artist');
    const primaryArtist = artistParts[0] || '';
    const secondaryArtist = artistParts[1] || '';

    // Find kindred cluster artists in this language
    const langCluster = rawLang ? (KINDRED_ARTIST_CLUSTERS[rawLang] || {}) : {};
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
      queries.push(`${capitalizedLang} ${primaryArtist} Best Songs`.trim());
      queries.push(`${capitalizedLang} ${primaryArtist} Hits`.trim());
    }

    if (secondaryArtist) {
      queries.push(`${capitalizedLang} ${secondaryArtist} Songs`.trim());
    }

    // Add up to 3 kindred artists from the cluster
    kindredArtists.slice(0, 3).forEach(k => {
      queries.push(`${capitalizedLang} ${k} Hits`.trim());
    });

    // 2. Pure Genre & Musical Style Anthems in target language
    if (capitalizedLang) {
      queries.push(`${capitalizedLang} Romantic Melodies`);
      queries.push(`${capitalizedLang} Superhit Movie Melodies`);
      queries.push(`${capitalizedLang} Top Hits Chartbusters`);
      queries.push(`${capitalizedLang} Acoustic Chill`);
      queries.push(`${capitalizedLang} Evergreen Masterpieces`);
    } else {
      queries.push(`${primaryArtist} Top Hits`);
      queries.push(`${cleanArtistStr} Melodies`);
    }

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
        if (rawLang) {
          const trackLang = (track.language || '').trim().toLowerCase();
          if (trackLang && trackLang !== rawLang) {
            continue; // Skip foreign / other language songs!
          }
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
      const fallbackQuery = capitalizedLang ? `${capitalizedLang} Top Trending Songs Hits` : `${primaryArtist || 'Top'} Hits`;
      const fallbackRes = await searchSongs(fallbackQuery, 1, 40).catch(() => ({ results: [] }));
      for (const track of (fallbackRes.results || [])) {
        if (rawLang) {
          const trackLang = (track.language || '').trim().toLowerCase();
          if (trackLang && trackLang !== rawLang) continue;
        }

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
 * 1. Liked and history related (ONLY if user has history or likes)
 * 2. Popular songs in EACH of user's selected languages
 * 3. Latest songs in EACH of user's selected languages
 * 4. Popular / Most listened songs in the world (English only)
 */
export async function getExploreFeed(
  profile?: { languages?: string[]; history?: any[]; likes?: any[] },
  currentTrack?: { id?: string; title?: string; artist?: string; language?: string }
): Promise<{ hero: any; sections: any[] }> {
  try {
    const userLangs = (profile && profile.languages && profile.languages.length > 0)
      ? profile.languages
      : ['Hindi', 'English'];

    const historyList = (profile && profile.history && Array.isArray(profile.history)) ? profile.history : [];
    const likesList = (profile && profile.likes && Array.isArray(profile.likes)) ? profile.likes : [];
    const userCombinedTracks = [...likesList, ...historyList];

    const hasUserHistory = userCombinedTracks.length > 0;
    const globalSeenIds = new Set<string>();
    const globalSeenTitles = new Set<string>();
    const sections: any[] = [];

    const dedupeTracks = (list: FormattedSong[], limit = 30, targetLang?: string): FormattedSong[] => {
      const out: FormattedSong[] = [];
      const tLang = (targetLang || '').toLowerCase().trim();
      for (const t of list) {
        if (tLang && tLang !== 'all') {
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

    // 1. LIKED & HISTORY RELATED (ONLY if user has history or liked songs)
    if (hasUserHistory) {
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
        .slice(0, 4);

      const historyQueries: string[] = [];
      topArtists.forEach(art => {
        historyQueries.push(`${art} Hits`);
      });
      userLangs.slice(0, 2).forEach(lang => {
        historyQueries.push(`${lang} Romantic Melodies`);
        historyQueries.push(`${lang} Acoustic Melodies`);
      });

      const histResultsArrays = await Promise.all(
        historyQueries.map(q => searchSongs(q, 1, 20).catch(() => ({ results: [] })))
      );

      const rawHistoryTracks: FormattedSong[] = [];
      for (const res of histResultsArrays) {
        for (const t of res.results || []) {
          rawHistoryTracks.push(t);
        }
      }

      const historyPersonalized = dedupeTracks(rawHistoryTracks, 30);
      if (historyPersonalized.length > 0) {
        sections.push({
          id: 'history_based_recommendations',
          title: `✨ Tailored to Your Favorite Songs & History`,
          tagline: (topArtists.length > 0)
            ? `Harmonized from your rotation of ${topArtists.slice(0, 3).join(', ')} and kindred melodies`
            : `Curated acoustic recommendations matching your taste`,
          badge: 'FOR YOU',
          color: '#22D3EE',
          tracks: historyPersonalized
        });
      }
    }

    // 2. POPULAR SONGS IN EACH OF USER'S SELECTED LANGUAGES
    for (const lang of userLangs) {
      const lKey = lang.trim();
      const [popRes, hitsRes] = await Promise.all([
        searchSongs(`${lKey} Top Hits`, 1, 25).catch(() => ({ results: [] })),
        searchSongs(`${lKey} Trending Hits`, 1, 25).catch(() => ({ results: [] }))
      ]);

      const popTracks = dedupeTracks([...(popRes.results || []), ...(hitsRes.results || [])], 30, lKey);
      if (popTracks.length > 0) {
        sections.push({
          id: `popular_${lKey.toLowerCase()}`,
          title: `🔥 All-Time Popular & Trending Hits in ${lKey}`,
          tagline: `Top streamed chartbusters and viral anthems in ${lKey}`,
          badge: `POPULAR ${lKey.toUpperCase()}`,
          color: '#F5C542',
          tracks: popTracks
        });
      }
    }

    // 3. LATEST SONGS IN EACH OF USER'S SELECTED LANGUAGES
    for (const lang of userLangs) {
      const lKey = lang.trim();
      const [latestRes, newRes] = await Promise.all([
        searchSongs(`${lKey} Latest Releases`, 1, 25).catch(() => ({ results: [] })),
        searchSongs(`${lKey} New Songs`, 1, 25).catch(() => ({ results: [] }))
      ]);

      const latestTracks = dedupeTracks([...(latestRes.results || []), ...(newRes.results || [])], 30, lKey);
      if (latestTracks.length > 0) {
        sections.push({
          id: `latest_${lKey.toLowerCase()}`,
          title: `✨ Fresh & Latest New Releases in ${lKey}`,
          tagline: `Newly dropped singles, album tracks, and recent soundtracks in ${lKey}`,
          badge: `NEW IN ${lKey.toUpperCase()}`,
          color: '#10B981',
          tracks: latestTracks
        });
      }
    }

    // 4. POPULAR / MOST LISTENED SONGS IN THE WORLD (ENGLISH ONLY)
    const [globalPopRes, billboardRes] = await Promise.all([
      searchSongs(`Global Top 50`, 1, 25).catch(() => ({ results: [] })),
      searchSongs(`English Pop Hits`, 1, 25).catch(() => ({ results: [] }))
    ]);

    const globalEnglishTracks = dedupeTracks([...(globalPopRes.results || []), ...(billboardRes.results || [])], 30, 'english');
    if (globalEnglishTracks.length > 0) {
      sections.push({
        id: 'global_english_chartbusters',
        title: '🌐 Global & Worldwide English Chartbusters',
        tagline: 'Billboard Hot 100, worldwide sensation pop, and international hits',
        badge: 'GLOBAL TOP 50',
        color: '#38BDF8',
        tracks: globalEnglishTracks
      });
    }

    // Select Hero Track from the top section
    const hero = (sections[0] && sections[0].tracks && sections[0].tracks[0]) || null;

    return { hero, sections: sections.filter(s => s.tracks && s.tracks.length > 0) };
  } catch (err) {
    console.error('Error generating explore feed:', err);
    return { hero: null, sections: [] };
  }
}

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
        telugu: ['Telugu Melody Hits', 'Sid Sriram Melodies', 'Telugu Love Duets', 'Hesham Abdul Wahab Telugu Melodies', 'SPB Romantic Melodies'],
        hindi: ['Bollywood Romantic Melodies', 'Hindi Romantic Songs', 'Arijit Singh Romantic Melodies', 'Shreya Ghoshal Melodies', 'Sonu Nigam Love Hits'],
        tamil: ['Tamil Romantic Melodies', 'Anirudh Romantic Hits', 'Harris Jayaraj Melodies', 'AR Rahman Romantic Hits', 'Sid Sriram Tamil Hits'],
        english: ['Romantic Acoustic Pop', 'Love Ballads Pop', 'Soft Romantic Pop Hits', 'Ed Sheeran Ballads', 'Taylor Swift Love Songs'],
        punjabi: ['Punjabi Romantic Melodies', 'B Praak Love Hits', 'Jaani Romantic Hits'],
        kannada: ['Kannada Romantic Melodies', 'Sonu Nigam Kannada Hits', 'Kannada Love Melodies'],
        malayalam: ['Malayalam Romantic Melodies', 'Hesham Abdul Wahab Hits', 'Vineeth Sreenivasan Melodies'],
        bengali: ['Bengali Romantic Melodies', 'Arijit Singh Bengali Hits'],
        marathi: ['Marathi Romantic Melodies', 'Ajay Atul Melodies'],
        gujarati: ['Gujarati Romantic Songs', 'Gujarati Garba Melodies'],
        bhojpuri: ['Bhojpuri Romantic Songs', 'Pawan Singh Hits'],
        spanish: ['Latin Romantic Pop', 'Spanish Love Ballads'],
        korean: ['K-Pop Romantic Ballads', 'Korean OST Love Songs'],
        japanese: ['J-Pop Romantic Melodies', 'Anime Love Songs'],
        french: ['French Romantic Chanson', 'French Pop Hits']
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
        telugu: ['Telugu Lofi Chillout', 'Telugu Acoustic Chill', 'Telugu Slowed Reverb', 'Midnight Telugu Melodies'],
        hindi: ['Hindi Lofi Chillout', 'Bollywood Acoustic Chill', 'Hindi Slowed Reverb', 'Midnight Hindi Melodies'],
        tamil: ['Tamil Lofi Chillout', 'Tamil Acoustic Chill', 'Tamil Slowed Reverb'],
        english: ['Lofi Chill Study Beats', 'Midnight Chillhop', 'Slowed Reverb Chill', 'Coffee Shop Acoustic Chill'],
        punjabi: ['Punjabi Acoustic Chill', 'Punjabi Slow Melodies'],
        kannada: ['Kannada Acoustic Melodies', 'Kannada Peaceful Songs'],
        malayalam: ['Malayalam Acoustic Melodies', 'Malayalam Chill Melodies'],
        spanish: ['Spanish Lofi Chill', 'Latin Chillout'],
        korean: ['K-Indie Chill Lofi', 'Korean Chill Cafe'],
        japanese: ['Tokyo Lofi Beats', 'Japanese Chill Hop']
      }
    },
    {
      id: 'breakup',
      key: 'breakup',
      name: 'Heartbreak & Melancholy Ballads',
      icon: '💔',
      tagline: 'Soul-stirring melancholy, emotional acoustics, and poignant vocal performances',
      color: '#8B5CF6',
      gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Pathos Melodies', 'Telugu Sad Melodies', 'Sid Sriram Sad Melodies', 'Telugu Heartbreak Songs', 'Emotional Melodies Telugu'],
        hindi: ['Arijit Singh Sad Melodies', 'Hindi Heartbreak Songs', 'Dard Bhare Geet Hindi', 'B Praak Sad Hits', 'Sad Bollywood Melodies'],
        tamil: ['Tamil Pathos Melodies', 'Tamil Sad Melodies', 'Yuvan Shankar Raja Sad Hits', 'Tamil Heartbreak Melodies'],
        english: ['Sad Pop Ballads', 'Emotional Piano Ballads', 'Adele Heartbreak Songs', 'Sad Acoustic Ballads', 'Heartbreak Hits'],
        punjabi: ['Punjabi Sad Melodies', 'B Praak Sad Hits', 'Kaka Sad Melodies'],
        kannada: ['Kannada Sad Melodies', 'Kannada Emotional Songs'],
        malayalam: ['Malayalam Sad Melodies', 'Malayalam Emotional Songs'],
        bengali: ['Bengali Sad Melodies', 'Hemanta Sad Classics'],
        spanish: ['Spanish Desamor Melancholy', 'Latin Sad Ballads'],
        korean: ['K-Drama Sad Ballads', 'Korean Heartbreak Songs']
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
        telugu: ['Telugu Feel Good Songs', 'Telugu Upbeat Melodies', 'Telugu Happy Hits', 'Joyful Telugu Songs'],
        hindi: ['Bollywood Feel Good Hits', 'Hindi Joyful Songs', 'Happy Bollywood Hits', 'Upbeat Hindi Melodies'],
        tamil: ['Tamil Feel Good Songs', 'Tamil Joyful Melodies', 'Tamil Upbeat Hits'],
        english: ['Feel Good Pop Hits', 'Sunny Acoustic Pop', 'Uplifting Radio Hits', 'Happy Acoustic Pop'],
        punjabi: ['Punjabi Happy Songs', 'Diljit Dosanjh Upbeat Songs', 'Punjabi Joyful Hits'],
        kannada: ['Kannada Happy Songs', 'Kannada Feel Good Songs'],
        malayalam: ['Malayalam Happy Songs', 'Malayalam Feel Good Songs'],
        spanish: ['Latin Feel Good Pop', 'Spanish Joyful Fiesta']
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
        telugu: ['Telugu Mass Fast Beats', 'Thaman Mass Beats', 'Telugu High BPM Hits', 'Anirudh Telugu Mass'],
        hindi: ['Bollywood Workout Motivation', 'Hindi High Energy Fast Beats', 'Gym Motivation High BPM'],
        tamil: ['Tamil Mass Beats', 'Anirudh Fast Beats Tamil', 'Tamil Gym Motivation'],
        english: ['Workout Motivation EDM High BPM', 'Gym Trap Hits', 'Beast Mode High Energy', 'Fitness Bass Boosted'],
        punjabi: ['Punjabi Gym Motivation', 'Sidhu Moose Wala Fast Beats', 'Punjabi Workout'],
        kannada: ['Kannada Mass Beats', 'Kannada High Energy Songs'],
        malayalam: ['Malayalam Fast Beats', 'Malayalam Gym Motivation']
      }
    },
    {
      id: 'party',
      key: 'party',
      name: 'Club Bangers & Dancefloor Hype',
      icon: '🎉',
      tagline: 'Mass celebration bangers, wedding dance anthems, and festival drops',
      color: '#3B82F6',
      gradient: 'linear-gradient(135deg, rgba(59, 130, 246, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Party Dance Hits', 'Telugu Wedding Dance Hits', 'Telugu Club Chartbusters', 'Thaman Party Hits'],
        hindi: ['Bollywood Dance Party Hits', 'Hindi Club Hits', 'Badshah Dance Hits', 'Bollywood Wedding Dance'],
        tamil: ['Tamil Dance Party Hits', 'Tamil Kuthu Dance Hits', 'Anirudh Dance Hits'],
        english: ['Global Dance Party Hits', 'EDM Club Chartbusters', 'Festival Dance Hits', 'Dance Pop Anthems'],
        punjabi: ['Punjabi Party Hits', 'Punjabi Wedding Dance', 'Bhangra Party Hits'],
        kannada: ['Kannada Party Songs', 'Kannada Dance Hits'],
        malayalam: ['Malayalam Party Hits', 'Malayalam Dance Songs'],
        spanish: ['Reggaeton Fiesta', 'Latin Club Bangers']
      }
    },
    {
      id: 'soulful',
      key: 'soulful',
      name: 'Soulful Sufi & Divine Ghazals',
      icon: '✨',
      tagline: 'Mystical Sufi poetry, harmonium melodies, and transcendent acoustic depth',
      color: '#6366F1',
      gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Soulful Melodies', 'SPB Soulful Melodies', 'Telugu Acoustic Classical Fusion'],
        hindi: ['Hindi Sufi Songs', 'Bollywood Ghazals', 'Rahat Fateh Ali Khan Sufi', 'Nusrat Fateh Ali Khan', 'A.R. Rahman Sufi'],
        tamil: ['Tamil Soulful Melodies', 'A.R. Rahman Soulful Tamil', 'Bombay Jayashri Soulful'],
        english: ['Acoustic Soul Classics', 'Soul Blues Vocal', 'Gospel Harmonies'],
        punjabi: ['Punjabi Sufi Songs', 'Nusrat Fateh Ali Khan', 'Satinder Sartaaj Sufi']
      }
    },
    {
      id: 'rock',
      key: 'rock',
      name: 'Electric Rock & Indie Alternative',
      icon: '🎸',
      tagline: 'Driving electric guitar riffs, heavy drum solos, and indie anthems',
      color: '#EF4444',
      gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Devi Sri Prasad Rock Songs', 'Telugu High Energy Rock', 'Telugu Rock Hits'],
        hindi: ['Bollywood Rock Hits', 'Indian Ocean Rock', 'Euphoria Hindi Rock', 'Agnee Hindi Rock'],
        tamil: ['Tamil Rock Hits', 'Anirudh Rock Hits Tamil'],
        english: ['Classic Rock Anthems', 'Alternative Rock Hits', 'Modern Rock Legends', 'Indie Rock Anthems']
      }
    },
    {
      id: 'cinematic',
      key: 'cinematic',
      name: 'Cinematic Orchestral & Epic BGM',
      icon: '🎻',
      tagline: 'Grand symphonic scores, epic movie themes, and soaring brass fanfares',
      color: '#06B6D4',
      gradient: 'linear-gradient(135deg, rgba(6, 182, 212, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Movie BGM', 'Keeravaani Soundtracks', 'Telugu Mass BGM', 'RRR Bahubali BGM'],
        hindi: ['Bollywood Theme Scores', 'AR Rahman Soundtracks', 'Hindi Cinematic BGM', 'Brahmastra BGM'],
        tamil: ['Tamil Mass BGM', 'Anirudh BGM Soundtracks', 'AR Rahman Tamil Scores'],
        english: ['Hans Zimmer Soundtracks', 'Epic Orchestral Scores', 'Movie Theme Symphony', 'Interstellar Inception Soundtrack']
      }
    },
    {
      id: 'acoustic',
      key: 'acoustic',
      name: 'Acoustic Coffeehouse & Unplugged',
      icon: '☕',
      tagline: 'Warm acoustic fingerpicking, subtle percussion, and intimate vocals',
      color: '#D97706',
      gradient: 'linear-gradient(135deg, rgba(217, 119, 6, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Acoustic Unplugged', 'Telugu Guitar Melodies', 'Telugu Soft Acoustic'],
        hindi: ['Bollywood Acoustic Unplugged', 'Hindi Guitar Melodies', 'Acoustic Covers Hindi'],
        tamil: ['Tamil Acoustic Unplugged', 'Tamil Guitar Melodies'],
        english: ['Coffeehouse Acoustic Guitar', 'Singer Songwriter Acoustic', 'Intimate Fingerstyle Guitar', 'Unplugged Pop Hits']
      }
    },
    {
      id: 'devotional',
      key: 'devotional',
      name: 'Devotional Mantras & Spiritual Peace',
      icon: '🙏',
      tagline: 'Sacred chants, meditative morning hymns, and peaceful stotrams',
      color: '#F59E0B',
      gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Bhakti Geethalu', 'SPB Bhakti Geethalu', 'Lord Venkateswara Stotrams', 'Telugu Devotional Bhajans'],
        hindi: ['Anup Jalota Bhajans', 'Krishna Bhajans Hindi', 'Shiv Stotram', 'Hanuman Chalisa Hariharan', 'Anuradha Paudwal Bhajans'],
        tamil: ['Tamil Bhakti Songs', 'Murugan Devotional Tamil', 'MS Subbulakshmi Suprabhatam', 'Kanda Sashti Kavasam'],
        english: ['Sacred Gregorian Chants', 'Peaceful Meditative Chants', 'Spiritual Hymns Chants']
      }
    },
    {
      id: 'classical',
      key: 'classical',
      name: 'Classical Indian & Timeless Ragas',
      icon: '🪕',
      tagline: 'Authentic Carnatic kritis, Hindustani classical ragas, and sitar improvisations',
      color: '#14B8A6',
      gradient: 'linear-gradient(135deg, rgba(20, 184, 166, 0.22), rgba(17, 17, 24, 0.95))',
      genreQueries: {
        telugu: ['Telugu Carnatic Classical Vocal', 'Thyagaraja Kritis Carnatic', 'MS Subbulakshmi Carnatic', 'Annamayya Sankeerthanalu Classical'],
        hindi: ['Hindustani Classical Vocal', 'Pandit Ravi Shankar Sitar Ragas', 'Pandit Jasraj Classical', 'Bismillah Khan Shehnai'],
        tamil: ['Carnatic Classical Vocal Tamil', 'MS Subbulakshmi Carnatic Classical', 'Lalgudi Jayaraman Violin'],
        english: ['Classical Symphony Masterpieces', 'Mozart Symphony Orchestral', 'Beethoven Piano Sonatas', 'Chopin Nocturnes']
      }
    }
  ];
}

const INDIAN_LANGUAGES = new Set([
  'telugu', 'hindi', 'tamil', 'punjabi', 'malayalam', 'kannada', 'bengali',
  'marathi', 'gujarati', 'bhojpuri', 'haryanvi', 'rajasthani', 'urdu', 'assamese', 'odia'
]);

/**
 * Deep Musical Genre & Acoustic Mood Validator
 * Ensures tracks belong to their designated emotional & musical genre,
 * rejecting superficial text keyword matches (e.g. party songs titled with 'love',
 * or dance tracks titled with 'breakup party', or romantic songs in devotional).
 */
export function verifyTrackMoodGenre(track: FormattedSong, moodKey: string): boolean {
  if (!track || !track.title) return false;

  const title = (track.title || '').toLowerCase();
  const album = (track.album || '').toLowerCase();
  const artist = (track.artist || '').toLowerCase();
  const fullText = `${title} ${album} ${artist}`.toLowerCase();

  switch (moodKey) {
    case 'love': {
      // BANNED: aggressive fast beats, club/EDM, workout drops, breakup songs, item songs
      const badTerms = [
        'remix', 'dj mix', 'club mix', 'party mix', 'edm', 'trap mix',
        'workout', 'gym', 'breakup', 'break up', 'sad version', 'pathos',
        'crying', 'death', 'funeral', 'item song', 'dappan koothu', 'fast beat',
        'mass beat', 'bass boosted', 'lover also fighter', 'fight song'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'lofi': {
      // BANNED: loud fast beats, party, metal, screaming, EDM
      const badTerms = [
        'remix', 'dj', 'club', 'party', 'dance mix', 'fast', 'gym', 'workout',
        'bass boosted', 'mass', 'hard rock', 'heavy metal', 'trap mix', 'screaming',
        'item song', 'high energy'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'breakup': {
      // BANNED: upbeat party/dance/celebration (e.g. "breakup party"!)
      const badTerms = [
        'party', 'club', 'dance', 'dj', 'disco', 'celebration', 'wedding',
        'bhangra', 'fiesta', 'edm', 'dappan koothu', 'fast beat', 'happy',
        'feel good', 'joyful', 'festive', 'item song', 'remix', 'bass boosted'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'feel_good': {
      // BANNED: sad, depressing, death, melancholy, heartbroken
      const badTerms = [
        'sad', 'crying', 'funeral', 'death', 'heartbreak', 'breakup',
        'melancholy', 'dark', 'depressed', 'horror', 'sorrow', 'pain',
        'tears', 'alone', 'crying version'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'workout': {
      // BANNED: slow, sleep, lofi, lullaby, peaceful, crying
      const badTerms = [
        'lofi', 'sleep', 'lullaby', 'peaceful', 'meditation', 'crying',
        'soft acoustic', 'slow melody', 'sad version', 'pathos'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'party': {
      // BANNED: sad, crying, lofi, sleep, devotional, slow acoustic
      const badTerms = [
        'sad', 'crying', 'pain', 'funeral', 'death', 'lofi', 'sleep',
        'lullaby', 'bhajan', 'stotram', 'stotra', 'devotional', 'mantra',
        'slow acoustic', 'slow melody', 'peaceful meditation'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'soulful': {
      // BANNED: loud EDM, fast dance, party, trap, mass
      const badTerms = [
        'dj mix', 'club mix', 'edm', 'party mix', 'fast beat', 'mass beat',
        'trap', 'hard rock', 'metal', 'bass boosted', 'item song'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'rock': {
      // BANNED: lullaby, sleep, soft lofi, devotional chants
      const badTerms = [
        'lofi', 'sleep', 'lullaby', 'bhajan', 'stotram', 'meditation',
        'soft acoustic', 'soothing'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'cinematic': {
      // BANNED: dance pop remix, DJ, party mix
      const badTerms = [
        'remix', 'dj mix', 'club mix', 'slap house', 'dance pop', 'party mix'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'acoustic': {
      // BANNED: loud EDM, electronic club, DJ, heavy bass
      const badTerms = [
        'remix', 'dj', 'club mix', 'edm', 'synth', 'techno', 'heavy metal',
        'hard rock', 'bass boosted', 'trap', 'fast beat'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;
      return true;
    }

    case 'devotional': {
      // MUST NOT have romantic, item, party words
      const badTerms = [
        'romantic', 'love duet', 'item song', 'kiss', 'sexy', 'hot',
        'club mix', 'party', 'breakup', 'dance mix', 'disco', 'remix'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;

      // MUST have genuine devotional markers
      const goodDevotional = [
        'bhakti', 'bhajan', 'stotram', 'stotra', 'suprabhatam', 'mantra',
        'chalisa', 'aarti', 'arti', 'chant', 'kirtan', 'shiva', 'krishna',
        'rama', 'venkateswara', 'hanuman', 'ganesha', 'ganesh', 'durga',
        'sai', 'ayyappa', 'murugan', 'govinda', 'namam', 'geethalu',
        'spiritual', 'divine', 'temple', 'sloka', 'hymn', 'chandan',
        'anuradha', 'spb bhakti', 'yesudas', 'sacred', 'gregorian'
      ];
      return goodDevotional.some(g => fullText.includes(g));
    }

    case 'classical': {
      // MUST NOT have modern dance/pop/remix words
      const badTerms = [
        'remix', 'dj', 'club', 'party', 'disco', 'trap', 'item song',
        'edm', 'bhangra', 'rap'
      ];
      if (badTerms.some(t => fullText.includes(t))) return false;

      // MUST have genuine classical markers
      const goodClassical = [
        'classical', 'raga', 'raag', 'ragam', 'kriti', 'carnatic', 'hindustani',
        'sitar', 'flute', 'veena', 'tabla', 'instrumental', 'thyagaraja',
        'annamayya', 'vocal', 'symphony', 'orchestra', 'sonata', 'concerto',
        'jugalbandi', 'alaap', 'tansen', 'subbulakshmi', 'balamuralikrishna',
        'jasraj', 'ravi shankar', 'bhimsen', 'mozart', 'beethoven', 'bach'
      ];
      return goodClassical.some(g => fullText.includes(g));
    }

    default:
      return true;
  }
}

/**
 * Rich multilingual Mood Feed: Queries language-specific genuine musical genre matrices for user's desired language,
 * with strict genre & mood acoustic verification, language isolation, title deduplication, and returning 60+ authentic tracks!
 */
export async function getMoodFeed(
  moodKey: string,
  languages: string[] = ['Hindi', 'English'],
  targetLanguage?: string
): Promise<{ mood: MoodCategory; tracks: FormattedSong[]; activeLanguage: string; availableLanguages: string[] }> {
  const categories = getMoodCategories();
  const normalizedKey = (moodKey || 'love').toLowerCase().trim();
  const category = categories.find((c) => c.key === normalizedKey || c.id === normalizedKey) || categories[0];

  const userLangs = (languages && languages.length > 0) ? languages : ['Hindi', 'English'];
  const activeLang = (targetLanguage && targetLanguage.trim())
    ? targetLanguage.trim().toLowerCase()
    : (userLangs[0] || 'hindi').toLowerCase();

  const capitalizedLang = activeLang.charAt(0).toUpperCase() + activeLang.slice(1);
  const isIndian = INDIAN_LANGUAGES.has(activeLang);

  // Genre Query Generator mapping genuine musical genres instead of literal mood words
  const moodGenreQueriesMap: Record<string, string[]> = {
    love: [`${capitalizedLang} Romantic Melodies`, `${capitalizedLang} Melody Songs`, `${capitalizedLang} Love Duets Melodies`, `${capitalizedLang} Romantic Ballads`],
    lofi: [`${capitalizedLang} Lofi Chill`, `${capitalizedLang} Acoustic Melodies`, `${capitalizedLang} Slowed Reverb Melodies`],
    breakup: [`${capitalizedLang} Sad Melodies`, `${capitalizedLang} Heartbreak Melodies`, `${capitalizedLang} Emotional Pathos Songs`],
    feel_good: [`${capitalizedLang} Happy Songs`, `${capitalizedLang} Upbeat Melodies`, `${capitalizedLang} Joyful Feel Good`],
    workout: [`${capitalizedLang} Gym Motivation Fast Beats`, `${capitalizedLang} Mass Beats`, `${capitalizedLang} High Energy Workout`],
    party: [`${capitalizedLang} Dance Party Hits`, `${capitalizedLang} Club Hits`, `${capitalizedLang} Fast Beats Party`],
    soulful: [`${capitalizedLang} Sufi Melodies`, `${capitalizedLang} Soulful Ghazals`, `${capitalizedLang} Acoustic Soul`],
    rock: [`${capitalizedLang} Rock Hits`, `${capitalizedLang} Alternative Rock`, `${capitalizedLang} High Energy Rock`],
    cinematic: [`${capitalizedLang} Movie BGM Soundtracks`, `${capitalizedLang} Epic Cinematic Scores`],
    acoustic: [`${capitalizedLang} Acoustic Unplugged`, `${capitalizedLang} Guitar Melodies`],
    devotional: [`${capitalizedLang} Bhakti Geethalu`, `${capitalizedLang} Devotional Stotrams`, `${capitalizedLang} Bhajans Chants`],
    classical: [`${capitalizedLang} Carnatic Classical Ragas`, `${capitalizedLang} Hindustani Classical Vocal`]
  };

  // Collect specific queries for the desired language
  const searchQueries: string[] = [];
  const specificQueries = category.genreQueries[activeLang] || moodGenreQueriesMap[normalizedKey] || [
    `${capitalizedLang} ${category.name} Songs`
  ];
  specificQueries.forEach(q => searchQueries.push(q));

  // Add genre-specific query from taxonomy
  if (moodGenreQueriesMap[normalizedKey]) {
    moodGenreQueriesMap[normalizedKey].forEach(q => {
      if (!searchQueries.includes(q)) searchQueries.push(q);
    });
  }

  try {
    const mergedTracks: FormattedSong[] = [];
    const seenIds = new Set<string>();
    const seenTitleKeys = new Set<string>();

    // 1. Fetch Official Curated Playlists for this exact Mood & Language
    const curatedPlaylistQueries: Record<string, string[]> = {
      love: [`${capitalizedLang} Romantic Hits`, `${capitalizedLang} Love Hits`, `Romantic Monsoon ${capitalizedLang}`],
      breakup: [`${capitalizedLang} Sad Songs`, `${capitalizedLang} Sad Hits`, `Tears Of Love`],
      lofi: [`${capitalizedLang} Lofi Chill`, `${capitalizedLang} Chillout`, `Midnight Lofi`],
      feel_good: [`${capitalizedLang} Feel Good`, `${capitalizedLang} Happy Songs`, `Upbeat ${capitalizedLang}`],
      workout: [`${capitalizedLang} Workout Hits`, `${capitalizedLang} Gym Motivation`, `${capitalizedLang} Fast Beats`],
      party: [`${capitalizedLang} Party Hits`, `${capitalizedLang} Dance Hits`, `${capitalizedLang} Club Hits`],
      soulful: [`${capitalizedLang} Soulful`, `${capitalizedLang} Sufi Hits`, `${capitalizedLang} Ghazals`],
      rock: [`${capitalizedLang} Rock Hits`, `Rock Anthems`],
      cinematic: [`${capitalizedLang} Movie BGM`, `${capitalizedLang} Soundtracks`],
      acoustic: [`${capitalizedLang} Acoustic Hits`, `${capitalizedLang} Unplugged`],
      devotional: [`${capitalizedLang} Bhakti Geethalu`, `${capitalizedLang} Devotional Hits`, `${capitalizedLang} Bhajans`],
      classical: [`${capitalizedLang} Classical Hits`, `${capitalizedLang} Carnatic Vocal`, `${capitalizedLang} Classical Ragas`]
    };

    const playlistSearchTerms = curatedPlaylistQueries[normalizedKey] || [`${capitalizedLang} ${category.name}`];
    
    // Extract editorial tracks from JioSaavn's official genre playlists
    for (const pTerm of playlistSearchTerms.slice(0, 2)) {
      try {
        const searchPlUrl = `${SAAVN_BASE_URL}?__call=search.getPlaylistResults&_format=json&_marker=0&api_version=4&n=2&p=1&q=${encodeURIComponent(pTerm)}`;
        const plFetch = await fetch(searchPlUrl, { headers: DEFAULT_HEADERS });
        const plText = await plFetch.text();
        const plCleaned = plText.replace(/^[^{]*/, '').replace(/[^}]*$/, '');
        const plRes = JSON.parse(plCleaned);
        const playlists = plRes.results || [];
        for (const pl of playlists.slice(0, 2)) {
          if (!pl || !pl.id) continue;
          const plDetUrl = `${SAAVN_BASE_URL}?__call=playlist.getDetails&_format=json&_marker=0&api_version=4&listid=${encodeURIComponent(pl.id)}`;
          const detFetch = await fetch(plDetUrl, { headers: DEFAULT_HEADERS });
          const detText = await detFetch.text();
          const plDetails = JSON.parse(detText.replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
          const rawSongs = (plDetails.list && Array.isArray(plDetails.list))
            ? plDetails.list
            : (plDetails.songs && Array.isArray(plDetails.songs) ? plDetails.songs : []);
          for (const s of rawSongs) {
            const formatted = await formatSongObject(s, false);
            if (!formatted || !formatted.id) continue;

            const trackLang = (formatted.language || '').trim().toLowerCase();
            if (isIndian) {
              if (trackLang && trackLang !== activeLang && activeLang !== 'all') continue;
            } else if (activeLang !== 'english' && activeLang !== 'all') {
              if (INDIAN_LANGUAGES.has(trackLang)) continue;
            }

            if (!verifyTrackMoodGenre(formatted, normalizedKey)) continue;

            const titleKey = getNormalizedTitleKey(formatted.title);
            if (!seenIds.has(formatted.id) && (!titleKey || !seenTitleKeys.has(titleKey))) {
              seenIds.add(formatted.id);
              if (titleKey) seenTitleKeys.add(titleKey);
              mergedTracks.push(formatted);
            }
          }
        }
      } catch (e) {}
    }

    // 2. Supplement with high-precision genre searches if under 50 tracks
    if (mergedTracks.length < 50) {
      const searchResults: any[] = [];
      for (let i = 0; i < searchQueries.length; i += 2) {
        const chunk = searchQueries.slice(i, i + 2);
        const chunkRes = await Promise.all(
          chunk.map(q => searchSongs(q, 1, 30).catch(() => ({ results: [] })))
        );
        searchResults.push(...chunkRes);
        if (i + 2 < searchQueries.length) {
          await new Promise(r => setTimeout(r, 40));
        }
      }

      for (const res of searchResults) {
        for (const track of (res.results || [])) {
          const trackLang = (track.language || '').trim().toLowerCase();

          // Language Filter
          if (isIndian) {
            if (trackLang && trackLang !== activeLang && activeLang !== 'all') {
              continue;
            }
          } else if (activeLang !== 'english' && activeLang !== 'all') {
            if (INDIAN_LANGUAGES.has(trackLang)) {
              continue;
            }
          }

          // GENRE & ACOUSTIC MOOD VERIFICATION
          if (!verifyTrackMoodGenre(track, normalizedKey)) {
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
    }

    // Fallback if results are low with strict genre check
    if (mergedTracks.length < 25) {
      const fallbackQuery = moodGenreQueriesMap[normalizedKey]
        ? moodGenreQueriesMap[normalizedKey][0]
        : `${capitalizedLang} Melody Songs`;
      const fallbackRes = await searchSongs(fallbackQuery, 1, 40).catch(() => ({ results: [] }));
      for (const track of (fallbackRes.results || [])) {
        const trackLang = (track.language || '').trim().toLowerCase();
        if (isIndian) {
          if (trackLang && trackLang !== activeLang && activeLang !== 'all') continue;
        } else if (activeLang !== 'english' && activeLang !== 'all') {
          if (INDIAN_LANGUAGES.has(trackLang)) continue;
        }

        if (!verifyTrackMoodGenre(track, normalizedKey)) continue;

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

/**
 * Universal Playlist Import Engine for JioSaavn and Spotify
 * Resolves full public playlists/albums and converts all items into Oxyzen FormattedSongs
 */
export async function importPlaylistFromUrl(rawUrl: string): Promise<{
  success: boolean;
  name: string;
  description: string;
  cover_url: string;
  source: 'jiosaavn' | 'spotify' | 'unknown';
  tracks: FormattedSong[];
}> {
  const url = (rawUrl || '').trim();
  if (!url) {
    throw new Error('Please provide a valid playlist URL');
  }

  // 1. JioSaavn / Saavn Playlist or Album URL
  if (url.includes('jiosaavn.com') || url.includes('saavn.com')) {
    // Extract token from URL
    const cleanUrl = url.split('?')[0].replace(/\/+$/, '');
    const segments = cleanUrl.split('/');
    const token = segments[segments.length - 1] || '';

    if (!token) {
      throw new Error('Invalid JioSaavn playlist URL structure');
    }

    const isAlbum = url.includes('/album/');
    const callType = isAlbum ? 'album' : 'playlist';

    const apiUrl = `https://www.jiosaavn.com/api.php?__call=webapi.get&token=${encodeURIComponent(token)}&type=${callType}&p=1&n=100&includeMetaTags=0&ctx=web6dot0&api_version=4&_format=json&_marker=0`;

    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    if (!res.ok) {
      throw new Error(`JioSaavn playlist fetch failed (HTTP ${res.status})`);
    }

    const data: any = await res.json();
    const rawTracks: any[] = data.list || data.songs || [];
    const name = data.title || data.listname || data.name || 'Imported JioSaavn Playlist';
    const description = data.subtitle || data.header_desc || `Imported from JioSaavn with ${rawTracks.length} tracks`;
    const cover_url = (data.image || '/static/assets/logo.png').replace('150x150', '500x500');

    const tracks: FormattedSong[] = [];
    for (const item of rawTracks) {
      try {
        const formatted = await formatSongObject(item, false);
        tracks.push(formatted);
      } catch (e) {}
    }

    return {
      success: true,
      name,
      description,
      cover_url,
      source: 'jiosaavn',
      tracks
    };
  }

  // 2. Spotify Playlist, Album, or Track URL
  if (url.includes('spotify.com')) {
    const isInviteLink = url.includes('pt=');
    const playlistMatch = url.match(/playlist\/([a-zA-Z0-9]+)/);
    const albumMatch = url.match(/album\/([a-zA-Z0-9]+)/);
    const trackMatch = url.match(/track\/([a-zA-Z0-9]+)/);

    const entityType = playlistMatch ? 'playlist' : (albumMatch ? 'album' : (trackMatch ? 'track' : null));
    const entityId = playlistMatch ? playlistMatch[1] : (albumMatch ? albumMatch[1] : (trackMatch ? trackMatch[1] : null));

    if (!entityType || !entityId) {
      throw new Error('Invalid Spotify link. Please provide a link to a Spotify playlist, album, or track.');
    }

    const embedUrl = `https://open.spotify.com/embed/${entityType}/${entityId}`;
    const embedRes = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!embedRes.ok) {
      if (embedRes.status === 404) {
        if (isInviteLink) {
          throw new Error('This Spotify playlist is a private collaborative invite link (?pt=...). Spotify restricts invite links to logged-in Spotify app sessions. To import into Oxyzen: Open the playlist in Spotify, tap (•••) > "Make Public", and paste the standard link.');
        }
        throw new Error('Spotify playlist not found (404). Please ensure the playlist is set to "Public" in Spotify so Oxyzen can access its tracks.');
      }
      throw new Error(`Spotify embed fetch failed (HTTP ${embedRes.status})`);
    }

    const html = await embedRes.text();
    const idx = html.indexOf('__NEXT_DATA__');
    if (idx === -1) {
      if (isInviteLink) {
        throw new Error('This Spotify link contains a collaborative invite code (?pt=...). Spotify requires logging into Spotify to view collaborative invite links. In Spotify, tap (•••) > "Make Public", then copy the public link to import.');
      }
      throw new Error('Could not parse Spotify playlist metadata. Please ensure the playlist is public.');
    }

    const start = html.indexOf('>', idx) + 1;
    const end = html.indexOf('</script>', start);
    const jsonStr = html.substring(start, end);
    let nextData: any = {};
    try {
      nextData = JSON.parse(jsonStr);
    } catch (e) {
      throw new Error('Failed to parse Spotify metadata response');
    }

    // Check if Spotify returned a 404 inside NextData
    if (nextData.props?.pageProps?.status === 404) {
      if (isInviteLink) {
        throw new Error('This Spotify playlist is a private collaborative invite link (?pt=...). Spotify blocks invite links from web scraping. To import: Open Spotify > tap (•••) > "Make Public" (or share without ?pt=), or export your playlist as JSON.');
      }
      throw new Error('Spotify playlist not found or set to Private. Please open Spotify, tap (•••) on the playlist, select "Make Public", and try again.');
    }

    const entity = nextData.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      if (isInviteLink) {
        throw new Error('This Spotify link is a collaborative party link (?pt=...). Spotify restricts unauthenticated access to collaborative invites. Please make the playlist Public on Spotify first.');
      }
      throw new Error('Spotify playlist data was empty or restricted. Please ensure the playlist is set to "Public" on Spotify.');
    }

    const name = entity.name || entity.title || 'Imported Spotify Playlist';
    const rawTrackList: any[] = entity.trackList || entity.tracks || [];
    const description = entity.description || `Imported from Spotify with ${rawTrackList.length} tracks`;
    const cover_url = entity.coverArt?.sources?.[0]?.url || entity.images?.[0]?.url || '/static/assets/logo.png';

    // Search and match each Spotify track on JioSaavn in parallel batches
    const matchedTracks: FormattedSong[] = [];
    const seenIds = new Set<string>();

    for (let i = 0; i < rawTrackList.length; i += 3) {
      const batch = rawTrackList.slice(i, i + 3);
      const batchResults = await Promise.all(
        batch.map(async (st: any) => {
          const title = st.title || st.name || '';
          const subtitle = st.subtitle || (st.artists ? st.artists.map((a: any) => a.name).join(' ') : '');
          const query = `${title} ${subtitle}`.trim();
          if (!query) return null;
          try {
            const res = await searchSongs(query, 1, 3);
            return res.results[0] || null;
          } catch (e) {
            return null;
          }
        })
      );

      for (const track of batchResults) {
        if (track && !seenIds.has(track.id)) {
          seenIds.add(track.id);
          matchedTracks.push(track);
        }
      }

      if (i + 3 < rawTrackList.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    return {
      success: true,
      name,
      description,
      cover_url,
      source: 'spotify',
      tracks: matchedTracks
    };
  }

  throw new Error('Unsupported playlist URL. Please provide a valid JioSaavn or Spotify playlist link.');
}
