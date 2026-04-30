const https = require('https');

// Legacy CARS device IDs look like "01-032-005-cam1" — letters, digits, dash, slash, underscore.
const LEGACY_ID_RE = /^[A-Za-z0-9_\-\/]{1,64}$/;

// Image URLs returned by /api/cameralocations come from these hosts.
// Strict exact-match allowlist — no substring tricks, no open proxy.
const ALLOWED_HOSTS = new Set([
  'public.carsprogram.org',
  'content.trafficwise.org',
  'cctv.trafficwise.org',
  '511in.org',
  'inhub.carsprogram.org',
]);

function pipeUpstream(url, res) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, {
      headers: {
        'Referer': 'https://511in.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, (camRes) => {
      if (camRes.statusCode !== 200) {
        camRes.resume();
        return reject(new Error('HTTP ' + camRes.statusCode));
      }
      // CORS headers must be set BEFORE piping starts so browser canvas isn't tainted
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Content-Type', camRes.headers['content-type'] || 'image/jpeg');
      camRes.pipe(res);
      camRes.on('end', resolve);
      camRes.on('error', reject);
    });
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
  });
}

function isAllowedUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  return ALLOWED_HOSTS.has(u.hostname);
}

module.exports = async (req, res) => {
  const id  = req.query.id;
  const url = req.query.url;

  // Path A: caller passed a full upstream URL (modern path — used when the
  // /api/cameralocations response includes imageUrl).
  if (url) {
    if (!isAllowedUrl(url)) {
      res.status(400).send('URL host not allowed');
      return;
    }
    try {
      await pipeUpstream(url, res);
      return;
    } catch (e) {
      if (!res.headersSent) res.status(502).send('Feed unavailable');
      return;
    }
  }

  // Path B: legacy device ID (e.g. "01-032-005-cam1") — keep working for
  // FALLBACK_CAMERAS list and any older clients.
  if (!id) { res.status(400).send('Missing id or url'); return; }
  if (!LEGACY_ID_RE.test(id)) { res.status(400).send('Invalid id'); return; }

  const primary = `https://content.trafficwise.org/cctv/${id}.jpg`;
  try {
    await pipeUpstream(primary, res);
    return;
  } catch (e) {
    if (res.headersSent) return;
  }

  const id2 = id.replace(/\//g, '_');
  const fallback = `https://public.carsprogram.org/cameras/IN/${id2}.flv.png`;
  try {
    await pipeUpstream(fallback, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).send('Feed unavailable');
  }
};
