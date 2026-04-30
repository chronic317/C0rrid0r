const https = require('https');

module.exports = async (req, res) => {
  const q = req.query.q;
  if (!q) { res.status(400).send('Missing q'); return; }
  if (q.length > 200) { res.status(400).send('Query too long'); return; }

  const path = '/search?q=' + encodeURIComponent(q) + '&format=json&limit=1&countrycodes=us';
  const r = https.request({
    hostname: 'nominatim.openstreetmap.org',
    path,
    method: 'GET',
    headers: {
      'User-Agent': 'C0RRID0R/1.0 Naptown Unsolved Missing Persons naptownunsolved@gmail.com',
      'Accept': 'application/json',
    }
  }, (resp) => {
    let data = '';
    resp.on('data', c => data += c);
    resp.on('end', () => {
      try {
        const json = JSON.parse(data);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Cache aggressively - addresses don't move
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.json(json[0] || null);
      } catch(e) {
        if (!res.headersSent) res.json(null);
      }
    });
  });

  r.setTimeout(8000, () => { r.destroy(); if (!res.headersSent) res.json(null); });
  r.on('error', () => { if (!res.headersSent) res.json(null); });
  r.end();
};
