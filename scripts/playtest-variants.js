#!/usr/bin/env node
'use strict';
// Research: why did every embedded-player test return error 150? Plays the same 15 videos under several setups
// and records the player result plus the text the player showed. Output research/out/playtest-variants.json.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');
const { PAGE } = require('./check-youtube-playback');

const REMOTE = process.env.PLAYTEST_URL || 'https://select-naija.92-5-24-2.sslip.io/playtest';
const health = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'youtube-health.json'), 'utf8'));
const ids = Object.entries(health.videos).filter(([, v]) => v.api === 'ok').map(([id]) => id).sort().filter((_, i) => i % 1700 === 0).slice(0, 15);

(async () => {
  const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const local = `http://localhost:${server.address().port}/`;
  const variants = [
    ['localhost-headless', { headless: true }, local, ''],
    ['server-headless', { headless: true }, REMOTE, ''],
    ['server-headed', { headless: false }, REMOTE, ''],
    ['server-headed-nocookie', { headless: false }, REMOTE, '&host=nc'],
    ['localhost-headed', { headless: false }, local, ''],
  ];
  const out = {};
  for (const [name, opts, base, extra] of variants) {
    const browser = await chromium.launch({ ...opts, args: ['--autoplay-policy=no-user-gesture-required', '--disable-blink-features=AutomationControlled'] });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', locale: 'en-GB' });
    const page = await ctx.newPage();
    const rows = [];
    for (const id of ids) {
      let r;
      try {
        await page.goto(`${base}?v=${id}${extra}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        r = await page.waitForFunction(() => window.result, null, { timeout: 25000, polling: 500 }).then((h) => h.jsonValue());
      } catch (e) { r = { result: 'timeout', err: e.message.split('\n')[0].slice(0, 80) }; }
      const frame = page.frames().find((f) => /youtube/.test(f.url()));
      r.shown = frame ? (await frame.locator('body').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) : 'no frame';
      rows.push({ id, ...r });
    }
    const tally = {};
    for (const r of rows) { const k = r.result === 'error' ? `error ${r.code}` : r.result; tally[k] = (tally[k] || 0) + 1; }
    out[name] = { tally, rows };
    console.log(name, JSON.stringify(tally), '|', rows.slice(0, 2).map((r) => r.shown).join(' || '));
    await browser.close();
  }
  server.close();
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'playtest-variants.json'), JSON.stringify(out, null, 1));
})();
