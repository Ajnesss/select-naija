#!/usr/bin/env node
'use strict';

// Live provider test runner.
//   node test.js "Blood Sisters"                 search every enabled provider for a title
//   node test.js "Blood Sisters (2022)"          with a release year (±1 year tolerance)
//   node test.js tt19896958                      resolve an IMDb ID (Cinemeta, then TMDB if TMDB_API_KEY is set)
//   node test.js tt1234567:1:2 --type series     an episode
//   node test.js "Title" --provider archive      only one provider (repeatable; includes disabled ones)
//   node test.js "Title" --all                   include disabled providers
//   node test.js --coverage                      how many Nigerian titles each provider exposes
//   options: --no-verify (skip HEAD checks)  --json (machine-readable output)

const { createEngine } = require('./src/engine');
const { resolveRequest, fromText, parseId } = require('./src/engine/matcher');
const { loadData } = require('./src/data');
const path = require('path');

function args(argv) {
  const out = { query: null, type: null, providers: [], all: false, verify: true, json: false, coverage: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--type') out.type = argv[++i];
    else if (a === '--provider') out.providers.push(argv[++i]);
    else if (a === '--all') out.all = true;
    else if (a === '--no-verify') out.verify = false;
    else if (a === '--json') out.json = true;
    else if (a === '--coverage') out.coverage = true;
    else out.query = out.query ? `${out.query} ${a}` : a;
  }
  return out;
}

const c = process.stdout.isTTY ? { g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, b: (s) => `\x1b[1m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` } : { g: String, r: String, y: String, b: String, d: String };

(async () => {
  const opt = args(process.argv.slice(2));
  const engine = createEngine({ only: opt.providers.length ? opt.providers : null, includeDisabled: opt.all });
  if (!engine.providers.length) { console.error('No providers selected/enabled.'); process.exit(2); }

  if (opt.coverage) {
    const cov = await engine.coverage();
    if (opt.json) return console.log(JSON.stringify(cov, null, 2));
    for (const x of cov) {
      console.log(c.b(`\n${x.provider}`), x.error ? c.r(x.error) : `${x.titles} title(s)${x.matchedQuery != null ? ` (query matched ${x.matchedQuery})` : ''}`);
      if (x.typeCounts) console.log(c.d(`  types: ${JSON.stringify(x.typeCounts)}`));
      for (const s of x.sample || []) console.log(`  · ${s}`);
    }
    return;
  }
  if (!opt.query) { console.error('Usage: node test.js "<title>" | <imdb id> [--type movie|series] [--provider key] [--all] [--no-verify] [--json] | --coverage'); process.exit(2); }

  let data = null;
  try { data = loadData(path.join(__dirname, 'data')); } catch { /* catalogue optional for the CLI */ }
  const ref = parseId(opt.query);
  const type = opt.type || (ref.episode != null ? 'series' : 'movie');
  const request = ref.kind !== 'local' || data?.byId?.has(ref.id)
    ? await resolveRequest(type, opt.query, { data, tmdbApiKey: process.env.TMDB_API_KEY })
    : fromText(opt.query, type);
  if (!request) { console.error(c.r(`Could not resolve ${opt.query} (try a title, or set TMDB_API_KEY)`)); process.exit(1); }

  const started = Date.now();
  const { streams, reports } = await engine.run({ ...request, private: true }, { verify: opt.verify, useCache: false });
  if (opt.json) return console.log(JSON.stringify({ request, reports, streams }, null, 2));

  console.log(c.b(`\n${request.name}${request.year ? ` (${request.year})` : ''}`), c.d(`[${request.type}${request.season != null ? ` S${request.season}E${request.episode}` : ''}] resolved via ${request.source}`));
  for (const r of reports) {
    const tag = r.status === 'ok' ? c.g('OK') : r.status === 'no-match' ? c.y('NO MATCH') : r.status === 'skipped' ? c.d('SKIPPED') : c.r(r.status.toUpperCase());
    console.log(`\n${c.b(r.name)} ${tag} ${c.d(`${r.ms} ms`)}${r.error ? ` ${c.r(r.error)}` : ''}`);
    for (const s of r.steps) console.log(c.d(`  › ${s}`));
    for (const m of r.matches) console.log(`  match: ${m.title}${m.year ? ` (${m.year})` : ''} score ${m.score}${m.licence ? ` · ${m.licence}` : ''}\n         ${c.d(m.ref || '')}`);
    for (const x of r.results) {
      const v = x.verified;
      const vtxt = !v ? c.d('not checked') : v.ok ? c.g(`HTTP ${v.status} ${v.type} ${v.length ? `${Math.round(v.length / 1e6)} MB` : ''} ${v.ms} ms`) : c.r(`HTTP ${v.status || '-'} ${v.type || v.error || ''}`);
      console.log(`  stream${x.part ? ` part ${x.part}/${x.partCount}` : ''}: ${x.url}\n         ${vtxt}${v?.finalUrl && v.finalUrl !== x.url ? c.d(` → ${v.finalUrl}`) : ''}`);
    }
  }
  const verified = reports.flatMap((r) => r.results).filter((x) => x.verified?.ok).length;
  console.log(c.b(`\n${streams.length} stream(s) from ${reports.filter((r) => r.results.length).length} provider(s)`), opt.verify ? `· ${verified} answered as media` : '', c.d(`· ${Date.now() - started} ms`));
  console.log(c.d('A link that answers is not proof it plays: playback is confirmed separately in Nuvio.'));
})().catch((err) => { console.error(err); process.exit(1); });
