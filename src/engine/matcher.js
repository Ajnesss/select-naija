'use strict';

// Title resolution and matching for live providers.
//  - resolveRequest: Nuvio's request (tt…, tmdb:…, snaija-…, with :season:episode) → { name, year, aliases, … }
//  - cleanTitle / detectPart: strip upload noise ("(Nigerian Movie)", "[Nollywood]", "Full Movie", "HD"),
//    and split "… Part 2" / "Episode 3" / "S01E03" into the base title and its part/episode numbers
//  - scoreMatch / isMatch: fuzzy title equality (accents, punctuation, word order noise) with ±1 year tolerance

const { normalize } = require('../text');

const NOISE = [
  /\((?:[^)]*?\b(?:nigerian|nollywood|yoruba|igbo|hausa|ghanaian|african)\b[^)]*?)\)/gi,
  /\[(?:[^\]]*)\]/g,
  /\b(?:latest|new|trending)\s+(?:\d{4}\s+)?(?:nigerian|nollywood|yoruba|igbo|hausa|african)\s+(?:movies?|films?)\b/gi,
  /\b(?:nigerian|nollywood|yoruba|igbo|hausa|ghanaian|african)\s+(?:movies?|films?|drama)\b/gi,
  /\bfull\s+(?:hd\s+)?(?:movie|film|episode)s?\b/gi,
  /\b(?:1080p|720p|480p|4k|uhd|fhd|hd|sd|hdrip|webrip|web-dl)\b/gi,
  /\b(?:official\s+)?(?:trailer|teaser)\b/gi,
  /\|.*$/g, // channel names after a pipe
];
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s) => (s == null ? null : /^\d+$/.test(s) ? Number(s) : ROMAN[s.toLowerCase()] || WORDS[s.toLowerCase()] || null);

function cleanTitle(raw) {
  let t = String(raw || '');
  for (const re of NOISE) t = t.replace(re, ' ');
  t = t.replace(/\s+/g, ' ').trim().replace(/\s*[-–—:|]+\s*(?:19|20)\d{2}\s*$/, '');
  return t.replace(/\s*[-–—:|]+\s*$/g, '').replace(/^\s*[-–—:|]+\s*/g, '').replace(/\s+/g, ' ').trim();
}

/** "Blood Sisters Part 2 (Nigerian Movie)" → { base: 'Blood Sisters', part: 2, season: null, episode: null } */
function detectPart(raw) {
  let t = cleanTitle(raw);
  let part = null;
  let season = null;
  let episode = null;
  const se = t.match(/\bS(\d{1,2})\s*E(\d{1,3})\b/i);
  if (se) { season = Number(se[1]); episode = Number(se[2]); t = t.replace(se[0], ' '); }
  const ep = t.match(/\b(?:episode|ep)\.?\s*(\d{1,3})\b/i);
  if (ep) { episode = Number(ep[1]); t = t.replace(ep[0], ' '); }
  const ss = t.match(/\bseason\s*(\d{1,2})\b/i);
  if (ss) { season = Number(ss[1]); t = t.replace(ss[0], ' '); }
  const pt = t.match(/\b(?:part|pt)\.?\s*(\d{1,2}|[ivx]{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i);
  if (pt) { part = num(pt[1]); t = t.replace(pt[0], ' '); }
  const base = t.replace(/\s*[-–—:|,]+\s*(?=$)/g, '').replace(/\s+/g, ' ').trim();
  return { base, part, season, episode };
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'movie', 'film']);
const tokens = (s) => normalize(s).replace(/['’]/g, '').split(' ').filter((w) => w && !STOP.has(w));

/** 0..1 similarity of two titles (token Dice coefficient, exact normalized match = 1). */
function similarity(a, b) {
  const na = normalize(cleanTitle(a));
  const nb = normalize(cleanTitle(b));
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const sb = new Set(tb);
  const common = ta.filter((w) => sb.has(w)).length;
  return (2 * common) / (ta.length + tb.length);
}

/**
 * Scores a candidate against the requested title. Returns 0 when it is not the same work.
 * candidate: { title, year }   want: { name, aliases?, year }
 */
function scoreMatch(candidate, want, { yearTolerance = 1, threshold = 0.85 } = {}) {
  const { base } = detectPart(candidate.title);
  const names = [want.name, ...(want.aliases || [])].filter(Boolean);
  const sim = Math.max(...names.map((n) => similarity(base, n)));
  if (sim < threshold) return 0;
  if (want.year && candidate.year) {
    const diff = Math.abs(Number(candidate.year) - Number(want.year));
    if (diff > yearTolerance) return 0;
    return sim - diff * 0.05;
  }
  return sim - 0.1; // no year to confirm: still allowed, ranked lower
}

const isMatch = (candidate, want, opts) => scoreMatch(candidate, want, opts) > 0;

/** Parses "tt123:1:2" / "tmdb:456" / "snaija-x:1:3". */
function parseId(id) {
  const [a, b, c, d] = String(id).split(':');
  if (a === 'tmdb') return { kind: 'tmdb', id: b, season: c != null ? Number(c) : null, episode: d != null ? Number(d) : null };
  return { kind: /^tt\d+$/.test(a) ? 'imdb' : 'local', id: a, season: b != null ? Number(b) : null, episode: c != null ? Number(c) : null };
}

const cache = new Map();

/**
 * Resolves what Nuvio asked for into a title description.
 * Order: Select Naija's own catalogue → Cinemeta (IMDb IDs) → TMDB (with an API key).
 */
async function resolveRequest(type, requestId, { data, fetchImpl = fetch, tmdbApiKey, timeoutMs = 4000 } = {}) {
  const ref = parseId(requestId);
  const base = { type, season: ref.season, episode: ref.episode, requestId };
  const local = data?.byId?.get(data.alias?.get(ref.id) || ref.id);
  if (local) {
    return { ...base, id: local.id, imdb: /^tt/.test(local.id) ? local.id : local.imdbId || null, name: local.name, aliases: local.aliases || [], year: local.year || null, languages: local.languages || [], fsIds: local.fsIds || null, fsParts: local.fsParts || false, fsEpisodes: (local.videos || []).filter((v) => v.fsId).map((v) => ({ season: v.season, episode: v.episode, fsId: v.fsId, title: v.title })), live: local.live || null, source: 'catalogue' };
  }
  const key = `${type}:${ref.kind}:${ref.id}`;
  if (cache.has(key)) return { ...base, ...cache.get(key) };
  const get = async (url) => {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.replace(/api_key=[^&]+/, 'api_key=…')}`);
    return res.json();
  };
  let found = null;
  if (ref.kind === 'imdb') {
    try {
      const j = await get(`https://v3-cinemeta.strem.io/meta/${type === 'series' ? 'series' : 'movie'}/${ref.id}.json`);
      if (j?.meta?.name) found = { id: ref.id, imdb: ref.id, name: j.meta.name, aliases: [], year: Number(String(j.meta.releaseInfo || j.meta.year || '').slice(0, 4)) || null, source: 'cinemeta' };
    } catch { /* try TMDB */ }
    if (!found && tmdbApiKey) {
      const j = await get(`https://api.themoviedb.org/3/find/${ref.id}?external_source=imdb_id&api_key=${tmdbApiKey}`);
      const r = (type === 'series' ? j.tv_results : j.movie_results)?.[0];
      if (r) found = { id: ref.id, imdb: ref.id, name: r.title || r.name, aliases: [r.original_title || r.original_name].filter((x) => x && x !== (r.title || r.name)), year: Number(String(r.release_date || r.first_air_date || '').slice(0, 4)) || null, source: 'tmdb' };
    }
  } else if (ref.kind === 'tmdb' && tmdbApiKey) {
    const j = await get(`https://api.themoviedb.org/3/${type === 'series' ? 'tv' : 'movie'}/${ref.id}?api_key=${tmdbApiKey}&append_to_response=external_ids`);
    found = { id: `tmdb:${ref.id}`, imdb: j.imdb_id || j.external_ids?.imdb_id || null, name: j.title || j.name, aliases: [j.original_title || j.original_name].filter((x) => x && x !== (j.title || j.name)), year: Number(String(j.release_date || j.first_air_date || '').slice(0, 4)) || null, source: 'tmdb' };
  }
  if (!found) return null;
  if (cache.size > 2000) cache.delete(cache.keys().next().value);
  cache.set(key, found);
  return { ...base, ...found };
}

/** For the CLI: a plain title (optionally "Title (2023)") instead of an ID. */
function fromText(text, type = 'movie') {
  const m = String(text).match(/^(.*?)\s*\((\d{4})\)\s*$/);
  return { type, requestId: null, id: null, imdb: null, name: (m ? m[1] : text).trim(), aliases: [], year: m ? Number(m[2]) : null, season: null, episode: null, source: 'text' };
}

module.exports = { cleanTitle, detectPart, similarity, scoreMatch, isMatch, parseId, resolveRequest, fromText };
