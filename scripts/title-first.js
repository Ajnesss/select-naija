#!/usr/bin/env node
'use strict';
// Research: title-first source check. For 20 well-known Nigerian films and series, every UK provider TMDB lists
// (JustWatch data: subscription, rent, buy, free, ads) and whether Select Naija already has the title.
// Output research/out/title-first.json and a table on stdout.
const fs = require('fs');
const path = require('path');
const { loadData } = require('../src/data');
const { normalize } = require('../src/text');

const TITLES = [
  ['movie', 'King of Boys', 2018], ['movie', 'The Wedding Party', 2016], ['movie', 'Living in Bondage: Breaking Free', 2019],
  ['movie', 'Lionheart', 2018], ['movie', 'Anikulapo', 2022], ['movie', 'Jagun Jagun', 2023], ['movie', 'Battle on Buka Street', 2022],
  ['movie', 'A Tribe Called Judah', 2023], ['movie', 'Brotherhood', 2022], ['movie', 'Merry Men: The Real Yoruba Demons', 2018],
  ['movie', 'Chief Daddy', 2018], ['movie', 'Omo Ghetto: The Saga', 2020], ['movie', 'Gangs of Lagos', 2023], ['movie', 'The Black Book', 2023],
  ['movie', 'Mami Wata', 2023], ['movie', 'Elesin Oba: The King\'s Horseman', 2022], ['movie', 'October 1', 2014],
  ['tv', 'Shanty Town', 2023], ['tv', 'Blood Sisters', 2022], ['tv', 'Far From Home', 2022],
];

(async () => {
  const key = process.env.TMDB_API_KEY;
  const data = loadData(path.join(__dirname, '..', 'data'), { inAppOnly: false });
  const rows = [];
  for (const [type, name, year] of TITLES) {
    const q = `https://api.themoviedb.org/3/search/${type}?api_key=${key}&query=${encodeURIComponent(name)}&${type === 'movie' ? 'year' : 'first_air_date_year'}=${year}`;
    const hit = ((await (await fetch(q)).json()).results || [])[0];
    let providers = {};
    if (hit) {
      const wp = await (await fetch(`https://api.themoviedb.org/3/${type}/${hit.id}/watch/providers?api_key=${key}`)).json();
      const gb = wp.results?.GB || {};
      for (const kind of ['flatrate', 'free', 'ads', 'rent', 'buy']) for (const p of gb[kind] || []) (providers[kind] = providers[kind] || []).push(p.provider_name);
    }
    const ours = data.titles.filter((t) => normalize(t.name) === normalize(name) || normalize(t.name).startsWith(normalize(name.split(':')[0])));
    const ourSources = [...new Set(ours.flatMap((t) => (data.linksByTitle.get(t.id) || []).map((l) => `${l.provider}${l.source ? ` (${l.source})` : ''}`)))];
    rows.push({ type, name, year, tmdb: hit?.id || null, providers, selectNaija: ourSources });
  }
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'title-first.json'), JSON.stringify(rows, null, 1));
  for (const r of rows) {
    const p = Object.entries(r.providers).map(([k, v]) => `${k}: ${v.join(', ')}`).join(' | ') || 'none in the UK';
    console.log(`${r.name} (${r.year}) — ${p} — Select Naija: ${r.selectNaija.join(', ') || 'none'}`);
  }
})();
