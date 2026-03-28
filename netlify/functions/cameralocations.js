const https = require('https');

function fetchUrl(hostname, path) {
  return new Promise((resolve) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://511in.org/',
      }
    }, (res) => {
      const location = res.headers['location'] || '';
      const match = location.match(/@([-\d.]+),([-\d.]+)/);
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({
        location,
        lon: match ? parseFloat(match[1]) : null,
        lat: match ? parseFloat(match[2]) : null,
        body: data,
      }));
    });
    req.on('error', () => resolve({lon: null, lat: null}));
    req.end();
  });
}

async function fetchCameraCoords(uri) {
  try {
    const result = await fetchUrl('511in.org', '/' + uri);
    if (result.lat && result.lon) return {lat: result.lat, lon: result.lon};
    // coords might be in page body instead of redirect
    const match = (result.body || '').match(/@([-\d.]+),([-\d.]+)/);
    if (match) return {lat: parseFloat(match[2]), lon: parseFloat(match[1])};
    return {lat: null, lon: null};
  } catch(e) {
    return {lat: null, lon: null};
  }
}

exports.handler = async function() {
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title uri url
          sources { type src }
          parentCollection {
            location { routeDesignator }
          }
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

  try {
    // Step 1 — get camera list
    const graphqlResult = await new Promise((resolve, reject) => {
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
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('GraphQL parse fail: ' + data.slice(0,200))); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const views = graphqlResult?.data?.listCameraViewsQuery?.cameraViews || [];

    // Step 2 — fetch coords in parallel batches of 50
    const BATCH = 50;
    const cameras = [];
    for (let i = 0; i < views.length; i += BATCH) {
      const batch = views.slice(i, i + BATCH);
      const coords = await Promise.all(batch.map(cam => fetchCameraCoords(cam.uri)));
      batch.forEach((cam, idx) => {
        cameras.push({
          id:        cam.uri,
          title:     cam.title,
          route:     cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
          imageUrl:  cam.url,
          streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
          lat:       coords[idx].lat,
          lon:       coords[idx].lon,
        });
      });
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: JSON.stringify({
        total: cameras.length,
        withCoords: cameras.filter(c => c.lat).length,
        cameras,
      }),
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({total: 0, cameras: [], error: e.message}),
    };
  }
};
