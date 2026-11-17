#!/usr/bin/env node
'use strict';
// Research only: signs in to FaithStream with Select Naija's own free account (FAITHSTREAM_EMAIL / _PASSWORD),
// opens the catalogue and a few titles as a normal viewer would, and records the data calls and media requests
// the site's own player makes. Writes research/out/faithstream.json. Never prints the credentials.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const email = process.env.FAITHSTREAM_EMAIL;
  const password = process.env.FAITHSTREAM_PASSWORD;
  const out = { at: new Date().toISOString(), signedIn: false, pages: [], calls: [], media: [], errors: [] };
  const file = path.join(__dirname, '..', 'research', 'out', 'faithstream.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!email || !password) { out.errors.push('FAITHSTREAM_EMAIL / FAITHSTREAM_PASSWORD not set'); fs.writeFileSync(file, JSON.stringify(out, null, 1)); return; }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'en-GB', timezoneId: 'Europe/London' })).newPage();
  const redact = (s) => String(s).split(email).join('<email>').split(password).join('<password>').replace(/("?(?:access|refresh)_?token"?\s*[:=]\s*")[^"]+/gi, '$1<token>').replace(/Bearer\s+[\w.-]+/g, 'Bearer <token>');
  let auth = null;
  const unsign = (s) => String(s).replace(/(Signature|Key-Pair-Id|Policy|playbackToken|token)=[^&"\s]+/g, '$1=<removed>');
  page.on('response', async (r) => {
    const u = r.url();
    if (/\.m3u8|\.mpd|\.mp4|\.webm|manifest|playlist|widevine|license|drm/i.test(u)) out.media.push({ u: unsign(u.slice(0, 300)), s: r.status(), ct: r.headers()['content-type'] || '' });
    if (!/gateway\.thefaithstream\.com/.test(u)) return;
    let b = '';
    try { b = await r.text(); } catch {}
    if (!auth && r.request().headers().authorization) auth = r.request().headers().authorization;
    const accountCall = /\/(auth|users|account|profile)/i.test(new URL(u).pathname);
    const shape = (v, depth = 0) => (v && typeof v === 'object' && depth < 4 ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x, depth + 1)])) : typeof v);
    if (accountCall || /playback|streaming/.test(u)) {
      let post = null; try { post = shape(JSON.parse(r.request().postData() || 'null')); } catch {}
      let resp = null; try { resp = accountCall ? shape(JSON.parse(b)) : null; } catch {}
      (out.shapes = out.shapes || []).push({ path: new URL(u).pathname, method: r.request().method(), status: r.status(), requestHeaders: Object.keys(r.request().headers()), body: post, response: resp });
    }
    out.calls.push({ u: unsign(u.slice(0, 300)), m: r.request().method(), s: r.status(), b: accountCall ? '<account data not recorded>' : unsign(redact(b.slice(0, 20000))) });
  });
  try {
    await page.goto('https://www.thefaithstream.com/auth/login', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);
    out.loginForm = await page.$$eval('input, button', (els) => els.map((e) => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, ph: e.placeholder, text: (e.innerText || '').slice(0, 40), visible: !!(e.offsetWidth || e.offsetHeight) })));
    const emailBox = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="@"], input[placeholder*="email" i], input[type="text"]').filter({ visible: true }).first();
    await emailBox.fill(email, { timeout: 15000 });
    let pass = page.locator('input[type="password"]').filter({ visible: true }).first();
    if (!(await pass.count())) {
      // Two-step form: email first, then password.
      await page.locator('button[type="submit"], button:has-text("Continue"), button:has-text("Next"), button:has-text("Login"), button:has-text("Sign in")').filter({ visible: true }).first().click();
      await page.waitForTimeout(4000);
      pass = page.locator('input[type="password"]').filter({ visible: true }).first();
    }
    await pass.fill(password, { timeout: 15000 });
    await Promise.all([
      page.waitForLoadState('networkidle').catch(() => {}),
      page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in"), button:has-text("Log in")').filter({ visible: true }).first().click(),
    ]);
    await page.waitForTimeout(8000);
    out.signedIn = !/\/auth\//.test(page.url());
    for (const url of ['https://www.thefaithstream.com/browse', 'https://www.thefaithstream.com/movies', 'https://www.thefaithstream.com/series']) {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        await page.mouse.wheel(0, 6000); await page.waitForTimeout(3000);
        const links = [...new Set(await page.$$eval('a[href]', (as) => as.map((a) => a.href)))];
        out.pages.push({ url, final: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 4000), links: links.slice(0, 200) });
      } catch (e) { out.errors.push(`${url}: ${e.message.split('\n')[0]}`); }
    }
    // Catalogue as the site's own pages request it (signed-in viewer).
    out.catalogue = {};
    for (const ep of ['/content/content-types/list', '/content/curated-collections/homepage']) {
      try {
        const r = await page.request.get(`https://gateway.thefaithstream.com${ep}`, { headers: auth ? { authorization: auth } : {} });
        out.catalogue[ep] = { s: r.status(), b: unsign((await r.text()).slice(0, 400000)) };
      } catch (e) { out.errors.push(`${ep}: ${e.message.split('\n')[0]}`); }
    }
    out.guesses = {};
    for (const ep of ['/content/search?q=God%20Calling', '/content/search?query=God%20Calling', '/content?type=movie&limit=100', '/content/videos?type=movie&limit=100', '/content/browse/movie', '/content/content-types/movie/videos?limit=100', '/content/movies?limit=100', '/content/series?limit=100', '/content/type/movie?limit=100']) {
      try {
        const r = await page.request.get(`https://gateway.thefaithstream.com${ep}`, { headers: auth ? { authorization: auth } : {} });
        const t = await r.text();
        out.guesses[ep] = { s: r.status(), n: t.length, titles: [...new Set([...t.matchAll(/"title":"([^"]+)"/g)].map((m) => m[1]))].slice(0, 200), types: [...new Set([...t.matchAll(/"type":"([^"]+)"/g)].map((m) => m[1]))], head: t.slice(0, 300) };
      } catch (e) { out.guesses[ep] = { error: e.message.split('\n')[0] }; }
    }
    out.terms = '';
    try {
      await page.goto('https://www.thefaithstream.com/legal/terms-and-conditions', { waitUntil: 'networkidle', timeout: 45000 });
      out.terms = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 30000);
    } catch (e) { out.errors.push(`terms: ${e.message.split('\n')[0]}`); }
    // Open a film from the Movies page and press play, as a viewer would.
    out.plays = [];
    for (let i = 0; i < 2; i += 1) {
      try {
        await page.goto('https://www.thefaithstream.com/browse/movie', { waitUntil: 'networkidle', timeout: 45000 });
        await page.waitForTimeout(3000);
        const tiles = page.locator('main img, [class*="card" i] img, [class*="poster" i] img').filter({ visible: true });
        const n = await tiles.count();
        if (n <= i) { out.errors.push(`movie tiles found: ${n}`); break; }
        const before = out.calls.length;
        await tiles.nth(i).click({ timeout: 10000 });
        await page.waitForTimeout(4000);
        const play = page.locator('button:has-text("Play"), button:has-text("Watch"), a:has-text("Play"), [aria-label*="play" i]').filter({ visible: true }).first();
        if (await play.count()) { await play.click({ timeout: 10000 }).catch(() => {}); await page.waitForTimeout(15000); }
        out.plays.push({
          url: page.url(),
          title: await page.title(),
          text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 1500),
          videos: await page.$$eval('video', (vs) => vs.map((v) => ({ src: (v.currentSrc || v.src || '').slice(0, 120), w: v.videoWidth, h: v.videoHeight, t: v.currentTime, d: v.duration }))),
          callsDuring: out.calls.slice(before).map((c) => `${c.m} ${c.s} ${c.u}`),
        });
      } catch (e) { out.errors.push(`play ${i}: ${e.message.split('\n')[0]}`); }
    }
  } catch (e) { out.errors.push(e.message.split('\n')[0]); }
  await browser.close();
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`signedIn=${out.signedIn} pages=${out.pages.length} calls=${out.calls.length} media=${out.media.length} errors=${out.errors.length}`);
})();
