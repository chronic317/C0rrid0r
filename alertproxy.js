const https = require('https');

const SOURCES = {
  amber:  'https://www.in.gov/amberalert/',
  silver: 'https://www.in.gov/silveralert/',
  green:  'https://www.in.gov/greenalert/',
  blue:   'https://www.in.gov/bluealerts/',
};

module.exports = async (req, res) => {
  const type = req.query.type;
  const url  = SOURCES[type];
  if (!url) { res.status(400).send('Invalid type'); return; }

  const request = https.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    }
  }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Cache 60s upstream so a refresh storm doesn't hammer in.gov
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.send(data);
    });
  });

  request.setTimeout(10000, () => {
    request.destroy();
    if (!res.headersSent) res.status(504).send('Upstream timeout');
  });

  request.on('error', e => {
    if (!res.headersSent) res.status(502).send(e.message);
  });
};
