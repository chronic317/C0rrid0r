const https = require('https');

// ── MILE MARKER ANCHORS ───────────────────────────────
// Each highway has anchor points [mm, lat, lon]
// We interpolate between them based on mile marker found in title
const HIGHWAY_ANCHORS = {
  'I-65': [
    [0,   38.334, -85.734],
    [10,  38.443, -85.784],
    [19,  38.526, -85.799],
    [34,  38.658, -85.769],
    [50,  38.811, -85.774],
    [72,  39.001, -85.819],
    [90,  39.180, -85.900],
    [101, 39.316, -86.007],
    [112, 39.533, -86.111],
    [119, 39.768, -86.149],
    [130, 40.048, -86.469],
    [141, 40.132, -86.617],
    [158, 40.413, -86.873],
    [168, 40.524, -86.897],
    [178, 40.657, -86.905],
    [193, 40.826, -87.019],
    [200, 41.044, -87.167],
    [215, 41.251, -87.321],
    [230, 41.367, -87.316],
    [240, 41.434, -87.319],
    [255, 41.516, -87.308],
    [262, 41.576, -87.310],
  ],
  'I-70': [
    [0,   39.469, -87.531],
    [7,   39.469, -87.381],
    [11,  39.469, -87.319],
    [23,  39.503, -87.125],
    [41,  39.551, -86.895],
    [58,  39.677, -86.668],
    [66,  39.758, -86.499],
    [73,  39.771, -86.280],
    [79,  39.771, -86.191],
    [90,  39.771, -85.930],
    [104, 39.787, -85.757],
    [116, 39.802, -85.578],
    [131, 39.825, -85.386],
    [145, 39.834, -85.175],
    [156, 39.834, -84.893],
  ],
  'I-69': [
    [0,   38.080, -87.568],
    [16,  38.189, -87.567],
    [29,  38.319, -87.441],
    [50,  38.519, -87.285],
    [73,  38.715, -87.141],
    [100, 38.954, -86.869],
    [118, 39.100, -86.618],
    [141, 39.336, -86.282],
    [162, 39.571, -86.032],
    [175, 39.779, -85.975],
    [185, 39.966, -85.731],
    [200, 40.193, -85.393],
    [215, 40.436, -85.149],
    [230, 40.693, -85.132],
    [245, 41.018, -85.132],
    [255, 41.131, -85.000],
  ],
  'I-74': [
    [0,   39.895, -87.526],
    [12,  40.040, -87.296],
    [28,  40.040, -87.070],
    [52,  40.040, -86.848],
    [69,  39.951, -86.544],
    [82,  39.852, -86.330],
    [96,  39.771, -86.130],
    [108, 39.607, -85.930],
    [116, 39.524, -85.774],
    [123, 39.452, -85.651],
    [134, 39.396, -85.489],
  ],
  'I-465': [
    [0,   39.671, -86.241],
    [7,   39.671, -86.059],
    [14,  39.723, -85.981],
    [21,  39.836, -85.966],
    [27,  39.908, -86.033],
    [34,  39.921, -86.167],
    [40,  39.887, -86.265],
    [46,  39.806, -86.282],
    [53,  39.723, -86.282],
  ],
  'I-80': [
    [0,   41.628, -87.524],
    [10,  41.556, -87.376],
    [20,  41.543, -87.177],
    [30,  41.589, -87.000],
    [40,  41.629, -86.820],
    [49,  41.678, -86.638],
    [56,  41.679, -86.494],
    [72,  41.683, -86.244],
    [83,  41.683, -85.970],
    [96,  41.650, -85.741],
    [107, 41.620, -85.521],
    [121, 41.420, -85.134],
  ],
  'I-90': [
    [0,   41.628, -87.524],
    [10,  41.556, -87.376],
    [20,  41.543, -87.177],
    [49,  41.678, -86.638],
    [72,  41.683, -86.244],
    [83,  41.683, -85.970],
    [107, 41.620, -85.521],
    [121, 41.420, -85.134],
  ],
  'I-94': [
    [0,   41.574, -87.524],
    [5,   41.574, -87.450],
    [10,  41.574, -87.376],
  ],
  'I-64': [
    [0,   37.971, -87.571],
    [10,  37.986, -87.432],
    [18,  38.030, -87.297],
    [25,  38.037, -87.167],
    [34,  38.046, -87.000],
  ],
  'I-164': [
    [0,   37.971, -87.571],
    [5,   37.971, -87.486],
    [10,  37.971, -87.400],
  ],
  'I-265': [
    [0,   38.296, -85.800],
    [5,   38.338, -85.748],
    [10,  38.365, -85.686],
  ],
  'I-469': [
    [0,   41.068, -85.134],
    [11,  41.001, -84.962],
    [21,  40.929, -84.842],
  ],
  'I-865': [
    [0,   39.836, -86.282],
    [3,   39.848, -86.234],
    [6,   39.860, -86.186],
  ],
  'US-31': [
    [0,   38.334, -85.734],
    [50,  38.811, -86.100],
    [100, 39.300, -86.100],
    [140, 39.768, -86.149],
    [170, 40.132, -86.100],
    [200, 40.657, -86.050],
    [230, 41.100, -86.050],
  ],
  'US-30': [
    [0,   41.550, -87.524],
    [30,  41.420, -87.000],
    [60,  41.282, -86.476],
    [90,  41.100, -85.900],
    [120, 41.100, -85.300],
  ],
  'US-40': [
    [0,   39.469, -87.531],
    [40,  39.600, -87.000],
    [80,  39.700, -86.500],
    [110, 39.771, -86.100],
    [140, 39.800, -85.600],
  ],
  'US-52': [
    [0,   39.771, -86.280],
    [30,  40.040, -86.848],
    [60,  40.420, -87.000],
    [90,  40.700, -87.150],
  ],
  'US-24': [
    [0,   41.100, -87.524],
    [40,  40.900, -86.900],
    [80,  40.800, -86.200],
    [120, 40.700, -85.500],
    [160, 40.700, -84.900],
  ],
  'US-6': [
    [0,   41.574, -87.524],
    [50,  41.524, -86.900],
    [100, 41.524, -86.200],
    [150, 41.524, -85.500],
  ],
  'US-20': [
    [0,   41.628, -87.524],
    [50,  41.628, -86.800],
    [100, 41.628, -86.100],
    [150, 41.628, -85.400],
  ],
};

// Cross-street / city name lookups for when no MM is found
const CITY_COORDS = {
  'gary':           {lat:41.576, lon:-87.310},
  'hammond':        {lat:41.574, lon:-87.500},
  'portage':        {lat:41.567, lon:-87.182},
  'valparaiso':     {lat:41.473, lon:-87.062},
  'merrillville':   {lat:41.473, lon:-87.332},
  'crown point':    {lat:41.417, lon:-87.367},
  'lowell':         {lat:41.294, lon:-87.432},
  'rensselaer':     {lat:40.936, lon:-87.152},
  'lafayette':      {lat:40.413, lon:-86.873},
  'west lafayette': {lat:40.413, lon:-86.908},
  'lebanon':        {lat:40.048, lon:-86.469},
  'carmel':         {lat:39.978, lon:-86.118},
  'indianapolis':   {lat:39.768, lon:-86.158},
  'indianapolis n': {lat:39.920, lon:-86.149},
  'indianapolis s': {lat:39.650, lon:-86.149},
  'indianapolis e': {lat:39.771, lon:-85.930},
  'indianapolis w': {lat:39.771, lon:-86.280},
  'greenwood':      {lat:39.614, lon:-86.107},
  'columbus':       {lat:39.201, lon:-85.921},
  'seymour':        {lat:38.959, lon:-85.893},
  'scottsburg':     {lat:38.686, lon:-85.778},
  'jeffersonville': {lat:38.334, lon:-85.734},
  'new albany':     {lat:38.286, lon:-85.824},
  'terre haute':    {lat:39.467, lon:-87.414},
  'brazil':         {lat:39.524, lon:-87.124},
  'plainfield':     {lat:39.703, lon:-86.399},
  'richmond':       {lat:39.828, lon:-84.900},
  'anderson':       {lat:40.105, lon:-85.680},
  'muncie':         {lat:40.193, lon:-85.386},
  'fort wayne':     {lat:41.130, lon:-85.134},
  'south bend':     {lat:41.683, lon:-86.250},
  'mishawaka':      {lat:41.662, lon:-86.158},
  'elkhart':        {lat:41.682, lon:-85.977},
  'goshen':         {lat:41.582, lon:-85.835},
  'warsaw':         {lat:41.238, lon:-85.851},
  'kokomo':         {lat:40.486, lon:-86.133},
  'logansport':     {lat:40.754, lon:-86.358},
  'michigan city':  {lat:41.710, lon:-86.895},
  'laporte':        {lat:41.609, lon:-86.722},
  'evansville':     {lat:37.971, lon:-87.571},
  'vincennes':      {lat:38.677, lon:-87.528},
  'bloomington':    {lat:39.165, lon:-86.526},
  'martinsville':   {lat:39.428, lon:-86.428},
  'crawfordsville': {lat:40.041, lon:-86.901},
  'covington':      {lat:40.141, lon:-87.393},
  'shelbyville':    {lat:39.524, lon:-85.774},
  'greensburg':     {lat:39.337, lon:-85.489},
  'connersville':   {lat:39.641, lon:-85.141},
};

// ── COORDINATE LOOKUP ─────────────────────────────────
function interpolate(anchors, mm) {
  if (mm <= anchors[0][0]) return {lat: anchors[0][1], lon: anchors[0][2]};
  if (mm >= anchors[anchors.length-1][0]) {
    const a = anchors[anchors.length-1];
    return {lat: a[1], lon: a[2]};
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    const [mm0, lat0, lon0] = anchors[i];
    const [mm1, lat1, lon1] = anchors[i+1];
    if (mm >= mm0 && mm <= mm1) {
      const t = (mm - mm0) / (mm1 - mm0);
      return {lat: lat0 + t*(lat1-lat0), lon: lon0 + t*(lon1-lon0)};
    }
  }
  return null;
}

function coordsFromTitle(title, route) {
  if (!title) return null;
  const t = title.toLowerCase();

  // Try to extract mile marker — "mm 158", "mile marker 158", "mp 158", "158.2"
  const mmMatch = t.match(/\b(?:mm|mp|mile\s*marker|mile\s*post)\s*(\d+\.?\d*)/i)
                || t.match(/\bat\s+(\d+\.?\d*)\s*(?:mm|mp|mile)/i)
                || t.match(/[\s@#](\d{1,3}\.?\d*)\s*(?:mm|mp)\b/i);

  const routeKey = route ? route.replace('/', '-') : '';
  const anchors = HIGHWAY_ANCHORS[route] || HIGHWAY_ANCHORS[routeKey];

  if (mmMatch && anchors) {
    const mm = parseFloat(mmMatch[1]);
    if (mm >= 0 && mm <= 500) {
      const coords = interpolate(anchors, mm);
      if (coords) return coords;
    }
  }

  // Try city/location name matching
  for (const [city, coords] of Object.entries(CITY_COORDS)) {
    if (t.includes(city)) return coords;
  }

  // Try cross-street route numbers like "at US-31" or "at SR-37"
  const crossMatch = t.match(/at\s+(us|sr|in|state road|state route|us route|highway)\s*-?\s*(\d+)/i);
  if (crossMatch && anchors) {
    // Use route midpoint
    const mid = anchors[Math.floor(anchors.length/2)];
    return {lat: mid[1], lon: mid[2]};
  }

  return null;
}

// ── GRAPHQL FETCH ─────────────────────────────────────
async function fetchCameraList() {
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
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── HANDLER ───────────────────────────────────────────
exports.handler = async function() {
  try {
    const result = await fetchCameraList();
    const views = result?.data?.listCameraViewsQuery?.cameraViews || [];

    let withCoords = 0;
    const cameras = views.map(cam => {
      const route = cam.parentCollection?.location?.routeDesignator || 'UNKNOWN';
      const coords = coordsFromTitle(cam.title, route);
      if (coords) withCoords++;

      return {
        id:        cam.uri,
        title:     cam.title,
        route,
        imageUrl:  cam.url,
        streamUrl: cam.sources?.find(s => s.type === 'application/x-mpegURL')?.src || null,
        lat:       coords?.lat || null,
        lon:       coords?.lon || null,
      };
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
      body: JSON.stringify({total: cameras.length, withCoords, cameras}),
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
      body: JSON.stringify({total: 0, cameras: [], error: e.message}),
    };
  }
};
