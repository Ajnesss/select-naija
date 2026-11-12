'use strict';

// Most tests cover general behaviour with every kind of link; the free-only filter has its own test.
if (process.env.SELECT_NAIJA_FREE_ONLY === undefined) process.env.SELECT_NAIJA_FREE_ONLY = '0';
if (process.env.SELECT_NAIJA_IN_APP_ONLY === undefined) process.env.SELECT_NAIJA_IN_APP_ONLY = '0';

const fs = require('fs');
const os = require('os');
const path = require('path');

const NOW = Date.parse('2026-11-10T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

function baseData() {
  return {
    catalogue: {
      titles: [
        { id: 'tt0000001', type: 'movie', name: 'Ọ̀ṣun Sẹ̀ẹ̀gẹ̀sí', aliases: ['Osun Seegesi'], year: 2019, languages: ['yo'], genres: ['Drama'] },
        { id: 'snaija-iyalode-2025', type: 'movie', name: 'Iyalode', year: 2025, languages: ['yo'], genres: ['Drama'] },
        { id: 'tt0000002', type: 'movie', name: 'Living in Bondage', year: 1992, languages: ['ig', 'en'], genres: ['Thriller'] },
        { id: 'tt0000003', type: 'movie', name: 'No Links Yet', year: 2024, languages: ['ha'], genres: ['Drama'] },
        { id: 'snaija-dadin-kowa-2015', type: 'series', name: 'Dadin Kowa', year: 2015, languages: ['ha'], genres: ['Drama'],
          videos: [{ season: 1, episode: 1, title: 'Episode 1' }] },
        { id: 'snaija-test-2026', type: 'movie', name: 'Test Title', year: 2026, languages: ['en'], category: 'test' },
      ],
    },
    links: {
      links: [
        { id: 'kava:osun', titleId: 'tt0000001', provider: 'kava', kind: 'external', url: 'https://kava.example/osun', expectTitle: 'Osun Seegesi' },
        { id: 'tubi:osun', titleId: 'tt0000001', provider: 'tubi', kind: 'external', url: 'https://tubi.example/osun', expectTitle: 'Osun Seegesi' },
        { id: 'archive:osun', titleId: 'tt0000001', provider: 'archive', kind: 'direct', url: 'https://archive.example/osun.mp4' },
        { id: 'kava:iyalode', titleId: 'snaija-iyalode-2025', provider: 'kava', kind: 'external', url: 'https://kava.example/iyalode', expectTitle: 'Iyalode' },
        { id: 'circuits:lib', titleId: 'tt0000002', provider: 'circuits', kind: 'external', url: 'https://circuits.example/lib', expectTitle: 'Living in Bondage' },
        { id: 'kava:nolinks', titleId: 'tt0000003', provider: 'kava', kind: 'external', url: 'https://kava.example/x', expectTitle: 'No Links Yet' },
        { id: 'arewa24:dk', titleId: 'snaija-dadin-kowa-2015', provider: 'arewa24', kind: 'external', url: 'https://arewa.example/dk', expectTitle: 'Dadin Kowa' },
        { id: 'selftest:file', titleId: 'snaija-test-2026', provider: 'selftest', kind: 'direct', url: 'https://files.example/t.mp4' },
      ],
    },
    providers: {
      providers: [
        { id: 'kava', name: 'Kava', access: 'subscription', unavailableMarkers: ['not available in your region'] },
        { id: 'tubi', name: 'Tubi', access: 'free', unavailableMarkers: ['content unavailable'] },
        { id: 'archive', name: 'Open archive', access: 'free', unavailableMarkers: [] },
        { id: 'circuits', name: 'Circuits', access: 'rental', unavailableMarkers: [] },
        { id: 'arewa24', name: 'Arewa24 On Demand', access: 'subscription', unavailableMarkers: [] },
        { id: 'netflix', name: 'Netflix', access: 'subscription', unavailableMarkers: [] },
        { id: 'selftest', name: 'Select Naija test file', access: 'free', unavailableMarkers: [] },
      ],
    },
    status: {
      generatedAt: hoursAgo(1),
      links: {
        'kava:osun': { lastOk: hoursAgo(2), lastCheck: hoursAgo(2), checks: [{ at: hoursAgo(2), ok: true }] },
        'tubi:osun': { lastOk: hoursAgo(24 * 10), lastCheck: hoursAgo(2), checks: [{ at: hoursAgo(240), ok: true }, { at: hoursAgo(2), ok: true }] },
        'archive:osun': { lastOk: hoursAgo(3), lastCheck: hoursAgo(3), finalUrl: 'https://ia800.example/osun.mp4', checks: [{ at: hoursAgo(3), ok: true }] },
        'kava:iyalode': { lastOk: hoursAgo(5), lastCheck: hoursAgo(5), checks: [{ at: hoursAgo(5), ok: true }] },
        'circuits:lib': { lastOk: hoursAgo(50), lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(50), ok: true }, { at: hoursAgo(25), ok: false }, { at: hoursAgo(1), ok: false }] },
        'arewa24:dk': { lastOk: hoursAgo(4), lastCheck: hoursAgo(4), checks: [{ at: hoursAgo(4), ok: true }] },
        'selftest:file': { lastOk: hoursAgo(1), lastCheck: hoursAgo(1), checks: [{ at: hoursAgo(1), ok: true }] },
      },
      providers: { kava: { score: 95 }, tubi: { score: 85 } },
    },
  };
}

function writeData(overrides = {}) {
  const d = { ...baseData(), ...overrides };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snaija-'));
  fs.writeFileSync(path.join(dir, 'catalogue.json'), JSON.stringify(d.catalogue));
  fs.writeFileSync(path.join(dir, 'links.json'), JSON.stringify(d.links));
  fs.writeFileSync(path.join(dir, 'providers.json'), JSON.stringify(d.providers));
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(d.status));
  return dir;
}

function fakeResponse({ status = 200, body = '', bytes = null, contentType = 'text/html', url = 'https://x.example/' } = {}) {
  const payload = bytes ? Buffer.from(bytes) : Buffer.from(body, 'utf8');
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(payload) })),
        cancel: async () => {},
      }),
    },
    json: async () => JSON.parse(payload.toString('utf8')),
  };
}

module.exports = { NOW, hoursAgo, baseData, writeData, fakeResponse };
