const https = require('https');

module.exports = async (req, res) => {
  const q = req.query.q;
  if (!q) { res.status(400).send('Missing q'); return; }

  const path = '/search?q=' + encodeURIComponent(q) + '&format=json&limit=1&countrycodes=us';
  https.request({
    hostname: 'nominatim.openstreetmap.org',
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'C0RRID0R/1.0 Naptown Unsolved Missing Persons naptownunsolved@gmail.com',
      'Accept': 'application/json',
    }
  }, (r) => {
    let data = '';
    r.on('data', c => data += c);
    r.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.json(json[0] || null);
      } catch(e) { res.json(null); }
    });
  }).on('error', () => res.json(null)).end();
};
