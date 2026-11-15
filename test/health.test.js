'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { NOW, hoursAgo, baseData, writeData } = require('./helpers');
const { loadData } = require('../src/data');
const { buildStreams } = require('../src/streams');
const { queryCatalog } = require('../src/catalog');
const { classify, applyApi } = require('../scripts/check-youtube');
const { applyPlayback, queue } = require('../scripts/check-youtube-playback');

const OK_ITEM = { status: { privacyStatus: 'public', uploadStatus: 'processed', embeddable: true }, contentDetails: { duration: 'PT1H2M', definition: 'hd' } };

function setup(health) {
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free', unavailableMarkers: [] });
  const dir = writeData(d);
  const film = (id, name, source, parts, t) => ({ id, type: 'movie', name, year: 2026, languages: ['en'], genres: ['Drama'], category: 'film',
    channelName: source, uploadedAt: t, parts: parts.map((v, i) => ({ part: i + 1, videoId: v, minutes: 120 / parts.length })) });
  fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ generatedAt: hoursAgo(1), titles: [
    film('snaija-yt-a', 'Alpha', 'Channel One', ['a1', 'a2'], hoursAgo(5)),
    film('snaija-yt-a2', 'Alpha', 'Channel Two', ['b1'], hoursAgo(6)),
    film('snaija-yt-gone', 'Gone Film', 'Channel One', ['g1'], hoursAgo(7)),
  ] }));
  fs.writeFileSync(path.join(dir, 'youtube-health.json'), JSON.stringify({ videos: health }));
  return loadData(dir, { now: NOW, freeOnly: false, inAppOnly: true });
}

test('API classification covers every reason a YouTube stream cannot play', () => {
  assert.strictEqual(classify(null).api, 'gone');
  assert.strictEqual(classify(OK_ITEM).api, 'ok');
  assert.strictEqual(classify({ ...OK_ITEM, status: { ...OK_ITEM.status, embeddable: false } }).api, 'no-embed');
  assert.strictEqual(classify({ ...OK_ITEM, contentDetails: { regionRestriction: { allowed: ['NG'] } } }).api, 'region');
  assert.strictEqual(classify({ ...OK_ITEM, status: { ...OK_ITEM.status, uploadStatus: 'uploaded' } }).api, 'processing');
});

test('a failing video is kept, hidden, and restored when it passes again', () => {
  let rec = applyApi({}, OK_ITEM, hoursAgo(48));
  rec = applyApi(rec, null, hoursAgo(24));
  assert.strictEqual(rec.api, 'gone');
  assert.strictEqual(rec.lastOkAt, hoursAgo(48));
  let data = setup({ g1: rec });
  assert.deepStrictEqual(queryCatalog('movie', 'snaija-search', { search: 'gone film' }, data, NOW), []);
  rec = applyApi(rec, OK_ITEM, hoursAgo(1));
  data = setup({ g1: rec });
  assert.strictEqual(queryCatalog('movie', 'snaija-search', { search: 'gone film' }, data, NOW).length, 1);
});

test('playback results are separate from API status; only video faults count as failures', () => {
  const base = applyApi({}, OK_ITEM, hoursAgo(1));
  assert.strictEqual(applyPlayback(base, { result: 'played' }, hoursAgo(1)).playback.result, 'played');
  assert.strictEqual(applyPlayback(base, { result: 'error', code: 150 }, hoursAgo(1)).playback.result, 'failed');
  assert.strictEqual(applyPlayback(base, { result: 'error', code: 5 }, hoursAgo(1)).playback.result, 'inconclusive');
  assert.strictEqual(applyPlayback(base, { result: 'timeout' }, hoursAgo(1)).playback.result, 'inconclusive');
  const order = queue({ x: { ...base, playback: { result: 'played', at: hoursAgo(1) } }, y: base, z: { ...base, api: 'gone' } });
  assert.deepStrictEqual(order, ['y', 'x']);
});

test('streams: confirmed-playing source first, its parts kept together; failed playback hidden', async () => {
  const ok = applyApi({}, OK_ITEM, hoursAgo(2));
  const played = applyPlayback(ok, { result: 'played' }, hoursAgo(2));
  const data = setup({ a1: ok, a2: ok, b1: played });
  const streams = await buildStreams('movie', 'snaija-yt-a', data, { now: NOW });
  assert.deepStrictEqual(streams.map((s) => s.ytId), ['b1', 'a1', 'a2']);
  assert.match(streams[0].title, /played in YouTube's player/);
  assert.match(streams[1].title, /available on YouTube in the UK/);
  assert.match(streams[0].name, /HD/);
  const blocked = setup({ a1: ok, a2: ok, b1: applyPlayback(ok, { result: 'error', code: 101 }, hoursAgo(1)) });
  assert.deepStrictEqual((await buildStreams('movie', 'snaija-yt-a', blocked, { now: NOW })).map((s) => s.ytId), ['a1', 'a2']);
});

test('same-named films merge only when their running times match', () => {
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free', unavailableMarkers: [] });
  const dir = writeData(d);
  const f = (id, ch, year, minutes, cast = []) => ({ id, type: 'movie', name: 'Dark Secret', year, languages: ['en'], channelName: ch, cast, parts: [{ part: 1, videoId: id.slice(-11), minutes }] });
  fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ generatedAt: hoursAgo(1), titles: [
    f('snaija-yt-x-aaaaaaaaaaa', 'Omoni Oboli TV', 2024, 102),
    f('snaija-yt-x-bbbbbbbbbbb', 'Nigerian Movies Plus', 2025, 162),
    f('snaija-yt-x-ccccccccccc', 'Rockcelly', 2023, 162),
    f('snaija-yt-x-ddddddddddd', 'Another', 2024, 118, ['Ada Ameh']),
    f('snaija-yt-x-eeeeeeeeeee', 'Omoni Oboli TV 2', 2026, 107, ['Ada Ameh']),
  ] }));
  const data = loadData(dir, { now: NOW, inAppOnly: true });
  const rows = queryCatalog('movie', 'snaija-search', { search: 'dark secret' }, data, NOW);
  // 102 ≈ 107 (within 5%) → one film; 162 = 162 across years → one film; 118 shares cast with 107 but is 10% off and
  // 107 already belongs to the 102-minute film, so: {102,107,118?}. Expect at most 3 rows and never 102 with 162.
  const merged = [...data.alias.entries()];
  assert.ok(merged.every(([a, b]) => !((a.endsWith('bbbbbbbbbbb') || a.endsWith('ccccccccccc')) && b.endsWith('aaaaaaaaaaa'))));
  assert.ok(merged.some(([a, b]) => [a, b].some((x) => x.endsWith('bbbbbbbbbbb')) && [a, b].some((x) => x.endsWith('ccccccccccc'))));
  assert.ok(rows.length >= 2 && rows.length <= 3);
});

test('YouTube-app setting and the always-present YouTube-app fallback', async () => {
  const ok = applyApi({}, OK_ITEM, hoursAgo(2));
  const data = setup({ a1: ok, a2: ok, b1: ok });
  const inApp = await buildStreams('movie', 'snaija-yt-a', data, { now: NOW, fallback: true });
  const ext = inApp.filter((s) => s.externalUrl);
  assert.ok(inApp.filter((s) => s.ytId).length === 3 && ext.length >= 1);
  assert.ok(ext.every((s) => /youtube\.com\/watch\?v=/.test(s.externalUrl) && /Fallback/.test(s.title)));
  assert.strictEqual(inApp.findIndex((s) => s.externalUrl), 3); // fallbacks come after every in-app option
  const app = await buildStreams('movie', 'snaija-yt-a', data, { now: NOW, fallback: true, youtube: 'app' });
  assert.ok(app.length === 3 && app.every((s) => !s.ytId && /youtube\.com\/watch/.test(s.externalUrl) && /Watch on YouTube/.test(s.title)));
});
