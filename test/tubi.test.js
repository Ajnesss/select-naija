'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { entriesFrom, pageData } = require('../scripts/discover-tubi');
const { loadData } = require('../src/data');
const { buildStreams } = require('../src/streams');
const { NOW, hoursAgo, writeData, baseData } = require('./helpers');

const page = {
  container: { containerChildrenIdMap: { nollywood_naija_tales: ['1', '2'] } },
  video: { byId: {
    1: { title: 'Iwo', year: 2025, type: 'v', lang: 'Yoruba', duration: 6725, tags: ['Drama', 'Foreign/International'], actors: ['A'], posterarts: ['//img/iwo'] },
    2: { title: 'Iyalode', year: 2025, type: 'v', lang: 'English,Hausa', duration: 6000 },
  } },
};

test('Tubi collection pages become entries with languages, runtime and https posters', () => {
  const html = `<script>window.__data = ${JSON.stringify(page).replace('"A"', 'undefined')};</script>`;
  const e = entriesFrom(pageData(html), 'nollywood_naija_tales');
  assert.equal(e.length, 2);
  assert.deepEqual(e[0].languages, ['yo']);
  assert.deepEqual(e[0].genres, ['Drama']);
  assert.equal(e[0].poster, 'https:////img/iwo'.replace('https:////', 'https://'));
  assert.deepEqual(e[1].languages, ['en', 'ha']);
});

test('Tubi titles match existing catalogue titles by name and year, or become their own', async () => {
  const dir = writeData();
  const entries = entriesFrom(page, 'nollywood_naija_tales');
  fs.writeFileSync(path.join(dir, 'tubi.json'), JSON.stringify({ titles: entries }));
  const d = baseData();
  d.status.links['tubi:1'] = { lastOk: hoursAgo(1), lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(1), ok: true }] };
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(d.status));
  const data = loadData(dir, { now: NOW, freeOnly: true });
  assert.ok(data.allLinks.some((l) => l.id === 'tubi:2' && l.titleId === 'snaija-iyalode-2025')); // matched by name+year
  assert.equal(data.byId.get('snaija-tubi-1').name, 'Iwo');
  const streams = await buildStreams('movie', 'snaija-tubi-1', data, { now: NOW });
  assert.deepEqual(streams.map((s) => s.externalUrl), ['https://tubitv.com/movies/1']);
  assert.deepEqual(await buildStreams('movie', 'snaija-tubi-2', data, { now: NOW }), []);
});
