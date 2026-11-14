'use strict';

const http = require('http');
const path = require('path');
const { loadData } = require('./data');
const { manifestCatalogs, queryCatalog, metaFor } = require('./catalog');
const { buildStreams } = require('./streams');
const { DEFAULT, decodeConfig, configurePage } = require('./config');
const pkg = require('../package.json');

const RELOAD_MS = 10 * 60 * 1000;

function buildManifest(data, { diagnostics, config = DEFAULT }) {
  return {
    id: 'community.selectnaija',
    version: pkg.version,
    name: 'Select Naija',
    description:
      'Nigerian films and series in Yoruba, Igbo, Hausa, English and more, from legitimate sources only. Every link is checked before it is shown.',
    resources: [
      'catalog',
      { name: 'meta', types: ['movie', 'series'], idPrefixes: ['snaija'] },
      { name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt', 'snaija'] },
    ],
    types: ['movie', 'series'],
    catalogs: manifestCatalogs(data, Date.now(), { diagnostics, config }),
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

// "/catalog/movie/snaija-yoruba/genre=Yoruba&skip=50.json" → { genre, skip }
function parseExtra(segment) {
  const extra = {};
  if (!segment) return extra;
  for (const part of segment.split('&')) {
    const [k, v = ''] = part.split('=');
    extra[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
  }
  return extra;
}

function createServer(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const diagnostics = options.diagnostics ?? process.env.SELECT_NAIJA_DIAGNOSTICS === '1';
  const tmdbApiKey = options.tmdbApiKey ?? process.env.TMDB_API_KEY;
  const fetchImpl = options.fetchImpl || fetch;
  let data = loadData(dataDir);
  let loadedAt = new Date().toISOString();

  function reload() {
    try {
      data = loadData(dataDir);
      loadedAt = new Date().toISOString();
    } catch (err) {
      // Keep serving the last good data if a new file is malformed.
      console.error(`[reload] kept previous data: ${err.message}`);
    }
  }

  function sendHtml(res, html) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  }

  function send(res, status, body, maxAge = 0) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    });
    res.end(JSON.stringify(body));
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const url = new URL(req.url, 'http://localhost');
      let rawParts = url.pathname.replace(/^\/+/, '').replace(/\.json$/, '').split('/');
      // Settings in the install URL: /<config>/manifest.json, /<config>/catalog/...
      const RESOURCES = new Set(['', 'manifest', 'catalog', 'meta', 'stream', 'health', 'configure']);
      const config = !RESOURCES.has(rawParts[0]) ? decodeConfig(rawParts[0]) : null;
      if (config) rawParts = rawParts.slice(1);
      const cfg = config || DEFAULT;
      const parts = rawParts.map(decodeURIComponent);
      const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

      if (parts[0] === 'configure') return sendHtml(res, configurePage(origin, cfg));
      if (url.pathname === '/' && !config) return sendHtml(res, configurePage(origin, cfg));
      if (parts[0] === 'manifest' || parts[0] === '') {
        return send(res, 200, buildManifest(data, { diagnostics, config: cfg }), 3600);
      }
      if (parts[0] === 'health') {
        return send(res, 200, {
          ok: true,
          version: pkg.version,
          titles: data.titles.length,
          links: data.allLinks.length,
          statusGeneratedAt: data.statusGeneratedAt,
          dataLoadedAt: loadedAt,
        });
      }
      if (parts[0] === 'catalog' && parts.length >= 3) {
        const metas = queryCatalog(parts[1], parts[2], parseExtra(rawParts[3]), data, Date.now(), cfg);
        return send(res, 200, { metas }, 3600);
      }
      if (parts[0] === 'meta' && parts.length === 3) {
        const meta = metaFor(parts[2], data);
        return meta ? send(res, 200, { meta }, 3600) : send(res, 404, { meta: null });
      }
      if (parts[0] === 'stream' && parts.length === 3) {
        const streams = await buildStreams(parts[1], parts[2], data, { tmdbApiKey, fetchImpl });
        return send(res, 200, { streams }, 600);
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      console.error(`[error] ${req.url}: ${err.stack || err.message}`);
      return send(res, 500, { error: 'internal error' });
    } finally {
      if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${req.url} ${Date.now() - started}ms`);
    }
  });

  const timer = setInterval(reload, RELOAD_MS);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  server.reload = reload;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8100;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`Select Naija ${pkg.version} on http://${host}:${port}`));
}

module.exports = { createServer, parseExtra, buildManifest };
