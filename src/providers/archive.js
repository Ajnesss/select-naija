'use strict';

// Internet Archive: only items whose uploader attached an open licence (Creative Commons or public domain)
// and that are tied to Nigeria (subject, description or Nigerian-language tag). Items without a licence are
// skipped: on archive.org those are typically re-uploads by people who do not hold the rights.
// Playback: archive.org/download/<item>/<file> redirects to the item's storage server and supports ranges.

const { scoreMatch, detectPart, cleanTitle } = require('../engine/matcher');

const NIGERIA = '(subject:(nigeria OR nigerian OR nollywood OR yoruba OR igbo OR hausa OR lagos) OR description:(nollywood OR nigerian OR nigeria) OR language:(yoruba OR yor OR igbo OR ibo OR hausa OR hau))';
const LICENCE = /creativecommons\.org|publicdomain/i;
const VIDEO_FORMATS = /^(h\.264( hd| ia)?|mpeg4|512kb mpeg4|matroska|webm|quicktime)$/i;
const PLAYABLE_EXT = /\.(mp4|m4v|mkv|webm|mov)$/i;

const licenceName = (url) => {
  if (!url) return '';
  if (/publicdomain\/zero/i.test(url)) return 'CC0';
  if (/publicdomain/i.test(url)) return 'Public domain';
  const m = url.match(/licenses\/([a-z-]+)\/(\d\.\d)/i);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : 'Open licence';
};
const yearOf = (d) => Number(String(d?.year || d?.date || '').slice(0, 4)) || null;
const quoted = (s) => s.replace(/["\\:()[\]{}^~*?|&!+-]/g, ' ').replace(/\s+/g, ' ').trim();

async function search(client, words, rows = 25) {
  const j = await client.getJson('/advancedsearch.php', {
    params: {
      q: `${words ? `title:(${quoted(words)}) AND ` : ''}mediatype:movies AND licenseurl:[* TO *] AND ${NIGERIA}`,
      'fl[]': ['identifier', 'title', 'year', 'date', 'licenseurl', 'language', 'subject'],
      rows,
      output: 'json',
    },
  });
  return { total: j.response?.numFound || 0, docs: (j.response?.docs || []).filter((d) => LICENCE.test(d.licenseurl || '')) };
}

/** Picks the playable video files of an item: one per distinct video, preferring an MP4/H.264 copy. */
function pickFiles(files) {
  const videos = files.filter((f) => VIDEO_FORMATS.test(f.format || '') || PLAYABLE_EXT.test(f.name || ''))
    .filter((f) => PLAYABLE_EXT.test(f.name || '') && !/\.ia\.mp4$/i.test(f.name) && !/sample|trailer/i.test(f.name));
  const byOriginal = new Map();
  for (const f of videos) {
    const key = f.source === 'derivative' && f.original ? f.original : f.name;
    if (!byOriginal.has(key)) byOriginal.set(key, []);
    byOriginal.get(key).push(f);
  }
  const rank = (f) => (/\.mp4$/i.test(f.name) ? 0 : /\.m4v$/i.test(f.name) ? 1 : /\.webm$/i.test(f.name) ? 2 : 3) * 10 + (/512kb/i.test(f.name) ? 1 : 0);
  return [...byOriginal.entries()]
    .map(([original, list]) => ({ original, file: list.sort((a, b) => rank(a) - rank(b) || Number(b.height || 0) - Number(a.height || 0))[0] }))
    .sort((a, b) => a.original.localeCompare(b.original, 'en', { numeric: true }));
}

module.exports = {
  key: 'archive',
  types: ['movie', 'series'],

  async resolve(request, ctx) {
    const { client } = ctx;
    const want = { name: request.name, aliases: request.aliases, year: request.year };
    const { total, docs } = await search(client, cleanTitle(request.name));
    ctx.log(`search "${cleanTitle(request.name)}": ${total} Nigeria-related items, ${docs.length} with an open licence`);
    const hits = docs
      .map((d) => ({ doc: d, score: scoreMatch({ title: d.title, year: yearOf(d) }, want, { yearTolerance: request.type === 'series' ? 30 : 1 }) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const x of hits) ctx.match({ title: x.doc.title, year: yearOf(x.doc), score: Number(x.score.toFixed(2)), ref: `https://archive.org/details/${x.doc.identifier}`, licence: licenceName(x.doc.licenseurl) });
    const results = [];
    for (const { doc } of hits) {
      const meta = await client.getJson(`/metadata/${encodeURIComponent(doc.identifier)}`);
      let picks = pickFiles(meta.files || []);
      ctx.log(`${doc.identifier}: ${picks.length} playable video file(s)`);
      if (request.type === 'series') {
        picks = picks.filter(({ file }) => {
          const p = detectPart(file.name.replace(PLAYABLE_EXT, '').replace(/[._]/g, ' '));
          return p.episode === request.episode && (p.season == null || p.season === request.season);
        });
      }
      const partCount = request.type === 'movie' && picks.length > 1 ? picks.length : null;
      picks.forEach(({ file }, i) => {
        const detected = detectPart(file.name.replace(PLAYABLE_EXT, '').replace(/[._]/g, ' ')).part;
        results.push({
          title: request.name,
          url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`,
          quality: file.height ? Number(file.height) : file.name,
          size: Number(file.size) || null,
          part: partCount ? detected || i + 1 : null,
          partCount,
          season: request.season,
          episode: request.episode,
          licence: licenceName(doc.licenseurl || meta.metadata?.licenseurl),
          groupKey: doc.identifier,
          filename: file.name.split('/').pop(),
        });
      });
    }
    return results;
  },

  async coverage(ctx) {
    const { total, docs } = await search(ctx.client, '', 200);
    return { titles: docs.length, matchedQuery: total, sample: docs.slice(0, 15).map((d) => `${d.title} (${yearOf(d) || '?'}) — ${licenceName(d.licenseurl)}`) };
  },
};
