#!/usr/bin/env node
'use strict';
// Research only: open pages in headless Chromium and record every JSON/XHR response (URL + first 3 KB of body),
// so we can find the data endpoints a site's own web pages use. Writes research/out/xhr/<name>.json.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'research', 'out', 'xhr');
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'xhr-pages.json'), 'utf8'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, urls] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({ locale: 'en-GB', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' });
    const page = await ctx.newPage();
    const out = [];
    for (const url of urls) {
      const rec = { url, xhr: [], media: [] };
      page.on('response', async (r) => {
        const u = r.url();
        const ct = r.headers()['content-type'] || '';
        if (/\.m3u8|\.mpd|\.mp4/i.test(u)) rec.media.push(u.slice(0, 200));
        if (!/json|graphql|text\/plain|x-component/i.test(ct) && !/\/api\/|_next\/data|\.json/i.test(u)) return;
        try { const b = await r.text(); rec.xhr.push({ u: u.slice(0, 300), s: r.status(), ct, b: b.slice(0, 3000) }); } catch {}
      });
      try {
        const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        rec.status = res?.status();
        await page.waitForTimeout(5000);
        await page.mouse.wheel(0, 4000); await page.waitForTimeout(3000);
      } catch (e) { rec.status = 'error ' + e.message.split('\n')[0]; }
      rec.finalUrl = page.url();
      rec.title = await page.title().catch(() => '');
      rec.text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 2500);
      rec.links = [...new Set(await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []))].slice(0, 300);
      rec.iframes = await page.$$eval('iframe', (f) => f.map((x) => x.src)).catch(() => []);
      page.removeAllListeners('response');
      out.push(rec);
    }
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(out, null, 1));
    await ctx.close();
  }
  await browser.close();
})();
