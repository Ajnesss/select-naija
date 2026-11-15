#!/usr/bin/env node
'use strict';
// Nightly YouTube stream health, step 1: the official Data API status of every video Select Naija uses.
// videos.list costs 1 quota unit per 50 videos, so ~28,000 videos ≈ 560 units of the 10,000/day free quota.
// API availability is NOT playback: scripts/check-youtube-playback.js records whether the video actually plays.
// Nothing is deleted: a failing video is marked unavailable, retried every night and restored when it passes.
// Output: data/youtube-health.json { generatedAt, videos: { <id>: record } }.
const fs = require('fs');
const path = require('path');

const DATA = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA, 'youtube-health.json');
const KEEP_CHECKS = 7;

/** Every YouTube video id the catalogue streams from (film parts and series episodes). */
function videoIds(dataDir = DATA) {
  const yt = JSON.parse(fs.readFileSync(path.join(dataDir, 'youtube.json'), 'utf8'));
  const ids = new Set();
  for (const t of yt.titles || []) {
    for (const p of [...(t.parts || []), ...(t.episodes || [])]) if (p.videoId) ids.add(p.videoId);
    for (const a of t.alternates || []) for (const p of a.parts) ids.add(p.videoId);
    for (const e of t.episodes || []) for (const o of e.alternates || []) ids.add(o.videoId);
  }
  for (const l of JSON.parse(fs.readFileSync(path.join(dataDir, 'links.json'), 'utf8')).links || []) if (l.ytId) ids.add(l.ytId);
  return [...ids];
}

const seconds = (iso) => {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) : null;
};

/**
 * One API item (or its absence) → { api, reason }. api 'ok' only when the video is public or unlisted, processed,
 * embeddable (the only permitted way to show it in another app), not age-restricted and not blocked in the UK.
 */
function classify(item, region = 'GB') {
  if (!item) return { api: 'gone', reason: 'deleted, private or removed' };
  const st = item.status || {};
  const cd = item.contentDetails || {};
  if (st.privacyStatus === 'private') return { api: 'gone', reason: 'private' };
  if (st.uploadStatus && st.uploadStatus !== 'processed') {
    return { api: st.uploadStatus === 'uploaded' ? 'processing' : 'gone', reason: `upload ${st.uploadStatus}${st.rejectionReason ? ` (${st.rejectionReason})` : ''}` };
  }
  const rr = cd.regionRestriction || {};
  if ((rr.allowed && !rr.allowed.includes(region)) || (rr.blocked || []).includes(region)) return { api: 'region', reason: `blocked in ${region}` };
  if (st.embeddable === false) return { api: 'no-embed', reason: 'owner does not allow playback outside YouTube' };
  if (cd.contentRating?.ytRating === 'ytAgeRestricted') return { api: 'age', reason: 'age-restricted (needs a signed-in YouTube account)' };
  return { api: 'ok', reason: null };
}

/** Folds one night's API result into a video's record. Temporary failures never erase lastOkAt. */
function applyApi(prev = {}, item, at) {
  const { api, reason } = classify(item);
  const ok = api === 'ok';
  const cd = item?.contentDetails || {};
  return {
    ...prev,
    api,
    reason,
    definition: cd.definition || prev.definition || null,
    seconds: seconds(cd.duration) ?? prev.seconds ?? null,
    checkedAt: at,
    lastOkAt: ok ? at : prev.lastOkAt || null,
    failingSince: ok ? null : prev.failingSince || at,
    checks: [...(prev.checks || []), ok].slice(-KEEP_CHECKS),
  };
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    console.log('YOUTUBE_API_KEY not set; keeping the previous health file');
    return;
  }
  const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { videos: {} };
  const ids = videoIds();
  const at = new Date().toISOString();
  const videos = {};
  let calls = 0;
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=status,contentDetails&id=${batch.join(',')}`
      + `&fields=items(id,status(uploadStatus,privacyStatus,embeddable,rejectionReason),contentDetails(duration,definition,regionRestriction,contentRating/ytRating))&key=${key}`;
    let res;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      res = await fetch(url).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
      if (res.ok || res.status === 403) break;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    calls += 1;
    if (!res.ok) {
      // Quota or network trouble: keep yesterday's records for the rest rather than marking them unavailable.
      console.log(`API stopped at ${i}/${ids.length}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      for (const id of ids.slice(i)) if (prev.videos?.[id]) videos[id] = prev.videos[id];
      break;
    }
    const items = new Map(((await res.json()).items || []).map((it) => [it.id, it]));
    for (const id of batch) videos[id] = applyApi(prev.videos?.[id], items.get(id), at);
  }
  const count = {};
  for (const v of Object.values(videos)) count[v.api] = (count[v.api] || 0) + 1;
  fs.writeFileSync(FILE, `${JSON.stringify({ generatedAt: at, videos }, null, 0)}\n`);
  console.log(`checked ${ids.length} videos in ${calls} API calls (${calls} quota units):`, count);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { classify, applyApi, videoIds, seconds };
