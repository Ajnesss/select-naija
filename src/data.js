'use strict';

const fs = require('fs');
const path = require('path');
const { FRESH_DAYS, DAY } = require('./states');

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

function loadData(dataDir, { now = Date.now(), freeOnly = process.env.SELECT_NAIJA_FREE_ONLY !== '0' } = {}) {
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
      });
      // Being in TMDB's UK list on the last discovery run is the check for these links.
      const at = discovered.generatedAt;
      discoveredStatus[id] = { lastOk: at, lastCheck: at, checks: [{ at, ok: true }], ukSignal: 'justwatch' };
    }
  }

  // links grouped by the stream id Nuvio asks for: "<titleId>" or "<titleId>:<season>:<episode>"
  // Films from approved video channels (scripts/discover-dailymotion.js): one link per part.
  const dm = readJson(path.join(dataDir, 'dailymotion.json'), { titles: [] });
  for (const t of dm.titles || []) {
    if (!t?.id || !t.name || byId.has(t.id)) continue;
    titles.push(t);
    byId.set(t.id, t);
    const total = (t.parts || []).length;
    for (const part of t.parts || []) {
      const id = `dm:${part.videoId}`;
      extraLinks.push({
        id,
        titleId: t.id,
        provider: 'dailymotion',
        kind: 'external',
        url: `https://www.dailymotion.com/video/${part.videoId}`,
        label: total > 1 ? `Part ${part.part} of ${total}` : undefined,
        order: part.part,
        minutes: part.minutes,
      });
      // Listed as public, published and not blocked for the UK on the last nightly read: that is the check.
      const at = dm.generatedAt;
      discoveredStatus[id] = { lastOk: at, lastCheck: at, checks: [{ at, ok: true }], ukSignal: 'provider' };
    }
  }

  const linksByStreamId = new Map();
  const curated = (links.links || []).filter(
    (l) => !freeOnly || FREE_ACCESS.has(l.access || providerById.get(l.provider)?.access),
  );
  const curatedProviders = new Set(curated.map((l) => `${l.titleId}|${l.provider}`));
  const allLinks = [...curated, ...extraLinks.filter((l) => !curatedProviders.has(`${l.titleId}|${l.provider}`))];
  for (const link of allLinks) {
    if (!providerById.has(link.provider)) throw new Error(`Link ${link.id} uses unknown provider ${link.provider}`);
    const key = link.season != null ? `${link.titleId}:${link.season}:${link.episode}` : link.titleId;
    if (!linksByStreamId.has(key)) linksByStreamId.set(key, []);
    linksByStreamId.get(key).push(link);
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
    allLinks,
    freeOnly,
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
