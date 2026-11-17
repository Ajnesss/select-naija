'use strict';

// Turns provider results into Nuvio/Stremio stream objects.
// Nuvio's player sends `headers` (and Stremio's `behaviorHints.proxyHeaders.request`) with every media request,
// so sources that check Referer/User-Agent still play. Parts of one film stay together and in order.

const QUALITY_ORDER = ['2160p', '1440p', '1080p', '720p', '576p', '480p', '360p', '240p'];
const qualityRank = (q) => { const i = QUALITY_ORDER.indexOf(q); return i === -1 ? QUALITY_ORDER.length : i; };

/** 1080 → "1080p"; "HD" → "720p"; from a file name "film_720p.mp4" → "720p". */
function qualityLabel(value) {
  if (value == null || value === '') return '';
  const s = String(value);
  const m = s.match(/(2160|1440|1080|720|576|480|360|240)\s*p?/i);
  if (m) return `${m[1]}p`;
  if (/\b4k|uhd\b/i.test(s)) return '2160p';
  if (/\bfhd\b/i.test(s)) return '1080p';
  if (/\bhd\b/i.test(s)) return '720p';
  if (/\bsd\b/i.test(s)) return '480p';
  if (typeof value === 'number') {
    const h = value;
    return QUALITY_ORDER.find((q) => h >= Number.parseInt(q, 10) * 0.9) || `${h}p`;
  }
  return '';
}

const sizeLabel = (bytes) => (!bytes ? '' : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.round(bytes / 1e6)} MB`);
const formatOf = (url, type) => (/m3u8|mpegurl/i.test(`${url} ${type || ''}`) ? 'HLS' : /\.mpd|dash/i.test(`${url} ${type || ''}`) ? 'DASH' : (url.match(/\.(mp4|mkv|webm|m4v|ogv)(?:\?|$)/i)?.[1] || '').toUpperCase());

/**
 * build(result) → stream object
 * result: { provider, providerName, title, url, quality, part, partCount, season, episode, headers, size, type,
 *           language, licence, note, verified: { status, at } }
 */
function build(r) {
  const quality = qualityLabel(r.quality);
  const part = r.part ? `Part ${r.part}${r.partCount ? ` of ${r.partCount}` : ''}` : '';
  const ep = r.season != null && r.episode != null ? `S${String(r.season).padStart(2, '0')}E${String(r.episode).padStart(2, '0')}` : '';
  const line1 = [`▶ ${r.title}`, ep, part].filter(Boolean).join(' · ');
  const line2 = [quality, formatOf(r.url, r.type), sizeLabel(r.size), r.language].filter(Boolean).join(' · ');
  const line3 = [r.licence, r.verified?.status ? `link answered ${r.verified.status}` : '', r.note].filter(Boolean).join(' · ');
  const stream = {
    name: `Select Naija\n${r.providerName || r.provider}${quality ? ` ${quality}` : ''}`,
    title: [line1, line2, line3].filter(Boolean).join('\n'),
    url: r.url,
    behaviorHints: { bingeGroup: `selectnaija-${r.provider}${quality ? `-${quality}` : ''}` },
  };
  if (r.headers && Object.keys(r.headers).length) {
    stream.headers = { ...r.headers };
    stream.behaviorHints.notWebReady = true;
    stream.behaviorHints.proxyHeaders = { request: { ...r.headers } };
  }
  if (r.size) stream.behaviorHints.videoSize = r.size;
  if (r.filename) stream.behaviorHints.filename = r.filename;
  stream._sort = { quality: qualityRank(quality), verified: r.verified?.ok ? 0 : 1, group: `${r.provider}|${r.groupKey || r.url}`, part: r.part || 0 };
  return stream;
}

/** Orders streams: verified first, then by quality; parts of one group stay together in part order. Removes duplicates. */
function finalize(streams) {
  const seen = new Set();
  const unique = streams.filter((s) => (seen.has(s.url) ? false : seen.add(s.url)));
  const groups = new Map();
  for (const s of unique) {
    const g = s._sort?.group || s.url;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(s);
  }
  const ordered = [...groups.values()]
    .map((list) => list.sort((a, b) => (a._sort?.part || 0) - (b._sort?.part || 0)))
    .sort((a, b) => {
      const ka = [Math.max(...a.map((s) => s._sort?.verified ?? 1)), Math.min(...a.map((s) => s._sort?.quality ?? 99))];
      const kb = [Math.max(...b.map((s) => s._sort?.verified ?? 1)), Math.min(...b.map((s) => s._sort?.quality ?? 99))];
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
  return ordered.flat().map(({ _sort, ...s }) => s);
}

module.exports = { build, finalize, qualityLabel, sizeLabel };
