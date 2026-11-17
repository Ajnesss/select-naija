'use strict';

// FaithStream (thefaithstream.com, House of Faith, non-profit): free, ad-free, donation-funded faith films and
// series, many Nigerian (Mount Zion and others). Viewing needs a free account; this provider signs in with
// Select Naija's own account (FAITHSTREAM_EMAIL / FAITHSTREAM_PASSWORD) exactly as the website does, asks the
// site for a playback URL like its own player, and hands that to Nuvio. Plain HLS (H.264/AAC), no DRM, no ads.
// The site's terms allow personal, non-commercial use, so this provider only serves private installs
// (install URLs carrying SELECT_NAIJA_PRIVATE_KEY); public installs never see it.

const { scoreMatch, cleanTitle, detectPart } = require('../engine/matcher');

const API = 'https://gateway.thefaithstream.com';
const SITE = 'https://www.thefaithstream.com';
const CATALOGUE_TTL = 6 * 3600 * 1000;
const SESSION_TTL = 50 * 60 * 1000;

let session = null; // { token, at }
let catalogue = null; // { at, items: [{ id, title, type, year, minutes, language, seriesTitle, season, episode }] }

function findToken(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 5) return null;
  for (const key of ['accessToken', 'access_token', 'token', 'jwt']) if (typeof obj[key] === 'string' && obj[key].length > 20) return obj[key];
  for (const v of Object.values(obj)) { const t = findToken(v, depth + 1); if (t) return t; }
  return null;
}

async function signIn(ctx, force = false) {
  if (!force && session && Date.now() - session.at < SESSION_TTL) return session.token;
  const email = ctx.env.FAITHSTREAM_EMAIL;
  const password = ctx.env.FAITHSTREAM_PASSWORD;
  if (!email || !password) throw new Error('FAITHSTREAM_EMAIL / FAITHSTREAM_PASSWORD not set');
  const res = await ctx.client.request(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Origin: SITE, Referer: `${SITE}/` },
    body: JSON.stringify({ email, password, userIpAddress: '', country: 'United Kingdom', countryCode: 'GB', city: '' }),
  });
  const j = await res.json();
  let token = findToken(j);
  // The site's player uses the viewing profile's token; fall back to the account token.
  try {
    const p = await ctx.client.getJson(`${API}/users/streaming-profiles/with-tokens`, { headers: { Authorization: `Bearer ${token}`, Origin: SITE, Referer: `${SITE}/` } });
    const profiles = Array.isArray(p.data) ? p.data : [];
    const primary = profiles.find((x) => x.isPrimary) || profiles[0];
    if (primary?.accessToken) token = primary.accessToken;
  } catch { /* account token still works for catalogue calls */ }
  if (!token) throw new Error('signed in but no access token in the response');
  session = { token, at: Date.now() };
  ctx.log('signed in to FaithStream');
  return token;
}

async function api(ctx, path) {
  const call = async (token) => ctx.client.getJson(`${API}${path}`, { headers: { Authorization: `Bearer ${token}`, Origin: SITE, Referer: `${SITE}/` } });
  try { return await call(await signIn(ctx)); } catch (err) {
    if (err.status === 401 || err.status === 403) return call(await signIn(ctx, true));
    throw err;
  }
}

const yearOf = (v) => Number(String(v.releaseYear || v.productionYear || v.year || '').slice(0, 4)) || null;

function toItems(list) {
  return list.map((v) => {
    const p = detectPart(v.title || '');
    return {
      id: v.id,
      title: v.title,
      type: v.type || v.contentType?.slug || null,
      typeName: v.contentType?.slug || v.contentType?.name || null,
      year: yearOf(v),
      minutes: v.durationSeconds ? Math.round(v.durationSeconds / 60) : null,
      language: v.language || null,
      seriesTitle: v.series?.title || v.seriesTitle || null,
      season: v.seasonNumber ?? v.season?.seasonNumber ?? p.season ?? null,
      episode: v.episodeNumber ?? p.episode ?? null,
      regions: v.availableRegions || null,
    };
  }).filter((x) => x.id && x.title);
}

const listOf = (j) => (Array.isArray(j.data) ? j.data : j.data?.items || j.data?.videos || j.data?.data || []);

async function loadCatalogue(ctx) {
  if (catalogue && Date.now() - catalogue.at < CATALOGUE_TTL) return catalogue.items;
  // Series names (episodes refer to their series by id).
  const seriesNames = new Map();
  try {
    for (let page = 1; page <= 10; page += 1) {
      const list = listOf(await api(ctx, `/content/series?limit=100&page=${page}`));
      for (const x of list) seriesNames.set(x.id, x.title);
      if (list.length < 100) break;
    }
  } catch (err) { ctx.log(`series list: ${err.message}`); }
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    let list;
    try { list = listOf(await api(ctx, `/content?limit=100&page=${page}`)); } catch (err) { ctx.log(`content page ${page}: ${err.message}`); break; }
    items.push(...toItems(list.map((v) => ({ ...v, seriesTitle: v.seriesTitle || v.series?.title || seriesNames.get(v.seriesId) || null }))));
    if (list.length < 100) break;
  }
  const unique = [...new Map(items.map((x) => [x.id, x])).values()];
  catalogue = { at: Date.now(), items: unique };
  ctx.log(`catalogue: ${unique.length} videos, ${seriesNames.size} series`);
  return unique;
}

module.exports = {
  key: 'faithstream',
  types: ['movie', 'series'],
  private: true,

  async resolve(request, ctx) {
    const items = await loadCatalogue(ctx);
    const want = { name: request.name, aliases: request.aliases, year: request.year };
    let hits;
    if (request.type === 'series') {
      hits = items.filter((x) => x.seriesTitle && scoreMatch({ title: x.seriesTitle, year: null }, want) > 0 && x.episode === request.episode && (x.season == null || request.season == null || x.season === request.season))
        .map((x) => ({ x, score: 1 }));
    } else {
      const isFilm = (x) => !x.seriesTitle && (/movie|film/i.test(`${x.type} ${x.typeName}`) || (x.minutes || 0) >= 40);
      hits = items.filter((x) => isFilm(x) && (!Array.isArray(x.regions) || !x.regions.length || x.regions.includes('GB')))
        .map((x) => ({ x, score: scoreMatch({ title: x.title, year: x.year }, want) }))
        .filter((h) => h.score > 0)
        .sort((a, b) => b.score - a.score);
    }
    hits = hits.slice(0, 4);
    for (const h of hits) ctx.match({ title: h.x.title, year: h.x.year, score: Number(h.score.toFixed(2)), ref: `${SITE}/watch/${h.x.id}` });
    // Films split into parts on FaithStream ("Stranded 2" is a sequel, "… Part 2" a part) stay grouped.
    const parts = hits.filter((h) => detectPart(h.x.title).part);
    const results = [];
    for (const { x } of hits) {
      const p = await api(ctx, `/content/playback/url/${x.id}?region=GB`);
      const url = p.data?.url || p.data?.cloudFrontUrl;
      if (!url) { ctx.log(`${x.title}: no playback URL`); continue; }
      ctx.log(`${x.title}: playback URL issued, expires ${p.data.expiresAt || '?'}`);
      const part = detectPart(x.title).part;
      results.push({
        title: request.name,
        url,
        quality: '720p',
        part: parts.length > 1 ? part : null,
        partCount: parts.length > 1 ? parts.length : null,
        season: request.season,
        episode: request.episode,
        headers: { Referer: `${SITE}/`, Origin: SITE },
        note: 'free, no adverts (donation-funded)',
        groupKey: parts.length > 1 ? 'parts' : x.id,
      });
    }
    return results;
  },

  async coverage(ctx) {
    const items = await loadCatalogue(ctx);
    const films = items.filter((x) => !x.seriesTitle && (x.minutes || 0) >= 40);
    const series = [...new Set(items.filter((x) => x.seriesTitle).map((x) => x.seriesTitle))];
    const typeCounts = {};
    for (const x of items) typeCounts[`${x.type}/${x.typeName}`] = (typeCounts[`${x.type}/${x.typeName}`] || 0) + 1;
    return { typeCounts, titles: films.length + series.length, episodes: items.filter((x) => x.seriesTitle).length, sample: [...films.map((x) => `${x.title}${x.minutes ? ` (${x.minutes} min)` : ''}`), ...series.map((s) => `series: ${s}`)].slice(0, 80) };
  },

  _reset() { session = null; catalogue = null; },
};
