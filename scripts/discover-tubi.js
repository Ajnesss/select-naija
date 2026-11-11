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
  for (const collection of COLLECTIONS) {
    try {
      const url = `https://tubitv.com/category/${collection}`;
      const res = await fetch(`${base}/api/fetch?url=${encodeURIComponent(url)}`, {
        headers: { 'x-select-naija-token': token },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status !== 200 || res.headers.get('x-upstream-status') !== '200') throw new Error(`HTTP ${res.status}/${res.headers.get('x-upstream-status')}`);
      const entries = entriesFrom(pageData(await res.text()), collection);
      for (const e of entries) byId.set(e.tubiId, { ...byId.get(e.tubiId), ...e, firstSeen: byId.get(e.tubiId)?.firstSeen || now, lastListed: now });
      console.log(`Tubi UK ${collection}: ${entries.length} titles listed today, ${byId.size} known in total`);
    } catch (err) {
      console.error(`Tubi UK ${collection}: ${err.message}; previous list kept`);
    }
  }
  fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: now, titles: [...byId.values()] }, null, 1)}\n`);
}

if (require.main === module) main();

module.exports = { entriesFrom, pageData };
