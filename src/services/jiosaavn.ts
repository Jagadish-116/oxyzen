/**
 * JioSaavn Music Service for Oxyzen
 * Handles search, song details, high-bitrate CDN audio streams (320kbps/160kbps/96kbps),
 * search suggestions, charts, trending, and explore feeds.
 */

export interface SongQuality {
  bitrate: string;
  url: string;
}

export interface FormattedSong {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  album: string;
  image: string;
  thumbnail: string;
  duration: number;
  duration_sec: number;
  duration_formatted: string;
  language: string;
  year?: string | number;
  has_lyrics: boolean;
  downloadUrl: SongQuality[];
  stream_url: string;
  direct_url?: string;
  encrypted_media_url?: string;
  perma_url?: string;
  copyright?: string;
}

const SAAVN_BASE_URL = 'https://www.jiosaavn.com/api.php';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

// In-memory stream URL cache to avoid repeated auth_url roundtrips
const streamUrlCache = new Map<string, SongQuality[]>();

/**
 * Decodes all HTML entities commonly returned by JioSaavn (e.g. &quot;, &amp;, &#039;)
 */
export function decodeHtmlEntities(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim();
}

/**
 * Replaces low-res thumbnail resolutions (50x50, 150x150) with high-res 500x500 CDN URLs
 */
export function formatImageUrl(url: string | null | undefined, resolution = '500x500'): string {
  if (!url) return '/static/assets/logo.png';
  return url
    .replace('50x50', resolution)
    .replace('150x150', resolution)
    .replace('http://', 'https://');
}

/**
 * Formats duration in seconds to "m:ss" string
 */
export function formatDuration(seconds: number | string): string {
  const totalSec = Math.max(0, parseInt(String(seconds), 10) || 0);
  const mins = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  return `${mins}:${remSec < 10 ? '0' : ''}${remSec}`;
}

/**
 * Generates direct high-bitrate CDN audio stream links (320kbps, 160kbps, 96kbps, 48kbps, 12kbps)
 * from an encrypted media URL.
 */
export async function generateStreamUrls(encryptedUrl: string): Promise<SongQuality[]> {
  if (!encryptedUrl) return [];

  if (streamUrlCache.has(encryptedUrl)) {
    return streamUrlCache.get(encryptedUrl)!;
  }

  try {
    const authUrl = `${SAAVN_BASE_URL}?__call=song.generateAuthToken&_format=json&_marker=0&cc=in&url=${encodeURIComponent(encryptedUrl)}&bitrate=96`;
    const res = await fetch(authUrl, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`generateAuthToken failed: ${res.status}`);

    const data: any = await res.json();
    if (data && typeof data.auth_url === 'string') {
      const rawBase = data.auth_url.split('?')[0];
      const normalizedBase = rawBase
        .replace(/^https?:\/\/[^\/]+/, 'https://aac.saavncdn.com');

      const qualities: SongQuality[] = [
        { bitrate: '12kbps', url: normalizedBase.replace('_96', '_12') },
        { bitrate: '48kbps', url: normalizedBase.replace('_96', '_48') },
        { bitrate: '96kbps', url: normalizedBase.replace('_96', '_96') },
        { bitrate: '160kbps', url: normalizedBase.replace('_96', '_160') },
        { bitrate: '320kbps', url: normalizedBase.replace('_96', '_320') },
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

  let downloadUrl: SongQuality[] = [];
  let streamUrl = '';

  if (resolveStreams && encryptedUrl) {
    downloadUrl = await generateStreamUrls(encryptedUrl);
    if (downloadUrl.length > 0) {
      // 320kbps is the last item in the array
      const highest = downloadUrl[downloadUrl.length - 1];
      streamUrl = highest.url;
    }
  }

  // If streams couldn't be resolved or were skipped, fall back to /api/stream/:id or direct link
  if (!streamUrl) {
    streamUrl = `/api/stream/${id}`;
  }

  return {
    id,
    videoId: id, // For backward compatibility with legacy frontends
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
export async function searchSongs(query: string, page = 1, limit = 30): Promise<{ query: string; total: number; page: number; results: FormattedSong[] }> {
  if (!query || !query.trim()) {
    return { query: '', total: 0, page, results: [] };
  }

  const url = `${SAAVN_BASE_URL}?__call=search.getResults&_format=json&_marker=0&cc=in&includeMetaTags=1&p=${page}&n=${limit}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`JioSaavn search failed with status ${res.status}`);
  }

  const data: any = await res.json();
  const rawResults: any[] = Array.isArray(data.results) ? data.results : [];
  const total = parseInt(String(data.total || rawResults.length), 10) || rawResults.length;

  // Resolve stream URLs in parallel
  const results = await Promise.all(
    rawResults.map((raw) => formatSongObject(raw, true))
  );

  return {
    query,
    total,
    page,
    results
  };
}

/**
 * Fetches full details for a single song ID
 */
export async function getSongDetails(songId: string): Promise<FormattedSong | null> {
  if (!songId) return null;

  const url = `${SAAVN_BASE_URL}?__call=song.getDetails&_format=json&_marker=0&cc=in&pids=${encodeURIComponent(songId)}`;
  const res = await fetch(url, { headers: DEFAULT_HEADERS });
  if (!res.ok) {
    throw new Error(`JioSaavn song details failed with status ${res.status}`);
  }

  const data: any = await res.json();
  const rawSong = data[songId] || (Array.isArray(data.songs) ? data.songs[0] : null) || Object.values(data)[0];

  if (!rawSong || typeof rawSong !== 'object' || !rawSong.id) {
    return null;
  }

  return await formatSongObject(rawSong, true);
}

/**
 * Fetches search autocomplete suggestions
 */
export async function getSearchSuggestions(query: string): Promise<string[]> {
  if (!query || !query.trim()) return [];

  try {
    const url = `${SAAVN_BASE_URL}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) return [];

    const data: any = await res.json();
    const suggestions: string[] = [];

    if (data.topquery && Array.isArray(data.topquery.data)) {
      for (const item of data.topquery.data) {
        if (item.title) suggestions.push(decodeHtmlEntities(item.title));
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
        if (album.title) suggestions.push(decodeHtmlEntities(album.title));
      }
    }

    // Return unique suggestions up to 10
    return Array.from(new Set(suggestions)).slice(0, 10);
  } catch (err) {
    console.warn('Error fetching search suggestions:', err);
    return [];
  }
}

/**
 * Fetches trending tracks and playlists from JioSaavn
 */
export async function getTrending(): Promise<{ songs: FormattedSong[]; albums: any[]; playlists: any[] }> {
  try {
    const url = `${SAAVN_BASE_URL}?__call=content.getTrending&_format=json&_marker=0&cc=in`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`getTrending failed: ${res.status}`);

    const data: any = await res.json();
    const rawItems: any[] = Array.isArray(data) ? data : [];

    const songs: FormattedSong[] = [];
    const albums: any[] = [];
    const playlists: any[] = [];

    for (const item of rawItems) {
      if (item.type === 'song') {
        const songData = item.details || item;
        const formatted = await formatSongObject(songData, true);
        songs.push(formatted);
      } else if (item.type === 'album') {
        const d = item.details || item;
        albums.push({
          id: d.albumid || d.id,
          title: decodeHtmlEntities(d.title || d.song),
          artist: decodeHtmlEntities(d.artist?.name || d.primary_artists || ''),
          image: formatImageUrl(d.image, '500x500'),
          year: d.release_date || d.year || '',
          language: d.language || item.language || ''
        });
      } else if (item.type === 'playlist') {
        const d = item.details || item;
        playlists.push({
          id: d.listid || d.id,
          title: decodeHtmlEntities(d.title || d.listname),
          image: formatImageUrl(d.image, '500x500'),
          count: d.count || d.song_count || 0
        });
      }
    }

    // If direct songs in trending were few, supplement with top search hits for popular charts
    if (songs.length < 10) {
      const topHits = await searchSongs('Trending India Hits', 1, 15);
      songs.push(...topHits.results);
    }

    return {
      songs: songs.slice(0, 30),
      albums: albums.slice(0, 15),
      playlists: playlists.slice(0, 15)
    };
  } catch (err) {
    console.warn('Error fetching trending feed:', err);
    // Fallback to top songs search
    const fallback = await searchSongs('Top Bollywood Trending', 1, 20);
    return {
      songs: fallback.results,
      albums: [],
      playlists: []
    };
  }
}

/**
 * Fetches top charts and editorial playlists
 */
export async function getCharts(): Promise<any[]> {
  try {
    const url = `${SAAVN_BASE_URL}?__call=content.getCharts&_format=json&_marker=0&cc=in`;
    const res = await fetch(url, { headers: DEFAULT_HEADERS });
    if (!res.ok) throw new Error(`getCharts failed: ${res.status}`);

    const data: any = await res.json();
    const rawList: any[] = Array.isArray(data) ? data : [];

    return rawList.map((item) => ({
      id: item.id || item.listid,
      title: decodeHtmlEntities(item.title || item.listname),
      image: formatImageUrl(item.image, '500x500'),
      count: item.count || 50,
      type: 'playlist',
      perma_url: item.perma_url
    }));
  } catch (err) {
    console.warn('Error fetching charts:', err);
    return [];
  }
}

/**
 * Curated Explore Feed organized into luxury mood hubs and language categories
 */
export async function getExploreFeed(profile?: any): Promise<{ hero: any; sections: any[] }> {
  try {
    const [trendingData, charts] = await Promise.all([
      getTrending(),
      getCharts()
    ]);

    const heroSong = trendingData.songs[0] || null;
    const hero = heroSong
      ? {
          id: heroSong.id,
          title: heroSong.title,
          subtitle: `${heroSong.artist} • ${heroSong.album}`,
          image: heroSong.image,
          track: heroSong,
          badge: 'FEATURED MASTER'
        }
      : null;

    // Multilingual & Genre sections
    const [hindiHits, englishHits, teluguHits, lofiChill, edmParty] = await Promise.all([
      searchSongs('Latest Hindi Hits', 1, 10).catch(() => ({ results: [] })),
      searchSongs('Global Top 50 English Hits', 1, 10).catch(() => ({ results: [] })),
      searchSongs('Top Telugu Hits', 1, 10).catch(() => ({ results: [] })),
      searchSongs('Bollywood Lofi Chill Night', 1, 10).catch(() => ({ results: [] })),
      searchSongs('Club EDM Party Dance', 1, 10).catch(() => ({ results: [] })),
    ]);

    const sections = [
      {
        id: 'trending_now',
        title: '🔥 Trending Now',
        subtitle: 'The hottest tracks spinning right now',
        type: 'horizontal-scroll',
        tracks: trendingData.songs.slice(0, 15)
      },
      {
        id: 'top_charts',
        title: '🏆 Top Charts & Playlists',
        subtitle: 'Official Top 50 charts across genres',
        type: 'cards',
        items: charts.slice(0, 8)
      },
      {
        id: 'hindi_spotlight',
        title: '✨ Bollywood Spotlight',
        subtitle: 'The latest chart-toppers from Indian cinema',
        type: 'horizontal-scroll',
        tracks: hindiHits.results
      },
      {
        id: 'global_hits',
        title: '🌍 Global Top Anthems',
        subtitle: 'Worldwide viral sensation tracks',
        type: 'horizontal-scroll',
        tracks: englishHits.results
      },
      {
        id: 'regional_telugu',
        title: '🌟 South Cinema Wave',
        subtitle: 'Top Telugu and South Indian blockbuster music',
        type: 'horizontal-scroll',
        tracks: teluguHits.results
      },
      {
        id: 'lofi_chill',
        title: '🌙 Midnight Lofi & Chill',
        subtitle: 'Relaxing ambient beats for night vibes & study sessions',
        type: 'horizontal-scroll',
        tracks: lofiChill.results
      },
      {
        id: 'party_edm',
        title: '⚡ High Energy Party & EDM',
        subtitle: 'Bass-heavy club bangers to ignite the floor',
        type: 'horizontal-scroll',
        tracks: edmParty.results
      }
    ];

    return { hero, sections };
  } catch (err) {
    console.error('Error generating explore feed:', err);
    const searchRes = await searchSongs('Top Bollywood Hits', 1, 20);
    return {
      hero: searchRes.results[0] || null,
      sections: [
        {
          id: 'popular',
          title: '🔥 Popular Tracks',
          subtitle: 'Top stream hits',
          type: 'horizontal-scroll',
          tracks: searchRes.results
        }
      ]
    };
  }
}

/**
 * Mood categories definition
 */
export function getMoodCategories(): any[] {
  return [
    { key: 'chill', name: 'Chill & Relax', icon: '☕', query: 'chill acoustic lofi songs', color: '#10B981' },
    { key: 'workout', name: 'Workout & Gym', icon: '⚡', query: 'high energy workout gym pump music', color: '#EF4444' },
    { key: 'party', name: 'Party & Dance', icon: '🎉', query: 'party dance club hits', color: '#F59E0B' },
    { key: 'focus', name: 'Deep Focus & Study', icon: '🧠', query: 'ambient study focus instrumental', color: '#6366F1' },
    { key: 'romance', name: 'Love & Romance', icon: '💖', query: 'romantic love songs heart', color: '#EC4899' },
    { key: 'sad', name: 'Heartbreak & Soul', icon: '🌧️', query: 'sad emotional breakup acoustic', color: '#64748B' },
    { key: 'retro', name: 'Golden Retro Classics', icon: '📻', query: '90s 2000s bollywood retro classics', color: '#D97706' },
    { key: 'devotional', name: 'Spiritual & Bhakti', icon: '🕉️', query: 'devotional bhajans spiritual mantras', color: '#8B5CF6' }
  ];
}

/**
 * Mood feed tracks
 */
export async function getMoodFeed(moodKey: string, languages: string[] = ['Hindi', 'English']): Promise<{ mood: string; tracks: FormattedSong[] }> {
  const categories = getMoodCategories();
  const category = categories.find((c) => c.key === moodKey) || categories[0];
  const query = `${category.query} ${languages.join(' ')}`.trim();
  const res = await searchSongs(query, 1, 25);
  return {
    mood: category.name,
    tracks: res.results
  };
}

/**
 * Smart track and vibe recommendations
 */
export async function getVibeRecommendations(songId?: string, artist?: string, title?: string): Promise<FormattedSong[]> {
  try {
    let query = '';
    if (artist && artist !== 'Unknown Artist') {
      query = `${artist} hits`;
    } else if (title) {
      query = `${title} mix`;
    } else {
      query = 'Top India Hits';
    }

    const res = await searchSongs(query, 1, 15);
    // Filter out the current track if songId is provided
    return res.results.filter((t) => t.id !== songId).slice(0, 10);
  } catch (err) {
    console.warn('Error fetching vibe recommendations:', err);
    return [];
  }
}
