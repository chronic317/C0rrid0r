const https = require('https');

function extractIntersection(title) {
  if (!title) return null;
  // Title format: "ROUTE: CAMERA-CODE LOCATION"
  // Camera code looks like: 11-049-127-cam or 3-062-147-3-1 or ky2-041-018-5-2
  const match = title.match(/:\s+[\w\d]+-[\w\d]+-[\w\d]+[-\w\d]*\s+(.+)/i);
  if (match) return match[1].trim();
  return null;
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
          catch(e) { reject(new Error('Parse fail: ' + data.slice(0, 200))); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    const views = graphqlResult?.data?.listCameraViewsQuery?.cameraViews || [];

    const cameras = views.map(cam => ({
      id:           cam.uri,
      title:        cam.title,
      route:        cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
      imageUrl:     cam.url,
      streamUrl:    cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
      intersection: extractIntersection(cam.title),
      lat:          null,
      lon:          null,
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
      body: JSON.stringify({total: cameras.length, cameras}),
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({total: 0, cameras: [], error: e.message}),
    };
  }
};
