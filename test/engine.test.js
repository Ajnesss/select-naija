'use strict';

require('./helpers');
const test = require('node:test');
const assert = require('node:assert');
const { cleanTitle, detectPart, similarity, scoreMatch, parseId, resolveRequest } = require('../src/engine/matcher');
const { build, finalize, qualityLabel } = require('../src/engine/streamBuilder');
const { createClient, CookieJar, html } = require('../src/engine/http');
const { createEngine } = require('../src/engine');
const archive = require('../src/providers/archive');
const commons = require('../src/providers/commons');

const res = (status, body, headers = {}) => new Response(typeof body === 'string' || body == null ? body : JSON.stringify(body), { status, headers });

test('cleanTitle strips upload noise', () => {
  assert.equal(cleanTitle('Blood Sisters (Nigerian Movie) [Nollywood] Full Movie HD'), 'Blood Sisters');
  assert.equal(cleanTitle('Ajoche - Latest Yoruba Movie 2024 | Ibaka TV'), 'Ajoche');
  assert.equal(cleanTitle('Anikulapo FULL MOVIE'), 'Anikulapo');
});

test('detectPart finds parts, seasons and episodes', () => {
  assert.deepEqual(detectPart('Blood Sisters Part 2 (Nigerian Movie)'), { base: 'Blood Sisters', part: 2, season: null, episode: null });
  assert.equal(detectPart('King of Boys - Part II').part, 2);
  assert.equal(detectPart('Jenifa Part Two').part, 2);
  const e = detectPart('Dadin Kowa S01E05');
  assert.equal(e.season, 1); assert.equal(e.episode, 5); assert.equal(e.base, 'Dadin Kowa');
  assert.equal(detectPart('Shanty Town Season 1 Episode 3').episode, 3);
});

test('similarity ignores accents and punctuation', () => {
  assert.equal(similarity('Ọ̀ṣun Sẹ̀ẹ̀gẹ̀sí', 'Osun Seegesi'), 1);
  assert.ok(similarity('The Wedding Party 2', 'Wedding Party 2') >= 0.85);
  assert.ok(similarity('Blood Sisters', 'Blood Brothers') < 0.85);
});

test('scoreMatch allows ±1 year and rejects other works', () => {
  const want = { name: 'Gangs of Lagos', year: 2023 };
  assert.ok(scoreMatch({ title: 'Gangs of Lagos (Nollywood)', year: 2022 }, want) > 0);
  assert.equal(scoreMatch({ title: 'Gangs of Lagos', year: 2020 }, want), 0);
  assert.equal(scoreMatch({ title: 'Lagos Gangsters Return', year: 2023 }, want), 0);
  assert.ok(scoreMatch({ title: 'Gangs of Lagos', year: 2023 }, want) > scoreMatch({ title: 'Gangs of Lagos', year: 2024 }, want));
});

test('parseId reads IMDb, TMDB and catalogue ids', () => {
  assert.deepEqual(parseId('tt123:1:2'), { kind: 'imdb', id: 'tt123', season: 1, episode: 2 });
  assert.deepEqual(parseId('tmdb:55'), { kind: 'tmdb', id: '55', season: null, episode: null });
  assert.equal(parseId('snaija-x').kind, 'local');
});

test('resolveRequest uses the catalogue first, then Cinemeta', async () => {
  const data = { byId: new Map([['snaija-a', { id: 'snaija-a', name: 'Iyalode', year: 2025, aliases: [] }]]), alias: new Map() };
  const local = await resolveRequest('movie', 'snaija-a', { data, fetchImpl: () => { throw new Error('no network'); } });
  assert.equal(local.name, 'Iyalode');
  const remote = await resolveRequest('movie', 'tt7654321', { data, fetchImpl: async (u) => (assert.match(u, /cinemeta/), res(200, { meta: { name: 'Anikulapo', releaseInfo: '2022' } })) });
  assert.equal(remote.name, 'Anikulapo'); assert.equal(remote.year, 2022);
});

test('streamBuilder labels parts, quality and headers; finalize keeps parts together', () => {
  assert.equal(qualityLabel('film_720p.mp4'), '720p');
  assert.equal(qualityLabel(1080), '1080p');
  const a1 = build({ provider: 'x', providerName: 'X', title: 'Film', url: 'https://a/1.mp4', quality: 480, part: 1, partCount: 2, groupKey: 'g', headers: { Referer: 'https://a/' } });
  const a2 = build({ provider: 'x', providerName: 'X', title: 'Film', url: 'https://a/2.mp4', quality: 480, part: 2, partCount: 2, groupKey: 'g' });
  const b = build({ provider: 'y', providerName: 'Y', title: 'Film', url: 'https://b/f.mp4', quality: 1080, verified: { ok: true, status: 200 } });
  assert.match(a1.title, /Part 1 of 2/);
  assert.match(a1.name, /X 480p/);
  assert.deepEqual(a1.behaviorHints.proxyHeaders.request, { Referer: 'https://a/' });
  assert.deepEqual(a1.headers, { Referer: 'https://a/' });
  const out = finalize([a2, a1, b, { ...b }]);
  assert.deepEqual(out.map((s) => s.url), ['https://b/f.mp4', 'https://a/1.mp4', 'https://a/2.mp4']);
  assert.ok(out.every((s) => !('_sort' in s)));
});

test('http client follows redirects, keeps cookies, retries 503 and records the chain', async () => {
  const calls = [];
  let n503 = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, cookie: opts.headers.Cookie });
    if (url === 'https://s.example/start') return res(302, null, { location: '/next', 'set-cookie': 'sid=abc; Path=/' });
    if (url === 'https://s.example/next') { if (n503++ === 0) return res(503, 'busy'); return res(200, { ok: true }, { 'content-type': 'application/json' }); }
    return res(404, 'no');
  };
  const client = createClient({ baseUrls: ['https://s.example'], fetchImpl, retries: 1 });
  const r = await client.request('/start');
  assert.equal(r.status, 200);
  assert.equal(r.finalUrl, 'https://s.example/next');
  assert.equal(calls.find((c) => c.url.endsWith('/next')).cookie, 'sid=abc');
  await assert.rejects(client.request('/missing'), /HTTP 404/);
});

test('http client falls back to the next base URL', async () => {
  const fetchImpl = async (url) => (url.startsWith('https://old.example') ? Promise.reject(new TypeError('getaddrinfo ENOTFOUND')) : res(200, 'hi'));
  const client = createClient({ baseUrls: ['https://old.example', 'https://new.example'], fetchImpl, retries: 0 });
  assert.equal(await client.getText('/x'), 'hi');
});

test('http client times out', async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const client = createClient({ baseUrls: ['https://slow.example'], fetchImpl, timeoutMs: 30, retries: 0 });
  await assert.rejects(client.getText('/'), /timeout after 30 ms/);
});

test('probe checks media without downloading and falls back to a ranged GET', async () => {
  const fetchImpl = async (url, opts) => {
    if (opts.method === 'HEAD') return res(405, null);
    assert.equal(opts.headers.Range, 'bytes=0-0');
    return res(206, 'x', { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/123456789' });
  };
  const client = createClient({ fetchImpl });
  const p = await client.probe('https://cdn.example/f.mp4');
  assert.equal(p.ok, true); assert.equal(p.status, 206); assert.equal(p.length, 123456789);
});

test('cookie jar scopes cookies to their domain', () => {
  const jar = new CookieJar();
  jar.store('https://a.example.com/', ['x=1; Domain=.example.com', 'y=2']);
  assert.equal(jar.header('https://b.example.com/'), 'x=1');
  assert.equal(jar.header('https://a.example.com/'), 'x=1; y=2');
  assert.equal(jar.header('https://other.org/'), '');
});

test('html helpers parse links, meta and video sources', () => {
  const page = '<meta property="og:title" content="Film &amp; Co"><a href="/f/1">One</a><video src="v.mp4"></video><source src="https://c/v.webm">';
  assert.equal(html.meta(page, 'og:title'), 'Film & Co');
  assert.deepEqual(html.links(page, 'https://s/'), [{ href: 'https://s/f/1', text: 'One' }]);
  assert.deepEqual(html.videoSources(page, 'https://s/p/'), ['https://s/p/v.mp4', 'https://c/v.webm']);
});

function fakeProvider(key, behaviour) {
  return { key, types: ['movie'], resolve: behaviour };
}
const config = {
  engine: { providerTimeoutMs: 80, totalTimeoutMs: 200, failureThreshold: 2, pauseMinutes: 10, negativeCacheMinutes: 30 },
  providers: { fast: { name: 'Fast', enabled: true }, slow: { name: 'Slow', enabled: true }, bad: { name: 'Bad', enabled: true }, off: { name: 'Off', enabled: false } },
};

test('engine runs providers in parallel, isolates slow and failing ones, and skips disabled ones', async () => {
  const engine = createEngine({
    config, env: {},
    providers: [
      fakeProvider('fast', async () => [{ title: 'Film', url: 'https://f/1.mp4', quality: 720 }]),
      fakeProvider('slow', () => new Promise((r) => setTimeout(() => r([{ title: 'Film', url: 'https://s/1.mp4' }]), 500))),
      fakeProvider('bad', async () => { throw new Error('boom'); }),
      fakeProvider('off', async () => [{ title: 'Film', url: 'https://o/1.mp4' }]),
    ],
  });
  assert.deepEqual(engine.providers, ['fast', 'slow', 'bad']);
  const started = Date.now();
  const { streams, reports } = await engine.run({ type: 'movie', name: 'Film', year: 2020 });
  assert.ok(Date.now() - started < 400);
  assert.deepEqual(streams.map((s) => s.url), ['https://f/1.mp4']);
  assert.equal(reports.find((r) => r.provider === 'slow').status, 'error');
  assert.match(reports.find((r) => r.provider === 'slow').error, /timed out/);
  assert.equal(reports.find((r) => r.provider === 'bad').error, 'boom');
});

test('engine pauses a provider after repeated failures and caches results', async () => {
  let calls = 0;
  let t = 1000000;
  const engine = createEngine({
    config, env: {}, now: () => t,
    providers: [fakeProvider('bad', async () => { calls += 1; throw new Error('down'); }), fakeProvider('fast', async () => { calls += 100; return [{ title: 'F', url: 'https://f/x.mp4' }]; })],
  });
  const req = { type: 'movie', name: 'F', year: 2020 };
  await engine.run(req); await engine.run(req); await engine.run(req);
  assert.equal(calls, 2 + 100); // bad: 2 tries then paused; fast: cached after the first run
  assert.equal((await engine.run(req)).reports.find((r) => r.provider === 'bad').status, 'paused');
  t += 11 * 60000;
  await engine.run(req);
  assert.equal(calls, 3 + 100);
});

test('engine respects SELECT_NAIJA_PROVIDERS_DISABLE / _ENABLE', () => {
  const providers = [fakeProvider('fast', async () => []), fakeProvider('off', async () => [])];
  assert.deepEqual(createEngine({ config, env: { SELECT_NAIJA_PROVIDERS_DISABLE: 'fast', SELECT_NAIJA_PROVIDERS_ENABLE: 'off' }, providers }).providers, ['off']);
});

test('archive provider: licensed Nigerian items only, parts in order, download URLs', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/advancedsearch.php')) {
      assert.match(decodeURIComponent(url.replace(/\+/g, ' ')), /licenseurl:\[\* TO \*\]/);
      return res(200, { response: { numFound: 3, docs: [
        { identifier: 'ajani-ogun-1976', title: 'Ajani Ogun', year: '1976', licenseurl: 'http://creativecommons.org/licenses/by-nc/4.0/' },
        { identifier: 'ajani-ogun-rip', title: 'Ajani Ogun', year: '1976', licenseurl: 'http://example.com/all-rights-reserved' },
        { identifier: 'other', title: 'Something Else', year: '1976', licenseurl: 'http://creativecommons.org/publicdomain/mark/1.0/' },
      ] } });
    }
    if (url.includes('/metadata/ajani-ogun-1976')) {
      return res(200, { metadata: {}, files: [
        { name: 'Ajani Ogun Part 2.mpeg', format: 'MPEG2', source: 'original' },
        { name: 'Ajani Ogun Part 2.mp4', format: 'h.264', source: 'derivative', original: 'Ajani Ogun Part 2.mpeg', height: '480', size: '2000' },
        { name: 'Ajani Ogun Part 1.mp4', format: 'h.264', source: 'original', height: '480', size: '1000' },
        { name: 'cover.jpg', format: 'JPEG', source: 'original' },
      ] });
    }
    return res(404, 'x');
  };
  const engine = createEngine({ config: { engine: config.engine, providers: { archive: { name: 'Internet Archive', enabled: true, baseUrls: ['https://archive.org'] } } }, env: {}, providers: [archive], fetchImpl });
  const { streams, reports } = await engine.run({ type: 'movie', name: 'Ajani Ogun', year: 1976, aliases: [] });
  assert.equal(reports[0].matches.length, 1);
  assert.deepEqual(streams.map((s) => s.url), [
    'https://archive.org/download/ajani-ogun-1976/Ajani%20Ogun%20Part%201.mp4',
    'https://archive.org/download/ajani-ogun-1976/Ajani%20Ogun%20Part%202.mp4',
  ]);
  assert.match(streams[0].title, /Part 1 of 2/);
  assert.match(streams[0].title, /CC BY-NC 4\.0/);
});

test('commons provider: Nigerian files only, original MP4 plus best WebM transcode', async () => {
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(url);
    if (u.includes('generator=search')) {
      return res(200, { query: { pages: [
        { title: 'File:Daybreak in Udi (1949).webm', categories: [{ title: 'Category:Films of Nigeria' }], imageinfo: [{ url: 'https://upload.wikimedia.org/a/Daybreak.webm', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Daybreak', mime: 'video/webm', extmetadata: { LicenseShortName: { value: 'Public domain' }, DateTimeOriginal: { value: '1949' }, ObjectName: { value: 'Daybreak in Udi' } } }] },
        { title: 'File:Daybreak in Udi other.webm', categories: [{ title: 'Category:Films of Kenya' }], imageinfo: [{ mime: 'video/webm', extmetadata: {} }] },
      ] } });
    }
    if (u.includes('prop=videoinfo')) {
      return res(200, { query: { pages: [{ videoinfo: [{ url: 'https://upload.wikimedia.org/a/Daybreak.webm', mime: 'video/webm', size: 5000, height: 576, derivatives: [
        { src: 'https://upload.wikimedia.org/t/Daybreak.webm.480p.vp9.webm', type: 'video/webm; codecs="vp9, opus"', height: 480 },
        { src: 'https://upload.wikimedia.org/t/Daybreak.webm.ogv', type: 'video/ogg', height: 360 },
      ] }] }] } });
    }
    return res(404, 'x');
  };
  const engine = createEngine({ config: { engine: config.engine, providers: { commons: { name: 'Wikimedia Commons', enabled: true, baseUrls: ['https://commons.wikimedia.org'] } } }, env: {}, providers: [commons], fetchImpl });
  const { streams, reports } = await engine.run({ type: 'movie', name: 'Daybreak in Udi', year: 1949, aliases: [] });
  assert.equal(reports[0].matches.length, 1);
  assert.deepEqual(streams.map((s) => s.url).sort(), ['https://upload.wikimedia.org/a/Daybreak.webm', 'https://upload.wikimedia.org/t/Daybreak.webm.480p.vp9.webm']);
});

const faithstream = require('../src/providers/faithstream');

test('faithstream: signs in, matches the catalogue, returns playback URLs; private installs only', async () => {
  faithstream._reset();
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push(`${opts.method || 'GET'} ${url} ${opts.headers.Authorization || ''}`);
    if (url.endsWith('/auth/login')) {
      const body = JSON.parse(opts.body);
      assert.equal(body.email, 'me@example.com');
      return res(200, { status: true, data: { data: { id: 'u' }, accessToken: 'acct-token-0123456789abcdef' } });
    }
    if (url.includes('/users/streaming-profiles/with-tokens')) return res(200, { data: [{ isPrimary: true, accessToken: 'profile-token-0123456789abcdef' }] });
    if (url.includes('/content/series?')) return res(200, { data: { items: [] } });
    if (url.includes('/content?limit=100&page=1')) return res(200, { data: { items: [
      { id: 'f1', title: 'God Calling', type: 'movie', durationSeconds: 7195, availableRegions: ['GB', 'NG'] },
      { id: 'f2', title: 'Stranded 2', type: 'movie', durationSeconds: 5400 },
      { id: 'f3', title: 'DAY 1', type: 'movie' },
    ] } });
    if (url.includes('/content/playback/url/f1')) return res(200, { data: { url: 'https://gateway.thefaithstream.com/content/streaming/hls/f1/x.m3u8?playbackToken=<removed>', expiresAt: '2026-11-18T00:00:00Z' } });
    return res(404, 'x');
  };
  const cfg = { engine: config.engine, providers: { faithstream: { name: 'FaithStream', enabled: true, baseUrls: [], auth: { email: 'FAITHSTREAM_EMAIL', password: 'FAITHSTREAM_PASSWORD' } } } };
  const env = { FAITHSTREAM_EMAIL: 'me@example.com', FAITHSTREAM_PASSWORD: 'pw' };

  const publicRun = await createEngine({ config: cfg, env, providers: [faithstream], fetchImpl }).run({ type: 'movie', name: 'God Calling', year: 2018 });
  assert.equal(publicRun.reports[0].status, 'skipped');
  assert.equal(seen.length, 0);

  const noCreds = await createEngine({ config: cfg, env: {}, providers: [faithstream], fetchImpl }).run({ type: 'movie', name: 'God Calling', private: true });
  assert.match(noCreds.reports[0].error, /needs FAITHSTREAM_EMAIL/);

  const { streams, reports } = await createEngine({ config: cfg, env, providers: [faithstream], fetchImpl }).run({ type: 'movie', name: 'God Calling', year: 2018, private: true });
  assert.equal(reports[0].status, 'ok', reports[0].error);
  assert.equal(streams.length, 1);
  assert.match(streams[0].url, /\/content\/streaming\/hls\/f1\//);
  assert.equal(streams[0].headers.Referer, 'https://www.thefaithstream.com/');
  assert.ok(seen.some((s) => s.includes('/content/playback/url/f1') && s.includes('Bearer profile-token')));
});

test('private install key travels in the install URL config', () => {
  const { decodeConfig } = require('../src/config');
  const seg = Buffer.from(JSON.stringify({ langs: ['yo'], k: 'abcdefghijklmnop1234' })).toString('base64url');
  assert.equal(decodeConfig(seg).k, 'abcdefghijklmnop1234');
  const bad = Buffer.from(JSON.stringify({ k: 'x' })).toString('base64url');
  assert.equal(decodeConfig(bad).k, undefined);
});
