'use strict';

const { linkState, isShown, DAY } = require('./states');
const { ukOffers } = require('./resolvers/tmdb');
const { ownerStreamUrl } = require('./resolvers/dailymotion');

const HIDE_BELOW = 50; // provider score under which its links are hidden
const DEFAULT_SCORE = 70; // providers not yet scored rank below proven ones
const MIN_CHECKS = 10; // a provider's score only counts once it rests on this many checks in 30 days

const ACCESS_LABEL = { free: 'Free', ads: 'Free with ads', subscription: 'Subscription', rental: 'Rental' };

function parseStreamId(id) {
  const [titleId, season, episode] = String(id).split(':');
  return { titleId, season: season != null ? Number(season) : null, episode: episode != null ? Number(episode) : null };
}

function ago(iso, now) {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function providerScore(data, providerId) {
  const s = data.status.providers[providerId];
  if (!s || typeof s.score !== 'number') return DEFAULT_SCORE;
  // A handful of checks is not enough evidence to demote or hide a whole provider.
  if (typeof s.checks30d === 'number' && s.checks30d < MIN_CHECKS) return DEFAULT_SCORE;
  return s.score;
}

// Links that answer a stream request: exact matches, plus title-level external links for an episode
// (a provider's series page still helps when it has no per-episode page).
function candidateLinks(streamId, data) {
  const { titleId, season } = parseStreamId(streamId);
  const exact = data.linksByStreamId.get(streamId) || [];
  if (season == null) return exact;
  const seriesLevel = (data.linksByStreamId.get(titleId) || []).filter((l) => l.kind === 'external');
  return [...exact, ...seriesLevel];
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** 124 → "2 h 4 min". */
function duration(min) {
  if (!min) return '';
  return min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`;
}

function formatLink(link, record, state, data, title, now) {
  const base = data.providerById.get(link.provider);
  const provider = link.providerName ? { ...base, name: link.providerName } : base;
  const access = ACCESS_LABEL[link.access || provider.access] || '';
  const credit = link.discovered ? 'UK availability: JustWatch via TMDB' : '';
  const part = link.label ? `${link.label}${link.minutes ? ` (${link.minutes} min)` : ''}` : '';
  const checked = record?.lastOk ? `checked ${ago(record.lastOk, now)}` : '';
  const name = title?.name || '';
  if (link.kind === 'youtube') {
    // Handed to the app as a YouTube video ID: Nuvio/Stremio play it with their own YouTube support.
    // YouTube reports "hd" (720p or better) or "sd"; the app picks the best stream it can play.
    const quality = link.quality === 'hd' ? 'HD' : link.quality === 'sd' ? 'SD' : '';
    return {
      name: `Select Naija\n${provider.name}${quality ? ` ${quality}` : ''}`,
      title: [
        [`▶ ${name}`, link.label].filter(Boolean).join(' · '),
        [quality && (quality === 'HD' ? 'HD (720p+)' : 'SD'), duration(link.minutes), link.source || 'YouTube', access].filter(Boolean).join(' · '),
        record?.lastPlayedAt ? `✓ played in YouTube's player ${ago(record.lastPlayedAt, now)}` : record?.api === 'ok' ? `available on YouTube (checked ${ago(record.lastCheck, now)}), not yet play-tested` : checked,
      ].filter(Boolean).join('\n'),
      ytId: link.ytId,
      behaviorHints: { bingeGroup: `selectnaija-${link.provider}` },
    };
  }
  if (link.kind === 'direct') {
    return {
      name: `Select Naija\n${provider.name}`,
      title: [[`▶ ${name}`, part].filter(Boolean).join(' · '), [access, 'plays in Nuvio', checked].filter(Boolean).join(' · ')].join('\n'),
      url: record?.finalUrl || link.url,
      behaviorHints: { bingeGroup: `selectnaija-${link.provider}` },
    };
  }
  const unconfirmed = provider.ukCheckRequired && record?.ukSignal === 'page-only' ? 'UK availability not confirmed' : '';
  return {
    name: `Select Naija\n${provider.name} ↗`,
    title: [
      [`Open on ${provider.name}`, part].filter(Boolean).join(' · '),
      [access, state === 'stale' ? `last checked ${ago(record.lastOk, now)}` : checked, unconfirmed].filter(Boolean).join(' · '),
      credit,
    ].filter(Boolean).join('\n'),
    externalUrl: link.url,
  };
}

/**
 * Builds the stream list for one Nuvio request.
 * Order: in-app streams, then verified links by provider score, then stale links, then TMDB/JustWatch offers
 * for providers not already listed. Unverified and failing links are never returned.
 */
async function buildStreams(type, requestedId, data, { tmdbApiKey, fetchImpl, now = Date.now(), env = process.env, youtube = 'nuvio', fallback = false } = {}) {
  // A title merged into another keeps working under its old ID (saved in someone's library or history).
  const [rid, ...rest] = String(requestedId).split(':');
  const streamId = data.alias?.has(rid) ? [data.alias.get(rid), ...rest].join(':') : requestedId;
  const { titleId } = parseStreamId(streamId);
  const title = data.byId.get(titleId);
  const shown = [];

  for (const link of candidateLinks(streamId, data)) {
    const record = data.status.links[link.id];
    const state = linkState(record, now);
    if (!isShown(state)) continue;
    const score = providerScore(data, link.provider);
    if (score < HIDE_BELOW) continue;
    shown.push({ link, record, state, score });
  }

  // Best source first. A film's parts from one channel are one option: they stay together, in order, and the
  // option is ranked by its weakest part. Rank: plays in Nuvio → confirmed playing in the official player →
  // available per the API → HD before SD → verified → provider score.
  const health = (x) => (x.record?.lastPlayedAt && now - Date.parse(x.record.lastPlayedAt) <= 14 * DAY ? 0 : x.record?.api === 'ok' ? 1 : 2);
  const rank = (x) => [
    x.link.kind === 'direct' ? 0 : x.link.kind === 'youtube' ? 1 : 2,
    health(x),
    x.link.quality === 'hd' ? 0 : x.link.quality === 'sd' ? 2 : 1,
    x.state === 'verified' ? 0 : 1,
    x.record?.ukSignal === 'page-only' ? 1 : 0,
    -x.score,
  ];
  const groupOf = (x) => `${x.link.provider}|${x.link.source || ''}`;
  const groups = new Map();
  for (const x of shown) {
    if (!groups.has(groupOf(x))) groups.set(groupOf(x), []);
    groups.get(groupOf(x)).push(x);
  }
  const worst = (list) => list.map(rank).reduce((w, r) => (cmp(r, w) > 0 ? r : w));
  const ordered = [...groups.values()]
    .map((list) => ({ list: list.sort((a, b) => (a.link.order || 0) - (b.link.order || 0)), key: worst(list) }))
    .sort((a, b) => cmp(a.key, b.key));
  shown.splice(0, shown.length, ...ordered.flatMap((g) => g.list));

  // Links that need a stream address fetched at play time (owner-authorised sources). Dropped if it fails.
  await Promise.all(
    shown.map(async (s) => {
      if (s.link.resolve?.via !== 'dailymotion-owner') return;
      s.resolvedUrl = await ownerStreamUrl(s.link.resolve.videoId, s.link.resolve.channel, { fetchImpl: fetchImpl || fetch, now, env });
    }),
  );
  const playable = shown.filter((s) => !s.link.resolve || s.resolvedUrl);
  const streams = playable.map((s) => {
    const st = formatLink(s.link, s.record, s.state, data, title, now);
    if (s.resolvedUrl) st.url = s.resolvedUrl;
    // "Open in the YouTube app" setting: YouTube's own player and adverts, as YouTube's terms require.
    if (s.link.kind === 'youtube' && youtube === 'app') {
      delete st.ytId;
      st.externalUrl = `https://www.youtube.com/watch?v=${s.link.ytId}`;
      st.name = st.name.replace(/\nYouTube/, '\nYouTube ↗');
      st.title = st.title.replace(/^▶ /, '▶ Watch on YouTube: ');
    }
    return st;
  });
  // Fallback: if Nuvio cannot play the best YouTube option, the same video can always open in the YouTube app.
  const bestYt = playable.find((s) => s.link.kind === 'youtube');
  if (fallback && bestYt && youtube !== 'app') {
    const group = playable.filter((s) => s.link.kind === 'youtube' && s.link.source === bestYt.link.source);
    for (const s of group) {
      streams.push({
        name: 'Select Naija\nYouTube app ↗',
        title: [`Fallback: open in the YouTube app${s.link.label ? ` · ${s.link.label}` : ''}`, `${s.link.source || 'YouTube'} · plays in YouTube's own player`].join('\n'),
        externalUrl: `https://www.youtube.com/watch?v=${s.link.ytId}`,
      });
    }
  }
  const listedProviders = new Set(shown.map((s) => s.link.provider));
  const listedNames = new Set(shown.map((s) => (s.link.providerName || '').toLowerCase()).filter(Boolean));

  // Only titles in Select Naija's own catalogue get TMDB offers, so non-Nigerian titles stay untouched.
  // Series episodes use the show's availability: TMDB has no per-episode provider data.
  if (title && /^tt\d+$/.test(titleId) && !data.inAppOnly) {
    const offers = await ukOffers(titleId, type, { apiKey: tmdbApiKey, fetchImpl, now });
    for (const o of offers) {
      if (data.freeOnly && o.offer === 'subscription') continue;
      if (o.providerId && listedProviders.has(o.providerId)) continue;
      if (listedNames.has(o.providerName.toLowerCase())) continue;
      streams.push({
        name: `Select Naija\n${o.providerName} ↗`,
        title: `Where to watch: ${o.providerName} (UK) · ${ACCESS_LABEL[o.offer]}\nAvailability data: JustWatch via TMDB`,
        externalUrl: o.link,
      });
    }
  }
  return streams;
}

module.exports = { buildStreams, parseStreamId, candidateLinks, HIDE_BELOW, DEFAULT_SCORE, MIN_CHECKS };
