'use strict';

const fs = require('fs');
const path = require('path');
const { FRESH_DAYS, DAY } = require('./states');
const { normalize, groupKey } = require('./text');

const normalizeName = (n) => normalize(String(n || '')).replace(/^the /, '');

const LANGUAGES = {
  en: 'English',
  yo: 'Yoruba',
  ig: 'Igbo',
  ha: 'Hausa',
  pcm: 'Pidgin',
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
}

/**
 * Loads every data file and builds the lookups the server needs.
 * Throws on a malformed catalogue so a bad deploy fails loudly instead of serving nothing.
 */
// Free only: Fortune's mum has no paid services, so links that need a subscription or rental are left out
// and titles available only that way disappear from the rows. Set SELECT_NAIJA_FREE_ONLY=0 to show them.
const FREE_ACCESS = new Set(['free', 'ads']);
const { credentialsFor } = require('./resolvers/dailymotion');

// In-app only: Select Naija shows a stream only if it plays inside Nuvio's own player. Links that open a
// browser or another app are kept in the data (and still checked) but never shown, and titles with no
// in-app stream leave the rows. SELECT_NAIJA_IN_APP_ONLY=0 shows external links again.
function loadData(
  dataDir,
  {
    now = Date.now(),
    freeOnly = process.env.SELECT_NAIJA_FREE_ONLY !== '0',
    inAppOnly = process.env.SELECT_NAIJA_IN_APP_ONLY !== '0',
    env = process.env,
  } = {},
) {
  const catalogue = readJson(path.join(dataDir, 'catalogue.json'));
  const links = readJson(path.join(dataDir, 'links.json'));
  const providers = readJson(path.join(dataDir, 'providers.json'));
  // Results from GitHub (unrestricted files) and from the UK check point (region-locked providers) are merged.
  const status = readJson(path.join(dataDir, 'status.json'), { links: {}, providers: {} });
  const statusUk = readJson(path.join(dataDir, 'status-uk.json'), { links: {}, providers: {} });

  const titles = (catalogue.titles || []).filter((t) => !t.hidden);
  const byId = new Map();
  for (const t of titles) {
    if (!t.id || !t.name || !t.type) throw new Error(`Catalogue entry missing id/name/type: ${JSON.stringify(t)}`);
    if (byId.has(t.id)) throw new Error(`Duplicate catalogue id: ${t.id}`);
    byId.set(t.id, t);
  }

  const providerById = new Map((providers.providers || []).map((p) => [p.id, p]));
  const providerByTmdbName = new Map();
  for (const p of providers.providers || []) for (const n of p.tmdbNames || []) providerByTmdbName.set(n.toLowerCase(), p);

  // Titles found automatically (scripts/discover.js). Hand-curated entries always win.
  const discovered = readJson(path.join(dataDir, 'discovered.json'), { entries: [] });
  const extraLinks = [];
  const discoveredStatus = {};
  for (const entry of discovered.entries || []) {
    const t = entry.title;
    if (!t?.id || !t.name || !t.type) continue;
    if (!byId.has(t.id)) {
      titles.push(t);
      byId.set(t.id, t);
    }
    for (const offer of entry.offers || []) {
      if (freeOnly && !FREE_ACCESS.has(offer.access)) continue;
      const p = providerByTmdbName.get(String(offer.providerName).toLowerCase()) || providerById.get('other');
      if (!p) continue;
      const slug = p.id === 'other' ? `other-${offer.tmdbProviderId}` : p.id;
      const id = `jw:${slug}:${t.id}`;
      if (discoveredStatus[id]) continue; // e.g. "Prime Video" and "Prime Video with Ads": one link, cheapest offer first
      const serviceId = entry.serviceIds?.[p.id];
      const url =
        serviceId && p.titleUrl
          ? p.titleUrl.replace('{id}', encodeURIComponent(serviceId))
          : p.openUrl
            ? p.openUrl.replace('{q}', encodeURIComponent(t.name))
            : entry.watchLink;
      if (!url) continue;
      extraLinks.push({
        id,
        titleId: t.id,
        provider: p.id,
        providerName: p.id === 'other' ? offer.providerName : undefined,
        access: offer.access,
        kind: 'external',
        url,
        discovered: true,
        synthetic: true,
      });
      // Being in TMDB's UK list on the last discovery run is the check for these links.
      const at = discovered.generatedAt;
      discoveredStatus[id] = { lastOk: at, lastCheck: at, checks: [{ at, ok: true }], ukSignal: 'justwatch' };
    }
  }

  // links grouped by the stream id Nuvio asks for: "<titleId>" or "<titleId>:<season>:<episode>"
  // Films from approved video channels (scripts/discover-dailymotion.js): one link per part.
  const dm = readJson(path.join(dataDir, 'dailymotion.json'), { titles: [] });
  const yt = readJson(path.join(dataDir, 'youtube.json'), { titles: [] });
  const channels = readJson(path.join(dataDir, 'channels.json'), { channels: [] }).channels || [];
  const channelNames = new Map(channels.map((c) => [c.user || c.channelId, c.name]));
  const authorisedChannels = new Map(
    channels.filter((c) => c.platform === 'dailymotion' && c.ownerAuthorised && credentialsFor(c, env)).map((c) => [c.user, c]),
  );
  const videoTitles = [
    ...(dm.titles || []).map((t) => ({ t, platform: 'dailymotion', at: dm.generatedAt })),
    ...(yt.titles || []).map((t) => ({ t, platform: 'youtube', at: yt.generatedAt })),
  ];
  for (const { t, platform, at } of videoTitles) {
    if (!t?.id || !t.name || byId.has(t.id)) continue;
    titles.push(t);
    byId.set(t.id, t);
    // Series episodes become per-episode links (stream id "<title>:<season>:<episode>").
    for (const e of t.episodes || []) {
      const isYt = platform === 'youtube';
      const id = `${isYt ? 'yt' : 'dm'}:${e.videoId}`;
      extraLinks.push({
        id,
        titleId: t.id,
        season: e.season,
        episode: e.episode,
        provider: platform,
        kind: isYt ? 'youtube' : 'external',
        ytId: isYt ? e.videoId : undefined,
        url: isYt ? `https://www.youtube.com/watch?v=${e.videoId}` : `https://www.dailymotion.com/video/${e.videoId}`,
        source: t.channelName || channelNames.get(t.channel),
        minutes: e.minutes,
        quality: e.quality,
        synthetic: true,
      });
      discoveredStatus[id] = { lastOk: at, lastCheck: at, checks: [{ at, ok: true }], ukSignal: 'provider' };
    }
    const total = (t.parts || []).length;
    for (const part of t.parts || []) {
      const isYt = platform === 'youtube';
      const id = `${isYt ? 'yt' : 'dm'}:${part.videoId}`;
      const owner = isYt ? null : authorisedChannels.get(t.channel);
      extraLinks.push({
        id,
        titleId: t.id,
        provider: platform,
        // YouTube: handed to the app as a video ID it plays itself. Dailymotion: in-app only for an
        // owner-authorised channel (stream address from the owner's own API key), otherwise external.
        kind: isYt ? 'youtube' : owner ? 'direct' : 'external',
        ytId: isYt ? part.videoId : undefined,
        resolve: owner ? { via: 'dailymotion-owner', videoId: part.videoId, channel: owner } : undefined,
        url: isYt ? `https://www.youtube.com/watch?v=${part.videoId}` : `https://www.dailymotion.com/video/${part.videoId}`,
        source: t.channelName || channelNames.get(t.channel),
        label: total > 1 ? `Part ${part.part} of ${total}` : undefined,
        order: part.part,
        minutes: part.minutes,
        quality: part.quality,
        synthetic: true,
      });
      // Listed as public, published and not blocked for the UK on the last nightly read: that is the check.
      discoveredStatus[id] = { lastOk: at, lastCheck: at, checks: [{ at, ok: true }], ukSignal: 'provider' };
    }
  }

  // Tubi UK's own Nollywood collection (scripts/discover-tubi.js). Matched to a title already in the
  // catalogue by name and year where possible; otherwise it becomes a title of its own. These links are
  // checked every night through the London check point like any hand-added link.
  const tubi = readJson(path.join(dataDir, 'tubi.json'), { titles: [] });
  const nameYear = new Map();
  const key = (name, year) => `${normalizeName(name)}|${year || ''}`;
  for (const t of titles) nameYear.set(key(t.name, t.year), t);
  for (const e of tubi.titles || []) {
    let t = nameYear.get(key(e.name, e.year)) || nameYear.get(key(e.name, e.year - 1)) || nameYear.get(key(e.name, e.year + 1));
    if (!t) {
      t = {
        id: `snaija-tubi-${e.tubiId}`,
        type: e.type,
        name: e.name,
        aliases: [],
        year: e.year,
        languages: e.languages,
        category: e.type === 'series' ? 'series' : 'film',
        genres: e.genres,
        runtime: e.runtime,
        description: e.description,
        cast: e.cast,
        director: e.director,
        poster: e.poster,
        background: e.background,
        sources: { all: 'Tubi UK title page' },
      };
      if (byId.has(t.id)) continue;
      titles.push(t);
      byId.set(t.id, t);
      nameYear.set(key(t.name, t.year), t);
    }
    extraLinks.push({
      id: `tubi:${e.tubiId}`,
      titleId: t.id,
      provider: 'tubi',
      kind: 'external',
      url: `https://tubitv.com/${e.type === 'series' ? 'series' : 'movies'}/${e.tubiId}`,
      expectTitle: e.name,
    });
  }
  // A direct Tubi page beats a Tubi search link from the JustWatch route for the same title.
  const tubiTitles = new Set(extraLinks.filter((l) => l.id.startsWith('tubi:')).map((l) => l.titleId));
  for (let i = extraLinks.length - 1; i >= 0; i--) {
    const l = extraLinks[i];
    if (l.synthetic && l.provider === 'tubi' && tubiTitles.has(l.titleId)) extraLinks.splice(i, 1);
  }

  const linksByStreamId = new Map();
  const linksByTitle = new Map();
  // TMDB details for channel titles (scripts/match-tmdb.js): real release year, poster, genres, IMDb ID.
  const matches = readJson(path.join(dataDir, 'tmdb-matches.json'), {});
  for (const t of titles) {
    if (!/^snaija-(yt|dm|tubi)-/.test(t.id)) continue;
    const m = matches[`${t.type}|${groupKey(t.name)}|${t.year || ''}`]?.match;
    if (!m) continue;
    if (m.year) {
      t.year = m.year;
      t.yearIsUpload = false;
    }
    if (m.poster) {
      t.poster = m.poster;
      t.posterShape = 'poster';
    }
    if (m.background) t.background = m.background;
    if (m.description) t.description = m.description;
    if (m.genres?.length) t.genres = m.genres;
    if (m.runtime && t.type === 'movie') t.runtime = m.runtime;
    t.tmdbId = m.tmdbId;
    t.imdbId = m.imdbId || undefined;
  }

  // One title per film: the same film from several channels or services (same name, same type, release
  // years at most a year apart) becomes one title carrying every stream. The kept title is the best
  // described one: an IMDb title first, then TMDB, Tubi, hand-curated, then the source with most streams.
  const alias = new Map();
  {
    const rank = (t) => (/^tt\d+$/.test(t.id) ? 0 : /^snaija-tmdb/.test(t.id) ? 1 : /^snaija-tubi/.test(t.id) ? 2 : /^snaija-(yt|dm)-/.test(t.id) ? 4 : 3);
    const size = (t) => (t.parts || t.episodes || []).length;
    const groups = new Map();
    for (const t of titles) {
      if (t.category === 'test' || !t.name) continue;
      const k = `${t.type}|${groupKey(t.name)}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => rank(a) - rank(b) || size(b) - size(a));
      const kept = [];
      for (const t of list) {
        const home = kept.find((k) => !t.year || !k.year || Math.abs(k.year - t.year) <= 1);
        if (!home) {
          kept.push(t);
          continue;
        }
        alias.set(t.id, home.id);
        home.languages = [...new Set([...(home.languages || []), ...(t.languages || [])])];
        home.cast = [...new Set([...(home.cast || []), ...(t.cast || [])])].slice(0, 10);
        if (!home.poster && t.poster) home.poster = t.poster;
        if (!home.description && t.description) home.description = t.description;
        if ((t.uploadedAt || '') > (home.uploadedAt || '')) home.uploadedAt = t.uploadedAt;
        if ((!home.genres?.length || (home.genres.length === 1 && home.genres[0] === 'Drama')) && t.genres?.length) home.genres = t.genres;
        if (home.type === 'series') {
          const have = new Set((home.videos || []).map((v) => `${v.season}:${v.episode}`));
          for (const v of t.videos || []) if (!have.has(`${v.season}:${v.episode}`)) (home.videos = home.videos || []).push(v);
          home.videos?.sort((a, b) => a.season - b.season || a.episode - b.episode);
        }
      }
    }
    if (alias.size) {
      for (let i = titles.length - 1; i >= 0; i--) if (alias.has(titles[i].id)) titles.splice(i, 1);
      for (const id of alias.keys()) byId.delete(id);
      for (const l of extraLinks) if (alias.has(l.titleId)) l.titleId = alias.get(l.titleId);
    }
  }

  const curated = (links.links || []).filter(
    (l) => !freeOnly || FREE_ACCESS.has(l.access || providerById.get(l.provider)?.access),
  );
  const curatedProviders = new Set(curated.map((l) => `${l.titleId}|${l.provider}`));
  const allLinks = [...curated, ...extraLinks.filter((l) => !curatedProviders.has(`${l.titleId}|${l.provider}`))].map((l) =>
    alias.has(l.titleId) ? { ...l, titleId: alias.get(l.titleId) } : l,
  );
  for (const link of allLinks) {
    // YouTube links count as in-app candidates: the app plays them itself (confirmed per device by testing).
    if (inAppOnly && link.kind !== 'direct' && link.kind !== 'youtube') continue;
    if (!providerById.has(link.provider)) throw new Error(`Link ${link.id} uses unknown provider ${link.provider}`);
    const key = link.season != null ? `${link.titleId}:${link.season}:${link.episode}` : link.titleId;
    if (!linksByStreamId.has(key)) linksByStreamId.set(key, []);
    linksByStreamId.get(key).push(link);
    if (!linksByTitle.has(link.titleId)) linksByTitle.set(link.titleId, []);
    linksByTitle.get(link.titleId).push(link);
  }

  // Per link: a UK check from the last 7 days wins (it saw exactly what UK viewers see).
  // Otherwise the nightly hands-off result counts, so nothing depends on the laptop being on.
  const fresh = (iso) => iso && now - Date.parse(iso) <= FRESH_DAYS * DAY;
  const mergedLinks = { ...discoveredStatus, ...(status.links || {}) };
  for (const [id, rec] of Object.entries(statusUk.links || {})) {
    if (fresh(rec.lastCheck) || !mergedLinks[id]) mergedLinks[id] = { ...rec, ukSignal: 'uk-check' };
  }
  const mergedProviders = { ...(status.providers || {}) };
  if (fresh(statusUk.generatedAt)) Object.assign(mergedProviders, statusUk.providers || {});

  return {
    titles,
    byId,
    providerById,
    linksByStreamId,
    linksByTitle,
    allLinks,
    alias,
    freeOnly,
    inAppOnly,
    discoveredGeneratedAt: discovered.generatedAt || null,
    status: {
      links: mergedLinks,
      providers: mergedProviders,
    },
    statusGeneratedAt: status.generatedAt || null,
    statusUkGeneratedAt: statusUk.generatedAt || null,
  };
}

module.exports = { loadData, LANGUAGES, readJson };
