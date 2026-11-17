'use strict';

// Wikimedia Commons: freely licensed video files (every file on Commons carries a free licence) that are
// categorised under Nigeria / Nollywood / Nigerian languages. Plays the original upload when it is MP4, otherwise
// Commons' own WebM transcodes (VP9), which Nuvio's player (ExoPlayer/mpv) handles.

const { scoreMatch, cleanTitle } = require('../engine/matcher');
const { html } = require('../engine/http');

const NIGERIAN = /nigeria|nigerian|nollywood|yoruba|igbo|hausa|lagos|abuja|kano|ibadan|enugu/i;
const fileTitle = (t) => String(t).replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ');
const yearFrom = (page) => {
  const em = page.imageinfo?.[0]?.extmetadata || {};
  const s = html.text(em.DateTimeOriginal?.value || '') || '';
  return Number(s.match(/\b(18|19|20)\d{2}\b/)?.[0]) || null;
};

async function searchFiles(client, words, limit = 30) {
  return client.getJson('/w/api.php', {
    params: {
      action: 'query', format: 'json', formatversion: 2,
      generator: 'search', gsrnamespace: 6, gsrlimit: limit, gsrsearch: `${words} filetype:video`,
      prop: 'imageinfo|categories', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|DateTimeOriginal|ObjectName|ImageDescription',
      clshow: '!hidden', cllimit: 'max',
    },
  });
}

function isNigerian(page) {
  const cats = (page.categories || []).map((c) => c.title).join(' ');
  const em = page.imageinfo?.[0]?.extmetadata || {};
  return NIGERIAN.test(cats) || NIGERIAN.test(html.text(em.ImageDescription?.value || '')) || NIGERIAN.test(page.title);
}

module.exports = {
  key: 'commons',
  types: ['movie'],

  async resolve(request, ctx) {
    const { client } = ctx;
    const want = { name: request.name, aliases: request.aliases, year: request.year };
    const j = await searchFiles(client, cleanTitle(request.name));
    const pages = j.query?.pages || [];
    const nigerian = pages.filter(isNigerian);
    ctx.log(`search "${cleanTitle(request.name)}": ${pages.length} video files, ${nigerian.length} tied to Nigeria`);
    const hits = nigerian
      .map((p) => {
        const em = p.imageinfo?.[0]?.extmetadata || {};
        const name = html.text(em.ObjectName?.value || '') || fileTitle(p.title);
        return { p, name, year: yearFrom(p), score: Math.max(scoreMatch({ title: name, year: yearFrom(p) }, want), scoreMatch({ title: fileTitle(p.title), year: yearFrom(p) }, want)) };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    const results = [];
    for (const x of hits) {
      const info = x.p.imageinfo?.[0] || {};
      const licence = html.text(info.extmetadata?.LicenseShortName?.value || '');
      ctx.match({ title: x.name, year: x.year, score: Number(x.score.toFixed(2)), ref: info.descriptionurl, licence });
      const v = await client.getJson('/w/api.php', { params: { action: 'query', format: 'json', formatversion: 2, titles: x.p.title, prop: 'videoinfo', viprop: 'derivatives|url|size|mime' } });
      const vi = v.query?.pages?.[0]?.videoinfo?.[0] || {};
      const derivs = (vi.derivatives || []).filter((d) => /webm|mp4/i.test(d.type || '') && !/audio\/|\.ogv$/i.test(`${d.type} ${d.src}`));
      const options = [];
      if (/video\/(mp4|webm)/i.test(vi.mime || info.mime || '')) options.push({ url: vi.url || info.url, quality: vi.height || info.height || '', size: vi.size || info.size });
      const best = derivs.filter((d) => Number(d.height) <= 1080).sort((a, b) => Number(b.height) - Number(a.height))[0];
      if (best && !options.some((o) => o.url === best.src)) options.push({ url: best.src, quality: Number(best.height), size: null });
      ctx.log(`${x.p.title}: ${options.length} playable version(s)`);
      for (const o of options) {
        results.push({ title: request.name, url: o.url, quality: o.quality, size: o.size, licence, groupKey: x.p.title, filename: fileTitle(x.p.title) });
      }
    }
    return results;
  },

  async coverage(ctx) {
    const j = await ctx.client.getJson('/w/api.php', {
      params: { action: 'query', format: 'json', formatversion: 2, list: 'search', srnamespace: 6, srlimit: 50, srinfo: 'totalhits', srsearch: 'filetype:video (nollywood OR "nigerian film" OR "Nigerian movie" OR "film from Nigeria")' },
    });
    return { titles: j.query?.searchinfo?.totalhits || 0, sample: (j.query?.search || []).slice(0, 15).map((s) => fileTitle(s.title)) };
  },
};
