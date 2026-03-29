const https = require('https');

module.exports = async (req, res) => {
  const url = req.query.url;
  if (!url) { res.status(400).send('Missing url'); return; }

  if (!url.includes('trafficwise.org') && !url.includes('carsprogram.org')) {
    res.status(403).send('Forbidden'); return;
  }

  try {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      port: parsed.port || 443,
      method: 'GET',
      headers: {
        'Referer': 'https://511in.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://511in.org',
      }
    };

    https.request(options, (stream) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      res.setHeader('Content-Type', stream.headers['content-type'] || 'application/x-mpegURL');
      res.setHeader('Cache-Control', 'no-cache');
      stream.pipe(res);
    }).on('error', e => res.status(502).send(e.message)).end();
  } catch(e) {
    res.status(400).send('Invalid URL');
  }
};
