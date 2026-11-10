'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, parseExtra } = require('../src/server');
const { writeData } = require('./helpers');

async function withServer(fn, opts = {}) {
  const server = createServer({ dataDir: writeData(), tmdbApiKey: '', diagnostics: true, ...opts });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('parseExtra decodes Stremio extra segments', () => {
  assert.deepEqual(parseExtra('genre=Free%20to%20watch&skip=50'), { genre: 'Free to watch', skip: '50' });
  assert.deepEqual(parseExtra('search=%E1%BB%8C%CC%80%E1%B9%A3un'), { search: 'Ọ̀ṣun' });
});

test('manifest declares catalogue, own-ID metadata and streams for tt and snaija IDs', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/manifest.json`);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const m = await res.json();
    assert.equal(m.id, 'community.selectnaija');
    assert.deepEqual(m.resources.find((r) => r.name === 'meta').idPrefixes, ['snaija']);
    assert.deepEqual(m.resources.find((r) => r.name === 'stream').idPrefixes, ['tt', 'snaija']);
    assert.ok(m.catalogs.some((c) => c.id === 'snaija-search' && c.extra[0].isRequired));
    assert.ok(m.catalogs.some((c) => c.id === 'snaija-diagnostics'));
  });
});

test('catalogue, meta and stream routes work end to end, including encoded custom IDs', async () => {
  await withServer(async (base) => {
    const cat = await (await fetch(`${base}/catalog/movie/snaija-yoruba/genre=2020s.json`)).json();
    assert.deepEqual(cat.metas.map((m) => m.id), ['snaija-iyalode-2025']);
    const meta = await (await fetch(`${base}/meta/movie/snaija-iyalode-2025.json`)).json();
    assert.equal(meta.meta.name, 'Iyalode');
    assert.equal((await fetch(`${base}/meta/movie/snaija-not-catalogued-2020.json`)).status, 404);
    const st = await (await fetch(`${base}/stream/series/${encodeURIComponent('snaija-dadin-kowa-2015:1:1')}.json`)).json();
    assert.equal(st.streams[0].externalUrl, 'https://arewa.example/dk');
    const unknown = await (await fetch(`${base}/stream/movie/tt7654321.json`)).json();
    assert.deepEqual(unknown.streams, []);
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.ok, true);
  });
});

test('diagnostics row exposes the test title with an in-app stream', async () => {
  await withServer(async (base) => {
    const cat = await (await fetch(`${base}/catalog/movie/snaija-diagnostics.json`)).json();
    assert.deepEqual(cat.metas.map((m) => m.id), ['snaija-test-2026']);
    const st = await (await fetch(`${base}/stream/movie/snaija-test-2026.json`)).json();
    assert.equal(st.streams[0].url, 'https://files.example/t.mp4');
  });
});
