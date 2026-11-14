#!/usr/bin/env node
'use strict';
// End-to-end check of the deployed addon, as Nuvio uses it: manifest → every row → a title page → its streams,
// for a film and a series episode, plus search and a configured install URL. Exits 1 on any failure.
const BASE = (process.env.ADDON_URL || 'https://select-naija.92-5-24-2.sslip.io').replace(/\/+$/, '');
const fails = [];
const get = async (p) => {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${p}`, { signal: AbortSignal.timeout(30000) });
  const ms = Date.now() - t0;
  if (!res.ok) throw new Error(`${p} → HTTP ${res.status}`);
  return { body: await res.json(), ms };
};
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails.push(msg); };

(async () => {
  try {
    const { body: m, ms } = await get('/manifest.json');
    check(m.id === 'community.selectnaija' && m.catalogs.length >= 5, `manifest v${m.version}, ${m.catalogs.length} catalogues (${ms} ms)`);
    check(m.behaviorHints?.configurable === true, 'manifest is configurable');
    let film = null;
    let show = null;
    for (const c of m.catalogs.filter((x) => !x.extra?.some((e) => e.name === 'search' && e.isRequired))) {
      const { body, ms: t } = await get(`/catalog/${c.type}/${c.id}.json`);
      const metas = body.metas || [];
      const junk = metas.filter((x) => !x.name || /^[-(|,]|sahaja|don'?t leave/i.test(x.name));
      check(metas.length > 0 && !junk.length && t < 5000, `row "${c.name}": ${metas.length} titles, ${junk.length} bad names (${t} ms)`);
      if (c.type === 'movie' && !film) film = metas[0];
      if (c.type === 'series' && !show) show = metas[0];
    }
    const { body: s } = await get(`/catalog/movie/snaija-search/search=${encodeURIComponent('love')}.json`);
    check((s.metas || []).length > 0, `search "love": ${(s.metas || []).length} films`);
    for (const [type, item] of [['movie', film], ['series', show]]) {
      if (!item) { check(false, `no ${type} to test`); continue; }
      const { body: meta } = await get(`/meta/${type}/${item.id}.json`);
      check(meta.meta?.name && meta.meta?.poster, `${type} page "${meta.meta?.name}"${meta.meta?.videos ? `, ${meta.meta.videos.length} episodes` : ''}`);
      const streamId = type === 'series' ? meta.meta?.videos?.[0]?.id : item.id;
      const { body: st } = await get(`/stream/${type}/${streamId}.json`);
      const playable = (st.streams || []).filter((x) => x.ytId || x.url);
      const external = (st.streams || []).filter((x) => x.externalUrl);
      check(playable.length > 0 && external.length === 0, `${type} ${streamId}: ${playable.length} in-app streams, ${external.length} external`);
    }
    const cfg = Buffer.from(JSON.stringify({ langs: ['yo'], rows: ['new'] })).toString('base64url');
    const { body: cm } = await get(`/${cfg}/manifest.json`);
    check(cm.catalogs.some((c) => c.id === 'snaija-yoruba') && !cm.catalogs.some((c) => c.id === 'snaija-igbo'), 'configured install URL (Yoruba only)');
  } catch (err) {
    check(false, err.message);
  }
  console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAll live checks passed');
  process.exit(fails.length ? 1 : 0);
})();
