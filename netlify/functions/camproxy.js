const https = require('https');

exports.handler = async function(event) {
  const camId = event.queryStringParameters?.id;
  if (!camId || !/^[\w\-]+$/.test(camId)) {
    return { statusCode: 400, body: 'Invalid camera ID' };
  }

  const url = `https://content.trafficwise.org/cctv/${camId}.jpg`;

  return new Promise((resolve) => {
    const options = {
      headers: {
        'Referer': 'https://511in.org/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'image/jpeg,image/*,*/*',
      }
    };

    https.get(url, options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          statusCode: res.statusCode === 200 ? 200 : 502,
          headers: {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-cache, no-store',
            'Access-Control-Allow-Origin': '*',
          },
          body: buffer.toString('base64'),
          isBase64Encoded: true,
        });
      });
    }).on('error', (e) => {
      resolve({ statusCode: 502, body: 'Upstream error: ' + e.message });
    });
  });
};
