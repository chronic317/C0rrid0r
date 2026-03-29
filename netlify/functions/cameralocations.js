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

exports.handler = async function(event) {
  const mode = event.queryStringParameters?.mode || 'cameras';

  // Mode: introspect — ask GraphQL what fields CameraView actually has
  if (mode === 'introspect') {
    const result = await graphqlRequest({
      query: `{
        __type(name: "CameraView") {
          name
          fields { name type { name kind ofType { name kind } } }
        }
      }`
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  }

  // Mode: location — introspect the Location type
  if (mode === 'location') {
    const result = await graphqlRequest({
      query: `{
        __type(name: "Location") {
          name
          fields { name type { name kind ofType { name kind } } }
        }
      }`
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  }

  // Mode: single — fetch one camera with all known safe fields to see raw data
  if (mode === 'single') {
    const result = await graphqlRequest({
      query: `query ($input: ListArgs!) {
        listCameraViewsQuery(input: $input) {
          cameraViews {
            title uri url
            sources { type src }
            parentCollection {
              uri title
              location { routeDesignator }
            }
          }
        }
      }`,
      variables: {
        input: {
          west: -88.5, south: 37.7, east: -84.5, north: 41.8,
          sortDirection: "ASC", sortType: "ROADWAY",
          recordLimit: 5, recordOffset: 0,
          classificationsOrSlugs: [], freeSearchTerm: ""
        }
      }
    });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(result),
    };
  }

  // Default: return cameras with whatever coords we have
  try {
    const result = await graphqlRequest({
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
    });

    const views = result?.data?.listCameraViewsQuery?.cameraViews || [];
    const cameras = views.map(cam => ({
      id:        cam.uri,
      title:     cam.title,
      route:     cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
      imageUrl:  cam.url,
      streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
      lat:       null,
      lon:       null,
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
      body: JSON.stringify({ total: cameras.length, placed: 0, cameras }),
    };
  } catch(e) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ total: 0, cameras: [], error: e.message }),
    };
  }
};
