#!/usr/bin/env node
'use strict';

// Research only: Circuits (circuits.tv) "FreeFlex" free section. Lists free titles, opens a few, records the
// stream requests, checks whether the HLS is encrypted, and saves the terms. Writes research/out/circuits.json.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const out = { pages: [], titles: [], streams: [], terms: null };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  const media = new Set();
  const drm = new Set();
  page.on('request', (r) => {
    const u = r.url();
    if (/\.m3u8|\.mpd|\.mp4/i.test(u)) media.add(u);
    if (/widevine|playready|fairplay|license|drm/i.test(u)) drm.add(u);
  });
  await page.goto('https://www.circuits.tv/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(8000);
  const nav = await page.$$eval('a[href]', (as) => as.map((a) => ({ text: a.innerText.trim(), href: a.href })));
  out.pages = nav.filter((n) => n.text).slice(0, 60);
  const free = nav.find((n) => /freeflex/i.test(n.text));
  if (free) {
    await page.goto(free.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(10000);
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(1500);
    }
    out.freePage = page.url();
    out.freeText = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 6000);
    const links = await page.$$eval('a[href]', (as) => as.map((a) => ({ text: a.innerText.trim(), href: a.href })));
    out.titles = links.filter((l) => /\/(content|movie|video|watch|title|details?)\//i.test(l.href)).slice(0, 200);
  }
  for (const t of out.titles.slice(0, 3)) {
    media.clear();
    drm.clear();
    await page.goto(t.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);
    const btn = page.locator('text=/^(Watch|Play|Watch now|Play now)$/i').first();
    if (await btn.count()) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(15000);
    }
    const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 800);
    const entry = { title: t.text, url: t.href, text, media: [...media].slice(0, 10), drm: [...drm].slice(0, 5) };
    const master = [...media].find((u) => /master\.m3u8/.test(u)) || [...media].find((u) => /\.m3u8/.test(u));
    if (master) {
      try {
        const m = await (await fetch(master)).text();
        const variant = m.split('\n').find((l) => l && !l.startsWith('#'));
        const vUrl = variant ? new URL(variant, master).toString() : master;
        const v = await (await fetch(vUrl)).text();
        entry.hls = { masterOkFromOutside: true, encrypted: /#EXT-X-KEY:METHOD=(?!NONE)/.test(v) ? v.match(/#EXT-X-KEY:[^\n]*/)[0].slice(0, 160) : false };
      } catch (err) {
        entry.hls = { error: err.message };
      }
    }
    out.streams.push(entry);
  }
  const termsLink = (await page.$$eval('a[href]', (as) => as.map((a) => ({ text: a.innerText.trim(), href: a.href })))).find((l) => /terms/i.test(l.text));
  if (termsLink) {
    await page.goto(termsLink.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(6000);
    out.terms = { url: page.url(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 20000) };
  }
  await browser.close();
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'circuits.json'), JSON.stringify(out, null, 1));
  console.log(`free page ${out.freePage}; ${out.titles.length} title links; streams ${out.streams.length}`);
}

main();
