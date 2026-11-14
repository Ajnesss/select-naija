#!/usr/bin/env node
'use strict';
// Research only: for each candidate Nigerian producer/distributor website, open the home page and up to
// MAX_PAGES internal film/video pages in headless Chromium, and fingerprint the video infrastructure the page
// itself loads (hosting service, player, stream format, DRM). Records URLs only; downloads nothing.
// Input research/infra-sites.json {name: url}. Output research/out/infra/<name>.json and summary.json.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const OUT = path.join(__dirname, '..', 'research', 'out', 'infra');
const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'infra-sites.json'), 'utf8'));
const MAX_PAGES = 5;
const FINGERPRINTS = {
  bunny: /mediadelivery\.net|b-cdn\.net|bunnycdn/i,
  cloudflareStream: /videodelivery\.net|cloudflarestream\.com/i,
  mux: /stream\.mux\.com|image\.mux\.com|mux\.dev/i,
  jwplayer: /jwplayer|jwpcdn|cdn\.jwplayer\.com|jwplatform/i,
  vimeo: /player\.vimeo\.com|vimeocdn/i,
  vhx: /vhx\.tv|embed\.vhx/i,
  youtube: /youtube\.com\/embed|youtube-nocookie|ytimg\.com\/vi/i,
  wistia: /wistia/i,
  brightcove: /brightcove|bcove/i,
  apiVideo: /api\.video|embed\.api\.video/i,
  dacast: /dacast/i,
  vdocipher: /vdocipher/i,
  kaltura: /kaltura/i,
  dailymotion: /dailymotion|dmcdn/i,
  cloudfront: /cloudfront\.net.*\.(m3u8|mp4)/i,
  s3: /s3[.-][a-z0-9-]*\.amazonaws\.com.*\.(m3u8|mp4)|digitaloceanspaces.*\.(m3u8|mp4)|linodeobjects.*\.(m3u8|mp4)|wasabisys/i,
  drm: /widevine|playready|fairplay|drmtoday|ezdrm|axinom|pallycon|license.*\.(drm|key)|\/acquire/i,
};
const MEDIA = /\.m3u8(\?|$)|\.mpd(\?|$)|\.mp4(\?|$)/i;
const LINKY = /watch|movie|film|video|series|episode|play|stream|cinema|library|catalog|title|show/i;

async function inspect(page, url) {
  const hits = { media: new Set(), fp: {} };
  const seen = (u) => {
    if (MEDIA.test(u) && !/thumb|poster|preview|trailer|\.jpg|\.png|banner|bg[-_]?video|hero/i.test(u)) hits.media.add(u.slice(0, 220));
    for (const [k, re] of Object.entries(FINGERPRINTS)) if (re.test(u)) (hits.fp[k] = hits.fp[k] || new Set()).add(u.slice(0, 160));
  };
  page.on('request', (r) => seen(r.url()));
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = res?.status() ?? null;
    await page.waitForTimeout(6000);
    const play = page.locator('button[aria-label*="play" i], .vjs-big-play-button, .jw-icon-display, .plyr__control--overlaid, [class*="play-button" i], [class*="playButton" i]').first();
    if (await play.count()) { await play.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(6000); }
  } catch (e) { status = 'error ' + e.message.split('\n')[0].slice(0, 120); }
  const html = await page.content().catch(() => '');
  for (const m of html.match(/https?:\/\/[^"'\s<>\\]+/g) || []) seen(m);
  const iframes = await page.$$eval('iframe', (f) => f.map((x) => x.src).filter(Boolean)).catch(() => []);
  iframes.forEach(seen);
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const links = await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []);
  page.removeAllListeners('request');
  return {
    url, finalUrl: page.url(), status, title: await page.title().catch(() => ''),
    walls: ['sign in', 'log in', 'subscribe', 'subscription', 'per month', '/month', 'rent', 'buy', 'pay per view', 'download the app'].filter((w) => text.toLowerCase().includes(w)),
    fingerprints: Object.fromEntries(Object.entries(hits.fp).map(([k, v]) => [k, [...v].slice(0, 4)])),
    media: [...hits.media].slice(0, 10), iframes: iframes.slice(0, 6), text: text.slice(0, 500), links,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const summary = {};
  for (const [name, start] of Object.entries(SITES)) {
    const ctx = await browser.newContext({ locale: 'en-GB', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36' });
    const page = await ctx.newPage();
    const pages = [];
    const home = await inspect(page, start);
    pages.push(home);
    let host = '';
    try { host = new URL(home.finalUrl || start).hostname.replace(/^www\./, ''); } catch {}
    const next = [...new Set(home.links.filter((l) => { try { const u = new URL(l); return u.hostname.replace(/^www\./, '') === host && LINKY.test(u.pathname) && u.pathname.length > 2; } catch { return false; } }))]
      .sort((a, b) => b.split('/').length - a.split('/').length).slice(0, MAX_PAGES);
    for (const u of next) pages.push(await inspect(page, u));
    for (const p of pages) delete p.links;
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(pages, null, 1));
    const fp = {};
    for (const p of pages) for (const k of Object.keys(p.fingerprints)) fp[k] = (fp[k] || 0) + 1;
    summary[name] = { start, status: home.status, title: home.title, pages: pages.length, fingerprints: fp, media: pages.reduce((n, p) => n + p.media.length, 0), walls: [...new Set(pages.flatMap((p) => p.walls))] };
    console.log(name, JSON.stringify(summary[name]));
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  await browser.close();
})();
