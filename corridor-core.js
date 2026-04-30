/* ============================================================================
 * C0RRID0R CORE — shared client logic
 * Extracted from index.html / mobile.html so fixes happen in one place.
 * Exposed as window.Corridor.
 * ========================================================================== */
(function (global) {
  'use strict';

  // ── HTML ESCAPING ────────────────────────────────────────────────────────
  // Anything that comes from parsed ISP HTML, camera titles, alert fields, or
  // any other untrusted source must be escaped before insertion via innerHTML.
  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── ALERT PARSER ─────────────────────────────────────────────────────────
  // Pulls structured rows out of the in.gov alert pages. Tightened so
  // `isReal` only fires when we've identified at least one strong field
  // (subject + something else), so a partial parse can't cosplay as official.
  function parseAlerts(html, type, startId) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const headers = [...doc.querySelectorAll('h2,h3,h4')];
    const alertHeader = headers.find(h => h.textContent.toLowerCase().includes('active alert'));
    if (!alertHeader) return [];
    const next = alertHeader.nextElementSibling;
    if (!next) return [];
    const txt = next.textContent.toLowerCase();
    if (txt.includes('no active') || txt.includes('currently no')) return [];

    const blocks = [];
    let curr = alertHeader.nextElementSibling;
    while (curr) {
      if (['H2', 'H3'].includes(curr.tagName)) break;
      if (curr.textContent.trim()) blocks.push(curr);
      curr = curr.nextElementSibling;
    }

    const alerts = [];
    let id = startId;
    for (const block of blocks) {
      const text = block.textContent.trim();
      if (!text || text.toLowerCase().includes('no active')) continue;

      const nameMatch     = text.match(/Name[:\s]+([A-Z][a-zA-Z\s,]+?)(?:\n|,|\s{2}|Age|DOB)/i);
      const ageMatch      = text.match(/Age[:\s]+(\d+)/i);
      const vehicleMatch  = text.match(/Vehicle[:\s]+([^\n]+?)(?:\n|License|Plate|$)/i);
      const plateMatch    = text.match(/(?:License|Plate|Tag)[:\s#]+([A-Z0-9\s\-]+?)(?:\n|\s{2}|$)/i);
      const locationMatch = text.match(/(?:Last\s*(?:Seen|Known)|Location)[:\s]+([^\n]+?)(?:\n|$)/i);
      const dirMatch      = text.match(/(?:Direction|Traveling|Headed)[:\s]+([^\n]+?)(?:\n|$)/i);

      if (!nameMatch && !vehicleMatch) continue;

      const name = nameMatch ? nameMatch[1].trim() : 'Unknown';
      const age  = ageMatch  ? ', ' + ageMatch[1] : '';
      const loc  = locationMatch ? locationMatch[1].trim() : 'Location unknown';
      const corridor = inferCorridor(loc);

      // Only call it real if we got a name AND (vehicle OR plate OR location)
      const strong = !!nameMatch && (!!vehicleMatch || !!plateMatch || !!locationMatch);

      alerts.push({
        id: id++,
        type, state: 'IN',
        subject: name + age,
        vehicle: vehicleMatch ? vehicleMatch[1].trim() : 'Vehicle unknown',
        plate:   plateMatch   ? plateMatch[1].trim().toUpperCase() : '—',
        ps: 'IN',
        lastSeen: loc,
        dir: dirMatch ? dirMatch[1].trim() : 'Unknown',
        corridor,
        // lat/lon get filled in by geocodeAlerts(); fall back to state center
        lat: 39.78, lon: -86.15,
        geocoded: false,
        elapsed: '—', issued: '—', suspect: null,
        cams: [],
        isReal: strong,
      });
    }
    return alerts;
  }

  function inferCorridor(loc) {
    if (!loc) return 'UNKNOWN';
    const l = loc.toUpperCase();
    if (l.includes('I-65')  || l.includes('I65'))  return 'I-65';
    if (l.includes('I-70')  || l.includes('I70'))  return 'I-70';
    if (l.includes('I-69')  || l.includes('I69'))  return 'I-69';
    if (l.includes('I-74')  || l.includes('I74'))  return 'I-74';
    if (l.includes('I-465'))                        return 'I-465';
    if (l.includes('I-80')  || l.includes('I-90')) return 'I-80/90';
    if (l.includes('I-94')  || l.includes('I94'))  return 'I-94';
    if (l.includes('I-64')  || l.includes('I64'))  return 'I-64';
    if (l.includes('US-31') || l.includes('US31')) return 'US-31';
    if (l.includes('US-30') || l.includes('US30')) return 'US-30';
    return 'UNKNOWN';
  }

  // Build camera list for an alert. Returns [] when corridor is UNKNOWN —
  // never seed scans against an arbitrary Indianapolis camera.
  function inferCameras(corridor, liveCameras, fallbackCameras) {
    if (!corridor || corridor === 'UNKNOWN') return [];
    const live = (liveCameras || []).filter(c => c.route === corridor).map(c => c.id);
    if (live.length) return live.slice(0, 3);
    const fb = (fallbackCameras || []).filter(c => c.route === corridor).map(c => c.id);
    return fb.slice(0, 3);
  }

  // ── GEOCODING ────────────────────────────────────────────────────────────
  // Adds lat/lon to alerts from the ISP "last known location" string.
  // Cached to localStorage so repeated alerts don't re-hit Nominatim.
  const GEO_CACHE_KEY = 'corridor_geocache_v1';
  function geoCacheGet(q) {
    try {
      const all = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}');
      const hit = all[q.toLowerCase()];
      if (!hit) return null;
      // Expire after 30 days
      if (Date.now() - hit.t > 30 * 24 * 3600 * 1000) return null;
      return hit;
    } catch (e) { return null; }
  }
  function geoCacheSet(q, lat, lon) {
    try {
      const all = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}');
      all[q.toLowerCase()] = { lat, lon, t: Date.now() };
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* quota / disabled — silently ignore */ }
  }

  async function geocodeOne(q) {
    if (!q || q === 'Location unknown') return null;
    const cached = geoCacheGet(q);
    if (cached) return cached;
    try {
      // Add ", Indiana" hint when not already present to bias results
      const hint = /\b(IN|Indiana)\b/i.test(q) ? q : (q + ', Indiana');
      const res = await fetch('/api/geocode?q=' + encodeURIComponent(hint));
      const json = await res.json();
      if (!json || !json.lat || !json.lon) return null;
      const out = { lat: parseFloat(json.lat), lon: parseFloat(json.lon) };
      geoCacheSet(q, out.lat, out.lon);
      return out;
    } catch (e) { return null; }
  }

  async function geocodeAlerts(alerts, onProgress) {
    let i = 0;
    for (const a of alerts) {
      if (a.geocoded) { i++; continue; }
      const r = await geocodeOne(a.lastSeen);
      if (r) { a.lat = r.lat; a.lon = r.lon; a.geocoded = true; }
      i++;
      if (onProgress) onProgress(i, alerts.length);
      // Nominatim asks for max 1 req/sec — be polite
      await new Promise(r => setTimeout(r, 1100));
    }
    return alerts;
  }

  // ── SCAN LOG ─────────────────────────────────────────────────────────────
  function logScan(msg, type) {
    const log = document.getElementById('scan-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'scan-entry' + (type === 'flagged' ? ' flagged'
                                    : type === 'sent'    ? ' sent' : '');
    entry.textContent = msg;
    log.appendChild(entry);
    // Keep log from growing forever
    while (log.childElementCount > 500) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }

  // ── IMAGE FETCH FOR SCANNER ─────────────────────────────────────────────
  // Always route through /api/camproxy so the canvas is not tainted by CORS.
  // CARS-direct image URLs don't send Access-Control-Allow-Origin, which
  // would silently break getImageData() with SecurityError.
  function scannerImageUrl(cam) {
    // Live CARS cameras: use their device-id through our proxy
    if (cam.id && cam.id.includes('-')) {
      return '/api/camproxy?id=' + encodeURIComponent(cam.id) + '&t=' + Date.now();
    }
    // Fallback static cameras have a `.img` field
    if (cam.img) {
      return '/api/camproxy?id=' + encodeURIComponent(cam.img) + '&t=' + Date.now();
    }
    return null;
  }

  function loadFrameAsImageData(cam) {
    return new Promise((resolve, reject) => {
      const url = scannerImageUrl(cam);
      if (!url) { reject(new Error('no image url')); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width  = img.width  || 640;
          canvas.height = img.height || 360;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);
          // This throws SecurityError on tainted canvas — caught by reject
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
          resolve({ imageData: data, canvas, ctx, width: canvas.width, height: canvas.height });
        } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('image load failed'));
      img.src = url;
    });
  }

  // ── EXPORT ───────────────────────────────────────────────────────────────
  global.Corridor = {
    escapeHtml,
    parseAlerts,
    inferCorridor,
    inferCameras,
    geocodeOne,
    geocodeAlerts,
    logScan,
    loadFrameAsImageData,
    scannerImageUrl,
  };
})(window);
