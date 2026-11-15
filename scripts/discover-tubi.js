#!/usr/bin/env node
'use strict';

// Reads Tubi UK's own Nollywood collection ("Nollywood Naija Tales") through the London check point and keeps
// data/tubi.json up to date. Tubi only shows each visitor the first 50 titles of a collection, and the
// collection rotates, so titles seen before are kept: each one is re-checked every night as a normal link
// (scripts/verify.js, through the check point) and dropped once it's no longer available in the UK.

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'tubi.json');
const COLLECTIONS = ['nollywood_naija_tales'];
// Other Tubi collections whose id or title looks Nigerian/African are read too (found on the collection page).
const RELATED = /nolly|naija|nigeria|african|afro|lagos/i;
const LANG = { english: 'en', yoruba: 'yo', igbo: 'ig', hausa: 'ha', pidgin: 'pcm' };

function pageData(html) {
  const m = html.match(/window\.__data\s*=\s*/);
  if (!m) return null;
  const end = html.indexOf('</script>', m.index);
  const raw = html.slice(m.index + m[0].length, end).trim().replace(/;$/, '').replace(/\bundefined\b/g, 'null');
  return JSON.parse(raw);
}

const https = (u) => (u && u.startsWith('//') ? `https:${u}` : u || null);

/** Turns Tubi's page data into Select Naija entries. Pure, so it can be tested offline. */
function entriesFrom(data, collection) {
  const ids = data?.container?.containerChildrenIdMap?.[collection] || [];
  const byId = data?.video?.byId || {};
  const out = [];
  for (const id of ids) {
    const v = byId[id];
    if (!v || !v.title) continue;
    const languages = [...new Set(String(v.lang || 'English').split(',').map((l) => LANG[l.trim().toLowerCase()]).filter(Boolean))];
    out.push({
      tubiId: String(id),
      type: v.type === 's' ? 'series' : 'movie',
      name: v.title,
      year: v.year || null,
      languages: languages.length ? languages : ['en'],
      genres: (v.tags || []).filter((t) => t !== 'Foreign/International'),
      runtime: v.duration ? `${Math.round(v.duration / 60)} min` : undefined,
      description: v.description || undefined,
      cast: (v.actors || []).slice(0, 8),
      director: (v.directors || []).slice(0, 3),
      poster: https(v.posterarts?.[0]),
      background: https(v.backgrounds?.[0]),
      collection,
    });
  }
  return out;
}

/** Collection ids mentioned in Tubi's page data that look Nigerian or African. */
function relatedCollections(data) {
  const byId = data?.container?.containerIdMap || data?.container?.containerChildrenIdMap || {};
  const ids = new Set(Object.keys(data?.container?.containerChildrenIdMap || {}));
  for (const [id, c] of Object.entries(byId)) if (c && typeof c === 'object' && RELATED.test(`${id} ${c.title || ''}`)) ids.add(id);
  return [...ids].filter((id) => RELATED.test(id) || RELATED.test(byId[id]?.title || ''));
}

/** Search results in Tubi's page data → entries (same shape as a collection). */
function searchEntries(data) {
  const byId = data?.video?.byId || {};
  const ids = data?.search?.hash ? Object.values(data.search.hash).flatMap((h) => h?.videos || h || []) : Object.keys(byId);
  const fake = { container: { containerChildrenIdMap: { search: [...new Set(ids.map(String))] } }, video: { byId } };
  return entriesFrom(fake, 'search');
}

async function edgeGet(base, token, url) {
  const res = await fetch(`${base}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-select-naija-token': token }, signal: AbortSignal.timeout(30000) });
  if (res.status !== 200 || res.headers.get('x-upstream-status') !== '200') throw new Error(`HTTP ${res.status}/${res.headers.get('x-upstream-status')}`);
  return pageData(await res.text());
}

async function main() {
  const base = process.env.UK_EDGE_URL;
  const token = process.env.UK_EDGE_TOKEN;
  if (!base || !token) {
    console.error('No London check point configured: Tubi collection not read, previous list kept.');
    return;
  }
  let previous = { titles: [] };
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const now = new Date().toISOString();
  const byId = new Map((previous.titles || []).map((t) => [t.tubiId, t]));
  const queue = [...COLLECTIONS];
  const done = new Set();
  while (queue.length && done.size < 12) {
    const collection = queue.shift();
    if (done.has(collection)) continue;
    done.add(collection);
    try {
      const data = await edgeGet(base, token, `https://tubitv.com/category/${collection}`);
      const related = relatedCollections(data);
      if (done.size === 1) console.log(`Tubi collections on the page: ${Object.keys(data?.container?.containerIdMap || {}).slice(0, 40).join(', ')} | related: ${related.join(', ')}`);
      for (const c of related) if (!done.has(c)) queue.push(c);
      const entries = entriesFrom(data, collection);
      for (const e of entries) byId.set(e.tubiId, { ...byId.get(e.tubiId), ...e, firstSeen: byId.get(e.tubiId)?.firstSeen || now, lastListed: now });
      console.log(`Tubi UK ${collection}: ${entries.length} titles listed today, ${byId.size} known in total`);
    } catch (err) {
      console.error(`Tubi UK ${collection}: ${err.message}; previous list kept`);
    }
  }
  // Films the UK catalogue data (JustWatch via TMDB) lists on Tubi: find each on Tubi's own search page so the
  // stream opens that film in the Tubi app, not a search.
  const { normalize } = require('../src/text');
  let wanted = [];
  try {
    wanted = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'discovered.json'), 'utf8')).entries
      .filter((e) => (e.offers || []).some((o) => /tubi/i.test(o.providerName || '')));
  } catch { /* none */ }
  const known = new Set([...byId.values()].map((t) => `${normalize(t.name)}|${t.year || ''}`));
  let found = 0;
  // Tubi's public sitemap lists every film's address (/movies/<id>/<slug>): match wanted films by slug.
  const { slugify } = require('../src/text');
  const bySlug = new Map();
  try {
    const raw = async (url) => {
      const res = await fetch(`${base}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-select-naija-token': token }, signal: AbortSignal.timeout(60000) });
      return res.status === 200 && res.headers.get('x-upstream-status') === '200' ? res.text() : '';
    };
    const index = await raw('https://tubitv.com/sitemap.xml');
    const maps = [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => /movie|series|video|title/i.test(u));
    console.log(`Tubi sitemap: ${maps.length} film/series sitemaps (${index.length} bytes index) ${maps.slice(0, 3).join(' ')}`);
    for (const m of maps.slice(0, 40)) {
      const xml = await raw(m);
      for (const [, kind, id, slug] of xml.matchAll(/tubitv\.com\/(movies|series)\/(\d+)\/([a-z0-9-]+)/g)) if (!bySlug.has(slug)) bySlug.set(slug, { kind, id });
    }
    console.log(`Tubi sitemap: ${bySlug.size} titles indexed`);
  } catch (err) {
    console.error(`Tubi sitemap: ${err.message}`);
  }
  for (const e of wanted) {
    const hitSlug = bySlug.get(slugify(e.title.name));
    if (hitSlug && !known.has(`${normalize(e.title.name)}|${e.title.year || ''}`)) {
      const t = e.title;
      byId.set(hitSlug.id, { ...byId.get(hitSlug.id), tubiId: hitSlug.id, type: hitSlug.kind === 'series' ? 'series' : 'movie', name: t.name, year: t.year, languages: t.languages, genres: t.genres || [], runtime: t.runtime, description: t.description, poster: t.poster, background: t.background, collection: 'sitemap', firstSeen: byId.get(hitSlug.id)?.firstSeen || now, lastListed: now });
      known.add(`${normalize(t.name)}|${t.year || ''}`);
      found += 1;
      continue;
    }
    if (bySlug.size) continue;
    const key = `${normalize(e.title.name)}|${e.title.year || ''}`;
    if (known.has(key)) continue;
    try {
      const data = await edgeGet(base, token, `https://tubitv.com/search/${encodeURIComponent(e.title.name)}`);
      const results = searchEntries(data);
      if (!results.length && !found) console.log('Tubi search page data keys:', Object.keys(data || {}).join(','), '| search:', JSON.stringify(data?.search || {}).slice(0, 300));
      const hit = results.find((x) => normalize(x.name) === normalize(e.title.name) && (!x.year || !e.title.year || Math.abs(x.year - e.title.year) <= 1));
      if (hit) {
        byId.set(hit.tubiId, { ...byId.get(hit.tubiId), ...hit, collection: 'search', firstSeen: byId.get(hit.tubiId)?.firstSeen || now, lastListed: now });
        found += 1;
      }
    } catch (err) {
      console.error(`Tubi search "${e.title.name}": ${err.message}`);
    }
  }
  console.log(`Tubi UK: ${done.size} collections read; ${found} of ${wanted.length} catalogue films matched on Tubi search; ${byId.size} titles known`);
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: now, titles: [...byId.values()] }, null, 1)}\n`);
}

if (require.main === module) main();

module.exports = { entriesFrom, pageData, relatedCollections, searchEntries };
