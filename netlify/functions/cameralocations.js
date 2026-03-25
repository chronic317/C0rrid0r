const https = require('https');

exports.handler = async function() {
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title
          uri
          url
          sources { type src }
          parentCollection {
            title
            uri
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

  return new Promise((resolve) => {
    const body = JSON.stringify(query);
    const options = {
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
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const views = parsed?.data?.listCameraViewsQuery?.cameraViews || [];
          const cameras = views.map(cam => ({
            id:            cam.uri,
            title:         cam.title,
            route:         cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
            imageUrl:      cam.url,
            streamUrl:     cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
            collectionUri: cam.parentCollection?.uri,
          }));
          resolve({
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=1800',
            },
            body: JSON.stringify({total: cameras.length, cameras}),
          });
        } catch(e) {
          // Return empty cameras array instead of crashing
          resolve({
            statusCode: 200,
            headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            body: JSON.stringify({total: 0, cameras: [], error: e.message, raw: data.slice(0, 200)}),
          });
        }
      });
    });

    req.on('error', e => resolve({
      statusCode: 200,
      headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({total: 0, cameras: [], error: e.message}),
    }));
    req.write(body);
    req.end();
  });
};
