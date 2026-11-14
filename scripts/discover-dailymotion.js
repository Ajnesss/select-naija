#!/usr/bin/env node
'use strict';

// Reads the approved Dailymotion channels (data/channels.json) through Dailymotion's public API and writes
// data/dailymotion.json: one catalogue title per film, with its parts in order. Runs in the nightly GitHub
// Action. A video only counts if it's public, published, long enough to be a film or part of one, and not
// geo-blocked for the UK (Dailymotion's own geoblocking field, so no UK address is needed).
// Only Dailymotion-verified channels whose rights position has been checked are listed in channels.json.

const fs = require('fs');
const path = require('path');
const { normalize, slugify, groupKey } = require('../src/text');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'dailymotion.json');
const API = 'https://api.dailymotion.com';
const FIELDS = 'id,title,duration,created_time,thumbnail_720_url,description,geoblocking,status,private,language';
const MIN_SECONDS = 20 * 60;
const MIN_FILM_MINUTES = 30;
const SKIP = /\b(sceneone ?tv live|our view on|masterclass|campaign|birthday (?:party|celebration)|recap|highlights?|trailer|teaser|preview|remix|behind the scenes|bts|interview|music video|official video|skit|vlog|livestream|live stream|is live|live now|podcast|reaction|prank|unboxing|q ?& ?a|meet the cast|compilation|meditation|sermon|worship service|showing (?:tonight|now|soon)|coming soon)\b/i;
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
  let s = String(raw)
    .replace(/\p{Extended_Pictographic}|\uFE0F/gu, ' ')
    .replace(/@[\w.]+/g, ' ')
    .replace(/\s+/g, ' ')
    // Clickbait and channel labels are never part of the name.
    .replace(/\b(?:please\s+)?don'?t\s+leave\s+you\s?tube\s+without\s+watching(?:\s+this)?\b/gi, ' | ')
    .replace(/\b(?:you\s+can'?t\s+miss\s+it|must\s+watch|showing\s+(?:tonight|now|soon)?\s*on\s+this\s+channel)\b.*$/gi, ' ')
    .replace(/\btaskar\s+kan+[ey]*wood\b(?:\s+(?:episode|ep)\s*\d+)?/gi, ' ')
    .replace(/\s+_+\s+|_+/g, ' | ')
    .replace(/\s-(?=[A-Za-z])/g, ' - ')
    .replace(/\(\s*(?:the|d)\s+movie\s*\)/gi, ' | ')
    // "(BLOOD OF THE HIDDEN THRONE) - MERCY JOHNSON": a name in brackets at the start is the name.
    .replace(/^\s*\(([^()]{3,80})\)/, '$1 | ')
    .replace(/[\s.,]*\b(?:starring|staring|featuring|feat|ft)\b[\s,.:]*/i, ' | starring ')
    .replace(/(\S)-\s+(?=[A-Z])/g, '$1 - ')
    .replace(/\s[–—](?=\S)/g, ' - ')
    .replace(/-(?:watch|starring|ft)\b/gi, ' | ')
    .replace(/\s*,\s*(?:latest|new|trending|nigerian|nollywood)\b.*$/i, ' ')
    .replace(/\{[^}]*\}?/g, ' ')
    .replace(/\[[^\]]*\]?/g, ' ')
    // Marketing in brackets ends the name: what follows is usually the cast ("Better Days (New Movie) Angel Unigwe, ...").
    .replace(/\((?:\s*(?:new|latest|trending|full|exclusive|hd|complete|nollywood|nigerian|african)\b)[^)]*\)?/gi, ' | ')
    .replace(/\(\s*(?:season|sn|part|pt)\s*(\d{1,2})\s*\)/gi, ' $1 ')
    .replace(/^\s*(?:new|latest|trending)\s*\*?\s*[-:]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Hausa: "Waiwaye | Zango Na 2 | Kashi Na 5" = season 2, episode 5; "Badariyya | Kashi Na 6" = part 6.
  const ha = s.match(/^(.*?)[\s|\-–:]*\bzango\s+na\s+(\d{1,2})[\s|\-–:]*\bkashi\s+na\s+(\d{1,3})\b/i);
  if (ha && ha[1].trim().length >= 2) {
    const base = parseTitle(ha[1]);
    return { ...base, part: null, season: Number(ha[2]), episode: Number(ha[3]) };
  }
  s = s.replace(/[\s|\-–:]*\bkashi\s+na\s+(\d{1,3})\b/i, ' part $1 | ');
  s = s.replace(/\bsaison\b/gi, 'season').replace(/\b[ée]pisode\b/gi, 'episode');
  // Series episodes: "Aiyetoro Town Season 2 Episode 19", "Best Friends in the World - S02E10".
  const ep = s.match(/^(.*?)[\s\-–:|]*\b(?:season|s)\s*(\d{1,2})\s*[-:,]?\s*(?:episode|ep\.?|e)\s*(\d{1,3})\b/i);
  if (ep && ep[1].trim().length >= 2) {
    const base = parseTitle(ep[1]);
    const yearMatch = String(raw).match(/\b(19[89]\d|20[0-3]\d)\b/);
    return { ...base, name: base.name, part: null, season: Number(ep[2]), episode: Number(ep[3]), year: yearMatch ? Number(yearMatch[1]) : base.year };
  }
  // Episodes without a season ("Obidike Episode 12", "Sibe Episode One", "Jenifa's Diary 16 Episode") are season 1.
  const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const ep1 = s.match(/^(.*?)[\s\-–:|(]*\b(?:final\s+episode\s*\(\s*)?(?:episode|ep\.?)\s*(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i)
    || s.match(/^(.*?)\s+(\d{1,3})\s*(?:st|nd|rd|th)?\s+episode\b/i);
  if (ep1 && ep1[1].replace(/[^a-z]/gi, '').length >= 2 && !/\bfunny\b/i.test(s)) {
    const base = parseTitle(ep1[1]);
    const n = WORDS[String(ep1[2]).toLowerCase()] || Number(ep1[2]);
    const yearMatch = String(raw).match(/\b(19[89]\d|20[0-3]\d)\b/);
    return { ...base, part: null, season: 1, episode: n, year: yearMatch ? Number(yearMatch[1]) : base.year };
  }
  // In Nollywood uploads "Season 3" on its own is the third part of a film, not a TV season.
  s = s.replace(/\b(?:season|sn)\s*(\d{1,2})\b/i, ' $1').replace(/\s+/g, ' ').trim();
  const yearMatch = s.match(/\b(19[89]\d|20[0-3]\d)\b/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const starring = s.match(/\bstarring\s+([^|#]+?)\.?\s*(?:[|#].*)?$/i);
  const cast = starring
    ? starring[1].split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter((x) => x.length > 2 && x.length < 40)
    : [];
  // Trailing cast after the name: "Take My Heart 2 | Luchy Donalds & Onny Micheal" or "Name - Actor, Actor".
  const segments = s.split(/\s*(?:\|\||\||#)\s*/);
  const tail = segments.slice(1).join(' ');
  s = segments[0];
  const dash = s.split(/\s+[-–—]\s+/);
  if (dash.length > 1 && dash[0].trim().length >= 3) s = dash[0];
  s = s.replace(/[\s\-–—:.,]+$/, '');
  const castFromTail = /[,&]/.test(tail) && !starring
    ? tail.replace(/\b(19|20)\d\d\b/g, '').split(/\s*(?:,|&|\band\b)\s*/i).map((x) => x.trim()).filter((x) => /^[A-Z][a-z]+(?: [A-Z][a-z]+){1,2}$/.test(x))
    : [];
  // Drop marketing tails: " - Latest Yoruba Movie 2018 Starring ...", "(Yoruba Movie)", "Nigerian Nollywood Movie".
  s = s.replace(/\s*[-–—:]\s*(?:\d{4}\s+)?(?:latest|new|blockbuster|nigerian|nollywood|yoruba|igbo|hausa|african|full|classic|trending|exclusive)\b.*$/i, '');
  s = s.replace(/\(\s*(?:yoruba|igbo|hausa|nollywood|nigerian)[^)]*\)/gi, '');
  s = s.replace(/\b(?:latest\s+)?(?:nigerian|nollywood|african|yoruba|igbo|hausa)\s+(?:nollywood\s+)?(?:movies?|films?)\b.*$/i, '');
  s = s.replace(/\bfull\s+(?:movie|film)\b.*$/i, '').replace(/\b(?:full\s+)?(?:movie|film)\b\s*$/i, '').trim();
  // Brackets holding only people's names ("Deceitful Union (Fredrick Leonard Shaznay Okawa)") are cast, not title.
  s = s.replace(/\s*\(([^()]*)\)?/g, (m, inner) => (/\b(the|of|a|an|my|in|on|and|to|saga|returns?|part|pt|season|\d)\b/i.test(inner) || inner.trim().split(/\s+/).length < 2 ? m : ' ')).trim();
  let part = null;
  // "Amare Part 2 Extra Words": a part number in the middle ends the name.
  const mid = s.match(/^(.*?)\s*[-–(]?\s*\b(?:part|pt\.?)\s*(\d{1,2})\b(?!\s*$)/i);
  if (mid && mid[1].trim().length >= 2) {
    s = mid[1].trim();
    part = Number(mid[2]);
  }
  const p = part == null && s.match(/^(.*?)(?:\s*[-–(]?\s*(?:part|pt\.?|episode|ep\.?)\s*|\s+)(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\)?\s*$/i);
  if (p && p[1].trim().length >= 2) {
    s = p[1].trim();
    part = Number(p[2]);
  }
  s = s.replace(/[\s\-–:.,]+$/, '').replace(/^[\s\-–—:.,()|]+/, '').trim();
  // What is left is a list of actors, not a name ("Kanayo O. Kanayo, Zubby Michael"): no usable title.
  {
    // "Breakfast Ruth Kadiri, Eddie Watson, Scarlet Gomez": the name, the first actor, then more actors.
    const [head, ...rest] = s.split(',');
    // "Risking for Love 4 Uju Okoli, Anthony Woods": name and part number, then the cast.
    const numbered = rest.length >= 1 && head.match(/^(.*?\s\d{1,2})\s+[A-Z][a-z]+ [A-Z][a-z]+$/i);
    if (numbered) {
      s = numbered[1];
      const n = part == null && s.match(/^(.*?)\s+(\d{1,2})$/);
      if (n && n[1].trim().length >= 2) {
        s = n[1].trim();
        part = Number(n[2]);
      }
    }
    else if (rest.length >= 2 && rest.every((x) => x.trim() && x.trim().split(/\s+/).length <= 4 && !/\d/.test(x))) {
      const glued = head.match(/^(.*\S)\s*-\s*([A-Z][a-z]+ [A-Z][a-z]+)$/i);
      const words = head.trim().split(/\s+/);
      s = glued ? glued[1] : words.length >= 3 ? words.slice(0, -2).join(' ') : '';
    }
  }
  const name = s
    .toLowerCase()
    .replace(/(^|[\s(\-])([a-zà-ÿ])/g, (m, pre, c) => pre + c.toUpperCase())
    .replace(/\b(Of|The|And|In|On|A|An|To|For)\b/g, (w, _x, i) => (i === 0 ? w : w.toLowerCase()));
  return { name, part, year, cast: tidyCast(cast.length ? cast : castFromTail) };
}


const MARKETING = /\b(latest|new|movie|movies|film|films|nollywood|nigerian|african|yoruba|igbo|hausa|trending|full|romance|drama|comedy|exclusive|official|channel|tv|blockbuster)\b/i;
/** Actor names as people write them: "BIMBO ADEMOYE" → "Bimbo Ademoye"; marketing words and years are dropped. */
function tidyCast(list) {
  return [...new Set((list || [])
    .map((x) => String(x).replace(/[.#]+$/g, '').trim())
    .filter((x) => x.length > 2 && x.length < 40 && !/\d/.test(x) && !MARKETING.test(x))
    .map((x) => x.toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, pre, c) => pre + c.toUpperCase())))];
}

const BOILERPLATE = /welcome to|your home for|home of|subscribe|click|link|https?:|www\.|#|©|copyright|all rights|cast\s*:|crew|production house|executive producer|producer\s*:|directed by|director\s*:|written by|screenplay|starring|follow us|instagram|facebook|tiktok|twitter|whatsapp|telegram|join this channel|perks|notification|bell icon|don'?t forget|like,? share|comment below|business|enquir|email|contact|watch more|playlist|channel|^\s*[-–=*_]+\s*$/i;
/** The story part of an upload description: credits, links and calls to subscribe removed. */
function cleanDescription(text) {
  const lines = String(text || '').split(/\n|(?<=[.!?])\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
  const story = lines.filter((l) => !BOILERPLATE.test(l) && /[a-z]{3}/.test(l) && l.split(' ').length >= 4);
  const out = story.join(' ').replace(/^\s*in this (?:african |nigerian |nollywood )*(?:movie|film)\s*[.…:,-]*\s*/i, '').replace(/\s+/g, ' ').trim();
  return out.length >= 40 ? out.slice(0, 500) : undefined;
}

const GENRE_WORDS = [
  ['Romance', /\b(love|lover|romance|romantic|heart|marriage|marry|married|wedding|bride|groom|husband|wife|crush|valentine)\b/i],
  ['Comedy', /\b(comedy|funny|laugh|hilarious|wahala|gbas gbos)\b/i],
  ['Thriller', /\b(kidnap|kidnapped|murder|killer|crime|criminal|police|detective|thriller|revenge|vengeance|cult|assassin|heist|ritual)\b/i],
  ['Epic', /\b(kingdom|king|queen|prince|princess|throne|palace|village|epic|warrior|chief|igwe|oba|emir)\b/i],
  ['Supernatural', /\b(fantasy|magic|magical|powers|juju|witch|witchcraft|spirit|spirits|ghost|oracle|gods|goddess|deity|native doctor|herbalist|curse|cursed|mermaid|marine|charm)\b/i],
  ['Family', /\b(family|mother|father|mum|mom|dad|son|daughter|sister|brother|siblings|twins|in-law|stepmother|orphan)\b/i],
  ['Christmas', /\b(christmas|xmas)\b/i],
];
/** Rough genres from the name and story; every film gets at least Drama. */
function genresFor(text) {
  const g = GENRE_WORDS.filter(([, re]) => re.test(text)).map(([name]) => name);
  return g.length ? g.slice(0, 3) : ['Drama'];
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
function buildTitles(channel, videos, { idPrefix = 'snaija-dm' } = {}) {
  const groups = new Map();
  for (const v of videos) {
    if (v.private || (v.status && v.status !== 'published')) continue;
    if ((v.duration || 0) < MIN_SECONDS || SKIP.test(v.title || '')) continue;
    if (!ukAllowed(v.geoblocking)) continue;
    const parsed = parseTitle(v.title);
    if (!parsed.name || parsed.name.length < 2) continue;
    // TV drama channels (AREWA24) number episodes as parts.
    if (channel.episodic && parsed.part != null && parsed.episode == null) Object.assign(parsed, { season: 1, episode: parsed.part, part: null });
    // "Anger of Immortal 3" and "Anger of Immortals 4" are the same film: ignore a plural s when grouping.
    const series = parsed.episode != null;
    const key = `${series ? 'S|' : ''}${groupKey(parsed.name)}`;
    if (!groups.has(key)) groups.set(key, { parsed, series, videos: [] });
    groups.get(key).videos.push({ ...v, part: parsed.part, season: parsed.season, episode: parsed.episode, year: parsed.year });
  }
  // A show uploaded partly as "Aiyetoro Town 3" (no word Episode) and partly as "Season 2 Episode 19":
  // when a series exists under the same name and has no season 1, the numbered parts become season 1.
  for (const [key, g] of groups) {
    if (g.series) continue;
    const show = groups.get(`S|${key}`);
    if (!show || show.videos.some((v) => v.season === 1)) continue;
    const numbered = g.videos.filter((v) => v.part != null);
    if (numbered.length < 2) continue;
    for (const v of numbered) show.videos.push({ ...v, season: 1, episode: v.part, part: null });
    g.videos = g.videos.filter((v) => v.part == null);
    if (!g.videos.length) groups.delete(key);
  }
  // "Aiyetoro" (a few episodes) and "Aiyetoro Town" (most of them) on one channel are the same show.
  const seriesKeys = [...groups.keys()].filter((k) => k.startsWith('S|'));
  for (const a of seriesKeys) {
    const ga = groups.get(a);
    if (!ga) continue;
    const target = seriesKeys.find((b) => b !== a && groups.get(b) && b.startsWith(`${a} `) && groups.get(b).videos.length >= 3 * ga.videos.length);
    if (!target) continue;
    groups.get(target).videos.push(...ga.videos);
    groups.delete(a);
  }
  const titles = [];
  for (const { parsed, series, videos: vids } of groups.values()) {
    const uploadedAt = new Date(Math.max(...vids.map((v) => v.created_time || 0)) * 1000).toISOString();
    if (series) {
      const byEp = new Map();
      for (const v of vids) {
        const k = `${v.season}:${v.episode}`;
        if (!byEp.has(k) || v.duration > byEp.get(k).duration) byEp.set(k, v);
      }
      const episodes = [...byEp.values()]
        .sort((a, b) => a.season - b.season || a.episode - b.episode)
        .map((v) => ({ season: v.season, episode: v.episode, videoId: v.id, minutes: Math.round(v.duration / 60), quality: v.definition || undefined, released: new Date(v.created_time * 1000).toISOString() }));
      const first = vids.find((v) => v.id === episodes[0].videoId);
      const year = Math.min(...vids.map((v) => v.year || new Date(v.created_time * 1000).getUTCFullYear()));
      titles.push({
        id: `${idPrefix}-${slugify(parsed.name)}-${year}`,
        type: 'series',
        name: parsed.name,
        aliases: [],
        year,
        languages: languagesFor(vids.map((v) => v.title).join(' '), channel),
        category: 'series',
        genres: genresFor(`${parsed.name} ${first.description || ''}`),
        description: cleanDescription(first.description),
        uploadedAt,
        poster: first.thumbnail_720_url || null,
        posterShape: 'landscape',
        sources: { all: `${channel.platform === 'youtube' ? 'YouTube' : 'Dailymotion'} channel ${channel.name} (${channel.user})` },
        channel: channel.user,
        videos: episodes.map((e) => ({ season: e.season, episode: e.episode, released: e.released })),
        episodes,
      });
      continue;
    }
    // One upload per part; when a part was uploaded twice keep the longest.
    const byPart = new Map();
    for (const v of vids) {
      const k = v.part ?? 1;
      if (!byPart.has(k) || v.duration > byPart.get(k).duration) byPart.set(k, v);
    }
    const parts = [...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([part, v]) => ({ part, videoId: v.id, minutes: Math.round(v.duration / 60), quality: v.definition || undefined }));
    // A single upload under half an hour is a clip, talk or recap, not a film.
    if (parts.length === 1 && parts[0].minutes < MIN_FILM_MINUTES && !vids.some((v) => v.part != null)) continue;
    const first = byPart.get(parts[0].part);
    const year = vids.map((v) => v.year).find(Boolean) || new Date(first.created_time * 1000).getUTCFullYear();
    titles.push({
      id: `${idPrefix}-${slugify(parsed.name)}-${year}`,
      type: 'movie',
      name: parsed.name,
      aliases: [],
      year,
      yearIsUpload: !vids.some((v) => v.year),
      languages: languagesFor(vids.map((v) => v.title).join(' '), channel),
      category: 'film',
      genres: genresFor(`${parsed.name} ${first.description || ''}`),
      cast: [...new Set(vids.flatMap((v) => parseTitle(v.title).cast))].slice(0, 8),
      runtime: `${parts.reduce((n, p) => n + p.minutes, 0)} min`,
      description: cleanDescription(first.description),
      uploadedAt,
      poster: first.thumbnail_720_url || null,
      posterShape: 'landscape',
      sources: { all: `${channel.platform === 'youtube' ? 'YouTube' : 'Dailymotion'} channel ${channel.name} (${channel.user})` },
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

module.exports = { parseTitle, buildTitles, ukAllowed, groupKey, cleanDescription, genresFor, tidyCast };
