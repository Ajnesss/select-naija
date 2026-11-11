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
function loadData(dataDir, { now = Date.now() } = {}) {
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

  // links grouped by the stream id Nuvio asks for: "<titleId>" or "<titleId>:<season>:<episode>"
  const linksByStreamId = new Map();
  for (const link of links.links || []) {
    if (!providerById.has(link.provider)) throw new Error(`Link ${link.id} uses unknown provider ${link.provider}`);
    const key = link.season != null ? `${link.titleId}:${link.season}:${link.episode}` : link.titleId;
    if (!linksByStreamId.has(key)) linksByStreamId.set(key, []);
    linksByStreamId.get(key).push(link);
  }

  // Per link: a UK check from the last 7 days wins (it saw exactly what UK viewers see).
  // Otherwise the nightly hands-off result counts, so nothing depends on the laptop being on.
  const fresh = (iso) => iso && now - Date.parse(iso) <= FRESH_DAYS * DAY;
  const mergedLinks = { ...(status.links || {}) };
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
    allLinks: links.links || [],
    status: {
      links: mergedLinks,
      providers: mergedProviders,
    },
    statusGeneratedAt: status.generatedAt || null,
    statusUkGeneratedAt: statusUk.generatedAt || null,
  };
}

module.exports = { loadData, LANGUAGES, readJson };
