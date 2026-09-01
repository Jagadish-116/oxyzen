/**
 * Synced and Plain Lyrics Service for Oxyzen
 * Uses LRCLIB for studio time-synced lyrics with rich timestamp parsing.
 */

export interface LyricLine {
  time: number;
  text: string;
}

export interface LyricsResponse {
  synced: boolean;
  lines: LyricLine[];
  plain: string;
  source?: string;
}

/**
 * Parses LRC format ([mm:ss.xx] line) into structured time-sorted lines
 */
export function parseLrcString(lrc: string): LyricLine[] {
  if (!lrc) return [];

  const lines = lrc.split('\n');
  const result: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;

  for (const line of lines) {
    const trimmed = line.trim();
    const match = regex.exec(trimmed);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const msStr = match[3] || '0';
      const ms = msStr.length === 2 ? parseInt(msStr, 10) / 100 : parseInt(msStr, 10) / 1000;
      const totalTime = Math.round((mins * 60 + secs + ms) * 100) / 100;
      const text = match[4].trim();

      if (text) {
        result.push({ time: totalTime, text });
      }
    }
  }

  return result.sort((a, b) => a.time - b.time);
}

/**
 * Cleans track and artist names for better LRCLIB matching
 */
function cleanQueryString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/feat\..*$/i, '')
    .replace(/ft\..*$/i, '')
    .replace(/from\s+["'].*?["']/i, '')
    .replace(/[^\w\s\u0900-\u097F\u0C00-\u0C7F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetches synced or plain lyrics for a track
 */
export async function getLyrics(title: string, artist: string, durationSec?: number): Promise<LyricsResponse> {
  const cleanTitle = cleanQueryString(title);
  const cleanArtist = cleanQueryString(artist);

  try {
    // 1. Direct LRCLIB get request
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    if (durationSec && durationSec > 0) {
      url += `&duration=${Math.round(durationSec)}`;
    }

    let res = await fetch(url, {
      headers: {
        'User-Agent': 'Oxyzen-Music-Engine/2.0.0 (https://github.com/Jagadish-116/oxyzen)'
      }
    });

    if (res.ok) {
      const data: any = await res.json();
      if (data.syncedLyrics) {
        const lines = parseLrcString(data.syncedLyrics);
        if (lines.length > 0) {
          return {
            synced: true,
            lines,
            plain: data.plainLyrics || '',
            source: 'LRCLIB (Synchronized)'
          };
        }
      }

      if (data.plainLyrics) {
        return {
          synced: false,
          lines: [],
          plain: data.plainLyrics,
          source: 'LRCLIB (Plain)'
        };
      }
    }

    // 2. Fallback search on LRCLIB
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Oxyzen-Music-Engine/2.0.0 (https://github.com/Jagadish-116/oxyzen)'
      }
    });

    if (searchRes.ok) {
      const results: any = await searchRes.json();
      if (Array.isArray(results) && results.length > 0) {
        const best = results[0];
        if (best.syncedLyrics) {
          const lines = parseLrcString(best.syncedLyrics);
          if (lines.length > 0) {
            return {
              synced: true,
              lines,
              plain: best.plainLyrics || '',
              source: 'LRCLIB (Search Match)'
            };
          }
        }

        if (best.plainLyrics) {
          return {
            synced: false,
            lines: [],
            plain: best.plainLyrics,
            source: 'LRCLIB (Search Plain)'
          };
        }
      }
    }
  } catch (err) {
    console.warn('Error fetching lyrics from LRCLIB:', err);
  }

  // Fallback placeholder
  return {
    synced: true,
    lines: [
      { time: 0.0, text: `♪ ${title} ♪` },
      { time: 4.0, text: `Artist: ${artist}` },
      { time: 10.0, text: '✦ High Fidelity Master Stream Active ✦' },
      { time: 25.0, text: '✦ Enjoying Pure Unchained Sound on Oxyzen ✦' }
    ],
    plain: `${title} by ${artist}\nEnjoying pure high-fidelity audio on Oxyzen.`
  };
}
