#!/usr/bin/env node
'use strict';

// Research: ZeraTV (zeratv.com). Lists posts in Movies, Yoruba and Igbo, classifies each film's player
// (Vimeo, YouTube, other), and for Vimeo films reads Vimeo's public oEmbed (owner, embed rules) and the
// video page (download availability), from the US and from London. Writes research/out/zeratv.json.
// Research only: it records what Vimeo shows a visitor and does not use any stream address it may see.

const fs = require('fs');
const path = require('path');

const EDGE = process.env.UK_EDGE_URL;
const TOKEN = process.env.UK_EDGE_TOKEN;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { uk = false, headers = {} } = {}) {
  const target = uk ? `${EDGE}/api/fetch?url=${encodeURIComponent(url)}` : url;
  const res = await fetch(target, { headers: { 'user-agent': UA, ...headers, ...(uk ? { 'x-select-naija-token': TOKEN } : {}) }, signal: AbortSignal.timeout(30000) });
  return { status: uk ? Number(res.headers.get('x-upstream-status')) : res.status, text: await res.text() };
}

async function main() {
  const out = { categories: {}, posts: [], vimeo: [] };
  const cats = { movies: 'category/movies', yoruba: 'category/traditional/yoruba-movies', igbo: 'category/traditional/igbo-movies' };
  const postUrls = new Map();
  for (const [name, slug] of Object.entries(cats)) {
    let pages = 0;
    let found = 0;
    for (let p = 1; p <= 80; p++) {
      const r = await get(`https://www.zeratv.com/${slug}/${p > 1 ? `page/${p}/` : ''}`);
      if (r.status !== 200) break;
      pages = p;
      const links = [...r.text.matchAll(/href="(https:\/\/www\.zeratv\.com\/[a-z0-9-]+\/)"/g)].map((m) => m[1]).filter((u) => !/\/(category|tag|author|page|about|contact|faq|terms-of-use|partnership-program|membership[^/]*|login|register|account)[/-]/.test(u));
      const before = postUrls.size;
      for (const u of links) if (!postUrls.has(u)) postUrls.set(u, name);
      found += postUrls.size - before;
      if (postUrls.size === before) break;
      await sleep(400);
    }
    out.categories[name] = { pages, newPosts: found };
  }
  const sample = [...postUrls.entries()];
  for (const [url, cat] of sample) {
    const r = await get(url);
    const vimeo = r.text.match(/player\.vimeo\.com\/video\/(\d+)(?:\?[^"']*?h=([0-9a-f]+))?/);
    const yt = r.text.match(/(?:youtube\.com\/embed\/|youtu\.be\/|youtube\.com\/watch\?v=)([\w-]{11})/);
    const dm = r.text.match(/dailymotion\.com\/(?:embed\/)?video\/(\w+)/);
    const title = (r.text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, '').trim();
    const members = /members only|subscribe to watch|premium content|login to watch|restricted to members/i.test(r.text);
    out.posts.push({ url, cat, status: r.status, title, host: vimeo ? 'vimeo' : yt ? 'youtube' : dm ? 'dailymotion' : 'other', id: vimeo?.[1] || yt?.[1] || dm?.[1] || null, membersOnly: members });
    await sleep(300);
  }
  const vimeoPosts = out.posts.filter((p) => p.host === 'vimeo');
  for (const p of vimeoPosts.slice(0, 12)) {
    const o = await get(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${p.id}`)}`);
    let oembed = null;
    try {
      oembed = JSON.parse(o.text);
    } catch {
      oembed = { raw: o.text.slice(0, 200) };
    }
    const page = await get(`https://vimeo.com/${p.id}`);
    const ukPage = EDGE ? await get(`https://vimeo.com/${p.id}`, { uk: true }) : null;
    const embedUk = EDGE ? await get(`https://player.vimeo.com/video/${p.id}`, { uk: true }) : null;
    out.vimeo.push({
      id: p.id,
      post: p.url,
      cat: p.cat,
      oembedStatus: o.status,
      owner: oembed?.author_name,
      ownerUrl: oembed?.author_url,
      title: oembed?.title,
      duration: oembed?.duration,
      domainStatus: oembed?.domain_status_code,
      pageStatusUS: page.status,
      downloadOffered: /"download"\s*:\s*\{|Download|allow_downloads"\s*:\s*true/i.test(page.text) ? 'mentions download' : 'no',
      pageStatusUK: ukPage?.status ?? null,
      embedStatusUK: embedUk?.status ?? null,
      embedPrivacyHint: embedUk ? (/because of its privacy settings|cannot be played here|Sorry/i.test(embedUk.text) ? 'blocked or private' : 'plays in player') : null,
    });
    await sleep(500);
  }
  const hosts = {};
  for (const p of out.posts) hosts[`${p.cat}:${p.host}`] = (hosts[`${p.cat}:${p.host}`] || 0) + 1;
  out.summary = { posts: out.posts.length, hosts, membersOnly: out.posts.filter((p) => p.membersOnly).length };
  fs.mkdirSync(path.join(__dirname, '..', 'research', 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'research', 'out', 'zeratv.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.summary), JSON.stringify(out.categories));
}

main();
