'use strict';

// Layer 1: UK availability from TMDB's watch-provider data (powered by JustWatch; attribution required).
// TMDB gives one "where to watch" page per title, not per-provider deep links, so every stream from
// this layer opens that page, labelled with the provider and the JustWatch credit.

const API = 'https://api.themoviedb.org/3';
const TTL_MS = 12 * 60 * 60 * 1000;
const MAX_ENTRIES = 2000;
const REGION = 'GB';

// TMDB provider names → Select Naija provider ids, so a provider we already link directly isn't repeated.
const NAME_TO_PROVIDER = {
  netflix: 'netflix',
  'tubi tv': 'tubi',
  tubi: 'tubi',
  plex: 'plex',
  'plex channel': 'plex',
  kava: 'kava',
};

const cache = new Map();

function cacheGet(key, now) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (now - hit.at > TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value, now) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, value });
}

async function getJson(url, fetchImpl, timeoutMs) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

/**
 * Returns [{ providerName, providerId|null, offer: 'free'|'ads'|'subscription', link }] for a title
 * available in the UK, or [] when unknown. Never throws: a TMDB outage must not break streams.
 */
async function ukOffers(imdbId, type, { apiKey, fetchImpl = fetch, now = Date.now(), timeoutMs = 4000 } = {}) {
  if (!apiKey || !/^tt\d+$/.test(imdbId)) return [];
  const key = `${type}:${imdbId}`;
  const cached = cacheGet(key, now);
  if (cached) return cached;

  let offers = [];
  try {
    const found = await getJson(
      `${API}/find/${imdbId}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`,
      fetchImpl,
      timeoutMs,
    );
    const hit = type === 'series' ? found.tv_results?.[0] : found.movie_results?.[0];
    if (hit) {
      const kind = type === 'series' ? 'tv' : 'movie';
      const wp = await getJson(
        `${API}/${kind}/${hit.id}/watch/providers?api_key=${encodeURIComponent(apiKey)}`,
        fetchImpl,
        timeoutMs,
      );
      const gb = wp.results?.[REGION];
      if (gb?.link) {
        const seen = new Set();
        for (const [field, offer] of [['free', 'free'], ['ads', 'ads'], ['flatrate', 'subscription']]) {
          for (const p of gb[field] || []) {
            if (seen.has(p.provider_name)) continue;
            seen.add(p.provider_name);
            offers.push({
              providerName: p.provider_name,
              providerId: NAME_TO_PROVIDER[p.provider_name.toLowerCase()] || null,
              offer,
              link: gb.link,
            });
          }
        }
      }
    }
  } catch (err) {
    offers = [];
    // Short negative cache so a TMDB hiccup isn't retried on every request.
    cacheSet(key, offers, now - TTL_MS + 10 * 60 * 1000);
    return offers;
  }
  cacheSet(key, offers, now);
  return offers;
}

function clearCache() {
  cache.clear();
}

module.exports = { ukOffers, clearCache, NAME_TO_PROVIDER };
