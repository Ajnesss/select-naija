#!/usr/bin/env node
'use strict';
// Nightly YouTube stream health, step 2: does the video actually PLAY?
// Each video is loaded in YouTube's official embedded player (IFrame Player API — the permitted way for another
// app to play YouTube), started muted, and watched until it is playing (adverts included) or the player reports
// an error. No stream addresses are extracted and nothing is downloaded.
// Runs on GitHub's servers (US), so UK blocking comes from the API check, not from here.
// Rolling: within the time budget, untested videos go first, then recent failures, then the oldest results.
const fs = require('fs');
const http = require('http');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'youtube-health.json');
const BUDGET_MS = Number(process.env.PLAYBACK_MINUTES || 35) * 60 * 1000;
const CONCURRENCY = Number(process.env.PLAYBACK_PAGES || 6);
const TIMEOUT_MS = 25000;
// Player error codes (developers.google.com/youtube/iframe_api_reference#onError).
const VIDEO_FAULT = { 100: 'not found or private', 101: 'embedding not allowed', 150: 'embedding not allowed' };

const PAGE = `<!DOCTYPE html><html><body><div id="p"></div><script>
const q = new URLSearchParams(location.search);
const id = q.get('v');
const host = q.get('host') === 'nc' ? 'https://www.youtube-nocookie.com' : 'https://www.youtube.com';
window.result = null;
const done = (r) => { if (!window.result) window.result = r; };
function onYouTubeIframeAPIReady() {
  const player = new YT.Player('p', { width: 640, height: 360, videoId: id, host,
    playerVars: { autoplay: 1, mute: 1, playsinline: 1, origin: location.origin },
    events: {
      onReady: (e) => { e.target.mute(); e.target.playVideo(); },
      onStateChange: (e) => { if (e.data === 1) setTimeout(() => done({ result: 'played', t: player.getCurrentTime() }), 2500); },
      onError: (e) => done({ result: 'error', code: e.data }),
    } });
}
</script><script src="https://www.youtube.com/iframe_api"></script></body></html>`;

/** Order of testing: never tested, failed or inconclusive last time, then oldest result first. */
function queue(videos) {
  const rank = (v) => (!v.playback ? 0 : v.playback.result !== 'played' ? 1 : 2);
  return Object.entries(videos)
    .filter(([, v]) => v.api === 'ok')
    .sort(([, a], [, b]) => rank(a) - rank(b) || String(a.playback?.at || '').localeCompare(String(b.playback?.at || '')))
    .map(([id]) => id);
}

/** Folds one test into a record; a player error only counts against the video when it is a fault of the video. */
function applyPlayback(rec, r, at) {
  const result = r.result === 'played' ? 'played' : r.result === 'error' && VIDEO_FAULT[r.code] ? 'failed' : 'inconclusive';
  return {
    ...rec,
    playback: { result, code: r.code ?? null, reason: VIDEO_FAULT[r.code] || (r.result === 'timeout' ? 'did not start within 25 s' : r.code ? `player error ${r.code}` : null), at },
    lastPlayedAt: result === 'played' ? at : rec.lastPlayedAt || null,
  };
}

async function main() {
  const { chromium } = require('playwright');
  const health = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const ids = queue(health.videos);
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const started = Date.now();
  const results = {};
  let next = 0;
  async function worker() {
    const page = await browser.newPage();
    while (next < ids.length && Date.now() - started < BUDGET_MS) {
      const id = ids[next++];
      let r;
      try {
        await page.goto(`${base}?v=${id}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        r = await page.waitForFunction(() => window.result, null, { timeout: TIMEOUT_MS, polling: 500 }).then((h) => h.jsonValue());
      } catch {
        r = { result: 'timeout' };
      }
      results[id] = r;
    }
    await page.close();
  }
  // Canary first: GitHub's servers get YouTube's "confirm you're not a bot" wall (seen 15 Nov 2026 for every video,
  // in every browser setup). While the canary is blocked, stop after 30 videos; no result is applied.
  const rest = ids.splice(30);
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const canaryPlayed = Object.values(results).filter((r) => r.result === 'played').length;
  if (canaryPlayed >= 10) {
    ids.push(...rest);
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }
  await browser.close();
  server.close();

  const tested = Object.keys(results).length;
  const tally = {};
  for (const r of Object.values(results)) { const k = r.result === 'error' ? `error ${r.code}` : r.result; tally[k] = (tally[k] || 0) + 1; }
  // If YouTube refused this server (bot check, outage), most tests fail the same way: keep previous results.
  const played = tally.played || 0;
  const suspicious = tested >= 30 && played / tested < 0.2;
  const at = new Date().toISOString();
  if (!suspicious) for (const [id, r] of Object.entries(results)) health.videos[id] = applyPlayback(health.videos[id], r, at);
  const blockedByYouTube = suspicious && Object.values(results).some((r) => r.result === 'error' && r.code === 150);
  health.playbackRun = { at, tested, tally, applied: !suspicious, blockedByYouTube, minutes: Math.round((Date.now() - started) / 60000) };
  fs.writeFileSync(FILE, `${JSON.stringify(health)}\n`);
  console.log(`playback tests: ${tested} of ${ids.length} queued in ${health.playbackRun.minutes} min`, tally, suspicious ? '— NOT applied (looks like YouTube refused this server)' : '');
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { queue, applyPlayback, VIDEO_FAULT, PAGE };
