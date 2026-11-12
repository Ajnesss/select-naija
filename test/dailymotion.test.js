'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseTitle, buildTitles, ukAllowed } = require('../scripts/discover-dailymotion');
const { loadData } = require('../src/data');
const { queryCatalog, metaFor } = require('../src/catalog');
const { buildStreams } = require('../src/streams');
const { NOW, hoursAgo, writeData, baseData } = require('./helpers');

test('upload titles are split into film name, part, year and cast', () => {
  assert.deepEqual(parseTitle('ANGER OF IMMORTALS 4 - 2018 LATEST NIGERIAN NOLLYWOOD MOVIES || TRENDING'), {
    name: 'Anger of Immortals', part: 4, year: 2018, cast: [],
  });
  assert.deepEqual(parseTitle('Gucci Girls - Latest Blockbuster Yoruba Movie 2018 Starring Mercy Aigbe, Doris Simeon'), {
    name: 'Gucci Girls', part: null, year: 2018, cast: ['Mercy Aigbe', 'Doris Simeon'],
  });
  assert.equal(parseTitle("MY SISTER'S PAIN 2 - LATEST NIGERIAN NOLLYWOOD MOVIES").name, "My Sister's Pain");
});

test('UK availability follows Dailymotion geoblocking', () => {
  assert.ok(ukAllowed(['allow']));
  assert.ok(ukAllowed(['deny', 'vn']));
  assert.ok(!ukAllowed(['deny', 'gb']));
  assert.ok(ukAllowed(['allow', 'gb', 'ng']));
  assert.ok(!ukAllowed(['allow', 'ng']));
});

test('videos group into films with ordered parts; trailers, shorts, private and UK-blocked videos are dropped', () => {
  const v = (id, title, minutes, extra = {}) => ({ id, title, duration: minutes * 60, created_time: 1500000000, geoblocking: ['allow'], status: 'published', ...extra });
  const titles = buildTitles({ user: 'c', name: 'C', languages: ['en'] }, [
    v('a2', 'ANGER OF IMMORTAL 2 - 2018 LATEST NIGERIAN NOLLYWOOD MOVIES', 38),
    v('a1', 'ANGER OF IMMORTALS 1 - 2018 LATEST NIGERIAN NOLLYWOOD MOVIES', 37),
    v('t', 'ANGER OF IMMORTALS 1&2 (OFFICIAL TRAILER) - 2018', 3),
    v('s', 'imelda remix', 25),
    v('p', 'Hidden Film 1 - Nollywood Movie', 60, { private: true }),
    v('g', 'Blocked Film - Nollywood Movie', 60, { geoblocking: ['deny', 'gb'] }),
    v('y', 'Omo Iya Mi - Latest Yoruba Movie 2019', 90),
  ]);
  assert.equal(titles.length, 2);
  const anger = titles.find((t) => t.name.startsWith('Anger'));
  assert.deepEqual(anger.parts.map((p) => p.videoId), ['a1', 'a2']);
  assert.equal(anger.id, 'snaija-dm-anger-of-immortal-2018');
  assert.deepEqual(titles.find((t) => t.name === 'Omo Iya Mi').languages, ['yo']);
});

test('Dailymotion films appear in rows with one link per part, in order', async () => {
  const dir = writeData();
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify({ providers: [...baseData().providers.providers, { id: 'dailymotion', name: 'Dailymotion', access: 'ads' }] }));
  fs.writeFileSync(path.join(dir, 'dailymotion.json'), JSON.stringify({
    generatedAt: hoursAgo(2),
    titles: [{ id: 'snaija-dm-ipe-2018', type: 'movie', name: 'Ipe', year: 2018, languages: ['yo'], posterShape: 'landscape',
      parts: [{ part: 2, videoId: 'x2', minutes: 60 }, { part: 1, videoId: 'x1', minutes: 62 }] }],
  }));
  const data = loadData(dir, { now: NOW, freeOnly: true });
  const ipe = queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).find((m) => m.id === 'snaija-dm-ipe-2018');
  assert.equal(ipe.posterShape, 'landscape');
  const streams = await buildStreams('movie', 'snaija-dm-ipe-2018', data, { now: NOW });
  assert.deepEqual(streams.map((s) => s.externalUrl), ['https://www.dailymotion.com/video/x1', 'https://www.dailymotion.com/video/x2']);
  assert.match(streams[0].title, /Part 1 of 2 \(62 min\)/);
});

test('in-app only: external links are never shown, and titles without an in-app stream leave the rows', async () => {
  const data = loadData(writeData(), { now: NOW, freeOnly: false, inAppOnly: true });
  const streams = await buildStreams('movie', 'tt0000001', data, { now: NOW, tmdbApiKey: 'k', fetchImpl: async () => { throw new Error('no TMDB in in-app mode'); } });
  assert.deepEqual(streams.map((s) => s.url), ['https://ia800.example/osun.mp4']);
  assert.ok(streams.every((s) => !s.externalUrl));
  assert.ok(!queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'snaija-iyalode-2025')); // Kava only
});

test('owner-authorised Dailymotion channel: parts play in Nuvio through the owner\'s API key; nothing without it', async () => {
  const { clearDailymotionCache } = require('../src/resolvers/dailymotion');
  const dir = writeData();
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify({ providers: [...baseData().providers.providers, { id: 'dailymotion', name: 'Dailymotion', access: 'ads' }] }));
  fs.writeFileSync(path.join(dir, 'channels.json'), JSON.stringify({ channels: [{ platform: 'dailymotion', user: 'owner1', ownerAuthorised: true, credentialsEnv: 'DM_OWNER1' }] }));
  fs.writeFileSync(path.join(dir, 'dailymotion.json'), JSON.stringify({ generatedAt: hoursAgo(2), titles: [
    { id: 'snaija-dm-ipe-2018', type: 'movie', name: 'Ipe', year: 2018, languages: ['yo'], channel: 'owner1', parts: [{ part: 1, videoId: 'x1', minutes: 60 }, { part: 2, videoId: 'x2', minutes: 58 }] },
  ] }));
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    if (url.endsWith('/oauth/v1/token')) {
      assert.match(String(opts.body), /grant_type=client_credentials/);
      return { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) };
    }
    assert.match(url, /no_expire=1&no_ip_lock=1/);
    const id = url.match(/video\/(\w+)/)[1];
    return { ok: true, json: async () => ({ stream_hls_url: `https://dm.example/${id}.m3u8` }) };
  };
  clearDailymotionCache();
  const noKey = loadData(dir, { now: NOW, inAppOnly: true, env: {} });
  assert.deepEqual(await buildStreams('movie', 'snaija-dm-ipe-2018', noKey, { now: NOW, fetchImpl }), []);
  assert.equal(calls.length, 0);
  const env = { DM_OWNER1_CLIENT_ID: 'id', DM_OWNER1_CLIENT_SECRET: 'secret' };
  const data = loadData(dir, { now: NOW, inAppOnly: true, env });
  const streams = await buildStreams('movie', 'snaija-dm-ipe-2018', data, { now: NOW, fetchImpl, env });
  assert.deepEqual(streams.map((s) => s.url), ['https://dm.example/x1.m3u8', 'https://dm.example/x2.m3u8']);
  assert.match(streams[0].title, /Part 1 of 2/);
  assert.ok(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'snaija-dm-ipe-2018'));
});

test('YouTube links are handed to the app as ytId streams and count as in-app', async () => {
  const dir = writeData();
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free' });
  d.links.links.push({ id: 'youtube:abc', titleId: 'tt0000002', provider: 'youtube', kind: 'youtube', ytId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  d.status.links['youtube:abc'] = { lastOk: hoursAgo(1), lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(1), ok: true }] };
  for (const [f, v] of [['providers.json', d.providers], ['links.json', d.links], ['status.json', d.status]]) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  const data = loadData(dir, { now: NOW, inAppOnly: true });
  const streams = await buildStreams('movie', 'tt0000002', data, { now: NOW });
  assert.equal(streams.length, 1);
  assert.equal(streams[0].ytId, 'abcdefghijk');
  assert.ok(!streams[0].externalUrl && !streams[0].url);
});

test('YouTube channel films join the catalogue with one ytId stream per part', async () => {
  const dir = writeData();
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free' }, { id: 'dailymotion', name: 'Dailymotion', access: 'ads' });
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(d.providers));
  fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ generatedAt: hoursAgo(3), titles: [
    { id: 'snaija-yt-koleoso-2025', type: 'movie', name: 'Koleoso', year: 2025, languages: ['yo'], channel: 'UCx', parts: [{ part: 1, videoId: 'aaaaaaaaaaa', minutes: 90 }, { part: 2, videoId: 'bbbbbbbbbbb', minutes: 80 }] },
  ] }));
  const data = loadData(dir, { now: NOW, inAppOnly: true });
  assert.ok(queryCatalog('movie', 'snaija-yoruba', {}, data, NOW).some((m) => m.id === 'snaija-yt-koleoso-2025'));
  const streams = await buildStreams('movie', 'snaija-yt-koleoso-2025', data, { now: NOW });
  assert.deepEqual(streams.map((s) => s.ytId), ['aaaaaaaaaaa', 'bbbbbbbbbbb']);
  assert.match(streams[0].title, /Part 1 of 2/);
});

test('series episodes group into a series with per-episode streams', async () => {
  const v = (id, title, minutes) => ({ id, title, duration: minutes * 60, created_time: 1700000000, geoblocking: ['allow'], status: 'published' });
  const titles = buildTitles({ user: 'c', name: 'C', languages: ['en', 'yo'], platform: 'youtube' }, [
    v('e1', 'Aiyetoro Town Season 2 Episode 19 - Busted', 30),
    v('e2', 'Aiyetoro Town Season 2 Episode 20 - Caught', 31),
    v('f1', 'Ikemba (Season 1){trending', 60),
    v('f2', 'Ikemba (Season 2){trending', 62),
  ], { idPrefix: 'snaija-yt' });
  const show = titles.find((t) => t.type === 'series');
  assert.deepEqual(show.episodes.map((e) => [e.season, e.episode, e.videoId]), [[2, 19, 'e1'], [2, 20, 'e2']]);
  const film = titles.find((t) => t.type === 'movie');
  assert.equal(film.name, 'Ikemba');
  assert.deepEqual(film.parts.map((p) => p.videoId), ['f1', 'f2']);

  const dir = writeData();
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free' }, { id: 'dailymotion', name: 'Dailymotion', access: 'ads' });
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(d.providers));
  fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ generatedAt: hoursAgo(1), titles }));
  const data = loadData(dir, { now: NOW, inAppOnly: true });
  const ep = await buildStreams('series', `${show.id}:2:20`, data, { now: NOW });
  assert.deepEqual(ep.map((s) => s.ytId), ['e2']);
  assert.ok(queryCatalog('series', 'snaija-series', {}, data, NOW).some((m) => m.id === show.id));
});

test('episodes without a season, name variants and numbered parts all land in one series', () => {
  const v = (id, title, minutes = 30) => ({ id, title, duration: minutes * 60, created_time: 1700000000, geoblocking: ['allow'], status: 'published' });
  const titles = buildTitles({ user: 'c', name: 'C', languages: ['en'], platform: 'youtube' }, [
    v('a1', 'Aiyetoro Town 1'),
    v('a2', 'Aiyetoro Town 2'),
    v('a3', 'Aiyetoro Town Season 2 Episode 1 - Busted'),
    v('o1', 'Obidike 🎬 Episode 1. @frederickleonardtv'),
    v('o2', 'Obidike Episode 2. @frederickleonardtv'),
    v('j1', "Jenifa's Diary Season 3 Episode 1"),
    v('j2', 'Jenifas Diary Season 3 Episode 2'),
  ], { idPrefix: 'snaija-yt' });
  const byName = Object.fromEntries(titles.map((t) => [t.name, t]));
  assert.deepEqual(byName['Aiyetoro Town'].episodes.map((e) => [e.season, e.episode]), [[1, 1], [1, 2], [2, 1]]);
  assert.equal(byName.Obidike.type, 'series');
  assert.equal(byName.Obidike.episodes.length, 2);
  assert.equal(titles.filter((t) => /jenifa/i.test(t.name)).length, 1);
  assert.equal(titles.length, 3);
});

test('the same film from several channels becomes one title with every stream; old IDs still work', async () => {
  const dir = writeData();
  const d = baseData();
  d.providers.providers.push({ id: 'youtube', name: 'YouTube', access: 'free' }, { id: 'dailymotion', name: 'Dailymotion', access: 'ads' });
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(d.providers));
  const film = (id, channelName, year, vid) => ({ id, type: 'movie', name: 'Ikemba', year, languages: ['en'], channel: channelName, channelName, parts: [{ part: 1, videoId: vid, minutes: 90 }] });
  fs.writeFileSync(path.join(dir, 'youtube.json'), JSON.stringify({ generatedAt: hoursAgo(1), titles: [
    film('snaija-yt-ikemba-2023', 'BTAtv', 2023, 'aaaaaaaaaaa'),
    film('snaija-yt-ikemba-2024', 'RealnollyTV', 2024, 'bbbbbbbbbbb'),
    film('snaija-yt-ikemba-2019', 'Old channel', 2019, 'ccccccccccc'),
  ] }));
  const data = loadData(dir, { now: NOW, inAppOnly: true });
  const rows = queryCatalog('movie', 'snaija-english', {}, data, NOW).filter((m) => m.name === 'Ikemba');
  assert.equal(rows.length, 2); // 2023+2024 merged, 2019 is a different film
  const kept = rows.find((m) => m.id !== 'snaija-yt-ikemba-2019').id;
  const streams = await buildStreams('movie', kept, data, { now: NOW });
  assert.equal(streams.length, 2);
  assert.ok(streams.some((s) => /BTAtv/.test(s.title)) && streams.some((s) => /RealnollyTV/.test(s.title)));
  const other = kept === 'snaija-yt-ikemba-2023' ? 'snaija-yt-ikemba-2024' : 'snaija-yt-ikemba-2023';
  assert.equal((await buildStreams('movie', other, data, { now: NOW })).length, 2);
  assert.equal(metaFor(other, data).id, kept);
});

test('TMDB matching accepts only the same Nigerian title in a fitting year', async () => {
  const { findMatch } = require('../scripts/match-tmdb');
  const lookup = async (p) => {
    if (p.startsWith('/search/')) return { results: [
      { id: 1, title: 'Ikemba', original_language: 'en' },
      { id: 2, title: 'Ikemba', original_language: 'en' },
      { id: 3, title: 'Ikemba Returns', original_language: 'en' },
    ] };
    if (p.startsWith('/movie/1')) return { id: 1, release_date: '2010-01-01', production_countries: [{ iso_3166_1: 'US' }] };
    return { id: 2, release_date: '2022-05-01', production_countries: [{ iso_3166_1: 'NG' }], poster_path: '/p.jpg', genres: [{ name: 'Drama' }], external_ids: { imdb_id: 'tt123' } };
  };
  const m = await findMatch({ type: 'movie', name: 'Ikemba', year: 2023, yearIsUpload: true }, 'k', lookup);
  assert.equal(m.tmdbId, 2);
  assert.equal(m.year, 2022);
  assert.equal(m.imdbId, 'tt123');
  assert.equal(await findMatch({ type: 'movie', name: 'Ikemba', year: 2015, yearIsUpload: false }, 'k', lookup), null);
});
