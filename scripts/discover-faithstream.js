#!/usr/bin/env node
'use strict';

// Lists FaithStream's Nigerian films and series for Select Naija's catalogue (data/faithstream.json).
// Signed in with Select Naija's own account (FAITHSTREAM_EMAIL / _PASSWORD). A title is kept only when it is
// identified as Nigerian: a known Nigerian production, the publisher label "Mount Zion", or a description naming
// Nigeria, a Nigerian place, language or typical Nigerian names. Streams are not stored: they are requested at play
// time (playback URLs expire after an hour).
//
// Films: one catalogue title per film; several uploads of the same film become alternative streams.
// Numbered uploads without an episode marker ("The Peace Maker 1", "… 2") are the parts of one film.
// Series: built from episode uploads ("ABATTOIR S2 EP6", "Corpers Lodge Ep 4", "ABATTOIR 3 EP 1" = season 3).

const fs = require('fs');
const path = require('path');
const { createClient } = require('../src/engine/http');
const { normalize } = require('../src/text');
const faithstream = require('../src/providers/faithstream');

const KNOWN_NIGERIAN = new Set([
  'stranded', 'land of fury', 'undersiege', 'under siege', 'perilous time', 'perilous times', 'the train', 'broken pitcher',
  'prodigal ones', 'rapture nightmare', 'tribulation night', 'apoti eri', 'eternal verdict', 'enoch', 'ipenija',
  'burning coles', 'the manager', 'jailer', 'legion', 'family riot', 'youthful lust', 'fiwajomi', 'stalker', 'haunt', 'haunted',
  'abejoye', 'corpers lodge', 'god calling', 'my defender', 'journey in the circle', 'abattoir', 'gbemi', 'the peacemaker',
  'the kingmaker', 'dying with the king', 'ina abe aso', 'the accountant', 'recitation', 'love and porridge',
]);
const NIGERIAN_TEXT = /\b(nigeria|nigerian|lagos|abuja|ibadan|enugu|kano|port harcourt|yoruba|igbo|hausa|naija|mount zion|mzfm|adeboye|kolade|temilola|adesewa|abayomi|funke|olakunle|iremoje|kunle|tunde|yemi|tolu|seun|bisi|emeka|ngozi|nkechi|chinedu|obinna|sade|dapo|ifedayo|buka)\b/i;
const NOT_FILMS = /^(day \d+|renewed mind|daily prayers|open mic|loosed to love|positioning yourself|healing, not burdens|forgive yourself|stop the hustle|become mercy|never messy|new fix testing|gc trailer|burnng bush|moses and the burning bush|parable of the talents)/i;

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const pretty = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Of|The|And|In|A|With)\b(?!$)/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase())) : s);
const key = (s) => normalize(String(s).replace(/&/g, ' and ')).replace(/\bthe\b/g, '').replace(/\s+/g, '');

// "ABATTOIR S2 EP6" → { base: 'ABATTOIR', season: 2, episode: 6 }; "ABATTOIR 3 EP 1" → season 3; "Corpers Lodge Ep 4" → season 1
function parseEpisode(title) {
  const t = tidy(title);
  const m = t.match(/^(.*?)\s*(?:S(?:eason)?\s*(\d+))?\s*(?:EP(?:ISODE)?\.?\s*(\d+))\s*$/i);
  if (!m) return null;
  let base = tidy(m[1]);
  let season = m[2] ? Number(m[2]) : null;
  const trailing = base.match(/^(.*\D)\s+(\d{1,2})$/);
  if (!season && trailing) { base = tidy(trailing[1]); season = Number(trailing[2]); }
  base = base.replace(/\bS\d+$/i, '').trim();
  return { base, season: season || 1, episode: Number(m[3]) };
}
// "THE PEACE MAKER 1" → { base: 'THE PEACE MAKER', n: 1 }
function parseNumbered(title) {
  const m = tidy(title).match(/^(.*\D)\s+(\d{1,2})$/);
  return m ? { base: tidy(m[1]), n: Number(m[2]) } : null;
}

// Groups names that are the same apart from spacing or a typo ("COPRERS LODGE" / "CORPERS LODGE").
function sameName(a, b) {
  const x = key(a); const y = key(b);
  if (x === y) return true;
  if ((x.match(/\d+$/) || [''])[0] !== (y.match(/\d+$/) || [''])[0]) return false; // "Stranded" ≠ "Stranded 2"
  if (Math.abs(x.length - y.length) > 2 || x.length < 6) return false;
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= x.length; i += 1) for (let j = 1; j <= y.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length] <= 2;
}
const known = (name) => [...KNOWN_NIGERIAN].some((k) => sameName(k, name));
const isNigerian = (x, name) => known(name) || /mount zion/i.test(x.publisher || '') || NIGERIAN_TEXT.test(`${x.description} ${x.title}`);

async function main() {
  const client = createClient({ timeoutMs: 15000, rateLimit: 4 });
  const ctx = { client, env: process.env, log: (m) => console.log(`  › ${m}`), match: () => {} };
  const items = await faithstream.loadCatalogue(ctx);
  const episodic = (x) => /series|episode/i.test(`${x.type} ${x.typeName}`);
  const filmLike = (x) => /movie|film/i.test(`${x.type} ${x.typeName}`);

  const films = []; // { name, fsIds, parts, x }
  const addFilm = (name, x, part) => {
    let f = films.find((y) => sameName(y.name, name));
    if (!f) { f = { name, x, uploads: [], parts: new Map() }; films.push(f); }
    if (part) f.parts.set(part, x.id); else f.uploads.push(x.id);
  };
  const series = []; // { name, episodes: Map("s:e" -> {season, episode, fsId, title}), x }

  for (const x of items) {
    const title = tidy(x.title);
    if (!title || NOT_FILMS.test(title)) continue;
    const ep = episodic(x) ? parseEpisode(title) : null;
    if (ep && ep.base) {
      if (!isNigerian(x, ep.base)) continue;
      let s = series.find((y) => sameName(y.name, ep.base));
      if (!s) { s = { name: ep.base, x, episodes: new Map() }; series.push(s); }
      const k = `${ep.season}:${ep.episode}`;
      if (!s.episodes.has(k)) s.episodes.set(k, { season: ep.season, episode: ep.episode, fsId: x.id, title: `Episode ${ep.episode}` });
      continue;
    }
    const numbered = episodic(x) ? parseNumbered(title) : null;
    if (numbered) { if (isNigerian(x, numbered.base)) addFilm(numbered.base, x, numbered.n); continue; }
    if (!filmLike(x) && !episodic(x)) continue;
    if (!isNigerian(x, title)) continue;
    addFilm(title, x, null);
  }

  const out = { generatedAt: new Date().toISOString(), source: 'FaithStream (thefaithstream.com)', titles: [] };
  for (const f of films) {
    const name = pretty(f.name);
    const partIds = [...f.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    const isParts = partIds.length > 1 && !f.uploads.length;
    out.titles.push({
      id: `snaija-fs-${normalize(name).replace(/ /g, '-')}`, type: 'movie', name, year: f.x.year || null,
      runtime: f.x.minutes ? `${f.x.minutes} min` : undefined,
      description: f.x.description && !/uploaded without metadata|description here/i.test(f.x.description) ? f.x.description : undefined,
      poster: f.x.poster || undefined, languages: ['en'], genres: ['Faith', 'Drama'], live: ['faithstream'],
      fsIds: isParts ? partIds : [...f.uploads, ...partIds], ...(isParts ? { fsParts: true } : {}),
    });
  }
  for (const s of series) {
    const videos = [...s.episodes.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
    const name = pretty(s.name).replace(/^Coprers|^Corpers/i, "Corper's");
    out.titles.push({ id: `snaija-fs-${normalize(name).replace(/ /g, '-')}`, type: 'series', name, poster: s.x.poster || undefined, languages: ['en'], genres: ['Faith', 'Drama'], live: ['faithstream'], videos });
  }
  // Keep only videos FaithStream will actually play (some uploads are listed but not playable yet).
  let dropped = 0;
  for (const t of out.titles) {
    if (t.fsIds) {
      const ok = [];
      for (const id of t.fsIds) if (await faithstream.playable(ctx, id)) ok.push(id); else dropped += 1;
      if (t.fsParts && ok.length !== t.fsIds.length) { t.fsIds = []; continue; } // a film missing a part is not offered
      t.fsIds = ok;
    }
    if (t.videos) {
      const ok = [];
      for (const v of t.videos) if (await faithstream.playable(ctx, v.fsId)) ok.push(v); else dropped += 1;
      t.videos = ok;
    }
  }
  out.titles = out.titles.filter((t) => (t.fsIds ? t.fsIds.length : t.videos?.length));
  console.log(`  › ${dropped} listed video(s) not playable on FaithStream right now; left out`);
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'faithstream.json'), `${JSON.stringify(out, null, 1)}\n`);
  const nFilms = out.titles.filter((t) => t.type === 'movie').length;
  const nSeries = out.titles.filter((t) => t.type === 'series');
  console.log(`FaithStream: ${items.length} videos → ${nFilms} Nigerian films, ${nSeries.length} Nigerian series (${nSeries.reduce((n, t) => n + t.videos.length, 0)} episodes)`);
  for (const t of out.titles) console.log(`  ${t.type === 'series' ? 'series' : 'film  '} ${t.name}${t.videos ? ` — ${t.videos.map((v) => `S${v.season}E${v.episode}`).join(' ')}` : `${t.fsParts ? ` (${t.fsIds.length} parts)` : t.fsIds.length > 1 ? ` (${t.fsIds.length} uploads)` : ''}${t.runtime ? ` ${t.runtime}` : ''}`}`);
}

if (require.main === module) main().catch((err) => { console.error(err); process.exit(1); });
module.exports = { parseEpisode, parseNumbered, sameName, pretty, isNigerian };
