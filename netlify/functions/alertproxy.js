const https = require('https');

exports.handler = async function(event) {
  const type = event.queryStringParameters?.type;
  const urls = {
    amber:  'https://www.in.gov/amberalert/',
    silver: 'https://www.in.gov/silveralert/',
    green:  'https://www.in.gov/greenalert/',
    blue:   'https://www.in.gov/bluealerts/',
  };
  if (!type || !urls[type]) {
    return { statusCode: 400, body: 'Invalid alert type' };
  }
  return new Promise((resolve) => {
    https.get(urls[type], {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html',
          'Access-Control-Allow-Origin': '*',
        },
        body: data,
      }));
    }).on('error', e => resolve({ statusCode: 502, body: e.message }));
  });
};
