#!/usr/bin/env node
'use strict';
// Research: title-level rights survey of Nigerian films on the Internet Archive.
// Pulls every matching video item with its licence, uploader, collection, year and (for licensed / public-domain
// candidates) the file list, so each title's rights and playable files can be checked individually.
// Writes research/out/archive/items.json and candidates.json.
const fs = require('fs');
const path = require('path');
const OUT = path.join(__dirname, '..', 'research', 'out', 'archive');
const Q = 'mediatype:movies AND (nollywood OR "nigerian film" OR "nigerian movie" OR "nigerian movies" OR "yoruba film" OR "yoruba movie" OR "hausa film" OR "kannywood" OR "igbo movie" OR "made in nigeria" OR subject:nigeria)';
const FL = ['identifier', 'title', 'licenseurl', 'uploader', 'collection', 'year', 'date', 'creator', 'subject', 'runtime', 'downloads', 'language', 'rights', 'possible-copyright-status'];
const UA = { 'user-agent': 'select-naija-research/1.0 (personal non-commercial addon; contact via github.com/Ajnesss/select-naija)' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const minutes = (rt) => { if (!rt) return null; const p = String(rt).split(':').map(Number); if (p.some(isNaN)) return null; return p.length === 3 ? p[0] * 60 + p[1] + p[2] / 60 : p.length === 2 ? p[0] + p[1] / 60 : p[0] / 60; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const u = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(Q)}&${FL.map((f) => `fl[]=${f}`).join('&')}&rows=500&page=${page}&output=json`;
    const j = await (await fetch(u, { headers: UA })).json();
    const docs = j.response?.docs || [];
    items.push(...docs);
    console.log('page', page, docs.length, 'of', j.response?.numFound);
    if (docs.length < 500) break;
    await sleep(1000);
  }
  const pdColl = /publicdomain|prelinger|feature_films|classic_tv|opensource_movies/i;
  const isLicensed = (d) => d.licenseurl || /public domain|creative commons|cc-by|cc by/i.test([].concat(d.rights || [], d['possible-copyright-status'] || []).join(' '));
  const cands = items.filter(isLicensed);
  console.log('items', items.length, 'with licence/rights statement', cands.length);
  for (const d of cands) {
    try {
      const m = await (await fetch(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`, { headers: UA })).json();
      const files = (m.files || []).filter((f) => /\.(mp4|m4v|webm|ogv|mkv|avi|mpeg|mpg)$/i.test(f.name));
      d.files = files.map((f) => ({ name: f.name, format: f.format, size: Number(f.size) || null, length: f.length || null }));
      d.lengthMin = Math.max(0, ...files.map((f) => minutes(f.length) || 0)) || minutes(d.runtime);
      d.description = String(m.metadata?.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400);
      d.uploaderName = m.metadata?.uploader;
      d.addeddate = m.metadata?.addeddate;
    } catch (e) { d.error = e.message; }
    await sleep(300);
  }
  const lic = {};
  for (const d of cands) { const k = d.licenseurl || 'rights-text'; lic[k] = (lic[k] || 0) + 1; }
  console.log('licences', lic);
  console.log('feature-length (>=40 min) licensed items', cands.filter((d) => d.lengthMin >= 40).length);
  console.log('in PD-ish collections', items.filter((d) => [].concat(d.collection || []).some((c) => pdColl.test(c))).length);
  fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify(items));
  fs.writeFileSync(path.join(OUT, 'candidates.json'), JSON.stringify(cands, null, 1));
})();
