#!/usr/bin/env node
'use strict';
// Free UK services listed for a film (JustWatch via TMDB) come without a link to the film itself. A stream that
// opens a search or TMDB's page is no use on a TV, so this finds each film's own page, confirmed from London:
//   Plex: watch.plex.tv/movie/<slug> (or /show/<slug>), with and without the year.
// Output data/app-links.json { plex: { <titleId>: "movie/<slug>" } }. Tubi films are matched by discover-tubi.js.
const fs = require('fs');
const path = require('path');
const { slugify, normalize } = require('../src/text');

const DATA = path.join(__dirname, '..', 'data');
const OUT = path.join(DATA, 'app-links.json');

async function main() {
  const base = process.env.UK_EDGE_URL;
  const token = process.env.UK_EDGE_TOKEN;
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { plex: {} };
  if (!base || !token) { console.log('No London check point: app links kept'); return; }
  const entries = JSON.parse(fs.readFileSync(path.join(DATA, 'discovered.json'), 'utf8')).entries;
  const plex = { ...prev.plex };
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
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), plex }, null, 1)}\n`);
  console.log(`Plex: ${Object.keys(plex).length} films linked directly (${tried} pages tried)`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
