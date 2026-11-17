#!/usr/bin/env node
'use strict';

// Lists FaithStream's Nigerian films and series for Select Naija's catalogue (data/faithstream.json).
// Signed in with Select Naija's own account (FAITHSTREAM_EMAIL / _PASSWORD). Only titles identified as Nigerian
// are kept: a known Nigerian production (list below) or a description naming Nigeria, a Nigerian city or language.
// Streams are not stored: they are requested at play time (playback URLs expire after an hour).

const fs = require('fs');
const path = require('path');
const { createClient } = require('../src/engine/http');
const { detectPart } = require('../src/engine/matcher');
const { normalize } = require('../src/text');
const faithstream = require('../src/providers/faithstream');

// Nigerian productions on FaithStream (Mount Zion Faith Ministries and other Nigerian faith studios).
const KNOWN_NIGERIAN = [
  'stranded', 'stranded 2', 'land of fury', 'undersiege', 'under siege', 'perilous time', 'perilous times', 'the train', 'broken pitcher',
  'prodigal ones', 'rapture nightmare', 'tribulation night', 'apoti eri', 'eternal verdict', 'enoch', 'ipenija', 'ipenija 2',
  'burning coles', 'the manager', 'jailer', 'legion', 'family riot', 'youthful lust', 'fiwajomi', 'stalker', 'haunt', 'abejoye',
  "corper s lodge", 'corpers lodge', 'god calling', 'my defender', 'my defender 2', 'journey in the circle', 'the ark', 'sims', 'sims 1', 'sims 2',
];
const NIGERIAN_TEXT = /\b(nigeria|nigerian|lagos|abuja|ibadan|enugu|kano|port harcourt|yoruba|igbo|hausa|naija|mount zion|mzfm)\b/i;
const NOT_FILMS = /^(day \d+|renewed mind|daily prayers|open mic|loosed to love|positioning yourself|healing, not burdens|forgive yourself|stop the hustle|become mercy|never messy|recitation|new fix testing|gc trailer)/i;

const slug = (s) => normalize(s).replace(/ /g, '-');

(async () => {
  const env = process.env;
  const client = createClient({ timeoutMs: 15000, rateLimit: 4 });
  const ctx = { client, env, log: (m) => console.log(`  › ${m}`), match: () => {} };
  const items = await faithstream.loadCatalogue(ctx);
  const nigerian = (x, name) => KNOWN_NIGERIAN.includes(normalize(name).replace(/'/g, ' ')) || NIGERIAN_TEXT.test(`${x.description} ${x.title}`);

  const films = [];
  const series = new Map();
  for (const x of items) {
    if (x.seriesTitle) {
      if (!nigerian(x, x.seriesTitle)) continue;
      if (!series.has(x.seriesTitle)) series.set(x.seriesTitle, { name: x.seriesTitle, poster: x.poster, description: '', episodes: [] });
      const p = detectPart(x.title);
      series.get(x.seriesTitle).episodes.push({ fsId: x.id, title: x.title, season: x.season ?? p.season ?? 1, episode: x.episode ?? p.episode ?? null, minutes: x.minutes });
      continue;
    }
    if (NOT_FILMS.test(x.title.trim())) continue;
    if (!/movie|film/i.test(`${x.type} ${x.typeName}`)) continue;
    const base = detectPart(x.title).base || x.title;
    if (!nigerian(x, base) && !nigerian(x, x.title)) continue;
    films.push({ fsId: x.id, name: x.title.replace(/\s+/g, ' ').trim(), minutes: x.minutes, year: x.year, description: x.description, poster: x.poster });
  }
  // One catalogue title per film; uploads of the same film (different case/spacing) share it.
  const byName = new Map();
  for (const f of films) {
    const pretty = f.name === f.name.toUpperCase() ? f.name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : f.name;
    const k = slug(pretty);
    if (!byName.has(k)) byName.set(k, { id: `snaija-fs-${k}`, type: 'movie', name: pretty, year: f.year || null, runtime: f.minutes ? `${f.minutes} min` : undefined, description: f.description || undefined, poster: f.poster || undefined, languages: ['en'], genres: ['Faith', 'Drama'], live: ['faithstream'], fsIds: [] });
    byName.get(k).fsIds.push(f.fsId);
  }
  const seriesTitles = [...series.values()].map((s) => {
    const eps = s.episodes.filter((e) => e.episode != null).sort((a, b) => a.season - b.season || a.episode - b.episode);
    return { id: `snaija-fs-${slug(s.name)}`, type: 'series', name: s.name, poster: s.poster || undefined, languages: ['en'], genres: ['Faith', 'Drama'], live: ['faithstream'], videos: eps.map((e) => ({ season: e.season, episode: e.episode, title: e.title })) };
  }).filter((s) => s.videos.length);
  const out = { generatedAt: new Date().toISOString(), source: 'FaithStream (thefaithstream.com)', titles: [...byName.values(), ...seriesTitles] };
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'faithstream.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`FaithStream: ${items.length} videos → ${byName.size} Nigerian films, ${seriesTitles.length} Nigerian series (${seriesTitles.reduce((n, s) => n + s.videos.length, 0)} episodes)`);
  for (const t of out.titles) console.log(`  ${t.type === 'series' ? 'series' : 'film  '} ${t.name}${t.videos ? ` (${t.videos.length} episodes)` : t.runtime ? ` (${t.runtime})` : ''}`);
})().catch((err) => { console.error(err); process.exit(1); });
