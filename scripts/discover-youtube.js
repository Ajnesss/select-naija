#!/usr/bin/env node
'use strict';

// Reads the approved YouTube channels (data/channels.json, platform "youtube") through the official YouTube
// Data API v3 and writes data/youtube.json: one catalogue title per film, with its parts in order. Each film is
// handed to Nuvio as a YouTube video ID (ytId), which the app plays itself. Runs in the nightly GitHub Action
// with YOUTUBE_API_KEY. A video counts only if it is public, embeddable, processed, long enough to be a film or
// part of one, and not region-blocked in the UK (contentDetails.regionRestriction).
// Quota: about 2 units per 50 videos per channel, well inside the free 10,000 units a day.

const fs = require('fs');
const path = require('path');
const { buildTitles } = require('./discover-dailymotion');
const { normalize } = require('../src/text');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'youtube.json');
const API = 'https://www.googleapis.com/youtube/v3';
const MAX_VIDEOS_PER_CHANNEL = 20000;

async function api(pathAndQuery, key) {
  const res = await fetch(`${API}/${pathAndQuery}&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30000) });
  const body = await res.json();
  if (!res.ok) throw new Error(`YouTube API ${res.status}: ${body?.error?.message || ''}`.slice(0, 300));
  return body;
}

/** ISO 8601 duration (PT1H45M3S) → seconds. */
function seconds(iso) {
  const m = String(iso || '').match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/** YouTube's region restriction → Dailymotion-style geoblocking list understood by buildTitles. */
function geoblocking(rr) {
  if (!rr) return ['allow'];
  if (rr.allowed) return ['allow', ...rr.allowed.map((c) => c.toLowerCase())];
  if (rr.blocked) return ['deny', ...rr.blocked.map((c) => c.toLowerCase())];
  return ['allow'];
}

// Channels listed by name are looked up once (YouTube search, 100 quota units) and the ID is remembered in
// data/youtube-channels.json; the closest-named channel with the most subscribers is taken and logged.
const RESOLVED = path.join(ROOT, 'data', 'youtube-channels.json');

const norm = (x) => normalize(String(x)).replace(/[^a-z0-9]/g, '');
const same = (a, b) => norm(a) === norm(b) || (norm(a).length >= 6 && (norm(a).includes(norm(b)) || norm(b).includes(norm(a))));

async function channelIdFor(channel, key, cache) {
  if (channel.channelId) return channel.channelId;
  if (cache[channel.search]) {
    const c = cache[channel.search];
    c.exactName = c.exactName || same(c.title, channel.search);
    return c.id;
  }
  const body = await api(`search?part=snippet&type=channel&maxResults=5&q=${encodeURIComponent(channel.search)}`, key);
  const hits = (body.items || []).map((i) => ({ id: i.snippet.channelId, title: i.snippet.channelTitle }));
  const exact = hits.find((h) => same(h.title, channel.search)) || hits[0];
  if (!exact) throw new Error(`no channel found for "${channel.search}"`);
  cache[channel.search] = { ...exact, exactName: same(exact.title, channel.search), at: new Date().toISOString() };
  return exact.id;
}

async function resolveChannel(channel, key, cache = {}) {
  // A channel listed by its @handle is looked up directly (exact, 1 quota unit) instead of by name search.
  const q = channel.handle && !channel.channelId
    ? `forHandle=${encodeURIComponent(channel.handle)}`
    : `id=${await channelIdFor(channel, key, cache)}`;
  const body = await api(`channels?part=snippet,contentDetails,statistics&${q}`, key);
  const c = body.items?.[0];
  if (!c) throw new Error(`channel not found (${channel.channelId || channel.handle})`);
  return {
    id: c.id,
    title: c.snippet.title,
    uploads: c.contentDetails.relatedPlaylists.uploads,
    subscribers: Number(c.statistics.subscriberCount || 0),
    videoCount: Number(c.statistics.videoCount || 0),
  };
}

// Every channel's upload list is kept in data/youtube-videos.json. Nightly runs only fetch uploads newer than
// the newest one already known (a few quota units); a full re-read once a week picks up removals, region
// changes and edits. Parsing improvements can be re-applied to the stored list without using any quota.
const VIDEO_CACHE = path.join(ROOT, 'data', 'youtube-videos.json');
const FULL_EVERY_MS = 7 * 24 * 3600 * 1000;

async function videoDetails(ids, key) {
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const body = await api(`videos?part=snippet,contentDetails,status&id=${ids.slice(i, i + 50).join(',')}`, key);
    for (const v of body.items || []) {
      videos.push({
        id: v.id,
        title: v.snippet.title,
        description: String(v.snippet.description || '').slice(0, 300),
        duration: seconds(v.contentDetails.duration),
        definition: v.contentDetails.definition || null,
        created_time: Math.floor(Date.parse(v.snippet.publishedAt) / 1000),
        thumbnail_720_url: v.snippet.thumbnails?.maxres?.url || v.snippet.thumbnails?.high?.url || null,
        geoblocking: geoblocking(v.contentDetails.regionRestriction),
        status: v.status.uploadStatus === 'processed' ? 'published' : v.status.uploadStatus,
        private: v.status.privacyStatus !== 'public' || v.status.embeddable === false,
      });
    }
  }
  return videos;
}

async function channelVideos(uploads, key, cached) {
  const full = !cached || Date.now() - Date.parse(cached.fullAt || 0) > FULL_EVERY_MS;
  const known = new Set(full ? [] : cached.videos.map((v) => v.id));
  const ids = [];
  let pageToken = '';
  let reachedKnown = false;
  do {
    const body = await api(`playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? `&pageToken=${pageToken}` : ''}`, key);
    for (const it of body.items || []) {
      if (known.has(it.contentDetails.videoId)) {
        reachedKnown = true;
        break;
      }
      ids.push(it.contentDetails.videoId);
    }
    pageToken = body.nextPageToken || '';
  } while (!reachedKnown && pageToken && ids.length < MAX_VIDEOS_PER_CHANNEL);
  const fresh = await videoDetails(ids, key);
  if (full) return { fullAt: new Date().toISOString(), videos: fresh };
  return { fullAt: cached.fullAt, videos: [...fresh, ...cached.videos] };
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  const reparse = process.argv.includes('--reparse'); // rebuild films from the stored lists, no API calls
  if (!key && !reparse) {
    console.error('No YOUTUBE_API_KEY: YouTube channels not read, previous list kept.');
    return;
  }
  let videoCache = {};
  try {
    videoCache = JSON.parse(fs.readFileSync(VIDEO_CACHE, 'utf8'));
  } catch {
    /* first run */
  }
  const channels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'channels.json'), 'utf8')).channels.filter(
    (c) => c.platform === 'youtube' && c.approved,
  );
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* first run */
  }
  let cache = {};
  try {
    cache = JSON.parse(fs.readFileSync(RESOLVED, 'utf8'));
  } catch {
    /* first run */
  }
  const result = { generatedAt: new Date().toISOString(), channels: {}, titles: [] };
  for (const channel of channels) {
    try {
      let info;
      if (reparse) {
        const id = channel.channelId || cache[channel.search]?.id
          || Object.keys(videoCache).find((k) => channel.handle && videoCache[k].handle === channel.handle);
        if (!id || !videoCache[id]) continue;
        info = { id, title: videoCache[id].title || channel.name, subscribers: videoCache[id].subscribers };
      } else info = await resolveChannel(channel, key, cache);
      if (!channel.handle && channel.search && cache[channel.search] && !cache[channel.search].exactName) {
        console.warn(`${channel.name}: closest match "${info.title}" (not an exact name match), skipped until confirmed`);
        result.channels[info.id] = { name: info.title, wanted: channel.name, skipped: 'name mismatch' };
        continue;
      }
      if (!reparse) {
        const got = await channelVideos(info.uploads, key, videoCache[info.id]);
        videoCache[info.id] = { ...got, title: info.title, subscribers: info.subscribers, handle: channel.handle };
      }
      const videos = videoCache[info.id].videos;
      const titles = buildTitles({ ...channel, user: info.id }, videos, { idPrefix: 'snaija-yt' }).map((t) => ({ ...t, channelName: info.title }));
      result.channels[info.id] = { name: info.title, handle: channel.handle, subscribers: info.subscribers, videos: videos.length, films: titles.length };
      result.titles.push(...titles);
      console.log(`${info.title}: ${videos.length} videos → ${titles.length} films`);
    } catch (err) {
      const id = channel.channelId || cache[channel.search]?.id;
      const kept = (previous?.titles || []).filter((t) => id && t.channel === id);
      result.titles.push(...kept);
      result.channels[channel.channelId || channel.handle] = { error: err.message, keptFromPreviousRun: kept.length };
      console.error(`${channel.name}: ${err.message}; kept ${kept.length}`);
    }
  }
  // The same film on two channels: keep IDs unique (both stay, as alternative streams come later via matching).
  const seen = new Map();
  for (const t of result.titles) {
    const n = seen.get(t.id) || 0;
    seen.set(t.id, n + 1);
    if (n) t.id = `${t.id}-${n + 1}`;
  }
  fs.writeFileSync(OUT, `${JSON.stringify(result, null, 1)}\n`);
  fs.writeFileSync(RESOLVED, `${JSON.stringify(cache, null, 1)}\n`);
  fs.writeFileSync(VIDEO_CACHE, JSON.stringify(videoCache));
}

if (require.main === module) main();

module.exports = { seconds, geoblocking };
