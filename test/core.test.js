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
  const data = loadData(dir);
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
