#!/usr/bin/env node
'use strict';

// Finds Nigerian films and series that can be watched in the UK, from TMDB's discover API
// (UK availability data from JustWatch; attribution shown in Nuvio). Writes data/discovered.json.
// Runs in the nightly GitHub Action with TMDB_API_KEY. Nothing here is guessed: every title and
// every offer comes straight from TMDB, and a title drops out as soon as it leaves UK services.
//
// What counts as Nigerian: produced in Nigeria (origin country NG), or originally in Yoruba, Igbo or Hausa.
// Offers kept: free, free with ads, and subscription. Rental and purchase are left out.

const fs = require('fs');
const path = require('path');

const API = 'https://api.themoviedb.org/3';
const OUT = path.join(__dirname, '..', 'data', 'discovered.json');
const MAX_PAGES = 40; // 20 results a page; well above today's ~200 UK titles
const DELAY_MS = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEEP = { free: 'free', ads: 'ads', flatrate: 'subscription' };
const NIGERIAN_LANGS = { yo: 'yo', ig: 'ig', ha: 'ha', en: 'en' };

async function tmdb(pathAndQuery, { apiKey, fetchImpl }) {
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchImpl(`${API}${pathAndQuery}${sep}api_key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(15000),
      headers: { accept: 'application/json' },
    });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} for ${pathAndQuery}`);
    return res.json();
  }
  throw new Error(`TMDB rate limit for ${pathAndQuery}`);
}

const QUERIES = [
  'with_origin_country=NG',
  'with_original_language=yo',
  'with_original_language=ig',
  'with_original_language=ha',
];

async function discoverIds(kind, opts) {
  const ids = new Set();
  for (const q of QUERIES) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await tmdb(
        `/discover/${kind}?${q}&watch_region=GB&with_watch_monetization_types=flatrate|free|ads&sort_by=popularity.desc&page=${page}`,
        opts,
      );
      for (const r of body.results || []) ids.add(r.id);
      if (page >= (body.total_pages || 1)) break;
      await sleep(DELAY_MS);
    }
  }
  return [...ids];
}

function languagesOf(d) {
  const set = new Set();
  if (NIGERIAN_LANGS[d.original_language]) set.add(NIGERIAN_LANGS[d.original_language]);
  for (const l of d.spoken_languages || []) if (NIGERIAN_LANGS[l.iso_639_1]) set.add(NIGERIAN_LANGS[l.iso_639_1]);
  if (!set.size) set.add(d.original_language || 'en');
  return [...set];
}

/** Turns one TMDB detail response into a catalogue entry plus its UK offers, or null if none qualify. */
function toEntry(kind, d) {
  const gb = d['watch/providers']?.results?.GB;
  const offers = [];
  const seen = new Set();
  for (const [field, access] of Object.entries(KEEP)) {
    for (const p of gb?.[field] || []) {
      if (seen.has(p.provider_name)) continue;
      seen.add(p.provider_name);
      offers.push({ providerName: p.provider_name, tmdbProviderId: p.provider_id, access });
    }
  }
  if (!offers.length) return null;
  const imdb = d.external_ids?.imdb_id || d.imdb_id;
  const type = kind === 'tv' ? 'series' : 'movie';
  const date = d.release_date || d.first_air_date || '';
  const year = date ? Number(date.slice(0, 4)) : null;
  const name = d.title || d.name;
  const original = d.original_title || d.original_name;
  const title = {
    id: /^tt\d+$/.test(imdb || '') ? imdb : `snaija-tmdb-${kind}-${d.id}`,
    tmdbId: d.id,
    type,
    name,
    originalName: original && original !== name ? original : undefined,
    aliases: [],
    year,
    languages: languagesOf(d),
    category: type === 'series' ? 'series' : 'film',
    genres: (d.genres || []).map((g) => g.name),
    runtime: d.runtime ? `${d.runtime} min` : undefined,
    description: d.overview || undefined,
    poster: d.poster_path ? `https://image.tmdb.org/t/p/w342${d.poster_path}` : null,
    background: d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : undefined,
    country: (d.origin_country || d.production_countries?.map((c) => c.iso_3166_1) || []).join(', ') || undefined,
    sources: { all: 'TMDB', availability: 'JustWatch via TMDB (UK)' },
  };
  if (type === 'series') {
    title.videos = [];
    for (const s of d.seasons || []) {
      if (!s.season_number) continue;
      for (let e = 1; e <= (s.episode_count || 0); e++) title.videos.push({ season: s.season_number, episode: e });
    }
  }
  return { title, offers, watchLink: gb.link };
}

// Hand-picked titles TMDB's country/language filters miss (its country data is patchy for Nollywood).
// Each is looked up by name (and year when given); it's only kept if TMDB lists a UK offer for it.
async function seedIds(kind, seeds, opts) {
  const ids = [];
  for (const seed of seeds.filter((x) => (x.kind || 'movie') === kind)) {
    const yearParam = seed.year ? `&${kind === 'tv' ? 'first_air_date_year' : 'year'}=${seed.year}` : '';
    const body = await tmdb(`/search/${kind}?query=${encodeURIComponent(seed.name)}${yearParam}`, opts);
    const hit = seed.tmdbId ? { id: seed.tmdbId } : (body.results || [])[0];
    if (hit) ids.push(hit.id);
    else console.warn(`Seed not found on TMDB: ${seed.name}${seed.year ? ` (${seed.year})` : ''}`);
    await sleep(DELAY_MS);
  }
  return ids;
}

async function discover({ apiKey, fetchImpl = fetch, seeds = [] } = {}) {
  const opts = { apiKey, fetchImpl };
  const entries = [];
  for (const kind of ['movie', 'tv']) {
    const ids = [...new Set([...(await discoverIds(kind, opts)), ...(await seedIds(kind, seeds, opts))])];
    for (const id of ids) {
      await sleep(DELAY_MS);
      const d = await tmdb(`/${kind}/${id}?append_to_response=external_ids,watch/providers`, opts);
      const entry = toEntry(kind, d);
      if (entry) entries.push(entry);
    }
  }
  return { generatedAt: new Date().toISOString(), source: 'TMDB discover, UK availability from JustWatch', entries };
}

async function main() {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error('No TMDB_API_KEY: discovery skipped, previous data/discovered.json kept.');
    return;
  }
  let result;
  try {
    const seeds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seeds.json'), 'utf8')).titles || [];
    result = await discover({ apiKey, seeds });
  } catch (err) {
    // Keep yesterday's list rather than emptying the catalogue on a TMDB outage.
    console.error(`Discovery failed, previous list kept: ${err.message}`);
    return;
  }
  // A sudden collapse is far more likely a TMDB or code problem than half of Nollywood leaving the UK.
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  const before = previous?.entries?.length || 0;
  if (before >= 20 && result.entries.length < before * 0.5 && !process.argv.includes('--accept-drop')) {
    console.error(`Discovery found ${result.entries.length} titles, down from ${before}. Previous list kept; rerun with --accept-drop if real.`);
    process.exitCode = 2;
    return;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
  const byLang = {};
  for (const e of result.entries) for (const l of e.title.languages) byLang[l] = (byLang[l] || 0) + 1;
  console.log(`${result.entries.length} titles watchable in the UK. By language: ${JSON.stringify(byLang)}`);
}

if (require.main === module) main();

module.exports = { discover, toEntry };
