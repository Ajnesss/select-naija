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
  page.on('response', async (r) => {
    const u = r.url();
    if (/\.m3u8|\.mpd|\.mp4|\.webm|manifest|playlist|widevine|license|drm/i.test(u)) out.media.push({ u: redact(u.slice(0, 300)), s: r.status(), ct: r.headers()['content-type'] || '' });
    if (!/gateway\.thefaithstream\.com/.test(u)) return;
    let b = '';
    try { b = await r.text(); } catch {}
    out.calls.push({ u: redact(u.slice(0, 300)), m: r.request().method(), s: r.status(), b: redact(b.slice(0, 6000)) });
  });
  try {
    await page.goto('https://www.thefaithstream.com/auth/login', { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(3000);
    out.loginForm = await page.$$eval('input, button', (els) => els.map((e) => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, ph: e.placeholder, text: (e.innerText || '').slice(0, 40), visible: !!(e.offsetWidth || e.offsetHeight) })));
    const emailBox = page.locator('input[type="email"], input[name*="email" i], input[placeholder*="email" i], input[id*="email" i]').filter({ visible: true }).first();
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
    // Open up to three titles and press play, as a viewer would.
    const titleLinks = [...new Set(out.pages.flatMap((p) => p.links))].filter((l) => /thefaithstream\.com\/(watch|movie|movies|series|title|video|content)\//.test(l)).slice(0, 3);
    for (const url of titleLinks) {
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
        const play = page.locator('button:has-text("Play"), button:has-text("Watch"), [aria-label*="Play" i]').first();
        if (await play.count()) { await play.click().catch(() => {}); await page.waitForTimeout(10000); }
        out.pages.push({ url, final: page.url(), title: await page.title(), text: (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 2000), videos: await page.$$eval('video', (vs) => vs.map((v) => ({ src: v.currentSrc || v.src, w: v.videoWidth, h: v.videoHeight, t: v.currentTime }))) });
      } catch (e) { out.errors.push(`${url}: ${e.message.split('\n')[0]}`); }
    }
  } catch (e) { out.errors.push(e.message.split('\n')[0]); }
  await browser.close();
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`signedIn=${out.signedIn} pages=${out.pages.length} calls=${out.calls.length} media=${out.media.length} errors=${out.errors.length}`);
})();
