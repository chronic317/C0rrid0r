const https = require('https');

exports.handler = async function(event) {
  const uri = event.queryStringParameters?.uri;
  if (!uri) return { statusCode: 400, body: 'Missing uri' };

  return new Promise((resolve) => {
    const options = {
      hostname: '511in.org',
      path: '/' + uri,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://511in.org/',
      }
    };

    const req = https.request(options, (res) => {
      // Check if we got a redirect with coordinates in the URL
      const location = res.headers['location'] || '';
      const coordMatch = location.match(/@([-\d.]+),([-\d.]+)/);
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({
            statusCode: res.statusCode,
            location,
            coordMatch: coordMatch ? {lon: coordMatch[1], lat: coordMatch[2]} : null,
            bodySnippet: data.slice(0, 500),
          }),
        });
      });
    });

    req.on('error', e => resolve({
      statusCode: 200,
      headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({error: e.message}),
    }));
    req.end();
  });
};
