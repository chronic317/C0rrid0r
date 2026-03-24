const https = require('https');

exports.handler = async function() {
  return new Promise((resolve) => {
    https.get('https://511in.org/api/v2/get/cameras', {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
        'Referer': 'https://511in.org/',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
        body: data,
      }));
    }).on('error', e => resolve({ statusCode: 502, body: e.message }));
  });
};
