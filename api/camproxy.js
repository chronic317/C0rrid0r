const https = require('https');

module.exports = async (req, res) => {
  const id = req.query.id;
  if (!id) { res.status(400).send('Missing id'); return; }

  const url = `https://content.trafficwise.org/cctv/${id}.jpg`;

  https.get(url, {
    headers: {
      'Referer': 'https://511in.org/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  }, (camRes) => {
    if (camRes.statusCode !== 200) {
      // Try fallback
      const id2 = id.replace(/\//g, '_');
      const fallback = `https://public.carsprogram.org/cameras/IN/${id2}.flv.png`;
      https.get(fallback, {headers:{'Referer':'https://511in.org/'}}, (fr) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');
        fr.pipe(res);
      }).on('error', () => res.status(502).send('Feed unavailable'));
      return;
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'image/jpeg');
    camRes.pipe(res);
  }).on('error', () => res.status(502).send('Feed unavailable'));
};
