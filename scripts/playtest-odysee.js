#!/usr/bin/env node
'use strict';

// Odysee / LBRY research: finds Nigerian film channels and tests whether their videos give a direct stream
// that plays from another location. Writes research/out/odysee.json.

const fs = require('fs');
const path = require('path');

const PROXY = 'https://api.na-backend.odysee.com/api/v1/proxy';
const EDGE = process.env.UK_EDGE_URL;
const TOKEN = process.env.UK_EDGE_TOKEN;
const QUERIES = ['nollywood', 'nollywood full movie', 'yoruba movie', 'igbo movie', 'hausa film', 'kannywood', 'nigerian movie', 'nollywood series'];

async function rpc(method, params) {
  const res = await fetch(`${PROXY}?m=${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
  return body.result;
}

async function head(url, viaUk) {
  const target = viaUk ? `${EDGE}/api/fetch?url=${encodeURIComponent(url)}` : url;
  const res = await fetch(target, {
    headers: { range: 'bytes=0-1023', ...(viaUk ? { 'x-select-naija-token': TOKEN } : {}) },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    status: viaUk ? Number(res.headers.get('x-upstream-status')) : res.status,
    type: res.headers.get('content-type'),
    finalUrl: viaUk ? res.headers.get('x-upstream-url') : res.url,
    magic: buf.subarray(4, 12).toString('latin1'),
  };
}

async function main() {
  const urls = new Set();
  for (const q of QUERIES) {
    const res = await fetch(`https://lighthouse.odysee.tv/search?s=${encodeURIComponent(q)}&size=100&from=0&claimType=file&mediaType=video`, { signal: AbortSignal.timeout(30000) });
    for (const hit of await res.json()) urls.add(`lbry://${hit.name}#${hit.claimId}`);
  }
  const list = [...urls];
  const resolved = {};
  for (let i = 0; i < list.length; i += 50) Object.assign(resolved, await rpc('resolve', { urls: list.slice(i, i + 50) }));
  const channels = {};
  const films = [];
  for (const [url, c] of Object.entries(resolved)) {
    if (!c || c.error) continue;
    const v = c.value || {};
    const minutes = Math.round((v.video?.duration || v.audio?.duration || 0) / 60);
    const ch = c.signing_channel?.name || '(anonymous)';
    channels[ch] = channels[ch] || { title: c.signing_channel?.value?.title, videos: 0, longVideos: 0, examples: [] };
    channels[ch].videos++;
    if (minutes >= 40) {
      channels[ch].longVideos++;
      if (channels[ch].examples.length < 4) channels[ch].examples.push(`${v.title} (${minutes} min)`);
      films.push({ url, channel: ch, title: v.title, minutes, license: v.license || null, mediaType: v.source?.media_type });
    }
  }
  // Playback test on a few long videos: get the stream address, then request it from the US and from London.
  const tests = [];
  for (const f of films.slice(0, 4)) {
    try {
      const got = await rpc('get', { uri: f.url, save_file: false });
      const stream = got.streaming_url;
      tests.push({ title: f.title, channel: f.channel, stream, us: await head(stream, false), uk: EDGE ? await head(stream, true) : null });
    } catch (err) {
      tests.push({ title: f.title, error: err.message });
    }
  }
  const out = { searched: QUERIES, claimsFound: list.length, channels, longFilms: films.length, tests };
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'odysee.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ claimsFound: out.claimsFound, longFilms: out.longFilms, tests }, null, 1));
}

main();
