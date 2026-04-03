const https = require('https');

// ── CARS XML PARSER ───────────────────────────────────────────────────────────
// Parses the official Indiana CARS/INDOT CCTV feed from inhub.carsprogram.org
// Coordinates in this feed are microdegrees — divide by 1,000,000 to get decimal
function parseCCTVXML(xml) {
  const cameras = [];
  const itemRegex = /<inventory-item>([\s\S]*?)<\/inventory-item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>\\s*([^<]+?)\\s*<\\/${tag}>`, 'i'));
      return m ? m[1].trim() : null;
    };

    const id    = get('device-id');
    const name  = get('device-name');
    const route = get('route-designator');

    // Coordinates are microdegrees (e.g. 39588567 → 39.588567)
    const rawLat = get('latitude');
    const rawLon = get('longitude');
    const lat = rawLat ? parseFloat(rawLat) / 1000000 : null;
    const lon = rawLon ? parseFloat(rawLon) / 1000000 : null;

    // Pull image URL from first <still-image> block
    let imageUrl = null;
    const stillBlock = block.match(/<still-image>([\s\S]*?)<\/still-image>/i);
    if (stillBlock) {
      const urlMatch = stillBlock[1].match(/<url>\s*(https?:\/\/[^\s<]+)\s*<\/url>/i);
      if (urlMatch) imageUrl = urlMatch[1].trim();
    }

    if (id) {
      cameras.push({
        id,
        title:     name  || id,
        route:     route || 'UNKNOWN',
        imageUrl,
        streamUrl: null,   // CARS feed is still-image only
        lat:       lat && Math.abs(lat) > 0.1 ? lat : null,
        lon:       lon && Math.abs(lon) > 0.1 ? lon : null,
      });
    }
  }

  return cameras;
}

// ── OFFICIAL CARS FEED ────────────────────────────────────────────────────────
function fetchCARSFeed() {
  const username = process.env.CCTV_USERNAME;
  const password = process.env.CCTV_PASSWORD;

  if (!username || !password) {
    return Promise.reject(new Error('CCTV credentials not set in environment variables'));
  }

  const auth = Buffer.from(`${username}:${password}`).toString('base64');

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'inhub.carsprogram.org',
      path:     '/data/cctv.xml',
      method:   'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept':        'application/xml, text/xml, */*',
        'User-Agent':    'C0RRID0R/1.0 Naptown Unsolved naptownunsolved@gmail.com',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`CARS feed returned HTTP ${res.statusCode}`));
        }
        try {
          const cameras = parseCCTVXML(data);
          if (!cameras.length) return reject(new Error('CARS feed parsed 0 cameras'));
          resolve(cameras);
        } catch(e) {
          reject(e);
        }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('CARS feed timed out'));
    });

    req.on('error', reject);
    req.end();
  });
}

// ── FALLBACK: 511in.org GraphQL ───────────────────────────────────────────────
function fetchGraphQL() {
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
      path:     '/api/graphql',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':        'https://511in.org/',
        'Origin':         'https://511in.org',
        'Accept':         'application/json',
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const result  = JSON.parse(data);
          const views   = result?.data?.listCameraViewsQuery?.cameraViews || [];
          const cameras = views.map(cam => ({
            id:        cam.uri,
            title:     cam.title,
            route:     cam.parentCollection?.location?.routeDesignator || 'UNKNOWN',
            imageUrl:  cam.url,
            streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
            lat:       cam.parentCollection?.bbox?.[1] || null,
            lon:       cam.parentCollection?.bbox?.[0] || null,
          }));
          resolve(cameras);
        } catch(e) {
          reject(e);
        }
      });
    });

    req.setTimeout(9000, () => { req.destroy(); reject(new Error('GraphQL timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── HANDLER ───────────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let cameras = [];
  let source  = '';

  // Try official CARS feed first
  try {
    cameras = await fetchCARSFeed();
    source  = 'CARS-OFFICIAL';
  } catch(e) {
    console.warn('[cameralocations] CARS feed failed, falling back to GraphQL:', e.message);
    // Fall back to 511in.org GraphQL
    try {
      cameras = await fetchGraphQL();
      source  = 'GRAPHQL-FALLBACK';
    } catch(e2) {
      console.error('[cameralocations] Both sources failed:', e2.message);
      return res.status(502).json({ total: 0, placed: 0, cameras: [], error: e2.message });
    }
  }

  const placed = cameras.filter(c => c.lat && c.lon).length;
  res.setHeader('Cache-Control', 'public, max-age=1800');
  res.json({ total: cameras.length, placed, cameras, source });
};
