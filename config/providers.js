'use strict';

// Central provider settings. Each live provider in src/providers/<key>.js has an entry here.
//   enabled     — off providers are never loaded (override: SELECT_NAIJA_PROVIDERS_DISABLE=key1,key2 / _ENABLE=...)
//   baseUrls    — first is used; others are fallbacks tried in order when the first fails (domains change)
//   timeoutMs   — per HTTP request; the whole provider run is also capped by engine.providerTimeoutMs
//   rateLimit   — max requests per second to this provider (shared by all requests in the process)
//   headers     — sent with every request to the provider
//   auth        — names of environment variables holding credentials for providers that need a (legitimate) login
//   cacheHours  — how long a successful result for one title is reused
module.exports = {
  engine: {
    providerTimeoutMs: 8000,
    totalTimeoutMs: 9000,
    failureThreshold: 3, // consecutive failures before a provider is paused
    pauseMinutes: 10,
    negativeCacheMinutes: 30, // remember "nothing found" this long
  },
  providers: {
    archive: {
      name: 'Internet Archive',
      enabled: true,
      baseUrls: ['https://archive.org'],
      timeoutMs: 7000,
      rateLimit: 4,
      headers: {},
      cacheHours: 24,
    },
    commons: {
      name: 'Wikimedia Commons',
      enabled: true,
      baseUrls: ['https://commons.wikimedia.org'],
      timeoutMs: 7000,
      rateLimit: 4,
      // Wikimedia asks API clients to identify themselves.
      headers: { 'User-Agent': 'SelectNaija/0.9 (https://github.com/Ajnesss/select-naija; Nuvio addon)' },
      cacheHours: 24,
    },
    template: {
      name: 'Template',
      enabled: false, // reference implementation only (src/providers/_template.js)
      baseUrls: ['https://commons.wikimedia.org'],
      timeoutMs: 7000,
      rateLimit: 2,
      headers: { 'User-Agent': 'SelectNaija/0.9 (https://github.com/Ajnesss/select-naija; Nuvio addon)' },
      cacheHours: 1,
    },
  },
};
