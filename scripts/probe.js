#!/usr/bin/env node
'use strict';

// Research probes for source discovery. Run by the "Research probes" GitHub Action (manual only).
// Fetches each address in research/probes.json and saves status, headers and the first part of the body
// to research/out/<name>.txt so sources can be assessed. Never part of the addon itself.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'research', 'out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function main() {
  const probes = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', 'probes.json'), 'utf8')).probes;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const key = process.env.TMDB_API_KEY || '';
  for (const p of probes) {
    const url = p.url.replace('{TMDB}', encodeURIComponent(key));
    let text;
    try {
      const res = await fetch(url, {
        method: p.method || 'GET',
        headers: { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9', ...(p.headers || {}) },
        body: p.body,
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      });
      const body = await res.text();
      text = `URL: ${p.url}\nFINAL: ${res.url.replace(key, '***')}\nSTATUS: ${res.status}\nTYPE: ${res.headers.get('content-type')}\nLENGTH: ${body.length}\n\n${body.slice(0, p.max || 60000)}`;
    } catch (err) {
      text = `URL: ${p.url}\nERROR: ${err.message}`;
    }
    fs.writeFileSync(path.join(OUT, `${p.name}.txt`), key ? text.split(key).join('***') : text);
    console.log(`${p.name}: ${text.split('\n').slice(1, 3).join(' ')}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

main();
