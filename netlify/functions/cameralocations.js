const https = require('https');

function graphqlRequest(query) {
  return new Promise((resolve, reject) => {
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
        catch(e) { reject(new Error('Parse fail: ' + data.slice(0, 300))); }
      });
    });
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async function() {
  // Try to get location fields directly from GraphQL
  // Testing multiple field combinations to find what the schema supports
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title
          uri
          url
          sources { type src }
          parentCollection {
            location {
              routeDesignator
              latitude
              longitude
              lat
              lon
              coordinates
            }
          }
          location {
            latitude
            longitude
            lat
            lon
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
    const result = await graphqlRequest(query);

    // Return the raw result so we can see what fields are available
    const views = result?.data?.listCameraViewsQuery?.cameraViews || [];
    const errors = result?.errors || [];

    // Sample first 5 cameras with all fields
    const sample = views.slice(0, 5).map(cam => ({
      title: cam.title,
      uri: cam.uri,
      parentCollection: cam.parentCollection,
      location: cam.location,
    }));

    // Also build full camera list extracting whatever coords we can find
    let placed = 0;
    const cameras = views.map(cam => {
      // Try every possible location field combination
      const loc = cam.location || cam.parentCollection?.location || {};
      const lat = loc.latitude || loc.lat || null;
      const lon = loc.longitude || loc.lon || null;
      if (lat && lon) placed++;
      return {
        id:        cam.uri,
        title:     cam.title,
        route:     cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
        imageUrl:  cam.url,
        streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
        lat,
        lon,
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify({ total: cameras.length, placed, errors, sample, cameras }),
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ total: 0, cameras: [], error: e.message }),
    };
  }
};
