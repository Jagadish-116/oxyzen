/**
 * Studio Synchronized Lyrics Engine for Oxyzen 2.0
 * Features multi-pass LRCLIB queries, robust millisecond LRC parsing,
 * multi-artist extraction, and exact song duration alignment.
 */
/**
 * Parses LRC format ([mm:ss.xx] line) into structured time-sorted lines.
 * Supports multiple timestamps per line and filters out metadata tags.
 */
export function parseLrcString(lrc) {
    if (!lrc)
        return [];
    const lines = lrc.split('\n');
    const result = [];
    const tagRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('[ti:') || trimmed.startsWith('[ar:') || trimmed.startsWith('[al:') || trimmed.startsWith('[by:') || trimmed.startsWith('[re:') || trimmed.startsWith('[ve:') || trimmed.startsWith('[offset:')) {
            continue;
        }
        const matches = [];
        let match;
        tagRegex.lastIndex = 0;
        while ((match = tagRegex.exec(trimmed)) !== null) {
            const mins = parseInt(match[1], 10);
            const secs = parseInt(match[2], 10);
            const msStr = match[3] || '0';
            const ms = msStr.length === 2 ? parseInt(msStr, 10) / 100 : parseInt(msStr, 10) / 1000;
            matches.push({ mins, secs, ms });
        }
        if (matches.length > 0) {
            const text = trimmed.replace(tagRegex, '').trim();
            if (text) {
                for (const m of matches) {
                    const totalTime = Math.round((m.mins * 60 + m.secs + m.ms) * 100) / 100;
                    result.push({ time: totalTime, text });
                }
            }
        }
    }
    return result.sort((a, b) => a.time - b.time);
}
/**
 * Cleans track and artist names for LRCLIB search matching
 */
function cleanQueryString(str) {
    if (!str)
        return '';
    return str
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/feat\..*$/i, '')
        .replace(/ft\..*$/i, '')
        .replace(/from\s+["'].*?["']/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * Extracts individual artist candidates from a multi-artist string
 */
function extractArtistCandidates(artistStr) {
    if (!artistStr)
        return [];
    const rawParts = artistStr.split(/[,&/|]/).map(a => cleanQueryString(a)).filter(a => a.length > 0);
    const candidates = [];
    if (rawParts.length > 0) {
        candidates.push(rawParts[0]); // Primary artist
        if (rawParts.length > 1) {
            candidates.push(rawParts[1]); // Secondary artist (often the main vocalist)
            candidates.push(`${rawParts[0]} ${rawParts[1]}`);
        }
    }
    return candidates;
}
/**
 * Fetches time-synchronized studio lyrics for any track
 */
export async function getLyrics(title, artist, durationSec) {
    const cleanTitle = cleanQueryString(title);
    const artistCandidates = extractArtistCandidates(artist);
    const headers = {
        'User-Agent': 'Oxyzen-Music-Engine/2.0.0 (https://github.com/Jagadish-116/oxyzen)'
    };
    try {
        // 1. Try direct LRCLIB get endpoint with each artist candidate
        for (const art of artistCandidates) {
            let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(art)}`;
            if (durationSec && durationSec > 0) {
                url += `&duration=${Math.round(durationSec)}`;
            }
            try {
                const res = await fetch(url, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.syncedLyrics) {
                        const lines = parseLrcString(data.syncedLyrics);
                        if (lines.length > 0) {
                            return {
                                synced: true,
                                lines,
                                plain: data.plainLyrics || '',
                                source: 'LRCLIB (Direct Studio Sync)'
                            };
                        }
                    }
                }
            }
            catch (e) { }
        }
        // 2. Search queries on LRCLIB
        const searchQueries = [
            `${cleanTitle} ${artistCandidates[0] || ''}`.trim(),
            `${cleanTitle} ${artistCandidates[1] || ''}`.trim(),
            cleanTitle
        ].filter(q => q.length > 0);
        for (const q of searchQueries) {
            try {
                const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
                const searchRes = await fetch(searchUrl, { headers });
                if (searchRes.ok) {
                    const results = await searchRes.json();
                    if (Array.isArray(results) && results.length > 0) {
                        // Find best match with synced lyrics
                        const bestSynced = results.find(r => r.syncedLyrics && r.syncedLyrics.length > 0) || results[0];
                        if (bestSynced && bestSynced.syncedLyrics) {
                            const lines = parseLrcString(bestSynced.syncedLyrics);
                            if (lines.length > 0) {
                                return {
                                    synced: true,
                                    lines,
                                    plain: bestSynced.plainLyrics || '',
                                    source: 'LRCLIB (Search Match)'
                                };
                            }
                        }
                        if (bestSynced && bestSynced.plainLyrics) {
                            return {
                                synced: false,
                                lines: [],
                                plain: bestSynced.plainLyrics,
                                source: 'LRCLIB (Plain Text)'
                            };
                        }
                    }
                }
            }
            catch (e) { }
        }
    }
    catch (err) {
        console.warn('Error fetching lyrics from LRCLIB:', err);
    }
    // Graceful atmospheric fallback
    return {
        synced: true,
        lines: [
            { time: 0.0, text: `♪ ${title} ♪` },
            { time: 4.0, text: `Artist: ${artist}` },
            { time: 10.0, text: '✦ High Fidelity Master Stream Active ✦' },
            { time: 25.0, text: '✦ Pure Unchained Audio on Oxyzen ✦' }
        ],
        plain: `${title} by ${artist}\nEnjoying pure high-fidelity audio on Oxyzen.`
    };
}
