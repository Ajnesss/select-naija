'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { checkExternal, checkDirect, applyResult, scoreProvider } = require('../src/verifier');
const { linkState } = require('../src/states');
const { NOW, hoursAgo, fakeResponse } = require('./helpers');

const tubi = { id: 'tubi', unavailableMarkers: ['content unavailable', 'remind me'] };
const link = { id: 'tubi:1', url: 'https://tubitv.com/x', expectTitle: 'Buddy Goes to Nollywood' };

test('external: page with the right title passes', async () => {
  const fetchImpl = async () => fakeResponse({ body: '<title>Buddy Goes to Nollywood | Tubi</title>', url: 'https://tubitv.com/x' });
  assert.deepEqual(await checkExternal(link, tubi, { fetchImpl }), { ok: true, finalUrl: 'https://tubitv.com/x' });
});

test('external: "Content unavailable" fails even though the page loads (real Tubi case, 10 Nov 2026)', async () => {
  const fetchImpl = async () => fakeResponse({ body: '<h1>BUDDY GOES TO NOLLYWOOD</h1><span>CONTENT UNAVAILABLE</span>' });
  const r = await checkExternal(link, tubi, { fetchImpl });
  assert.equal(r.ok, false);
  assert.match(r.reason, /^unavailable:/);
});

test('external: wrong title, HTTP errors and timeouts fail', async () => {
  const wrong = async () => fakeResponse({ body: '<title>Some Other Film</title>' });
  assert.equal((await checkExternal(link, tubi, { fetchImpl: wrong })).reason, 'title_not_on_page');
  const gone = async () => fakeResponse({ status: 404 });
  assert.equal((await checkExternal(link, tubi, { fetchImpl: gone })).reason, 'http_404');
  const slow = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
  assert.equal((await checkExternal(link, tubi, { fetchImpl: slow })).reason, 'timeout');
});

test('direct: real video passes and records the address after redirects', async () => {
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom')]);
  const fetchImpl = async () => fakeResponse({ status: 206, bytes: mp4, contentType: 'application/octet-stream', url: 'https://ia800.us.archive.org/f.mp4' });
  assert.deepEqual(await checkDirect({ url: 'https://archive.org/download/f.mp4' }, { fetchImpl }), {
    ok: true,
    finalUrl: 'https://ia800.us.archive.org/f.mp4',
  });
});

test('direct: an HTML page is not a video', async () => {
  const fetchImpl = async () => fakeResponse({ body: '<html>login</html>', contentType: 'text/html' });
  assert.equal((await checkDirect({ url: 'https://a/f.mp4' }, { fetchImpl })).reason, 'not_a_video');
});

test('applyResult: two failures in a row make a link failing; history is capped', () => {
  let r;
  r = applyResult(r, { ok: true, finalUrl: 'https://f' }, NOW - 3000);
  r = applyResult(r, { ok: false, reason: 'http_404' }, NOW - 2000);
  assert.equal(linkState(r, NOW), 'verified');
  r = applyResult(r, { ok: false, reason: 'http_404' }, NOW - 1000);
  assert.equal(linkState(r, NOW), 'failing');
  assert.equal(r.finalUrl, 'https://f');
  for (let i = 0; i < 100; i++) r = applyResult(r, { ok: true }, NOW);
  assert.equal(r.checks.length, 60);
});

test('provider score weights reliability 60%, accuracy 30%, freshness 10%', () => {
  const records = [
    { lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(1), ok: true }, { at: hoursAgo(25), ok: true }] },
    { lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(1), ok: false }, { at: hoursAgo(25), ok: true }] },
  ];
  const s = scoreProvider(records, { sampled: 20, correct: 18 }, NOW);
  assert.deepEqual(s, { score: Math.round(0.6 * 75 + 0.3 * 90 + 0.1 * 100), reliability30d: 75, accuracy: 90, freshness: 100, checks30d: 4 });
  assert.equal(scoreProvider([], null, NOW), null);
  const old = [{ lastCheck: hoursAgo(24 * 40), checks: [{ at: hoursAgo(24 * 40), ok: true }] }];
  assert.equal(scoreProvider(old, null, NOW), null, 'checks older than 30 days do not count');
});

test('confirmUk: JustWatch UK data decides for tracked providers, otherwise page-only', async () => {
  const { confirmUk } = require('../src/verifier');
  const pass = { ok: true, finalUrl: 'https://x' };
  const tubi = { id: 'tubi', justwatchTracked: true };
  const kava = { id: 'kava' };
  const link = { titleId: 'tt1', provider: 'tubi' };
  const listed = async () => ({ known: true, providers: new Set(['tubi']) });
  const notListed = async () => ({ known: true, providers: new Set(['netflix']) });
  const unknown = async () => ({ known: false, reason: 'tmdb_error' });
  assert.equal((await confirmUk(pass, link, tubi, {}, listed)).ukSignal, 'justwatch');
  assert.equal((await confirmUk(pass, link, tubi, {}, notListed)).reason, 'not_in_uk:justwatch');
  assert.equal((await confirmUk(pass, link, tubi, {}, unknown)).ukSignal, 'page-only');
  assert.equal((await confirmUk(pass, { ...link, provider: 'kava' }, kava, {}, notListed)).ukSignal, 'page-only');
  const fail = { ok: false, reason: 'http_404' };
  assert.equal(await confirmUk(fail, link, tubi, {}, listed), fail);
});

test('ukProvidersFor never reads a TMDB failure as "not in the UK"', async () => {
  const { ukProvidersFor } = require('../src/resolvers/tmdb');
  assert.equal((await ukProvidersFor('tt1', 'movie', {})).known, false);
  assert.equal((await ukProvidersFor('snaija-x-2020', 'movie', { apiKey: 'k' })).known, false);
  const down = async () => { throw new Error('down'); };
  assert.deepEqual(await ukProvidersFor('tt1', 'movie', { apiKey: 'k', fetchImpl: down }), { known: false, reason: 'tmdb_error' });
  const ok = async (url) => fakeResponse({ body: JSON.stringify(url.includes('/find/') ? { movie_results: [{ id: 7 }] } : { results: { GB: { ads: [{ provider_name: 'Tubi TV' }] } } }) });
  const r = await ukProvidersFor('tt1', 'movie', { apiKey: 'k', fetchImpl: ok });
  assert.ok(r.known && r.providers.has('tubi') && !r.providers.has('plex'));
  const noGb = async (url) => fakeResponse({ body: JSON.stringify(url.includes('/find/') ? { movie_results: [{ id: 7 }] } : { results: { US: {} } }) });
  const r2 = await ukProvidersFor('tt1', 'movie', { apiKey: 'k', fetchImpl: noGb });
  assert.deepEqual(r2, { known: false, reason: 'no_uk_data' });
});
