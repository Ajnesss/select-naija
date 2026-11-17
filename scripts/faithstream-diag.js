#!/usr/bin/env node
'use strict';
// Prints the shape of FaithStream's series and episode records (field names and non-personal values) so the
// provider can map episodes to their series. Writes research/out/faithstream-diag.json. No account data.
const fs = require('fs');
const path = require('path');
const { createClient } = require('../src/engine/http');
const faithstream = require('../src/providers/faithstream');

(async () => {
  const client = createClient({ timeoutMs: 15000, rateLimit: 4 });
  const ctx = { client, env: process.env, log: (m) => console.log(m), match: () => {} };
  await faithstream.loadCatalogue(ctx); // signs in
  const API = 'https://gateway.thefaithstream.com';
  const token = faithstream._token();
  const get = (p) => client.getJson(`${API}${p}`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://www.thefaithstream.com', Referer: 'https://www.thefaithstream.com/' } });
  const out = {};
  const series = await get('/content/series?limit=100&page=1');
  const list = series.data?.items || series.data || [];
  out.seriesKeys = Object.keys(list[0] || {});
  out.series = list.map((s) => ({ id: s.id, title: s.title, type: s.type, seasons: s.seasons?.length ?? s.seasonCount ?? null, episodeCount: s.episodeCount ?? s.totalEpisodes ?? null, keysWithEpisodes: Object.keys(s).filter((k) => /season|episode/i.test(k)) }));
  const content = [];
  for (let page = 1; page <= 5; page += 1) {
    const j = await get(`/content?limit=100&page=${page}`);
    const items = j.data?.items || [];
    content.push(...items);
    if (items.length < 100) break;
  }
  const eps = content.filter((v) => /episode/i.test(`${v.type} ${v.contentType?.slug}`));
  out.episodeKeys = Object.keys(eps[0] || {});
  out.episodes = eps.slice(0, 40).map((v) => Object.fromEntries(Object.entries(v).filter(([k]) => /id$|title|season|episode|series|number|order|duration|type/i.test(k)).map(([k, x]) => [k, typeof x === 'object' && x ? (x.title || x.name || x.slug || JSON.stringify(x).slice(0, 120)) : x])));
  // Try the series detail routes the site may use.
  out.routes = {};
  const sid = list.find((s) => /abejoye|corper/i.test(s.title))?.id || list[0]?.id;
  for (const p of [`/content/series/${sid}`, `/content/series/${sid}/episodes`, `/content/series/${sid}/seasons`, `/content/episodes/series/${sid}`]) {
    try { const j = await get(p); out.routes[p] = JSON.stringify(j).slice(0, 3000); } catch (e) { out.routes[p] = `error ${e.message}`; }
  }
  out.films = content.filter((v) => /movie/i.test(`${v.type} ${v.contentType?.slug}`)).map((v) => ({ id: v.id, title: v.title, minutes: v.durationSeconds ? Math.round(v.durationSeconds / 60) : null, description: (v.description || '').slice(0, 400), language: v.language, cast: v.cast || v.actors || null, director: v.director || null, producer: v.producer || v.studio || null, keys: Object.keys(v).filter((k) => /cast|actor|director|produc|studio|country|origin|tag|genre/i.test(k)) }));
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'faithstream-diag.json'), JSON.stringify(out, null, 1));
  console.log(`series ${out.series.length}, episodes ${eps.length}, films ${out.films.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
