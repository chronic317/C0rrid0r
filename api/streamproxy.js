const https = require('https');
const http  = require('http');

const ALLOWED_HOSTS = ['trafficwise.org', 'carsprogram.org'];

function isAllowedHost(hostname) {
  // Exact match or subdomain match — no substring matches.
  return ALLOWED_HOSTS.some(d => hostname === d || hostname.endsWith('.' + d));
}

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Invalid URL')); }
    if (!isAllowedHost(u.hostname)) return reject(new Error('Forbidden host'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port:     u.port || (u.protocol === 'https:' ? 443 : 80),
      path:     u.pathname + u.search,
      method:   'GET',
      headers: {
        'Referer':    'https://511in.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin':     'https://511in.org',
      }
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve({
        statusCode: resp.statusCode,
        headers:    resp.headers,
        body:       Buffer.concat(chunks),
      }));
      resp.on('error', reject);
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// Rewrite an M3U8 manifest so every URI inside it routes through this proxy.
// Without this, HLS.js fetches segment files (.ts) directly from the upstream
// host, which has no CORS, so playback fails.
function rewriteManifest(body, baseUrl, proxyPath) {
  const text = body.toString('utf8');
  return text.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) {
      // Some directives have URI="..." inside (EXT-X-KEY, EXT-X-MEDIA, EXT-X-MAP).
      return line.replace(/URI="([^"]+)"/g, (m, uri) => {
        try {
          const abs = new URL(uri, baseUrl).toString();
          return `URI="${proxyPath}?url=${encodeURIComponent(abs)}"`;
        } catch { return m; }
      });
    }
    // Otherwise: a media-URI line (segment or nested variant manifest)
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      return `${proxyPath}?url=${encodeURIComponent(abs)}`;
    } catch {
      return line;
    }
  }).join('\n');
}

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) { res.status(400).send('Missing url'); return; }

  let parsed;
  try { parsed = new URL(url); }
  catch (e) { res.status(400).send('Invalid URL'); return; }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    res.status(400).send('Invalid protocol'); return;
  }
  if (!isAllowedHost(parsed.hostname)) {
    res.status(403).send('Forbidden host'); return;
  }

  try {
    const upstream = await fetchBuffer(url);

    if (upstream.statusCode !== 200) {
      res.status(upstream.statusCode).send('Upstream HTTP ' + upstream.statusCode);
      return;
    }

    const ct = (upstream.headers['content-type'] || '').toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isManifest = ct.includes('mpegurl') || ct.includes('m3u8') || path.endsWith('.m3u8');

    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control',                'no-cache');

    if (isManifest) {
      const rewritten = rewriteManifest(upstream.body, url, '/api/streamproxy');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(rewritten);
    } else {
      // Segments and other binary content — pass through unchanged.
      res.setHeader('Content-Type', ct || 'video/mp2t');
      res.send(upstream.body);
    }
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).send((e && e.message) || 'Upstream error');
    }
  }
};
