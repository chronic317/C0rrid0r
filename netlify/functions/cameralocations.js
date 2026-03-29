const https = require('https');

function extractCoords(uri) {
  if (!uri) return null;
  const match = uri.match(/\{"lng":([-\d.]+),"lat":([-\d.]+)\}/);
  if (match) return { lon: parseFloat(match[1]), lat: parseFloat(match[2]) };
  return null;
}

exports.handler = async function() {
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title uri url
          sources { type src }
          parentCollection { location { routeDesignator } }
        }
        totalRecords
      }
    }`,
    variables: {
      input: {
        west: -88.5, south: 37.7, east: -84.5, north: 41.8,
        sortDirection: "ASC", sortType: "ROADWAY",
        recordLimit: 750, recordOffset: 0,
        classificationsOrSlugs: [], freeSearchTerm: ""
      }
    }
  };

  return new Promise((resolve) => {
    const body = JSON.stringify(query);
    const req = https.request({
      hostname: '511in.org',
      path: '/api/graphql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://511in.org/',
        'Origin': 'https://511in.org',
        'Accept': 'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const views = json?.data?.listCameraViewsQuery?.cameraViews || [];

          let placed = 0;
          const cameras = views.map(cam => {
            const coords = extractCoords(cam.uri);
            if (coords) placed++;
            return {
              id:        cam.uri,
              title:     cam.title,
              route:     cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
              imageUrl:  cam.url,
              streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
              lat:       coords?.lat || null,
              lon:       coords?.lon || null,
            };
          });

          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=1800',
            },
            body: JSON.stringify({ total: cameras.length, placed, cameras }),
          });
        } catch(e) {
          resolve({
            statusCode: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ total: 0, cameras: [], error: e.message }),
          });
        }
      });
    });
    req.on('error', e => resolve({
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ total: 0, cameras: [], error: e.message }),
    }));
    req.write(body);
    req.end();
  });
};
