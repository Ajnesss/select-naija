'use strict';

const { containsPhrase, normalize } = require('./text');
const { DAY } = require('./states');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SelectNaijaVerifier/0.1';
const MAX_HTML = 2 * 1024 * 1024;
const KEEP_CHECKS = 60;

async function readLimited(res, limit) {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * External link check: the page must load, must name the expected title,
 * and must not carry the provider's "unavailable" wording.
 * "The page opens" is not enough — Tubi's page for a removed film still loads.
 */
async function checkExternal(link, provider, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetchImpl(link.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT, 'accept-language': 'en-GB,en;q=0.9', accept: 'text/html,*/*' },
    });
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
  if (!res.ok) return { ok: false, reason: `http_${res.status}` };
  const html = await readLimited(res, MAX_HTML);
  const text = normalize(html);
  for (const marker of provider.unavailableMarkers || []) {
    if (text.includes(normalize(marker))) return { ok: false, reason: `unavailable:${marker}` };
  }
  if (link.expectTitle && !containsPhrase(html, link.expectTitle)) return { ok: false, reason: 'title_not_on_page' };
  return { ok: true, finalUrl: res.url || link.url };
}

function looksLikeVideo(contentType, firstBytes) {
  if (/^video\//i.test(contentType) || /mpegurl/i.test(contentType)) return true;
  const head = Buffer.from(firstBytes || []);
  if (head.length >= 8 && head.toString('latin1', 4, 8) === 'ftyp') return true; // MP4/MOV
  if (head.toString('utf8', 0, 7) === '#EXTM3U') return true; // HLS playlist
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return true; // Matroska/WebM
  return false;
}

/**
 * Direct (in-app) check: follows redirects itself and records the final file address,
 * because Nuvio's player failed on a redirecting Internet Archive link in testing.
 */
async function checkDirect(link, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  let res;
  try {
    res = await fetchImpl(link.url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT, range: 'bytes=0-2047' },
    });
  } catch (err) {
    return { ok: false, reason: err.name === 'TimeoutError' ? 'timeout' : 'network_error' };
  }
  if (res.status !== 200 && res.status !== 206) return { ok: false, reason: `http_${res.status}` };
  let bytes = Buffer.alloc(0);
  try {
    const reader = res.body?.getReader();
    if (reader) {
      const { value } = await reader.read();
      bytes = Buffer.from(value || []);
      reader.cancel().catch(() => {});
    }
  } catch {
    /* content-type alone may still decide */
  }
  if (!looksLikeVideo(res.headers.get('content-type') || '', bytes)) return { ok: false, reason: 'not_a_video' };
  return { ok: true, finalUrl: res.url || link.url };
}

/**
 * Hands-off UK check for a region-locked provider link, run from outside the UK (the nightly GitHub run).
 * The page check has already passed; this adds the UK answer from JustWatch's UK data (via TMDB) when the
 * provider is one JustWatch tracks in the UK. Not listed there → fails as not in the UK. No answer
 * possible (custom-ID title, provider not tracked, TMDB down) → passes as 'page-only', which Nuvio labels.
 */
async function confirmUk(pageResult, link, provider, title, lookup) {
  if (!pageResult.ok) return pageResult;
  const uk = await lookup(link.titleId, title?.type === 'series' ? 'series' : 'movie');
  if (!uk.known) return { ...pageResult, ukSignal: 'page-only' };
  if (uk.providers.has(link.provider)) return { ...pageResult, ukSignal: 'justwatch' };
  // Only providers whose JustWatch UK data has proved complete may be failed on its absence.
  // Plex isn't one: Nollywood Babylon plays on Plex in the UK, but JustWatch UK doesn't list it there.
  if (provider.justwatchTracked)
    return { ok: false, reason: 'not_in_uk:justwatch', ukListed: (uk.names || []).join(', ') || null };
  return { ...pageResult, ukSignal: 'page-only' };
}

function applyResult(record, result, now = Date.now()) {
  const at = new Date(now).toISOString();
  const next = { ...(record || {}) };
  next.checks = [...(next.checks || []), { at, ok: result.ok, reason: result.reason || null }].slice(-KEEP_CHECKS);
  next.lastCheck = at;
  next.lastReason = result.ok ? null : result.reason;
  if (result.ukListed !== undefined) next.ukListed = result.ukListed;
  if (result.ok) {
    next.lastOk = at;
    if (result.finalUrl) next.finalUrl = result.finalUrl;
    if (result.ukSignal) next.ukSignal = result.ukSignal;
  }
  return next;
}

/**
 * Provider score 0–100: 30-day link reliability (60%), hand-sampled accuracy (30%), freshness (10%).
 * null when a provider has no checks yet.
 */
function scoreProvider(records, accuracy, now = Date.now()) {
  const recent = [];
  const lastChecks = [];
  for (const r of records) {
    for (const c of r.checks || []) if (now - Date.parse(c.at) <= 30 * DAY) recent.push(c.ok);
    if (r.lastCheck) lastChecks.push(now - Date.parse(r.lastCheck));
  }
  if (!recent.length) return null;
  const reliability = (100 * recent.filter(Boolean).length) / recent.length;
  const acc = accuracy && accuracy.sampled ? (100 * accuracy.correct) / accuracy.sampled : 100;
  lastChecks.sort((a, b) => a - b);
  const medianAge = lastChecks[Math.floor(lastChecks.length / 2)] / DAY;
  const freshness = medianAge <= 2 ? 100 : Math.max(0, 100 - ((medianAge - 2) / 12) * 100);
  return {
    score: Math.round(0.6 * reliability + 0.3 * acc + 0.1 * freshness),
    reliability30d: Math.round(reliability),
    accuracy: Math.round(acc),
    freshness: Math.round(freshness),
    checks30d: recent.length,
  };
}

module.exports = { checkExternal, checkDirect, confirmUk, applyResult, scoreProvider, looksLikeVideo, USER_AGENT };
