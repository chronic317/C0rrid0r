const https = require('https');

// CARS device IDs look like "01-032-005-cam1" — letters, digits, dash, slash, underscore.
// Strict allowlist prevents path traversal and weird upstreams.
const ID_RE = /^[A-Za-z0-9_\-\/]{1,64}$/;

function fetchToRes(url, res) {
  return new Promise((resolve, reject) => {
    const r = https.get(url, {
      headers: {
        'Referer': 'https://511in.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    }, (camRes) => {
      if (camRes.statusCode !== 200) {
        camRes.resume(); // drain
        return reject(new Error('HTTP ' + camRes.statusCode));
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', camRes.headers['content-type'] || 'image/jpeg');
      camRes.pipe(res);
      camRes.on('end', resolve);
      camRes.on('error', reject);
    });
    r.setTimeout(8000, () => { r.destroy(); reject(new Error('timeout')); });
    r.on('error', reject);
  });
}

module.exports = async (req, res) => {
  const id = req.query.id;
  if (!id) { res.status(400).send('Missing id'); return; }
  if (!ID_RE.test(id)) { res.status(400).send('Invalid id'); return; }

  const primary = `https://content.trafficwise.org/cctv/${id}.jpg`;
  try {
    await fetchToRes(primary, res);
    return;
  } catch (e) {
    // Fall through to fallback only if response hasn't started
    if (res.headersSent) return;
  }

  // Fallback — CARS public still
  const id2 = id.replace(/\//g, '_');
  const fallback = `https://public.carsprogram.org/cameras/IN/${id2}.flv.png`;
  try {
    await fetchToRes(fallback, res);
  } catch (e) {
    if (!res.headersSent) res.status(502).send('Feed unavailable');
  }
};
