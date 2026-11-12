#!/usr/bin/env node
'use strict';

// Research only: opens candidate sites in a real (headless) browser, follows a few film pages, and records
// what the page loads: stream formats (HLS/DASH/MP4), DRM licence requests, embedded players (YouTube, Vimeo,
// JW Player...), sign-in or payment walls, and the terms page. Writes research/out/browser/<name>.json.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'research', 'out', 'browser');
const SITES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'research', 'browser-sites.json'), 'utf8')).sites;
const MEDIA = /\.m3u8|\.mpd|\.mp4|\.ts(\?|$)|\.m4s|manifest|playlist/i;
const DRM = /widevine|playready|fairplay|license|drm|\/acquire/i;
const PLAYERS = /youtube\.com\/embed|youtube-nocookie|ytimg|player\.vimeo|vimeocdn|jwplayer|jwpcdn|brightcove|dailymotion|bitmovin|mux\.com|cloudflarestream|bunnycdn|b-cdn|akamaihd|cloudfront|kaltura|wistia|odycdn|shaka|videojs/i;

async function inspect(page, url, wait = 12000) {
  const hits = { media: new Set(), drm: new Set(), players: new Set() };
  const onReq = (r) => {
    const u = r.url();
    if (MEDIA.test(u) && !/\.mp4\?.*thumb|poster|\.jpg|\.png/i.test(u)) hits.media.add(u.slice(0, 160));
    if (DRM.test(u) && !/licen[sc]e(s)?\.(html|txt)|cookie/i.test(u)) hits.drm.add(u.slice(0, 160));
    const m = u.match(PLAYERS);
    if (m) hits.players.add(m[0]);
  };
  page.on('request', onReq);
  let status = null;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    status = res?.status() ?? null;
    await page.waitForTimeout(wait);
    // Press a visible play button if there is one.
    const play = page.locator('button[aria-label*="play" i], .vjs-big-play-button, .jw-icon-display, [class*="play-button" i], [class*="playButton" i]').first();
    if (await play.count()) {
      await play.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(8000);
    }
  } catch (err) {
    status = `error: ${err.message.split('\n')[0]}`;
  }
  page.off('request', onReq);
  const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const links = await page.$$eval('a[href]', (as) => as.map((a) => a.href)).catch(() => []);
  return {
    url,
    finalUrl: page.url(),
    status,
    title: await page.title().catch(() => ''),
    text: text.slice(0, 1500),
    walls: ['sign in', 'log in', 'login', 'subscribe', 'subscription', 'free trial', 'per month', '/month', 'rent', 'buy now', 'download the app', 'download our app', 'get the app']
      .filter((w) => text.toLowerCase().includes(w)),
    media: [...hits.media].slice(0, 15),
    drm: [...hits.drm].slice(0, 10),
    players: [...hits.players],
    links,
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const site of SITES) {
    const ctx = await browser.newContext({ locale: 'en-GB', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' });
    const page = await ctx.newPage();
    const report = { name: site.name, home: await inspect(page, site.url) };
    const pattern = new RegExp(site.titlePattern || '/(movie|movies|watch|video|videos|film|films|title|show|series|play|content)/', 'i');
    const candidates = [...new Set(report.home.links.filter((l) => pattern.test(l) && !/terms|privacy|about|faq|help|login|signup|register/i.test(l)))].slice(0, 40);
    report.titleLinksFound = candidates.length;
    report.titleLinkSamples = candidates.slice(0, 10);
    report.titles = [];
    for (const l of candidates.slice(0, site.open || 2)) report.titles.push(await inspect(page, l, 15000));
    const terms = report.home.links.find((l) => /terms|conditions|tos/i.test(l));
    if (terms) {
      const t = await inspect(page, terms, 3000);
      const lower = t.text.toLowerCase();
      report.terms = {
        url: terms,
        mentions: ['third party', 'third-party', 'scrap', 'automated', 'reverse engineer', 'embed', 'download', 'api', 'ads', 'advertis', 'personal use', 'non-commercial', 'redistribut', 'circumvent']
          .filter((w) => lower.includes(w)),
        text: t.text.slice(0, 1200),
      };
    }
    for (const r of [report.home, ...report.titles]) delete r.links;
    fs.writeFileSync(path.join(OUT, `${site.name}.json`), JSON.stringify(report, null, 1));
    console.log(`${site.name}: home ${report.home.status}, ${report.titleLinksFound} title links, media ${report.titles.flatMap((t) => t.media).length}, drm ${report.titles.flatMap((t) => t.drm).length}, players ${[...new Set(report.titles.flatMap((t) => t.players).concat(report.home.players))].join(',')}`);
    await ctx.close();
  }
  await browser.close();
}

main();
