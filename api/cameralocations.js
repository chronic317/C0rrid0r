const https = require('https');

function fetchCameraList() {
  const query = {
    query: `query ($input: ListArgs!) {
      listCameraViewsQuery(input: $input) {
        cameraViews {
          title uri url
          sources { type src }
          parentCollection {
            bbox
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
        catch(e) { reject(new Error('Parse fail: ' + data.slice(0, 200))); }
      });
    });
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  try {
    const result = await fetchCameraList();
    const views  = result?.data?.listCameraViewsQuery?.cameraViews || [];

    let placed = 0;
    const cameras = views.map(cam => {
      const bbox = cam.parentCollection?.bbox;
      const lon  = bbox?.[0] || null;
      const lat  = bbox?.[1] || null;
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

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800');
    res.json({ total: cameras.length, placed, cameras });

  } catch(e) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ total: 0, cameras: [], error: e.message });
  }
};
