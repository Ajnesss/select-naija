'use strict';

// Reference provider. Copy to src/providers/<key>.js, set `key`, add an entry in config/providers.js,
// and implement resolve(). This template works end to end against Wikimedia Commons' plain-HTML pages
// (enable it with SELECT_NAIJA_PROVIDERS_ENABLE=template, or run `node test.js "<title>" --provider template`):
//   1. search page for the cleaned title (HTML)
//   2. parse result links and match titles with the shared matcher (±1 year)
//   3. open the matched detail page (HTML) and read the media URL from its <video>/<source> tags or links
//   4. check the media URL answers (HEAD / 1-byte range) before returning it
// Use only routes the site offers to everyone (or to a logged-in user, with credentials from config.auth/env).
// Do not return streams that bypass DRM, paywalls or a site's advertising.

const { scoreMatch, cleanTitle } = require('../engine/matcher');
const { html } = require('../engine/http');

module.exports = {
  key: 'template',
  types: ['movie'],

  async resolve(request, ctx) {
    const { client } = ctx;
    const want = { name: request.name, aliases: request.aliases, year: request.year };

    // 1. Search (plain HTML results page).
    const query = `${cleanTitle(request.name)} filetype:video`;
    const searchUrl = client.url('/w/index.php', { search: query, ns6: 1, fulltext: 1 });
    const page = await client.getText(searchUrl);
    ctx.log(`GET ${searchUrl}`);

    // 2. Parse results and match.
    const candidates = html.links(page, client.baseUrl)
      .filter((l) => /\/wiki\/File:.+\.(webm|ogv|mp4|mpg|mpeg)$/i.test(decodeURIComponent(l.href)))
      .map((l) => ({ href: l.href, title: decodeURIComponent(l.href.split('/wiki/File:')[1]).replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ') }));
    const unique = [...new Map(candidates.map((c) => [c.href, c])).values()];
    const hits = unique.map((c) => ({ ...c, score: scoreMatch({ title: c.title, year: null }, want) })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
    hits.forEach((h) => ctx.match({ title: h.title, year: null, score: Number(h.score.toFixed(2)), ref: h.href }));

    // 3. Detail page → media URL.
    const results = [];
    for (const hit of hits) {
      const detail = await client.getText(hit.href);
      const sources = html.videoSources(detail, hit.href);
      const original = html.links(detail, hit.href).map((l) => l.href).find((u) => /upload\.wikimedia\.org\/.+\.(webm|mp4)$/i.test(u));
      const candidatesUrls = [...new Set([original, ...sources].filter((u) => u && /\.(webm|mp4)(\?|$)/i.test(u)))];
      ctx.log(`${hit.href}: ${candidatesUrls.length} media URL(s)`);

      // 4. Verify before returning.
      for (const url of candidatesUrls.slice(0, 2)) {
        const check = await client.probe(url);
        ctx.log(`probe ${url} → ${check.status} ${check.type || ''}`);
        if (!check.ok) continue;
        results.push({ title: request.name, url, quality: url, size: check.length, groupKey: hit.href, verified: check });
      }
    }
    return results;
  },
};
