const https = require('https');

function fetchHead(path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname: '511in.org',
      path: '/' + path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://511in.org/',
        'Accept': 'text/html',
      }
    }, (res) => {
      const location = res.headers['location'] || '';
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        // Try coords from redirect URL first
        let match = location.match(/@([-\d.]+),([-\d.]+)/);
        if (!match) match = location.match(/lng[=:]([-\d.]+)[&,}].*lat[=:]([-\d.]+)/i);
        if (!match) match = body.match(/@([-\d.]+),([-\d.]+)/);
        if (!match) {
          // Look for JSON coords in body
          const jm = body.match(/"lng":([-\d.]+),"lat":([-\d.]+)/);
          if (jm) {
            resolve({ lon: parseFloat(jm[1]), lat: parseFloat(jm[2]), location, bodySnip: body.slice(0, 300) });
            return;
          }
        }
        resolve({
          statusCode: res.statusCode,
          location,
          coords: match ? { lon: parseFloat(match[1]), lat: parseFloat(match[2]) } : null,
          bodySnip: body.slice(0, 400),
        });
      });
    });
    req.setTimeout(5000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', e => resolve({ error: e.message }));
    req.end();
  });
}

exports.handler = async function(event) {
  // Test mode: hit a single camera page and return everything we see
  const uri = event.queryStringParameters?.uri || 'camera/18236';
  const result = await fetchHead(uri);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(result),
  };
};
