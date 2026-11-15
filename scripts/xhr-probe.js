#!/usr/bin/env node
'use strict';
// Research only: open pages in headless Chromium and record every JSON/XHR response (URL + first 3 KB of body),
// so we can find the data endpoints a site's own web pages use. Writes research/out/xhr/<name>.json.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'research', 'out', 'xhr');
// Keyword scan of each page's JavaScript: ad SDKs (client-side vs server-side insertion), players, embed routes, partner APIs.
const SCAN = {
  imaSdk: /imasdk\.googleapis\.com[^"'\s]*|google\.ima\.[A-Za-z]+/g,
  vast: /[^"'\s]{0,60}(?:vast|vmap)[^"'\s]{0,60}\.(?:xml|php)?|adTagUrl|ad_tag_url|adsResponse/gi,
  ssai: /mediatailor|yospace|stitcher|serverSideAd|ssai|dai\.google|streamActivityMonitor/gi,
  adsense: /adsbygoogle|pagead2\.googlesyndication|googletag\.|gpt\.js|admob|unityads|applovin/gi,
  player: /videojs|video\.js|shaka-player|shaka\.Player|hls\.js|Hls\.|jwplayer|bitmovin|theoplayer|plyr|react-player|clappr|dashjs/gi,
  drm: /widevine|fairplay|playready|licenseServer|license_url|drmToday|ezdrm|axinom|pallycon/gi,
  hosting: /[a-z0-9.-]*(?:b-cdn\.net|mediadelivery\.net|mux\.com|cloudflarestream\.com|videodelivery\.net|vimeocdn\.com|cloudfront\.net|akamaized\.net|bunnycdn|gumlet|api\.video|wistia|brightcove|jwpcdn|dacast|vdocipher)[^"'\s]{0,40}/gi,
  embed: /[^"'\s]{0,40}\/embed\/[^"'\s]{0,40}|oembed|iframe[^"'\s]{0,30}src|allowfullscreen|embedUrl/gi,
  partnerApi: /[^"'\s]{0,40}\/(?:api|v1|v2|public|partner|developer)s?\/[a-z][^"'\s]{0,50}/gi,
};
const PAGES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'xhr-pages.json'), 'utf8'));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, urls] of Object.entries(PAGES)) {
    const ctx = await browser.newContext({ locale: 'en-GB', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' });
    const page = await ctx.newPage();
    const out = [];
    for (const url of urls) {
      const rec = { url, xhr: [], media: [], scripts: [] };
      page.on('response', async (r) => {
        const u = r.url();
        const ct = r.headers()['content-type'] || '';
        if (/javascript/i.test(ct) || /\.js(\?|$)/i.test(u)) {
          try {
            const b = await r.text();
            const hits = {};
            for (const [k, re] of Object.entries(SCAN)) { const m = b.match(re); if (m) hits[k] = [...new Set(m)].slice(0, 6).map((x) => x.slice(0, 120)); }
            if (Object.keys(hits).length) rec.scripts.push({ u: u.slice(0, 200), hits });
          } catch {}
          return;
        }
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
      rec.html = (await page.content().catch(() => '')).slice(0, 400000);
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
