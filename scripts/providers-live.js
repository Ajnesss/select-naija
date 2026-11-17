#!/usr/bin/env node
'use strict';

// Runs every live provider against a fixed list of Nigerian titles plus each provider's coverage query,
// checks every returned link, and writes reports/providers-live.{json,md}. Used by .github/workflows/providers-live.yml.

const fs = require('fs');
const path = require('path');
const { createEngine } = require('../src/engine');
const { fromText } = require('../src/engine/matcher');

const TITLES = [
  'Living in Bondage (1992)', 'Osuofia in London (2003)', 'Blood Sisters (2022)', 'Anikulapo (2022)', 'King of Boys (2018)',
  'The Wedding Party (2016)', 'Lionheart (2018)', 'Ajani Ogun (1976)', 'Shaihu Umar (1976)', 'Daybreak in Udi (1949)',
  'Kongi\'s Harvest (1970)', 'Saworoide (1999)', 'Thunderbolt (2000)', 'Ije (2010)', 'Half of a Yellow Sun (2013)',
  'October 1 (2014)', 'The Figurine (2009)', 'Eyimofe (2020)', 'Juju Stories (2021)', 'Mami Wata (2023)',
  'God Calling (2018)', 'Stranded', 'Land of Fury', 'The Train', 'Ipenija', 'Eternal Verdict',
];

(async () => {
  const engine = createEngine({ includeDisabled: false });
  const coverage = await engine.coverage();
  const runs = [];
  for (const t of TITLES) {
    const req = { ...fromText(t, 'movie'), private: true };
    const { reports } = await engine.run(req, { verify: true, useCache: false });
    runs.push({ query: t, reports: reports.map((r) => ({ provider: r.provider, status: r.status, ms: r.ms, error: r.error, steps: r.steps, matches: r.matches, results: r.results.map((x) => ({ url: String(x.url).replace(/(playbackToken|token|Signature|Key-Pair-Id|Policy)=[^&]+/g, '$1=<removed>'), part: x.part, quality: x.quality, licence: x.licence, verified: x.verified && { ok: x.verified.ok, status: x.verified.status, type: x.verified.type, length: x.verified.length } })) })) });
  }
  const out = { generatedAt: new Date().toISOString(), providers: engine.providers, coverage, runs };
  const dir = path.join(__dirname, '..', 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'providers-live.json'), JSON.stringify(out, null, 2));
  const lines = [`# Live providers — ${out.generatedAt}`, '', '## Coverage', ''];
  for (const c of coverage) lines.push(`- **${c.provider}**: ${c.error ? `error: ${c.error}` : `${c.titles} title(s)${c.episodes ? `, ${c.episodes} episode(s)` : ''}${c.typeCounts ? ` · types ${JSON.stringify(c.typeCounts)}` : ''}`}${c.sample?.length ? `\n  - ${c.sample.join('\n  - ')}` : ''}`);
  lines.push('', '## Title runs', '', '| Title | ' + engine.providers.join(' | ') + ' |', '| --- | ' + engine.providers.map(() => '---').join(' | ') + ' |');
  for (const r of runs) {
    lines.push(`| ${r.query} | ${engine.providers.map((p) => {
      const x = r.reports.find((y) => y.provider === p);
      if (!x) return '-';
      const ok = x.results.filter((y) => y.verified?.ok).length;
      return x.status === 'ok' ? `${x.results.length} link(s), ${ok} answered` : x.status === 'error' ? `error: ${x.error}` : x.status;
    }).join(' | ')} |`);
  }
  fs.writeFileSync(path.join(dir, 'providers-live.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
})().catch((err) => { console.error(err); process.exit(1); });
