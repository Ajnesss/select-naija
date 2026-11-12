'use strict';

// Select Naija UK check point, deployed on Vercel's free plan in London (lhr1, see vercel.json).
// The nightly GitHub run asks it to load provider pages, so region-locked catalogues (Tubi above all)
// are seen exactly as a UK viewer sees them. Locked down: needs the secret token, and only fetches
// the provider sites listed below. It is not a general proxy.

const ALLOWED_HOSTS = [
  'tubitv.com',
  'www.tubitv.com',
  'uapi.adrise.tv',
  'watch.plex.tv',
  'vod.provider.plex.tv',
  'filmzie.com',
  'www.primevideo.com',
  'www.amazon.co.uk',
  'www.bbc.co.uk',
  'www.channel4.com',
  'nollistream.com',
  'www.afrolandtv.com',
  'kallo.ng',
  'ibaka.tv',
  'www.ibakatv.com',
  'northflix.ng',
  'ipinfo.io',
];
// Stream hosts, for playback tests: can a stream address be played from another place than where it was issued?
const ALLOWED_SUFFIXES = ['.tubi.video', '.dailymotion.com', '.dmcdn.net', '.dailymotion.net'];
const MAX_BYTES = 3 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 SelectNaijaUK/1.0';

module.exports = async function handler(req, res) {
  const token = process.env.UK_TOKEN;
  if (!token || req.headers['x-select-naija-token'] !== token) {
    res.status(401).json({ error: 'unauthorised' });
    return;
  }
  let target;
  try {
    target = new URL(String(req.query.url || ''));
  } catch {
    res.status(400).json({ error: 'bad url' });
    return;
  }
  const hostOk = ALLOWED_HOSTS.includes(target.hostname) || ALLOWED_SUFFIXES.some((x) => target.hostname.endsWith(x));
  if (target.protocol !== 'https:' || !hostOk) {
    res.status(403).json({ error: `not allowed: ${target.protocol}//${target.hostname}` });
    return;
  }
  try {
    const upstream = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: { 'user-agent': UA, 'accept-language': 'en-GB,en;q=0.9', accept: req.headers.accept || '*/*' },
    });
    const buf = Buffer.from(await upstream.arrayBuffer()).subarray(0, MAX_BYTES);
    res.setHeader('x-upstream-status', String(upstream.status));
    res.setHeader('x-upstream-url', upstream.url);
    res.setHeader('x-checked-from', process.env.VERCEL_REGION || 'unknown');
    res.setHeader('content-type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.status(200).send(buf);
  } catch (err) {
    res.status(502).json({ error: err.name === 'TimeoutError' ? 'timeout' : 'network_error' });
  }
};
