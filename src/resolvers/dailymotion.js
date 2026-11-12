'use strict';

// Owner-authorised Dailymotion streams. A channel owner who agrees to Select Naija playing their films in
// Nuvio creates a Private API key with the "Generate Stream URLs" permission (Dailymotion Partner API) and
// shares its client ID and secret. With it, Select Naija asks Dailymotion for permanent stream addresses
// (no_expire=1, no_ip_lock=1) for that owner's videos, exactly as Dailymotion documents for delivering an
// owner's content to their audience: https://developers.dailymotion.com/guides/generate-stream-urls/
// Without the owner's key nothing here runs; public player addresses are never used.

const API = 'https://partner.api.dailymotion.com';
const tokens = new Map(); // channel -> { token, expires }
const urls = new Map(); // videoId -> { url, at }
const URL_TTL_MS = 24 * 3600 * 1000; // permanent per Dailymotion; refreshed daily anyway

function credentialsFor(channel, env = process.env) {
  const prefix = channel.credentialsEnv;
  if (!prefix) return null;
  const id = env[`${prefix}_CLIENT_ID`];
  const secret = env[`${prefix}_CLIENT_SECRET`];
  return id && secret ? { id, secret } : null;
}

async function token(channel, creds, fetchImpl) {
  const cached = tokens.get(channel.user);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const res = await fetchImpl(`${API}/oauth/v1/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.id, client_secret: creds.secret }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Dailymotion token ${res.status}`);
  const body = await res.json();
  tokens.set(channel.user, { token: body.access_token, expires: Date.now() + (body.expires_in || 3600) * 1000 });
  return body.access_token;
}

/** Returns the owner-authorised HLS address for one video, or null. Never throws. */
async function ownerStreamUrl(videoId, channel, { fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  const creds = credentialsFor(channel, env);
  if (!creds) return null;
  const hit = urls.get(videoId);
  if (hit && now - hit.at < URL_TTL_MS) return hit.url;
  try {
    const t = await token(channel, creds, fetchImpl);
    const res = await fetchImpl(`${API}/rest/video/${encodeURIComponent(videoId)}?fields=stream_hls_url&no_expire=1&no_ip_lock=1`, {
      headers: { authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const url = (await res.json()).stream_hls_url || null;
    if (url) urls.set(videoId, { url, at: now });
    return url;
  } catch {
    return null;
  }
}

function clearDailymotionCache() {
  tokens.clear();
  urls.clear();
}

module.exports = { ownerStreamUrl, credentialsFor, clearDailymotionCache };
