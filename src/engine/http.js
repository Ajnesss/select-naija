'use strict';

// Shared HTTP client for live providers. No dependencies: Node's built-in fetch.
// Per provider: base URL fallbacks, default headers, cookie jar (for legitimate sessions), rate limiting,
// per-request timeout, retries on 429/5xx with back-off, and a record of every redirect followed.

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(message, { status, url, chain } = {}) {
    super(message);
    this.status = status;
    this.url = url;
    this.chain = chain;
  }
}

class CookieJar {
  constructor() { this.cookies = new Map(); } // host -> Map(name -> value)
  store(url, setCookies) {
    const host = new URL(url).hostname;
    for (const line of setCookies || []) {
      const [pair, ...attrs] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const domainAttr = attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a));
      const domain = domainAttr ? domainAttr.slice(7).replace(/^\./, '').toLowerCase() : host;
      if (!this.cookies.has(domain)) this.cookies.set(domain, new Map());
      const expired = attrs.some((a) => /^max-age=0$/i.test(a.trim()));
      if (expired || value === '') this.cookies.get(domain).delete(name);
      else this.cookies.get(domain).set(name, value);
    }
  }
  header(url) {
    const host = new URL(url).hostname;
    const out = [];
    for (const [domain, map] of this.cookies) {
      if (host === domain || host.endsWith(`.${domain}`)) for (const [k, v] of map) out.push(`${k}=${v}`);
    }
    return out.join('; ');
  }
}

function rateLimiter(perSecond) {
  if (!perSecond) return async () => {};
  const gap = 1000 / perSecond;
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gap;
    if (wait) await sleep(wait);
  };
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[^;,=\s]+=)/) : [];
}

/**
 * createClient({ baseUrls, headers, timeoutMs, rateLimit, retries, fetchImpl })
 * Returns { request, get, getText, getJson, probe, url, jar, baseUrl }.
 */
function createClient({ baseUrls = [], headers = {}, timeoutMs = 8000, rateLimit = 0, retries = 1, fetchImpl = fetch, maxRedirects = 6 } = {}) {
  const jar = new CookieJar();
  const limit = rateLimiter(rateLimit);
  let baseIndex = 0;
  const baseUrl = () => baseUrls[baseIndex] || '';
  const url = (pathOrUrl, params) => {
    const u = new URL(pathOrUrl, baseUrl() || undefined);
    for (const [k, v] of Object.entries(params || {})) {
      if (Array.isArray(v)) for (const x of v) u.searchParams.append(k, x);
      else if (v != null) u.searchParams.set(k, v);
    }
    return u.toString();
  };

  async function once(target, opts) {
    const chain = [];
    let current = target;
    let method = opts.method || 'GET';
    let body = opts.body;
    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      await limit();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || timeoutMs);
      let res;
      try {
        const h = { 'User-Agent': DEFAULT_UA, 'Accept-Language': 'en-GB,en;q=0.9', ...headers, ...opts.headers };
        const cookie = jar.header(current);
        if (cookie) h.Cookie = cookie;
        res = await fetchImpl(current, { method, headers: h, body, redirect: 'manual', signal: ctrl.signal });
      } catch (err) {
        clearTimeout(timer);
        throw new HttpError(err.name === 'AbortError' ? `timeout after ${opts.timeoutMs || timeoutMs} ms` : err.message, { url: current, chain });
      }
      clearTimeout(timer);
      jar.store(current, getSetCookies(res.headers));
      chain.push({ url: current, status: res.status });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) { method = 'GET'; body = undefined; }
        res.body?.cancel?.().catch(() => {});
        continue;
      }
      res.finalUrl = current;
      res.chain = chain;
      return res;
    }
    throw new HttpError(`too many redirects (${maxRedirects})`, { url: target, chain });
  }

  async function request(pathOrUrl, opts = {}) {
    const absolute = /^https?:/i.test(pathOrUrl);
    const bases = absolute ? [null] : baseUrls.map((_, i) => i);
    let lastErr;
    for (const bi of bases) {
      if (bi != null) baseIndex = bi;
      const target = url(pathOrUrl, opts.params);
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const res = await once(target, opts);
          if ((res.status === 429 || res.status >= 500) && attempt < retries) {
            const after = Number(res.headers.get('retry-after'));
            res.body?.cancel?.().catch(() => {});
            await sleep(Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 600 * (attempt + 1), 3000));
            continue;
          }
          if (opts.okOnly !== false && res.status >= 400) {
            res.body?.cancel?.().catch(() => {});
            throw new HttpError(`HTTP ${res.status}`, { status: res.status, url: res.finalUrl, chain: res.chain });
          }
          return res;
        } catch (err) {
          lastErr = err;
          if (err.status && err.status < 500 && err.status !== 429) break; // a 404 won't fix itself
        }
      }
    }
    throw lastErr;
  }

  const getText = async (p, o) => (await request(p, o)).text();
  const getJson = async (p, o) => {
    const res = await request(p, { ...o, headers: { Accept: 'application/json', ...(o?.headers || {}) } });
    try { return await res.json(); } catch (err) { throw new HttpError(`invalid JSON: ${err.message}`, { url: res.finalUrl }); }
  };

  /**
   * Checks that a media URL answers, without downloading it: HEAD, or a 1-byte ranged GET whose body is
   * discarded when the server refuses HEAD. → { ok, status, type, length, finalUrl, chain, ms }
   */
  async function probe(mediaUrl, { headers: extra = {} } = {}) {
    const started = Date.now();
    const finish = (res) => {
      const type = res.headers.get('content-type') || '';
      const range = res.headers.get('content-range');
      const length = Number(range ? range.split('/')[1] : res.headers.get('content-length')) || null;
      res.body?.cancel?.().catch(() => {});
      const media = /video|audio|mpegurl|octet-stream|mp2t|dash/i.test(type) || /\.(mp4|m4v|mkv|webm|m3u8|mpd|ogv)(\?|$)/i.test(res.finalUrl);
      return { ok: res.status < 400 && media, status: res.status, type, length, finalUrl: res.finalUrl, chain: res.chain, ms: Date.now() - started };
    };
    try {
      const res = await request(mediaUrl, { method: 'HEAD', headers: extra, okOnly: false });
      if (res.status !== 405 && res.status !== 403 && res.status !== 501) return finish(res);
    } catch { /* fall through to ranged GET */ }
    try {
      const res = await request(mediaUrl, { headers: { Range: 'bytes=0-0', ...extra }, okOnly: false });
      return finish(res);
    } catch (err) {
      return { ok: false, status: err.status || 0, error: err.message, finalUrl: mediaUrl, ms: Date.now() - started };
    }
  }

  return { request, get: request, getText, getJson, probe, url, jar, get baseUrl() { return baseUrl(); } };
}

/** Minimal HTML helpers for providers that serve plain HTML pages (no dependency on an HTML parser). */
const html = {
  decode: (s) => String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))),
  text: (s) => html.decode(String(s || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
  /** All <a href> links: [{ href (absolute), text }] */
  links: (page, base) => [...String(page).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => { try { return { href: new URL(html.decode(m[1]), base).toString(), text: html.text(m[2]) }; } catch { return null; } })
    .filter(Boolean),
  /** Value of <meta property|name="key" content="..."> */
  meta: (page, key) => {
    const re = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key.replace(/[.:]/g, '\\$&')}["'][^>]*>`, 'i');
    const tag = String(page).match(re)?.[0];
    return tag ? html.decode(tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1] || '') : '';
  },
  /** <source src> and <video src> URLs, absolute */
  videoSources: (page, base) => [...String(page).matchAll(/<(?:source|video)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => { try { return new URL(html.decode(m[1]), base).toString(); } catch { return null; } })
    .filter(Boolean),
  /** JSON-LD blocks parsed */
  jsonLd: (page) => [...String(page).matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter(Boolean),
};

module.exports = { createClient, CookieJar, HttpError, html, DEFAULT_UA };
