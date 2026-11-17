'use strict';

// Live provider engine: loads src/providers/*.js, runs the enabled ones in parallel for one request,
// each capped by a timeout, merges their streams, and keeps per-provider health (pauses a provider after
// repeated failures). Results are cached per provider and title.
//
// Provider module contract (see src/providers/_template.js):
//   module.exports = {
//     key: 'archive',                 // matches config/providers.js
//     types: ['movie', 'series'],     // request types it can answer
//     async resolve(request, ctx) {   // → array of results for streamBuilder.build()
//       ctx.client  shared HTTP client for this provider (headers, cookies, rate limit, timeouts)
//       ctx.match(candidate)          record a search hit ({ title, year, score, ref }) for test output
//       ctx.log(step)                 record a step (shown by test.js)
//       ctx.config  provider settings; ctx.env  environment (credentials named in config.auth)
//     },
//     async coverage(ctx) { … }       // optional: { titles, episodes, sample } for reports
//   };

const fs = require('fs');
const path = require('path');
const defaults = require('../../config/providers');
const { createClient } = require('./http');
const { build, finalize } = require('./streamBuilder');
const { resolveRequest } = require('./matcher');

const PROVIDERS_DIR = path.join(__dirname, '..', 'providers');

function settingsFor(config, env) {
  const disabled = new Set(String(env.SELECT_NAIJA_PROVIDERS_DISABLE || '').split(',').map((s) => s.trim()).filter(Boolean));
  const enabled = new Set(String(env.SELECT_NAIJA_PROVIDERS_ENABLE || '').split(',').map((s) => s.trim()).filter(Boolean));
  const out = {};
  for (const [key, p] of Object.entries(config.providers)) out[key] = { ...p, enabled: !disabled.has(key) && (p.enabled || enabled.has(key)) };
  return out;
}

function loadModules(dir) {
  const mods = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = require(path.join(dir, file));
    if (mod && mod.key && typeof mod.resolve === 'function') mods.push(mod);
  }
  return mods;
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * createEngine({ config, env, fetchImpl, providers, only, includeDisabled, now })
 *   providers: array of modules (tests); default: every module in src/providers
 *   only: array of keys to run (CLI)
 */
function createEngine({ config = defaults, env = process.env, fetchImpl = fetch, providers, only, includeDisabled = false, now = () => Date.now() } = {}) {
  const settings = settingsFor(config, env);
  const mods = (providers || loadModules(PROVIDERS_DIR)).filter((m) => {
    if (only?.length) return only.includes(m.key);
    return includeDisabled || settings[m.key]?.enabled;
  });
  const clients = new Map();
  const cache = new Map();
  const health = new Map(); // key -> { ok, failures, consecutive, pausedUntil, lastError, lastOkAt, lastMs }
  const engineCfg = config.engine;

  const clientFor = (m) => {
    if (!clients.has(m.key)) {
      const s = settings[m.key] || {};
      clients.set(m.key, createClient({ baseUrls: s.baseUrls || [], headers: s.headers || {}, timeoutMs: s.timeoutMs || 8000, rateLimit: s.rateLimit || 0, fetchImpl }));
    }
    return clients.get(m.key);
  };
  const h = (key) => { if (!health.has(key)) health.set(key, { ok: 0, failures: 0, consecutive: 0, pausedUntil: 0, lastError: null, lastOkAt: null, lastMs: null }); return health.get(key); };

  async function runOne(m, request, { verify = false, useCache = true } = {}) {
    const s = settings[m.key] || {};
    const report = { provider: m.key, name: s.name || m.key, status: 'ok', ms: 0, matches: [], steps: [], results: [], error: null };
    const st = h(m.key);
    if (!m.types.includes(request.type)) { report.status = 'skipped'; report.error = `does not serve ${request.type}`; return report; }
    if (m.private && !request.private) { report.status = 'skipped'; report.error = 'private installs only'; return report; }
    const missing = Object.values(s.auth || {}).filter((name) => !env[name]);
    if (missing.length) { report.status = 'skipped'; report.error = `needs ${missing.join(', ')}`; return report; }
    if (st.pausedUntil > now()) { report.status = 'paused'; report.error = `paused after ${st.consecutive} failures: ${st.lastError}`; return report; }
    const cacheKey = `${m.key}|${request.type}|${request.imdb || request.id || request.name}|${request.year || ''}|${request.season ?? ''}|${request.episode ?? ''}`;
    const hit = useCache && cache.get(cacheKey);
    if (hit && hit.until > now()) return { ...hit.report, cached: true };
    const started = now();
    const ctx = {
      client: clientFor(m),
      config: s,
      env,
      log: (step) => report.steps.push(String(step)),
      match: (c) => report.matches.push(c),
    };
    try {
      const results = await withTimeout(Promise.resolve(m.resolve(request, ctx)), engineCfg.providerTimeoutMs, m.key);
      report.results = (results || []).filter((r) => r && r.url).map((r) => ({ ...r, provider: m.key, providerName: r.providerName || s.name || m.key }));
      if (verify) {
        await Promise.all(report.results.map(async (r) => {
          r.verified = await ctx.client.probe(r.url, { headers: r.headers });
        }));
      }
      st.ok += 1; st.consecutive = 0; st.lastOkAt = new Date(now()).toISOString();
      report.status = report.results.length ? 'ok' : 'no-match';
    } catch (err) {
      report.status = 'error';
      report.error = err.message;
      st.failures += 1; st.consecutive += 1; st.lastError = err.message;
      if (st.consecutive >= engineCfg.failureThreshold) st.pausedUntil = now() + engineCfg.pauseMinutes * 60000;
    }
    report.ms = now() - started;
    st.lastMs = report.ms;
    if (report.status !== 'error') {
      const ttl = report.status === 'ok' ? (s.cacheHours || 6) * 3600000 : engineCfg.negativeCacheMinutes * 60000;
      if (cache.size > 5000) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { until: now() + ttl, report });
    }
    return report;
  }

  /** Runs every active provider for one resolved request. → { streams, reports } */
  async function run(request, opts = {}) {
    const settled = await Promise.allSettled(mods.map((m) => runOne(m, request, opts)));
    const reports = settled.map((x, i) => (x.status === 'fulfilled' ? x.value : { provider: mods[i].key, status: 'error', error: String(x.reason), results: [], matches: [], steps: [], ms: 0 }));
    const streams = finalize(reports.flatMap((r) => r.results.map((res) => build(res))));
    return { streams, reports };
  }

  /** For the addon: Nuvio's (type, id) → stream objects. Never throws; capped by totalTimeoutMs. */
  async function streamsFor(type, id, { data, tmdbApiKey, private: isPrivate = false } = {}) {
    if (!mods.length) return [];
    try {
      return await withTimeout((async () => {
        const request = await resolveRequest(type, id, { data, fetchImpl, tmdbApiKey });
        // Select Naija answers only for titles in its own (Nigerian) catalogue.
        if (!request || request.source !== 'catalogue') return [];
        return (await run({ ...request, private: isPrivate })).streams;
      })(), engineCfg.totalTimeoutMs, 'live providers');
    } catch (err) {
      console.error(`[providers] ${type}/${id}: ${err.message}`);
      return [];
    }
  }

  const status = () => mods.map((m) => ({ provider: m.key, name: settings[m.key]?.name || m.key, types: m.types, ...h(m.key), pausedUntil: h(m.key).pausedUntil ? new Date(h(m.key).pausedUntil).toISOString() : null }));

  async function coverage() {
    const out = [];
    for (const m of mods) {
      if (typeof m.coverage !== 'function') { out.push({ provider: m.key, error: 'no coverage() method' }); continue; }
      const missing = Object.values(settings[m.key]?.auth || {}).filter((name) => !env[name]);
      if (missing.length) { out.push({ provider: m.key, error: `needs ${missing.join(', ')}` }); continue; }
      try { out.push({ provider: m.key, ...(await m.coverage({ client: clientFor(m), config: settings[m.key] || {}, env, log: () => {}, match: () => {} })) }); }
      catch (err) { out.push({ provider: m.key, error: err.message }); }
    }
    return out;
  }

  return { run, runOne, streamsFor, status, coverage, providers: mods.map((m) => m.key), settings };
}

module.exports = { createEngine, loadModules, settingsFor, withTimeout, PROVIDERS_DIR };
