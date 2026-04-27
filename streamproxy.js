const https = require('https');

const ALLOWED_HOSTS = ['trafficwise.org', 'carsprogram.org'];

function isAllowedHost(hostname) {
  // Exact match or subdomain match — no substring matches.
  return ALLOWED_HOSTS.some(d => hostname === d || hostname.endsWith('.' + d));
}

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) { res.status(400).send('Missing url'); return; }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    res.status(400).send('Invalid URL');
    return;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    res.status(400).send('Invalid protocol'); return;
  }
  if (!isAllowedHost(parsed.hostname)) {
    res.status(403).send('Forbidden host'); return;
  }

  const options = {
    hostname: parsed.hostname,
    path:     parsed.pathname + parsed.search,
    port:     parsed.port || 443,
    method:   'GET',
    headers: {
      'Referer':    'https://511in.org/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin':     'https://511in.org',
    }
  };

  const upstream = https.request(options, (stream) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Content-Type', stream.headers['content-type'] || 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache');
    stream.pipe(res);
  });

  upstream.setTimeout(10000, () => {
    upstream.destroy();
    if (!res.headersSent) res.status(504).send('Upstream timeout');
  });

  upstream.on('error', e => {
    if (!res.headersSent) res.status(502).send(e.message);
  });

  upstream.end();
};
