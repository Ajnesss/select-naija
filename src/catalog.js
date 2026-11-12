'use strict';

const { LANGUAGES } = require('./data');
const { normalize } = require('./text');
const { linkState, isShown } = require('./states');

const PAGE_SIZE = 50;
const CLASSIC_BEFORE = 2010;

// Rows shown in Nuvio. Every row supports a filter (genre extra) and paging (skip).
const ROWS = [
  { id: 'snaija-yoruba', type: 'movie', name: 'Yoruba films', match: (t) => t.languages.includes('yo') },
  { id: 'snaija-igbo', type: 'movie', name: 'Igbo films', match: (t) => t.languages.includes('ig') },
  { id: 'snaija-hausa', type: 'movie', name: 'Hausa films', match: (t) => t.languages.includes('ha') },
  { id: 'snaija-english', type: 'movie', name: 'Nollywood (English)', match: (t) => t.languages.includes('en') },
  { id: 'snaija-other-languages', type: 'movie', name: 'Pidgin & other languages', match: (t) => t.languages.some((l) => !['en', 'yo', 'ig', 'ha'].includes(l)) },
  { id: 'snaija-series', type: 'series', name: 'Nigerian series', match: () => true },
  { id: 'snaija-new', type: 'movie', name: 'New on Select Naija', match: () => true, sort: 'newest' },
  { id: 'snaija-classics', type: 'movie', name: 'Nigerian classics', match: (t) => t.year && t.year < CLASSIC_BEFORE },
];

function decadeOf(year) {
  return year ? `${Math.floor(year / 10) * 10}s` : null;
}

function accessOptions(title, data, now) {
  const out = new Set();
  for (const link of linksForTitle(title.id, data)) {
    if (!isShown(linkState(data.status.links[link.id], now))) continue;
    const provider = data.providerById.get(link.provider);
    if (provider) out.add(provider.access === 'free' ? 'Free to watch' : 'Subscription or rental');
  }
  return [...out];
}

function linksForTitle(titleId, data) {
  if (data.linksByTitle) return data.linksByTitle.get(titleId) || [];
  const out = [];
  for (const [key, links] of data.linksByStreamId) {
    if (key === titleId || key.startsWith(`${titleId}:`)) out.push(...links);
  }
  return out;
}

// Which titles are available, and their filter labels, worked out once a minute per loaded data set:
// with tens of thousands of titles, doing it per request would take seconds.
const CACHE_MS = 60 * 1000;
const caches = new WeakMap();

function snapshot(data, now) {
  const c = caches.get(data);
  if (c && Math.abs(now - c.at) < CACHE_MS) return c;
  const available = new Set();
  for (const t of data.titles) {
    if (linksForTitle(t.id, data).some((l) => isShown(linkState(data.status.links[l.id], now)))) available.add(t.id);
  }
  const fresh = { at: now, available, labels: new Map(), rowOptions: new Map(), sorted: new Map() };
  caches.set(data, fresh);
  return fresh;
}

// A title appears in rows only when at least one of its links is currently shown.
function isAvailable(title, data, now) {
  return snapshot(data, now).available.has(title.id);
}

// Filter labels a title answers to: its genres, languages, decade, category and access.
function filterLabels(title, data, now) {
  const cache = snapshot(data, now).labels;
  if (cache.has(title.id)) return cache.get(title.id);
  const labels = [...(title.genres || [])];
  for (const l of title.languages || []) if (LANGUAGES[l]) labels.push(LANGUAGES[l]);
  const decade = decadeOf(title.year);
  if (decade) labels.push(decade);
  labels.push(...accessOptions(title, data, now));
  cache.set(title.id, labels);
  return labels;
}

function rowOptions(row, data, now) {
  const cache = snapshot(data, now).rowOptions;
  if (cache.has(row.id)) return cache.get(row.id);
  const set = new Set();
  for (const t of data.titles) {
    if (t.type !== row.type || t.category === 'test' || !row.match(t)) continue;
    if (!isAvailable(t, data, now)) continue;
    for (const label of filterLabels(t, data, now)) set.add(label);
  }
  const options = [...set].sort();
  cache.set(row.id, options);
  return options;
}

function manifestCatalogs(data, now = Date.now(), { diagnostics = false } = {}) {
  const catalogs = ROWS.map((row) => ({
    type: row.type,
    id: row.id,
    name: row.name,
    extra: [
      { name: 'genre', options: rowOptions(row, data, now), isRequired: false },
      { name: 'skip', isRequired: false },
    ],
  }));
  catalogs.push(
    { type: 'movie', id: 'snaija-search', name: 'Select Naija', extra: [{ name: 'search', isRequired: true }] },
    { type: 'series', id: 'snaija-search', name: 'Select Naija', extra: [{ name: 'search', isRequired: true }] },
  );
  if (diagnostics) {
    catalogs.push({ type: 'movie', id: 'snaija-diagnostics', name: 'Select Naija diagnostics', extra: [] });
  }
  return catalogs;
}

function posterFor(title) {
  if (title.poster) return title.poster;
  const text = encodeURIComponent(`${title.name}${title.year ? `\n(${title.year})` : ''}`);
  return `https://placehold.co/300x450/1b5e20/ffffff/png?font=roboto&text=${text}`;
}

function toPreview(title) {
  return {
    id: title.id,
    type: title.type,
    name: title.name,
    poster: posterFor(title),
    posterShape: title.posterShape || 'poster',
    releaseInfo: title.year ? String(title.year) : undefined,
    genres: title.genres || [],
    description: title.description || undefined,
  };
}

function searchScore(title, query) {
  const q = normalize(query);
  if (!q) return 0;
  const names = [title.name, title.originalName, ...(title.aliases || [])].filter(Boolean).map(normalize);
  let best = 0;
  for (const n of names) {
    if (n === q) best = Math.max(best, 100);
    else if (n.startsWith(q)) best = Math.max(best, 80);
    else if (` ${n} `.includes(` ${q} `)) best = Math.max(best, 60);
    else if (q.split(' ').every((w) => n.includes(w))) best = Math.max(best, 40);
  }
  const people = [...(title.cast || []), ...(title.director || [])].map(normalize);
  if (best === 0 && people.some((p) => p.includes(q))) best = 30;
  return best;
}

/**
 * Answers a catalogue request. extra = { genre, search, skip }.
 * Rows list only titles with a shown link; search finds every catalogued title that has one.
 */
function queryCatalog(type, id, extra, data, now = Date.now()) {
  const skip = Math.max(0, parseInt(extra.skip, 10) || 0);

  if (id === 'snaija-search') {
    if (!extra.search) return [];
    return data.titles
      .filter((t) => t.type === type && t.category !== 'test' && isAvailable(t, data, now))
      .map((t) => ({ t, score: searchScore(t, extra.search) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.t.year || 0) - (a.t.year || 0))
      .slice(skip, skip + PAGE_SIZE)
      .map((x) => toPreview(x.t));
  }

  if (id === 'snaija-diagnostics') {
    return data.titles.filter((t) => t.category === 'test' && t.type === type).map(toPreview);
  }

  const row = ROWS.find((r) => r.id === id && r.type === type);
  if (!row) return [];
  const snap = snapshot(data, now);
  const key = `${row.id}|${extra.genre || ''}`;
  let list = snap.sorted.get(key);
  if (!list) {
    list = data.titles.filter((t) => t.type === type && t.category !== 'test' && row.match(t) && isAvailable(t, data, now));
    if (extra.genre) list = list.filter((t) => filterLabels(t, data, now).includes(extra.genre));
    list.sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name));
    snap.sorted.set(key, list);
  }
  return list.slice(skip, skip + PAGE_SIZE).map(toPreview);
}

function metaFor(id, data) {
  const t = data.byId.get(id);
  if (!t) return null;
  const meta = {
    ...toPreview(t),
    background: t.background || undefined,
    runtime: t.runtime || undefined,
    language: (t.languages || []).map((l) => LANGUAGES[l] || l).join(', ') || undefined,
    cast: t.cast || undefined,
    director: t.director || undefined,
    country: t.country || undefined,
  };
  if (t.type === 'series') {
    meta.videos = (t.videos || []).map((v) => ({
      id: `${t.id}:${v.season}:${v.episode}`,
      title: v.title || `Episode ${v.episode}`,
      season: v.season,
      episode: v.episode,
      released: v.released || undefined,
    }));
  }
  return meta;
}

module.exports = { ROWS, manifestCatalogs, queryCatalog, metaFor, isAvailable, linksForTitle, searchScore, PAGE_SIZE };
