const https = require('https');

exports.handler = async function(event) {
  const q = event.queryStringParameters?.q;
  if (!q) return { statusCode: 400, body: 'Missing q' };

  return new Promise((resolve) => {
    const path = '/search?q=' + encodeURIComponent(q) + '&format=json&limit=1';
    const req = https.request({
      hostname: 'nominatim.openstreetmap.org',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'C0RRID0R/1.0 Naptown Unsolved Missing Persons Dashboard contact@naptownunsolved.com',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=86400',
            },
            body: JSON.stringify(json[0] || null),
          });
        } catch(e) {
          resolve({ statusCode: 200, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: 'null' });
        }
      });
    });
    req.on('error', () => resolve({ statusCode: 200, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: 'null' }));
    req.end();
  });
};
