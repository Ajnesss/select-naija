#!/usr/bin/env node
'use strict';

// Checks every link in data/links.json and writes data/status.json.
// Polite by design: one request at a time per website, 2 s apart.
// Usage: node scripts/verify.js [--only <provider>]
//
// Two kinds of run, written to separate files so they never clash:
//   VERIFY_COUNTRY=GB  → checks region-locked provider links (ukCheckRequired) → data/status-uk.json
//                        Refuses to run unless this machine's internet connection really is in the UK
//                        (a VPN set to another country would give false results).
//   otherwise          → checks everything that isn't region-locked (direct files) → data/status.json

const fs = require('fs');
const path = require('path');
const { readJson } = require('../src/data');
const { checkExternal, checkDirect, applyResult, scoreProvider } = require('../src/verifier');

const DATA = path.join(__dirname, '..', 'data');
const DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connectionCountry() {
  for (const url of ['https://ipinfo.io/country', 'https://ipapi.co/country/']) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) return (await res.text()).trim().toUpperCase();
    } catch {
      /* try the next service */
    }
  }
  return null;
}

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const ukRun = (process.env.VERIFY_COUNTRY || '').toUpperCase() === 'GB';
  if (ukRun) {
    const country = await connectionCountry();
    if (country !== 'GB') {
      console.error(`Stopped: this connection appears to be in ${country || 'an unknown country'}, not the UK. Turn off any VPN and try again.`);
      process.exit(3);
    }
  }
  const statusFile = path.join(DATA, ukRun ? 'status-uk.json' : 'status.json');
  const providers = new Map(readJson(path.join(DATA, 'providers.json')).providers.map((p) => [p.id, p]));
  const links = readJson(path.join(DATA, 'links.json')).links.filter(
    (l) => (!only || l.provider === only) && Boolean(providers.get(l.provider)?.ukCheckRequired) === ukRun,
  );
  const accuracy = readJson(path.join(DATA, 'accuracy.json'), {});
  const status = readJson(statusFile, { links: {}, providers: {} });
  status.links = status.links || {};

  // Group by website so each site sees at most one request every DELAY_MS.
  const byHost = new Map();
  for (const l of links) {
    const host = new URL(l.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(l);
  }

  const results = [];
  await Promise.all(
    [...byHost.values()].map(async (group) => {
      for (const [i, link] of group.entries()) {
        if (i) await sleep(DELAY_MS);
        const provider = providers.get(link.provider);
        const result = link.kind === 'direct' ? await checkDirect(link) : await checkExternal(link, provider);
        status.links[link.id] = applyResult(status.links[link.id], result);
        results.push({ link, result });
        console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${link.id}${result.ok ? '' : `  (${result.reason})`}`);
      }
    }),
  );

  // Keep only records this kind of run owns, for links that still exist.
  const allLinks = readJson(path.join(DATA, 'links.json')).links;
  const providerOf = new Map(allLinks.map((l) => [l.id, l.provider]));
  for (const id of Object.keys(status.links)) {
    const pid = providerOf.get(id);
    if (!pid || Boolean(providers.get(pid)?.ukCheckRequired) !== ukRun) delete status.links[id];
  }

  status.providers = {};
  for (const [pid, p] of providers) {
    if (Boolean(p.ukCheckRequired) !== ukRun) continue;
    const records = Object.entries(status.links)
      .filter(([id]) => providerOf.get(id) === pid)
      .map(([, r]) => r);
    const s = scoreProvider(records, accuracy[pid]);
    if (s) status.providers[pid] = s;
  }
  status.generatedAt = new Date().toISOString();
  status.checkedFrom = ukRun ? 'GB (connection confirmed)' : process.env.VERIFY_LOCATION || 'unknown';

  fs.writeFileSync(statusFile, `${JSON.stringify(status, null, 1)}\n`);
  const passed = results.filter((r) => r.result.ok).length;
  console.log(`\n${passed}/${results.length} links passed. Status written to ${path.relative(path.join(DATA, '..'), statusFile)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
