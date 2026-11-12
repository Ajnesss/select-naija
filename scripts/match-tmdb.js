#!/usr/bin/env node
'use strict';

// Finds each channel film or series on TMDB, for its real release year, a proper poster, genres and an IMDb ID.
// A match must have the same name (ignoring accents, punctuation and "Season"), be a Nigerian production
// (TMDB production/origin country NG), and fit the year: within a year of a year stated in the upload title, or
// released no later than the upload. Results, including "no match", are kept in data/tmdb-matches.json so
// each title is looked up once (no-match entries are retried after 30 days). Runs nightly with TMDB_API_KEY.

const fs = require('fs');
const path = require('path');
const { loadData } = require('../src/data');
const { groupKey } = require('../src/text');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'tmdb-matches.json');
const API = 'https://api.themoviedb.org/3';
const LIMIT = Number(process.env.TMDB_MATCH_LIMIT || 4000);
const RETRY_MS = 30 * 24 * 3600 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tmdb(p, key) {
  for (let i = 0; i < 3; i++) {
    const res = await fetch(`${API}${p}${p.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(15000) });
    if (res.status === 429) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status}`);
    return res.json();
  }
  throw new Error('TMDB rate limit');
}

/** Picks the TMDB entry that is the same Nigerian title, or null. Pure apart from the details lookups. */
async function findMatch(title, key, lookup = tmdb) {
  const kind = title.type === 'series' ? 'tv' : 'movie';
  const want = groupKey(title.name);
  const body = await lookup(`/search/${kind}?query=${encodeURIComponent(title.name)}&include_adult=false`, key);
  const candidates = (body.results || []).filter((r) => {
    const names = [r.title, r.name, r.original_title, r.original_name].filter(Boolean).map(groupKey);
    return names.includes(want) && ['en', 'yo', 'ig', 'ha', 'pcm'].includes(r.original_language);
  });
  for (const c of candidates.slice(0, 3)) {
    const d = await lookup(`/${kind}/${c.id}?append_to_response=external_ids`, key);
    const countries = [...(d.production_countries || []).map((x) => x.iso_3166_1), ...(d.origin_country || [])];
    if (!countries.includes('NG')) continue;
    const date = d.release_date || d.first_air_date || '';
    const year = date ? Number(date.slice(0, 4)) : null;
    if (year && title.year) {
      if (title.yearIsUpload ? year > title.year + 1 : Math.abs(year - title.year) > 1) continue;
    }
    return {
      tmdbId: d.id,
      imdbId: d.external_ids?.imdb_id || d.imdb_id || null,
      year,
      poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
      background: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : null,
      description: d.overview || null,
      genres: (d.genres || []).map((g) => g.name),
      runtime: d.runtime ? `${d.runtime} min` : null,
    };
  }
  return null;
}

async function main() {
  const key = process.env.TMDB_API_KEY;
  if (!key) {
    console.error('No TMDB_API_KEY: matching skipped.');
    return;
  }
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const data = loadData(path.join(ROOT, 'data'), { inAppOnly: false, freeOnly: false });
  const now = Date.now();
  const todo = data.titles.filter((t) => {
    if (!/^snaija-(yt|dm|tubi)-/.test(t.id) || t.category === 'test') return false;
    const c = cache[`${t.type}|${groupKey(t.name)}|${t.year || ''}`];
    return !c || (!c.match && now - Date.parse(c.at) > RETRY_MS);
  });
  let done = 0;
  let matched = 0;
  for (const t of todo.slice(0, LIMIT)) {
    try {
      const match = await findMatch(t, key);
      cache[`${t.type}|${groupKey(t.name)}|${t.year || ''}`] = { at: new Date().toISOString(), match };
      if (match) matched++;
    } catch (err) {
      console.warn(`${t.name}: ${err.message}`);
    }
    done++;
    await sleep(30);
  }
  fs.writeFileSync(OUT, JSON.stringify(cache));
  console.log(`TMDB matching: ${done} looked up, ${matched} matched, ${Math.max(0, todo.length - done)} left for later runs`);
}

if (require.main === module) main();

module.exports = { findMatch };
