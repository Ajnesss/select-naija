#!/usr/bin/env node
'use strict';

// Reads the approved Dailymotion channels (data/channels.json) through Dailymotion's public API and writes
// data/dailymotion.json: one catalogue title per film, with its parts in order. Runs in the nightly GitHub
// Action. A video only counts if it's public, published, long enough to be a film or part of one, and not
// geo-blocked for the UK (Dailymotion's own geoblocking field, so no UK address is needed).
// Only Dailymotion-verified channels whose rights position has been checked are listed in channels.json.

const fs = require('fs');
const path = require('path');
const { normalize, slugify } = require('../src/text');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'dailymotion.json');
const API = 'https://api.dailymotion.com';
const FIELDS = 'id,title,duration,created_time,thumbnail_720_url,description,geoblocking,status,private,language';
const MIN_SECONDS = 20 * 60;
const SKIP = /\b(trailer|teaser|preview|remix|behind the scenes|bts|interview|music video|official video|skit)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when Dailymotion's geoblocking list lets UK viewers watch. */
function ukAllowed(geo) {
  if (!Array.isArray(geo) || !geo.length) return true;
  const [mode, ...countries] = geo.map((c) => String(c).toLowerCase());
  if (mode === 'allow') return countries.length === 0 || countries.includes('gb');
  if (mode === 'deny') return !countries.includes('gb');
  return false;
}

/**
 * Splits an upload title into the film's name, its part number and a year, e.g.
 * "ANGER OF IMMORTALS 4 - 2018 LATEST NIGERIAN NOLLYWOOD MOVIES || TRENDING" → Anger of Immortals, part 4, 2018.
 */
function parseTitle(raw) {
  let s = String(raw).replace(/\s+/g, ' ').trim();
  const yearMatch = s.match(/\b(19[89]\d|20[0-3]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const starring = s.match(/\bstarring\s+([^|#]+?)\.?\s*$/i);
  const cast = starring
    ? starring[1].split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 40)
    : [];
  s = s.split(/\s*(?:\|\||\||#)\s*/)[0];
  // Drop marketing tails: " - Latest Yoruba Movie 2018 Starring ...", "(Yoruba Movie)", "Nigerian Nollywood Movie".
  s = s.replace(/\s*[-–—:]\s*(?:\d{4}\s+)?(?:latest|new|blockbuster|nigerian|nollywood|yoruba|igbo|hausa|african|full|classic|trending|exclusive)\b.*$/i, '');
  s = s.replace(/\(\s*(?:yoruba|igbo|hausa|nollywood|nigerian)[^)]*\)/gi, '');
  s = s.replace(/\b(?:latest\s+)?(?:nigerian|nollywood|african|yoruba|igbo|hausa)\s+(?:nollywood\s+)?(?:movies?|films?)\b.*$/i, '');
  s = s.replace(/\b(?:full\s+)?(?:movie|film)\b\s*$/i, '').trim();
  let part = null;
  const p = s.match(/^(.*?)(?:\s*[-–(]?\s*(?:part|pt\.?|episode|ep\.?)\s*|\s+)(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\)?\s*$/i);
  if (p && p[1].trim().length >= 2) {
    s = p[1].trim();
    part = Number(p[2]);
  }
  s = s.replace(/[\s\-–:.,]+$/, '').trim();
  const name = s
    .toLowerCase()
    .replace(/(^|[\s(\-])([a-zà-ÿ])/g, (m, pre, c) => pre + c.toUpperCase())
    .replace(/\b(Of|The|And|In|On|A|An|To|For)\b/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase()));
  return { name, part, year, cast };
}

function languagesFor(title, channel) {
  const t = normalize(title);
  const found = ['yoruba', 'igbo', 'hausa'].filter((l) => t.includes(l)).map((l) => ({ yoruba: 'yo', igbo: 'ig', hausa: 'ha' })[l]);
  return found.length ? found : channel.languages;
}

// Dailymotion lists at most 1,000 videos per query, so walk back in time: newest first, then repeat the
// listing for everything uploaded before the oldest video seen so far.
async function channelVideos(channel, fetchImpl) {
  const out = new Map();
  let before = null;
  for (let round = 0; round < 50; round++) {
    let oldest = null;
    let added = 0;
    for (let page = 1; page <= 10; page++) {
      const window = before ? `&created_before=${before}` : '';
      const res = await fetchImpl(
        `${API}/user/${encodeURIComponent(channel.user)}/videos?fields=${FIELDS}&limit=100&page=${page}&sort=recent${window}`,
        { signal: AbortSignal.timeout(30000) },
      );
      if (!res.ok) throw new Error(`Dailymotion ${res.status} for ${channel.user} page ${page}`);
      const body = await res.json();
      for (const v of body.list || []) {
        if (!out.has(v.id)) added++;
        out.set(v.id, v);
        if (oldest == null || v.created_time < oldest) oldest = v.created_time;
      }
      if (!body.has_more) break;
      await sleep(300);
    }
    if (!added || oldest == null || oldest === before) break;
    before = oldest;
  }
  return [...out.values()];
}

/** Groups a channel's videos into films. Pure, so it can be tested without the network. */
function buildTitles(channel, videos) {
  const groups = new Map();
  for (const v of videos) {
    if (v.private || (v.status && v.status !== 'published')) continue;
    if ((v.duration || 0) < MIN_SECONDS || SKIP.test(v.title || '')) continue;
    if (!ukAllowed(v.geoblocking)) continue;
    const parsed = parseTitle(v.title);
    if (!parsed.name || parsed.name.length < 2) continue;
    // "Anger of Immortal 3" and "Anger of Immortals 4" are the same film: ignore a plural s when grouping.
    const key = normalize(parsed.name).split(' ').map((w) => w.replace(/s$/, '')).join(' ');
    if (!groups.has(key)) groups.set(key, { parsed, videos: [] });
    groups.get(key).videos.push({ ...v, part: parsed.part, year: parsed.year });
  }
  const titles = [];
  for (const { parsed, videos: vids } of groups.values()) {
    // One upload per part; when a part was uploaded twice keep the longest.
    const byPart = new Map();
    for (const v of vids) {
      const k = v.part ?? 1;
      if (!byPart.has(k) || v.duration > byPart.get(k).duration) byPart.set(k, v);
    }
    const parts = [...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([part, v]) => ({ part, videoId: v.id, minutes: Math.round(v.duration / 60) }));
    const first = byPart.get(parts[0].part);
    const year = vids.map((v) => v.year).find(Boolean) || new Date(first.created_time * 1000).getUTCFullYear();
    titles.push({
      id: `snaija-dm-${slugify(parsed.name)}-${year}`,
      type: 'movie',
      name: parsed.name,
      aliases: [],
      year,
      yearIsUpload: !vids.some((v) => v.year),
      languages: languagesFor(vids.map((v) => v.title).join(' '), channel),
      category: 'film',
      genres: [],
      cast: [...new Set(vids.flatMap((v) => parseTitle(v.title).cast))].slice(0, 8),
      runtime: `${parts.reduce((n, p) => n + p.minutes, 0)} min`,
      description: (first.description || '').replace(/\s+/g, ' ').trim().slice(0, 400) || undefined,
      poster: first.thumbnail_720_url || null,
      posterShape: 'landscape',
      sources: { all: `Dailymotion channel ${channel.name} (${channel.user})` },
      channel: channel.user,
      parts,
    });
  }
  // Two different films with the same name and year on one channel: keep the IDs unique.
  const seen = new Map();
  for (const t of titles) {
    const n = seen.get(t.id) || 0;
    seen.set(t.id, n + 1);
    if (n) t.id = `${t.id}-${n + 1}`;
  }
  return titles;
}

async function main() {
  const channels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'channels.json'), 'utf8')).channels.filter(
    (c) => c.platform === 'dailymotion' && c.approved,
  );
  const result = { generatedAt: new Date().toISOString(), channels: {}, titles: [] };
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  for (const channel of channels) {
    try {
      const videos = await channelVideos(channel, fetch);
      const titles = buildTitles(channel, videos);
      result.channels[channel.user] = { videos: videos.length, titles: titles.length };
      result.titles.push(...titles);
      console.log(`${channel.name}: ${videos.length} videos → ${titles.length} films`);
    } catch (err) {
      // Keep yesterday's titles for this channel rather than dropping them on an API hiccup.
      const kept = (previous?.titles || []).filter((t) => t.channel === channel.user);
      result.titles.push(...kept);
      result.channels[channel.user] = { error: err.message, keptFromPreviousRun: kept.length };
      console.error(`${channel.name}: ${err.message}; kept ${kept.length} titles from the previous run`);
    }
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
}

if (require.main === module) main();

module.exports = { parseTitle, buildTitles, ukAllowed };
