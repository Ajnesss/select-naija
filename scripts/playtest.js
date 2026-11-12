#!/usr/bin/env node
'use strict';

// Playback test for candidate sources: gets a stream address the way the source's own web page does, then
// checks whether it is plain (unencrypted) HLS and whether it plays from a different internet address than the
// one it was issued to (US GitHub runner vs London check point). Writes research/out/playtest.json.

const fs = require('fs');
const path = require('path');

const EDGE = process.env.UK_EDGE_URL;
const TOKEN = process.env.UK_EDGE_TOKEN;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

async function direct(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, text: buf.toString('utf8', 0, Math.min(buf.length, 400000)), bytes: buf.length };
}
async function viaUk(url) {
  const res = await fetch(`${EDGE}/api/fetch?url=${encodeURIComponent(url)}`, { headers: { 'x-select-naija-token': TOKEN }, signal: AbortSignal.timeout(30000) });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: Number(res.headers.get('x-upstream-status') || res.status), text: buf.toString('utf8', 0, Math.min(buf.length, 400000)), bytes: buf.length };
}
const abs = (base, ref) => new URL(ref, base).toString();

async function hlsReport(name, master, fetcher) {
  const r = { name, master: master.replace(/token=[^&]+/, 'token=…').slice(0, 140) };
  try {
    const m = await fetcher(master);
    r.masterStatus = m.status;
    if (m.status !== 200) return r;
    const variant = m.text.split('\n').find((l) => l && !l.startsWith('#'));
    r.isMaster = m.text.includes('#EXT-X-STREAM-INF');
    let media = m;
    let mediaUrl = master;
    if (r.isMaster && variant) {
      mediaUrl = abs(master, variant.trim());
      media = await fetcher(mediaUrl);
      r.variantStatus = media.status;
    }
    r.encrypted = /#EXT-X-KEY:METHOD=(?!NONE)/.test(media.text) ? media.text.match(/#EXT-X-KEY:[^\n]*/)[0].slice(0, 120) : false;
    r.ads = /#EXT-X-DISCONTINUITY|#EXT-X-CUE|SCTE/i.test(media.text);
    const seg = media.text.split('\n').find((l) => l && !l.startsWith('#'));
    if (seg) {
      const s = await fetcher(abs(mediaUrl, seg.trim()));
      r.segmentStatus = s.status;
      r.segmentBytes = s.bytes;
    }
  } catch (err) {
    r.error = err.message;
  }
  return r;
}

async function main() {
  const out = [];
  // Tubi UK: stream addresses are in the public title page.
  for (const id of ['559737', '100048274']) {
    const page = await viaUk(`https://tubitv.com/movies/${id}`);
    const urls = [...new Set(page.text.match(/https:\/\/[a-z0-9\-]+\.tubi\.video\/[^"\\]+?\.m3u8\?token=[\w\-.]+/g) || [])];
    out.push({ source: 'tubi', id, pageStatus: page.status, manifests: urls.length, drmHint: /license_server|widevine|playready|fairplay/i.test(page.text) });
    if (urls[0]) {
      out.push(await hlsReport(`tubi ${id} played from London`, urls[0], viaUk));
      out.push(await hlsReport(`tubi ${id} played from US`, urls[0], direct));
    }
  }
  // Dailymotion: stream address from the public player metadata.
  for (const id of ['x6upsb9', 'x70qlsa']) {
    const meta = JSON.parse((await direct(`https://www.dailymotion.com/player/metadata/video/${id}`)).text);
    const url = meta.qualities?.auto?.[0]?.url;
    out.push({ source: 'dailymotion', id, protected: meta.protected_delivery, hasUrl: Boolean(url) });
    if (url) {
      out.push(await hlsReport(`dailymotion ${id} played from US (issued US)`, url, direct));
      out.push(await hlsReport(`dailymotion ${id} played from London (issued US)`, url, viaUk));
    }
  }
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'playtest.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

main();
