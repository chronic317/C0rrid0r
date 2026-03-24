const https = require('https');

exports.handler = async function() {
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title
          uri
          url
          parentCollection {
            title
            uri
            location {
              routeDesignator
              latitude
              longitude
            }
          }
        }
        totalRecords
      }
    }`,
    variables: {
      input: {
        west: -88.5,
        south: 37.7,
        east: -84.5,
        north: 41.8,
        sortDirection: "ASC",
        sortType: "ROADWAY",
        recordLimit: 750,
        recordOffset: 0,
        classificationsOrSlugs: [],
        freeSearchTerm: ""
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
      res.on('end', () => resolve({
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
        body: data,
      }));
    });

    req.on('error', e => resolve({ statusCode: 502, body: e.message }));
    req.write(body);
    req.end();
  });
};
