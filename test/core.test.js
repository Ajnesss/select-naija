'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, containsPhrase } = require('../src/text');
const { linkState } = require('../src/states');
const { loadData } = require('../src/data');
const { queryCatalog, manifestCatalogs, metaFor } = require('../src/catalog');
const { buildStreams } = require('../src/streams');
const { clearCache } = require('../src/resolvers/tmdb');
const { NOW, hoursAgo, writeData, baseData, fakeResponse } = require('./helpers');

test('normalize strips Yoruba diacritics and punctuation', () => {
  assert.equal(normalize('Ọ̀ṣun Sẹ̀ẹ̀gẹ̀sí!'), 'osun seegesi');
  assert.ok(containsPhrase('<h1>Watch Ọ̀ṣun Sẹ̀ẹ̀gẹ̀sí now</h1>', 'Osun Seegesi'));
  assert.ok(!containsPhrase('Osunlade', 'Osun'));
});

test('link states: verified, stale, failing, unverified', () => {
  assert.equal(linkState(undefined, NOW), 'unverified');
  assert.equal(linkState({ lastOk: hoursAgo(1), checks: [{ ok: true }] }, NOW), 'verified');
  assert.equal(linkState({ lastOk: hoursAgo(24 * 8), checks: [{ ok: true }] }, NOW), 'stale');
  assert.equal(linkState({ lastOk: hoursAgo(1), checks: [{ ok: true }, { ok: false }, { ok: false }] }, NOW), 'failing');
  assert.equal(linkState({ lastOk: null, checks: [{ ok: false }] }, NOW), 'unverified');
});

test('data loader rejects duplicate ids and unknown providers', () => {
  const dup = baseData().catalogue;
  dup.titles.push({ ...dup.titles[0] });
  assert.throws(() => loadData(writeData({ catalogue: dup })), /Duplicate/);
  const badLinks = { links: [{ id: 'x', titleId: 'tt0000001', provider: 'nope', kind: 'external', url: 'https://a' }] };
  assert.throws(() => loadData(writeData({ links: badLinks })), /unknown provider/);
});

test('rows list only titles with a shown link, newest first, and never test titles', () => {
  const data = loadData(writeData());
  const yoruba = queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).map((m) => m.id);
  assert.deepEqual(yoruba, ['snaija-iyalode-2025', 'tt0000001']);
  // Living in Bondage: its only link is failing → hidden. No Links Yet: link never verified → hidden.
  assert.deepEqual(queryCatalog('movie', 'snaija-igbo', {}, data, NOW), []);
  assert.deepEqual(queryCatalog('movie', 'snaija-hausa', {}, data, NOW), []);
  const english = queryCatalog('movie', 'snaija-english', {}, data, NOW).map((m) => m.id);
  assert.ok(!english.includes('snaija-test-2026'));
});

test('custom-ID titles are first-class: rows, search and detail pages', () => {
  const data = loadData(writeData());
  assert.ok(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'snaija-iyalode-2025'));
  assert.equal(queryCatalog('movie', 'snaija-search', { search: 'iyalode' }, data, NOW)[0].id, 'snaija-iyalode-2025');
  const meta = metaFor('snaija-iyalode-2025', data);
  assert.equal(meta.name, 'Iyalode');
  assert.equal(meta.language, 'Yoruba');
  assert.match(meta.poster, /^https:\/\//);
  const series = metaFor('snaija-dadin-kowa-2015', data);
  assert.deepEqual(series.videos.map((v) => v.id), ['snaija-dadin-kowa-2015:1:1']);
});

test('search ignores diacritics and matches alternative spellings', () => {
  const data = loadData(writeData());
  assert.equal(queryCatalog('movie', 'snaija-search', { search: 'osun' }, data, NOW)[0].id, 'tt0000001');
  assert.equal(queryCatalog('movie', 'snaija-search', { search: 'Ọ̀ṣun' }, data, NOW)[0].id, 'tt0000001');
  assert.deepEqual(queryCatalog('movie', 'snaija-search', { search: 'zzz' }, data, NOW), []);
});

test('filters by genre, language, decade and access', () => {
  const data = loadData(writeData());
  assert.deepEqual(queryCatalog('movie', 'snaija-new', { genre: '2020s' }, data, NOW).map((m) => m.id), ['snaija-iyalode-2025']);
  assert.deepEqual(queryCatalog('movie', 'snaija-new', { genre: 'Free to watch' }, data, NOW).map((m) => m.id), ['tt0000001']);
  const yoRow = manifestCatalogs(data, NOW).find((c) => c.id === 'snaija-yoruba');
  assert.ok(yoRow.extra[0].options.includes('Yoruba'));
  assert.ok(yoRow.extra[0].options.includes('2010s'));
});

test('streams: in-app first with resolved file address, then verified, then stale; failing and unverified hidden', async () => {
  const data = loadData(writeData());
  const streams = await buildStreams('movie', 'tt0000001', data, { now: NOW });
  assert.equal(streams.length, 3);
  assert.equal(streams[0].url, 'https://ia800.example/osun.mp4');
  assert.match(streams[0].title, /plays in Nuvio/);
  assert.equal(streams[1].externalUrl, 'https://kava.example/osun');
  assert.equal(streams[2].externalUrl, 'https://tubi.example/osun');
  assert.match(streams[2].title, /last checked/);
  assert.deepEqual(await buildStreams('movie', 'tt0000002', data, { now: NOW }), []);
  assert.deepEqual(await buildStreams('movie', 'tt0000003', data, { now: NOW }), []);
});

test('streams: providers scoring under 50 are hidden', async () => {
  const d = baseData();
  d.status.providers.kava = { score: 40, checks30d: 25 };
  const data = loadData(writeData({ status: d.status }));
  const streams = await buildStreams('movie', 'tt0000001', data, { now: NOW });
  assert.ok(!streams.some((s) => s.externalUrl === 'https://kava.example/osun'));
});

test('streams: series episodes get the series-level provider link', async () => {
  const data = loadData(writeData());
  const streams = await buildStreams('series', 'snaija-dadin-kowa-2015:1:1', data, { now: NOW });
  assert.equal(streams[0].externalUrl, 'https://arewa.example/dk');
});

test('streams: TMDB offers only for catalogued titles, deduplicated, never throwing', async () => {
  clearCache();
  const data = loadData(writeData());
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('/find/')) return fakeResponse({ body: JSON.stringify({ movie_results: [{ id: 42 }] }) });
    return fakeResponse({
      body: JSON.stringify({
        results: { GB: { link: 'https://www.themoviedb.org/movie/42/watch?locale=GB', flatrate: [{ provider_name: 'Netflix' }, { provider_name: 'Kava' }], ads: [{ provider_name: 'Tubi TV' }] } },
      }),
    });
  };
  const streams = await buildStreams('movie', 'tt0000001', data, { tmdbApiKey: 'k', fetchImpl, now: NOW });
  const tmdb = streams.filter((s) => s.title.includes('JustWatch'));
  assert.deepEqual(tmdb.map((s) => s.name.split('\n')[1]), ['Netflix ↗']); // Kava and Tubi already linked directly
  calls.length = 0;
  assert.deepEqual(await buildStreams('movie', 'tt9999999', data, { tmdbApiKey: 'k', fetchImpl, now: NOW }), []);
  assert.equal(calls.length, 0, 'non-catalogued titles must not trigger TMDB lookups');

  clearCache();
  const broken = async () => { throw new Error('down'); };
  const s2 = await buildStreams('movie', 'tt0000001', data, { tmdbApiKey: 'k', fetchImpl: broken, now: NOW });
  assert.equal(s2.length, 3);
});

test('UK check results are merged with the main results', async () => {
  const fs = require('fs');
  const path = require('path');
  const d = baseData();
  const ukOnly = { 'kava:iyalode': d.status.links['kava:iyalode'] };
  delete d.status.links['kava:iyalode'];
  const dir = writeData({ status: d.status });
  fs.writeFileSync(path.join(dir, 'status-uk.json'), JSON.stringify({ generatedAt: hoursAgo(1), links: ukOnly, providers: { kava: { score: 90 } } }));
  const data = loadData(dir, { now: NOW });
  assert.ok(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'snaija-iyalode-2025'));
  assert.equal(data.status.providers.kava.score, 90);
});

test('a provider with too few checks is not demoted or hidden', async () => {
  const d = baseData();
  d.status.providers.kava = { score: 40, checks30d: 1 };
  const data = loadData(writeData({ status: d.status }));
  const streams = await buildStreams('movie', 'tt0000001', data, { now: NOW });
  assert.ok(streams.some((s) => s.externalUrl === 'https://kava.example/osun'));
});

test('a recent UK check wins over the hands-off result; an old one does not', () => {
  const fs = require('fs');
  const path = require('path');
  const d = baseData();
  d.status.links['kava:osun'].ukSignal = 'justwatch';
  const dir = writeData({ status: d.status });
  const ukFail = (h) => ({ lastCheck: hoursAgo(h), lastOk: null, checks: [{ at: hoursAgo(h), ok: false }, { at: hoursAgo(h), ok: false }] });
  fs.writeFileSync(path.join(dir, 'status-uk.json'), JSON.stringify({ generatedAt: hoursAgo(3), links: { 'kava:osun': ukFail(3) } }));
  assert.equal(linkState(loadData(dir, { now: NOW }).status.links['kava:osun'], NOW), 'unverified');
  fs.writeFileSync(path.join(dir, 'status-uk.json'), JSON.stringify({ generatedAt: hoursAgo(24 * 9), links: { 'kava:osun': ukFail(24 * 9) } }));
  const merged = loadData(dir, { now: NOW }).status.links['kava:osun'];
  assert.equal(linkState(merged, NOW), 'verified');
  assert.equal(merged.ukSignal, 'justwatch');
});

test('streams: links whose UK availability is unconfirmed are labelled and ranked after confirmed ones', async () => {
  const d = baseData();
  d.providers.providers.find((p) => p.id === 'kava').ukCheckRequired = true;
  d.providers.providers.find((p) => p.id === 'tubi').ukCheckRequired = true;
  d.status.links['kava:osun'].ukSignal = 'page-only';
  d.status.links['tubi:osun'] = { ...d.status.links['kava:osun'], ukSignal: 'justwatch' };
  const data = loadData(writeData({ providers: d.providers, status: d.status }), { now: NOW });
  const streams = (await buildStreams('movie', 'tt0000001', data, { now: NOW })).filter((s) => s.externalUrl);
  assert.equal(streams[0].externalUrl, 'https://tubi.example/osun');
  assert.ok(!/not confirmed/.test(streams[0].title));
  assert.match(streams[1].title, /UK availability not confirmed/);
});

test('discovered titles join the catalogue with JustWatch-confirmed links; curated entries win', async () => {
  const fs = require('fs');
  const path = require('path');
  const { toEntry } = require('../scripts/discover');
  const d = baseData();
  d.providers.providers.push(
    { id: 'netflix2', name: 'Netflix', access: 'subscription', tmdbNames: ['Netflix'], openUrl: 'https://www.netflix.com/search?q={q}', titleUrl: 'https://www.netflix.com/title/{id}' },
    { id: 'other', name: 'Other UK service', access: 'subscription' },
  );
  const dir = writeData({ providers: d.providers });
  const detail = (over) => ({
    id: 5, title: 'Jagun Jagun', original_language: 'yo', release_date: '2023-08-10', genres: [{ name: 'Action' }],
    poster_path: '/p.jpg', overview: 'A warrior.', external_ids: { imdb_id: 'tt2000001' },
    'watch/providers': { results: { GB: { link: 'https://tmdb/watch', flatrate: [{ provider_name: 'Netflix', provider_id: 8 }], ads: [{ provider_name: 'Channel 5', provider_id: 99 }], rent: [{ provider_name: 'Apple', provider_id: 2 }] } } },
    ...over,
  });
  const fresh = toEntry('movie', detail({}));
  assert.deepEqual(fresh.offers.map((o) => o.providerName).sort(), ['Channel 5', 'Netflix']); // rental left out
  const dupe = toEntry('movie', detail({ title: 'Osun', external_ids: { imdb_id: 'tt0000001' } }));
  const noUk = toEntry('movie', detail({ 'watch/providers': { results: { US: {} } } }));
  assert.equal(noUk, null);
  const show = toEntry('tv', { id: 9, name: 'Lakatabu', original_language: 'yo', first_air_date: '2024-01-01', seasons: [{ season_number: 0, episode_count: 2 }, { season_number: 1, episode_count: 2 }], 'watch/providers': fresh && detail({})['watch/providers'] });
  assert.equal(show.title.id, 'snaija-tmdb-tv-9');
  assert.deepEqual(show.title.videos, [{ season: 1, episode: 1 }, { season: 1, episode: 2 }]);
  const withId = toEntry('movie', detail({ id: 6, title: 'Aníkúlápó', external_ids: { imdb_id: 'tt2000002' } }));
  withId.serviceIds = { netflix2: '81234567' };
  fs.writeFileSync(path.join(dir, 'discovered.json'), JSON.stringify({ generatedAt: hoursAgo(5), entries: [fresh, dupe, show, withId] }));

  const data = loadData(dir, { now: NOW });
  assert.equal(data.byId.get('tt0000001').name, 'Ọ̀ṣun Sẹ̀ẹ̀gẹ̀sí'); // curated wins
  assert.ok(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'tt2000001'));
  assert.ok(queryCatalog('series', 'snaija-series', {}, data, NOW).some((m) => m.id === 'snaija-tmdb-tv-9'));
  const streams = await buildStreams('movie', 'tt2000001', data, { now: NOW });
  const nf = streams.find((s) => s.externalUrl.includes('netflix'));
  assert.equal(nf.externalUrl, 'https://www.netflix.com/search?q=Jagun%20Jagun');
  assert.match(nf.title, /JustWatch via TMDB/);
  const c5 = streams.find((s) => /Channel 5/.test(s.name));
  assert.equal(c5.externalUrl, 'https://tmdb/watch');
  assert.equal(streams.length, 2);
  const direct = await buildStreams('movie', 'tt2000002', data, { now: NOW });
  assert.ok(direct.some((x) => x.externalUrl === 'https://www.netflix.com/title/81234567'));
  const ep = await buildStreams('series', 'snaija-tmdb-tv-9:1:2', data, { now: NOW });
  assert.equal(ep.length, 2);
  // A week after the last discovery run the links are only stale; they never turn into unverified.
  assert.equal(linkState(data.status.links['jw:netflix2:tt2000001'], NOW + 8 * 864e5), 'stale');
});

test('free only: subscription and rental links are dropped, and titles with nothing free leave the rows', async () => {
  const data = loadData(writeData(), { now: NOW, freeOnly: true });
  const streams = await buildStreams('movie', 'tt0000001', data, { now: NOW });
  assert.ok(!streams.some((s) => s.externalUrl === 'https://kava.example/osun')); // Kava is a subscription
  assert.ok(streams.some((s) => s.externalUrl === 'https://tubi.example/osun')); // Tubi is free
  // Iyalode is only on Kava → gone from the Yoruba row; Osun stays (Tubi, open archive).
  assert.deepEqual(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).map((m) => m.id), ['tt0000001']);
});
