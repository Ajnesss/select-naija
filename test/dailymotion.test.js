'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseTitle, buildTitles, ukAllowed } = require('../scripts/discover-dailymotion');
const { loadData } = require('../src/data');
const { queryCatalog } = require('../src/catalog');
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
