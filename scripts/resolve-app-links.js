#!/usr/bin/env node
'use strict';
// Free UK services listed for a film (JustWatch via TMDB) come without a link to the film itself. A stream that
// opens a search or TMDB's page is no use on a TV, so this finds each film's own page, confirmed from London:
//   Plex: watch.plex.tv/movie/<slug> (or /show/<slug>), with and without the year.
//   Prime Video (free with ads only): the film's /detail/<id> page, found on Prime Video's UK search and
//   accepted only when that page's title matches the film.
// Output data/app-links.json { plex: { <titleId>: "movie/<slug>" }, primevideo: { <titleId>: "<id>" } }.
// Tubi films are matched by discover-tubi.js.
const fs = require('fs');
const path = require('path');
const { slugify, normalize } = require('../src/text');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'app-links.json');

async function main() {
  const base = process.env.UK_EDGE_URL;
  const token = process.env.UK_EDGE_TOKEN;
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { plex: {}, primevideo: {} };
  if (!base || !token) { console.log('No London check point: app links kept'); return; }
  const entries = JSON.parse(fs.readFileSync(path.join(DATA, 'discovered.json'), 'utf8')).entries;
  const plex = { ...prev.plex };
  const primevideo = { ...(prev.primevideo || {}) };
  const page = async (url) => {
    const res = await fetch(`${base}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-select-naija-token': token }, signal: AbortSignal.timeout(30000) }).catch(() => null);
    return res && res.status === 200 && res.headers.get('x-upstream-status') === '200' ? res.text() : null;
  };
  // Re-check last night's film pages: a page that is gone (or no longer the film) is dropped and looked up again.
  // A fetch that fails (network, check point) proves nothing: the link is kept and checked again tomorrow.
  const stillThere = async (url, name) => {
    const html = await page(url);
    return html == null ? null : normalize(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '').includes(normalize(name));
  };
  const names = new Map(entries.map((e) => [e.title.id, e.title.name]));
  for (const [id, slug] of Object.entries(plex)) if (!names.has(id) || (await stillThere(`https://watch.plex.tv/${slug}`, names.get(id))) === false) delete plex[id];
  for (const [id, pid] of Object.entries(primevideo)) if (!names.has(id) || (await stillThere(`https://www.primevideo.com/detail/${pid}`, names.get(id))) === false) delete primevideo[id];
  for (const e of entries) {
    if (!(e.offers || []).some((o) => /prime video free with ads|mx player/i.test(o.providerName || ''))) continue;
    const t = e.title;
    if (primevideo[t.id]) continue;
    const html = await page(`https://www.primevideo.com/search?phrase=${encodeURIComponent(t.name)}`);
    const ids = [...new Set([...(html || '').matchAll(/\/detail\/([A-Za-z0-9]{10,})/g)].map((m) => m[1]))].slice(0, 4);
    for (const id of ids) {
      const detail = await page(`https://www.primevideo.com/detail/${id}`);
      const title = ((detail || '').match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      if (normalize(title).includes(normalize(t.name))) { primevideo[t.id] = id; break; }
    }
  }
  let tried = 0;
  for (const e of entries) {
    if (!(e.offers || []).some((o) => /plex/i.test(o.providerName || '') && ['free', 'ads'].includes(o.access))) continue;
    const t = e.title;
    if (plex[t.id]) continue;
    const kind = t.type === 'series' ? 'show' : 'movie';
    for (const slug of [slugify(t.name), `${slugify(t.name)}-${t.year}`]) {
      tried += 1;
      const url = `https://watch.plex.tv/${kind}/${slug}`;
      const res = await fetch(`${base}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-select-naija-token': token }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (!res || res.status !== 200 || res.headers.get('x-upstream-status') !== '200') continue;
      const html = await res.text();
      const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
      if (normalize(title).includes(normalize(t.name))) { plex[t.id] = `${kind}/${slug}`; break; }
    }
  }
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), plex, primevideo }, null, 1)}\n`);
  console.log(`Plex: ${Object.keys(plex).length} films linked directly (${tried} pages tried); Prime Video free with ads: ${Object.keys(primevideo).length}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
