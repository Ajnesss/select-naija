'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTitle, buildTitles, cleanDescription } = require('../scripts/discover-dailymotion');
const { encodeConfig, decodeConfig, wantsTitle } = require('../src/config');

test('upload titles become clean film names', () => {
  const cases = [
    ['(BLOOD OF THE HIDDEN THRONE) - MERCY JOHNSON & ONNY - 2026 LATEST NIGERIAN MOVIE', 'Blood of the Hidden Throne', null],
    ["(THE UNSEALED) Please Don't Leave YouTube Without Watching This LIZZY GOLD latest nigerian Movie", 'The Unsealed', null],
    [' AMARE  PART 1 TASKAR KANEEWOOD EPISODE 27', 'Amare', 1],
    ['OUT OF TIME -FREDERICK LEONARD, SARIAN MARTIN. Latest Nigerian Movie 2026 #trending', 'Out of Time', null],
    ['DECEIETFUL UNION (FREDRICK LEONARD SHAZNAY OKAWA) - Nigerian Movies 2026', 'Deceietful Union', null],
    ['MY 30TH WEDDING.  STARRING BIMBO ADEMOYE,TIMINI EGBUSON, 2026 LATEST ROMANCE MOVIE.', 'My 30th Wedding', null],
    ['AGOGO ÈÈWỌ̀ (The Taboo Gong)', 'Agogo Èèwọ̀ (the Taboo Gong)', null],
    ['RISKING FOR LOVE 4 UJU OKOLI, ANTHONY WOODS', 'Risking for Love', 4],
  ];
  for (const [raw, name, part] of cases) {
    const p = parseTitle(raw);
    assert.strictEqual(p.name, name, raw);
    assert.strictEqual(p.part, part, raw);
  }
  assert.deepStrictEqual(parseTitle('MY 30TH WEDDING.  STARRING BIMBO ADEMOYE,TIMINI EGBUSON, 2026 LATEST ROMANCE MOVIE.').cast, ['Bimbo Ademoye', 'Timini Egbuson']);
});

test('Hausa season/episode numbering and episodic channels', () => {
  const p = parseTitle('Waiwaye | Zango Na 2 | Kashi Na 5');
  assert.deepStrictEqual([p.name, p.season, p.episode], ['Waiwaye', 2, 5]);
  const v = (id, title, min = 50, t = 1) => ({ id, title, duration: min * 60, created_time: t, description: '' });
  const titles = buildTitles({ name: 'A', user: 'u', languages: ['ha'], platform: 'youtube', episodic: true },
    [v('a', 'Badariyya | Kashi Na 1 | AREWA24'), v('b', 'Badariyya | Kashi Na 2 | AREWA24')], { idPrefix: 'x' });
  assert.strictEqual(titles.length, 1);
  assert.strictEqual(titles[0].type, 'series');
  assert.strictEqual(titles[0].episodes.length, 2);
});

test('clips, talk shows and livestreams are not films', () => {
  const v = (id, title, min) => ({ id, title, duration: min * 60, created_time: 1, description: '' });
  const titles = buildTitles({ name: 'A', user: 'u', languages: ['en'], platform: 'youtube' }, [
    v('1', 'Our View on Sceneone Tv (Effects of Alcohol)', 50),
    v('2', 'Bakori Tv Is Live!', 90),
    v('3', 'Funny Moments Clip', 25),
    v('4', 'THE REAL DEAL - Latest Nigerian Movie', 110),
  ], { idPrefix: 'x' });
  assert.deepStrictEqual(titles.map((t) => t.name), ['The Real Deal']);
});

test('descriptions keep the story, drop credits and calls to subscribe', () => {
  assert.strictEqual(cleanDescription('CAST: PRODUCTION HOUSE: ROCKCELLY FILMS LTD. EXECUTIVE PRODUCER: x'), undefined);
  assert.strictEqual(cleanDescription('Amara brings her boyfriend home for Christmas, only to find her ex-fiancé waiting. Subscribe for more'), 'Amara brings her boyfriend home for Christmas, only to find her ex-fiancé waiting.');
});

test('install-URL settings round-trip and filter by language', () => {
  const cfg = decodeConfig(encodeConfig({ langs: ['yo', 'ha'], rows: ['new'] }));
  assert.deepStrictEqual(cfg, { langs: ['yo', 'ha'], rows: ['new'] });
  assert.strictEqual(decodeConfig('manifest'), null);
  assert.ok(wantsTitle({ languages: ['yo'] }, cfg));
  assert.ok(!wantsTitle({ languages: ['ig'] }, cfg));
});
