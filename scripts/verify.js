#!/usr/bin/env node
'use strict';

// Checks every link in data/links.json and writes data/status.json.
// Polite by design: one request at a time per website, 2 s apart.
// Usage: node scripts/verify.js [--only <provider>]

const fs = require('fs');
const path = require('path');
const { readJson } = require('../src/data');
const { checkExternal, checkDirect, applyResult, scoreProvider } = require('../src/verifier');

const DATA = path.join(__dirname, '..', 'data');
const DELAY_MS = Number(process.env.VERIFY_DELAY_MS ?? 2000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
  const links = readJson(path.join(DATA, 'links.json')).links.filter((l) => !only || l.provider === only);
  const providers = new Map(readJson(path.join(DATA, 'providers.json')).providers.map((p) => [p.id, p]));
  const accuracy = readJson(path.join(DATA, 'accuracy.json'), {});
  const status = readJson(path.join(DATA, 'status.json'), { links: {}, providers: {} });
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

  // Drop records for links that no longer exist.
  const allLinks = readJson(path.join(DATA, 'links.json')).links;
  const providerOf = new Map(allLinks.map((l) => [l.id, l.provider]));
  for (const id of Object.keys(status.links)) if (!providerOf.has(id)) delete status.links[id];

  status.providers = {};
  for (const [pid] of providers) {
    const records = Object.entries(status.links)
      .filter(([id]) => providerOf.get(id) === pid)
      .map(([, r]) => r);
    const s = scoreProvider(records, accuracy[pid]);
    if (s) status.providers[pid] = s;
  }
  status.generatedAt = new Date().toISOString();
  status.checkedFrom = process.env.VERIFY_LOCATION || 'unknown';

  fs.writeFileSync(path.join(DATA, 'status.json'), `${JSON.stringify(status, null, 1)}\n`);
  const passed = results.filter((r) => r.result.ok).length;
  console.log(`\n${passed}/${results.length} links passed. Status written to data/status.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
