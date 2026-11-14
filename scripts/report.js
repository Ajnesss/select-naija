#!/usr/bin/env node
'use strict';

// Coverage and reliability report. Writes reports/coverage.md and reports/coverage.json.
// A title is covered only when at least one verified (or stale) Select Naija link is shown for it.
// TMDB/JustWatch "where to watch" offers are NOT counted: they are unverified by us.
// With --gate, exits 2 if coverage in any group or language fell more than 5 points since the last report,
// or a provider scored under 50 (its links are hidden, which must be a conscious decision before release).

const fs = require('fs');
const path = require('path');
const { loadData, readJson, LANGUAGES } = require('../src/data');
const { isAvailable } = require('../src/catalog');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'reports');
const GATE_DROP = 5;
const { MIN_CHECKS } = require('../src/streams');

function pct(n, d) {
  return d ? Math.round((1000 * n) / d) / 10 : null;
}

function main() {
  const now = Date.now();
  const data = loadData(DATA);
  const testset = readJson(path.join(DATA, 'testset.json')).titles;
  const previous = readJson(path.join(OUT, 'coverage.json'), null);

  const groups = {};
  const missing = [];
  for (const entry of testset) {
    const t = data.byId.get(entry.id);
    const covered = t ? isAvailable(t, data, now) : false;
    groups[entry.group] = groups[entry.group] || { total: 0, covered: 0 };
    groups[entry.group].total += 1;
    if (covered) groups[entry.group].covered += 1;
    else missing.push({ ...entry, name: t?.name || '(not in catalogue)' });
  }

  const languages = {};
  for (const t of data.titles) {
    if (t.category === 'test') continue;
    for (const l of t.languages || []) {
      languages[l] = languages[l] || { catalogued: 0, covered: 0, withoutTmdb: 0 };
      languages[l].catalogued += 1;
      if (isAvailable(t, data, now)) languages[l].covered += 1;
      if (!/^tt\d+$/.test(t.id)) languages[l].withoutTmdb += 1;
    }
  }

  // Source breakdown: playable titles per provider and per channel (a title with streams from two sources
  // counts for both), and how much of the catalogue depends on YouTube alone.
  const bySource = {};
  const byChannel = {};
  const { linkState, isShown } = require('../src/states');
  let playable = 0;
  let youtubeOnly = 0;
  // Genuine multi-source progress: titles with at least one shown in-app stream that is NOT YouTube.
  let nonYoutube = 0;
  const nonYoutubeBySource = {};
  for (const t of data.titles) {
    if (t.category === 'test') continue;
    const shown = (data.linksByTitle.get(t.id) || []).filter((l) => isShown(linkState(data.status.links[l.id], now)));
    if (!shown.length) continue;
    playable += 1;
    const providers = new Set(shown.map((l) => data.providerById.get(l.provider)?.name || l.provider));
    if (providers.size === 1 && providers.has('YouTube')) youtubeOnly += 1;
    const independent = new Set(shown.filter((l) => l.kind === 'direct').map((l) => data.providerById.get(l.provider)?.name || l.provider));
    if (independent.size) nonYoutube += 1;
    for (const p of independent) nonYoutubeBySource[p] = (nonYoutubeBySource[p] || 0) + 1;
    for (const p of providers) bySource[p] = (bySource[p] || 0) + 1;
    for (const c of new Set(shown.map((l) => `${data.providerById.get(l.provider)?.name || l.provider}: ${l.source || l.providerName || '-'}`)))
      byChannel[c] = (byChannel[c] || 0) + 1;
  }

  const report = {
    playable,
    youtubeOnly,
    youtubeShare: pct(youtubeOnly, playable),
    nonYoutube,
    nonYoutubeBySource,
    bySource,
    byChannel,
    generatedAt: new Date(now).toISOString(),
    statusGeneratedAt: data.statusGeneratedAt,
    groups: Object.fromEntries(Object.entries(groups).map(([g, v]) => [g, { ...v, coverage: pct(v.covered, v.total) }])),
    languages: Object.fromEntries(
      Object.entries(languages).map(([l, v]) => [l, { ...v, coverage: pct(v.covered, v.catalogued) }]),
    ),
    providers: data.status.providers,
    gaps: missing,
  };

  const lines = [
    `# Select Naija coverage report`,
    ``,
    `Generated ${report.generatedAt}. Links last verified ${report.statusGeneratedAt || 'never'}.`,
    `A title counts as covered only if a verified Select Naija link is shown for it.`,
    ``,
    `## Test catalogue by group`,
    ``,
    `| Group | Covered | Total | Coverage |`,
    `| --- | --- | --- | --- |`,
    ...Object.entries(report.groups).map(([g, v]) => `| ${g} | ${v.covered} | ${v.total} | ${v.coverage ?? '–'}% |`),
    ``,
    `## Catalogue by language`,
    ``,
    `| Language | Catalogued | Covered | Coverage | Without TMDB/IMDb ID |`,
    `| --- | --- | --- | --- | --- |`,
    ...Object.entries(report.languages).map(
      ([l, v]) => `| ${LANGUAGES[l] || l} | ${v.catalogued} | ${v.covered} | ${v.coverage ?? '–'}% | ${v.withoutTmdb} |`,
    ),
    ``,
    `## Source breakdown (plays inside Nuvio)`,
    ``,
    `${report.playable} playable titles; ${report.youtubeOnly} (${report.youtubeShare ?? 0}%) rely on YouTube alone.`,
    ``,
    `**Unique non-YouTube playable titles: ${report.nonYoutube}** (titles with at least one in-app stream from an independent provider; external links, live channels, trailers and YouTube duplicates are not counted).`,
    ``,
    ...(Object.keys(report.nonYoutubeBySource).length
      ? [`| Independent provider | Playable titles |`, `| --- | --- |`, ...Object.entries(report.nonYoutubeBySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`), ``]
      : []),
    `| Provider | Playable titles |`,
    `| --- | --- |`,
    ...Object.entries(report.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    ``,
    `| Provider: channel | Playable titles |`,
    `| --- | --- |`,
    ...Object.entries(report.byChannel).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    ``,
    `## Providers`,
    ``,
    `| Provider | Score | Reliability 30d | Accuracy | Freshness | Checks 30d |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...Object.entries(report.providers).map(
      ([p, v]) => `| ${data.providerById.get(p)?.name || p} | ${v.score} | ${v.reliability30d}% | ${v.accuracy}% | ${v.freshness}% | ${v.checks30d} |`,
    ),
    ``,
    `## Gaps: test titles with no verified source`,
    ``,
    ...(missing.length ? missing.map((m) => `- ${m.name} (${m.id}, ${m.group})`) : ['None.']),
    ``,
  ];

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'coverage.md'), lines.join('\n'));
  fs.writeFileSync(path.join(OUT, 'coverage.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(lines.join('\n'));

  if (process.argv.includes('--gate')) {
    const problems = [];
    if (previous) {
      for (const [g, v] of Object.entries(report.groups)) {
        const before = previous.groups?.[g]?.coverage;
        if (before != null && v.coverage != null && before - v.coverage > GATE_DROP)
          problems.push(`group ${g} coverage fell ${before}% → ${v.coverage}%`);
      }
      for (const [l, v] of Object.entries(report.languages)) {
        const before = previous.languages?.[l]?.coverage;
        if (before != null && v.coverage != null && before - v.coverage > GATE_DROP)
          problems.push(`language ${l} coverage fell ${before}% → ${v.coverage}%`);
      }
    }
    for (const [p, v] of Object.entries(report.providers))
      if (v.score < 50 && v.checks30d >= MIN_CHECKS) problems.push(`provider ${p} scored ${v.score}`);
    if (problems.length) {
      console.error(`\nRELEASE BLOCKED:\n- ${problems.join('\n- ')}`);
      process.exit(2);
    }
    console.log('\nRelease gate passed.');
  }
}

main();
