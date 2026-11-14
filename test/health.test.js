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
    channelName: source, uploadedAt: t, parts: parts.map((v, i) => ({ part: i + 1, videoId: v, minutes: 60 })) });
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
  assert.match(streams[1].title, /not yet play-tested/);
  assert.match(streams[0].name, /HD/);
  const blocked = setup({ a1: ok, a2: ok, b1: applyPlayback(ok, { result: 'error', code: 101 }, hoursAgo(1)) });
  assert.deepStrictEqual((await buildStreams('movie', 'snaija-yt-a', blocked, { now: NOW })).map((s) => s.ytId), ['a1', 'a2']);
});
