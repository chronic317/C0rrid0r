/* ============================================================================
 * C0RRID0R VEHICLE SIZER
 *
 * Classifies vehicles in scanner frames by relative pixel size and aspect
 * ratio. Used to filter the color analyzer: a "black sedan" alert should not
 * flag a semi just because the trailer is dark.
 *
 * Approach
 * --------
 * 1. Frame differencing: compare current frame to previous to isolate moving
 *    pixels. Empty highway → no motion regions → no false flags from low
 *    brightness at night.
 *
 * 2. Connected component (blob) extraction on the motion mask.
 *
 * 3. Per-camera self-calibration: maintain a rolling window of blob sizes in
 *    localStorage. The median represents "1 sedan" since sedans dominate US
 *    traffic (~60%). Larger blobs scale up from there.
 *
 * 4. Real-world dimensional anchors — when manufacturer dimensions match
 *    known classes, aspect ratio (length:height) is scale-invariant and lets
 *    us classify even before calibration converges.
 *
 * Vehicle reference (manufacturer specs, meters)
 *   COMPACT  Civic       4.55 × 1.80 × 1.41   L/H ≈ 3.23   L/W ≈ 2.53
 *   SEDAN    Camry       4.88 × 1.84 × 1.45   L/H ≈ 3.37   L/W ≈ 2.65
 *   SUV      CR-V        4.68 × 1.86 × 1.69   L/H ≈ 2.77   L/W ≈ 2.52
 *   FULLSUV  Tahoe       5.35 × 2.06 × 1.94   L/H ≈ 2.76   L/W ≈ 2.60
 *   PICKUP   F-150       5.89 × 2.03 × 1.96   L/H ≈ 3.00   L/W ≈ 2.90
 *   VAN      Odyssey     5.32 × 1.99 × 1.74   L/H ≈ 3.06   L/W ≈ 2.67
 *   SEMI     Day cab     ~21  × 2.59 × 4.0    L/H ≈ 5.25   L/W ≈ 8.10
 *
 * Exposed as window.VehicleSizer.
 * ========================================================================== */
(function (global) {
  'use strict';

  // ── REFERENCE PROFILES ───────────────────────────────────────────────────
  // Pre-computed aspect ratios. `relSize` is approximate area in "sedan units"
  // (a sedan = 1.0). Used to pick a class when calibration is converged.
  const PROFILES = {
    compact:  { aspectLH: 3.23, aspectLW: 2.53, relSize: 0.83 },
    sedan:    { aspectLH: 3.37, aspectLW: 2.65, relSize: 1.00 },
    suv:      { aspectLH: 2.77, aspectLW: 2.52, relSize: 0.97 },
    fullsuv:  { aspectLH: 2.76, aspectLW: 2.60, relSize: 1.23 },
    pickup:   { aspectLH: 3.00, aspectLW: 2.90, relSize: 1.31 },
    van:      { aspectLH: 3.06, aspectLW: 2.67, relSize: 1.04 },
    semi:     { aspectLH: 5.25, aspectLW: 8.10, relSize: 6.00 },
  };

  // Compatibility map — what class an alert vehicle could plausibly *appear*
  // as in a scanner frame. A "sedan" alert can also match "compact" (visual
  // confusion at distance) but should NOT match "pickup" or "semi".
  const ALERT_COMPATIBILITY = {
    compact:  ['compact', 'sedan'],
    sedan:    ['sedan', 'compact'],
    midsize:  ['sedan', 'suv'],
    suv:      ['suv', 'sedan', 'fullsuv'],
    fullsuv:  ['fullsuv', 'suv', 'pickup'],
    pickup:   ['pickup', 'fullsuv'],
    van:      ['van', 'suv', 'fullsuv'],
    semi:     ['semi'],
    unknown:  ['compact', 'sedan', 'suv', 'fullsuv', 'pickup', 'van', 'semi'],
  };

  // ── PARSE ALERT VEHICLE TEXT ─────────────────────────────────────────────
  // Maps free-form vehicle descriptions to a class. Returns 'unknown' when
  // nothing recognizable is present so the size filter becomes a no-op
  // rather than rejecting everything.
  function parseVehicleType(desc) {
    if (!desc) return 'unknown';
    const d = desc.toLowerCase();

    // Explicit unknown takes precedence over the generic "vehicle" fallthrough
    if (/\b(unknown|unspecified|not\s+(specified|reported|known))\b/.test(d)) return 'unknown';

    if (/\b(semi|tractor.?trailer|18.?wheeler|big.?rig|freightliner|peterbilt|kenworth)\b/.test(d)) return 'semi';
    if (/\b(pickup|f-?\d{2,3}|silverado|sierra|ram \d{3,4}|tacoma|tundra|colorado|ranger|ridgeline|frontier|maverick)\b/.test(d)) return 'pickup';
    if (/\b(minivan|caravan|odyssey|sienna|pacifica|town.?and.?country)\b/.test(d)) return 'van';
    if (/\b(tahoe|suburban|expedition|yukon|sequoia|navigator|escalade|armada|qx80)\b/.test(d)) return 'fullsuv';
    if (/\b(suv|crossover|cuv|cr-?v|rav-?4|equinox|rogue|escape|highlander|pilot|explorer|cherokee|forester|outback|santa.?fe|telluride|palisade|murano|edge|traverse|enclave|acadia)\b/.test(d)) return 'suv';
    if (/\b(van|cargo.?van|sprinter|transit)\b/.test(d)) return 'van';
    if (/\b(compact|civic|corolla|elantra|sentra|focus|cruze|fit|yaris|versa|spark|fiesta|rio|forte|mirage)\b/.test(d)) return 'compact';
    if (/\b(sedan|coupe|camry|accord|altima|sonata|fusion|impala|malibu|charger|challenger|mustang|3-?series|c-?class|maxima|legacy|6-?series)\b/.test(d)) return 'sedan';
    // Generic "car" without class hint — assume sedan-class.
    if (/\b(car|vehicle|auto)\b/.test(d)) return 'sedan';
    return 'unknown';
  }

  // ── PER-CAMERA CALIBRATION ───────────────────────────────────────────────
  // We don't know each camera's focal length / mount height. Instead we
  // track observed blob sizes and use the median as our "1 sedan" anchor.
  const CAL_KEY_PREFIX = 'corridor_cal_';
  const SAMPLE_LIMIT = 200;
  const MIN_SAMPLES_TO_CLASSIFY = 15;

  function loadCalibration(camId) {
    try {
      const raw = localStorage.getItem(CAL_KEY_PREFIX + camId);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { samples: [], median: null, p90: null };
  }

  function saveCalibration(camId, cal) {
    try {
      localStorage.setItem(CAL_KEY_PREFIX + camId, JSON.stringify(cal));
    } catch (e) {}
  }

  function recompute(cal) {
    if (cal.samples.length < 5) { cal.median = null; cal.p90 = null; return; }
    const areas = cal.samples.map(s => s.area).sort((a, b) => a - b);
    cal.median = areas[Math.floor(areas.length / 2)];
    cal.p90    = areas[Math.floor(areas.length * 0.9)];
  }

  function addCalibrationSample(camId, blob) {
    const cal = loadCalibration(camId);
    cal.samples.push({ w: blob.w, h: blob.h, area: blob.w * blob.h, t: Date.now() });
    if (cal.samples.length > SAMPLE_LIMIT) {
      cal.samples = cal.samples.slice(-SAMPLE_LIMIT);
    }
    recompute(cal);
    saveCalibration(camId, cal);
    return cal;
  }

  // ── FRAME DIFFERENCING ───────────────────────────────────────────────────
  // Returns a binary mask (Uint8Array, 1 = motion) of the same dimensions as
  // the inputs. Threshold tuned to ignore minor lighting flicker but catch
  // moving vehicles.
  function frameDiff(curData, prevData, threshold) {
    threshold = threshold || 28;
    const len = curData.length / 4 | 0;
    const mask = new Uint8Array(len);
    const c = curData, p = prevData;
    for (let i = 0, j = 0; i < c.length; i += 4, j++) {
      const dr = Math.abs(c[i]   - p[i]);
      const dg = Math.abs(c[i+1] - p[i+1]);
      const db = Math.abs(c[i+2] - p[i+2]);
      // Luminance-weighted diff
      if ((dr * 0.30 + dg * 0.59 + db * 0.11) > threshold) mask[j] = 1;
    }
    return mask;
  }

  // ── BLOB EXTRACTION ──────────────────────────────────────────────────────
  // Two-pass scanline connected components. Returns array of bboxes:
  //   { x, y, w, h, area }
  // Filtered by minArea so we don't keep noise blobs.
  function extractBlobs(mask, width, height, minArea) {
    minArea = minArea || 200;
    const labels = new Int32Array(mask.length);
    let nextLabel = 1;
    const eq = [0]; // union-find parent array

    function find(x) {
      while (eq[x] !== x) { eq[x] = eq[eq[x]]; x = eq[x]; }
      return x;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) eq[Math.max(ra, rb)] = Math.min(ra, rb);
    }

    // Pass 1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const left = x > 0 ? labels[i - 1] : 0;
        const up   = y > 0 ? labels[i - width] : 0;
        if (left && up) {
          labels[i] = Math.min(left, up);
          if (left !== up) union(left, up);
        } else if (left) labels[i] = left;
        else if (up)     labels[i] = up;
        else {
          labels[i] = nextLabel;
          eq[nextLabel] = nextLabel;
          nextLabel++;
        }
      }
    }

    // Pass 2 — flatten labels and accumulate bboxes
    const stats = new Map();
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (!labels[i]) continue;
        const root = find(labels[i]);
        let s = stats.get(root);
        if (!s) {
          s = { minX: x, minY: y, maxX: x, maxY: y, area: 0 };
          stats.set(root, s);
        }
        if (x < s.minX) s.minX = x;
        if (y < s.minY) s.minY = y;
        if (x > s.maxX) s.maxX = x;
        if (y > s.maxY) s.maxY = y;
        s.area++;
      }
    }

    const blobs = [];
    for (const s of stats.values()) {
      if (s.area < minArea) continue;
      blobs.push({
        x: s.minX, y: s.minY,
        w: s.maxX - s.minX + 1,
        h: s.maxY - s.minY + 1,
        area: s.area,
      });
    }
    return blobs;
  }

  // ── SCENE BRIGHTNESS ─────────────────────────────────────────────────────
  // Mean luminance over the frame. Used to detect night and gate scanning.
  function meanLuminance(imageData) {
    const d = imageData.data;
    let sum = 0, n = 0;
    // Sample every 4th pixel for speed
    for (let i = 0; i < d.length; i += 16) {
      sum += d[i] * 0.30 + d[i+1] * 0.59 + d[i+2] * 0.11;
      n++;
    }
    return sum / n;
  }

  // ── BLOB CLASSIFICATION ──────────────────────────────────────────────────
  // Two-stage: aspect ratio first (scale-invariant), then relative size.
  function classifyBlob(blob, calibration) {
    const lhRatio = blob.w / blob.h; // assuming road runs roughly horizontal in frame
    // Long, low blobs = semis
    if (lhRatio > 4.5) return { class: 'semi', confidence: 0.85, by: 'aspect' };

    // If we have calibration, use relative size
    if (calibration && calibration.median && calibration.samples.length >= MIN_SAMPLES_TO_CLASSIFY) {
      const ratio = blob.area / calibration.median;
      if (ratio < 0.55) return { class: 'compact',  confidence: 0.6, by: 'size' };
      if (ratio < 1.25) return { class: 'sedan',    confidence: 0.7, by: 'size' };
      if (ratio < 1.55) return { class: 'suv',      confidence: 0.65, by: 'size' };
      if (ratio < 2.20) {
        // Aspect ratio breaks the tie between fullsuv and pickup
        return { class: lhRatio > 2.95 ? 'pickup' : 'fullsuv', confidence: 0.6, by: 'size+aspect' };
      }
      if (ratio < 4.00) return { class: 'pickup',   confidence: 0.55, by: 'size' };
      return { class: 'semi', confidence: 0.7, by: 'size' };
    }

    // No calibration yet — best-guess from aspect ratio alone
    if (lhRatio < 2.0) return { class: 'sedan', confidence: 0.3, by: 'aspect-uncalibrated' };
    if (lhRatio < 2.6) return { class: 'sedan', confidence: 0.35, by: 'aspect-uncalibrated' };
    if (lhRatio < 3.5) return { class: 'pickup', confidence: 0.3, by: 'aspect-uncalibrated' };
    return { class: 'semi', confidence: 0.5, by: 'aspect-uncalibrated' };
  }

  function classMatchesAlert(observedClass, alertClass) {
    if (!observedClass) return null;        // can't decide
    if (alertClass === 'unknown') return true; // no filter
    const allowed = ALERT_COMPATIBILITY[alertClass] || ALERT_COMPATIBILITY.unknown;
    return allowed.includes(observedClass);
  }

  // ── COLOR CHECK INSIDE A BLOB ────────────────────────────────────────────
  // Sample the blob bounding box only (not the whole frame) so a dark sky
  // doesn't trigger "dark vehicle" matches.
  function blobMatchesColor(imageData, blob, vehicleDesc) {
    const desc = (vehicleDesc || '').toLowerCase();
    if (!desc) return { match: false };

    const w = imageData.width;
    const data = imageData.data;
    let dark = 0, light = 0, red = 0, blue = 0, silver = 0, total = 0;

    // Sample every 4th pixel inside the bbox
    for (let y = blob.y; y < blob.y + blob.h; y += 2) {
      for (let x = blob.x; x < blob.x + blob.w; x += 2) {
        const i = (y * w + x) * 4;
        const r = data[i], g = data[i+1], b = data[i+2];
        const br = (r + g + b) / 3;
        total++;
        if (br < 60)  dark++;
        if (br > 180) light++;
        if (r > 130 && g < 90  && b < 90)  red++;
        if (b > 130 && r < 90  && g < 110) blue++;
        if (br > 130 && br < 200 && Math.abs(r - g) < 20 && Math.abs(g - b) < 20) silver++;
      }
    }
    if (!total) return { match: false };

    const wantsDark   = /\b(black|dark|charcoal)\b/.test(desc);
    const wantsLight  = /\b(white|light|cream|beige|tan)\b/.test(desc);
    const wantsRed    = /\b(red|maroon|burgundy|crimson)\b/.test(desc);
    const wantsBlue   = /\b(blue|navy|teal)\b/.test(desc);
    const wantsSilver = /\b(silver|gray|grey|gunmetal)\b/.test(desc);

    // Inside a blob the relevant pixels should be a *plurality*, not a tiny %.
    if (wantsDark   && dark   / total > 0.40) return { match: true,  color: 'dark',   pct: dark/total };
    if (wantsLight  && light  / total > 0.40) return { match: true,  color: 'light',  pct: light/total };
    if (wantsRed    && red    / total > 0.20) return { match: true,  color: 'red',    pct: red/total };
    if (wantsBlue   && blue   / total > 0.20) return { match: true,  color: 'blue',   pct: blue/total };
    if (wantsSilver && silver / total > 0.30) return { match: true,  color: 'silver', pct: silver/total };

    // No color was specified in the alert — don't gate on color
    if (!wantsDark && !wantsLight && !wantsRed && !wantsBlue && !wantsSilver) {
      return { match: true, color: null, pct: 0, note: 'no color in alert' };
    }
    return { match: false };
  }

  // ── PUBLIC API ───────────────────────────────────────────────────────────
  // analyzeFrame() is the main entrypoint. Caller provides current and
  // (optional) previous ImageData plus alert info. Returns flag decision.
  function analyzeFrame(opts) {
    const { camId, current, previous, alert } = opts;
    const out = {
      flagged: false,
      reason:  '',
      detail:  null,
      blobs:   [],
      sceneNight: false,
      noPrev: false,
      camId,
    };

    const luminance = meanLuminance(current);
    out.sceneNight = luminance < 55;

    // No previous frame → can't do motion. Fall back to old "any dark pixels"
    // mode but only outside of night, and only when alert color is specified.
    if (!previous) {
      out.noPrev = true;
      if (out.sceneNight) {
        out.reason = 'first frame at night, skipping';
        return out;
      }
      // Treat the whole frame as one "blob" so color check still runs
      const fakeBlob = { x: 0, y: Math.floor(current.height * 0.3),
                         w: current.width, h: Math.floor(current.height * 0.4),
                         area: current.width * Math.floor(current.height * 0.4) };
      const colorResult = blobMatchesColor(current, fakeBlob, alert.vehicle);
      if (colorResult.match && colorResult.color) {
        out.flagged = true;
        out.reason  = `Color-only match: ${colorResult.color} (no motion baseline yet)`;
        out.detail  = { color: colorResult, blob: fakeBlob, classification: null };
      }
      return out;
    }

    // Motion-based pipeline
    const mask = frameDiff(current.data, previous.data, out.sceneNight ? 50 : 28);
    const minArea = Math.max(200, (current.width * current.height) * 0.005);
    const blobs = extractBlobs(mask, current.width, current.height, minArea);
    out.blobs = blobs;

    if (!blobs.length) {
      out.reason = 'no motion';
      return out;
    }

    const calibration = loadCalibration(camId);
    const alertClass  = parseVehicleType(alert.vehicle);

    // Update calibration with each detected blob
    for (const blob of blobs) addCalibrationSample(camId, blob);

    // Test each blob; flag on first match
    for (const blob of blobs) {
      const cls = classifyBlob(blob, calibration);
      const sizeOk = classMatchesAlert(cls.class, alertClass);
      const color  = blobMatchesColor(current, blob, alert.vehicle);

      if (sizeOk && color.match) {
        out.flagged = true;
        out.detail  = { blob, classification: cls, color, alertClass };
        const sizeStr  = `${cls.class}${cls.confidence >= 0.5 ? '' : '?'}`;
        const colorStr = color.color ? `${color.color} ${(color.pct*100).toFixed(0)}%` : 'no color filter';
        out.reason = `${sizeStr} + ${colorStr} (alert: ${alertClass})`;
        return out;
      }
    }

    out.reason = `${blobs.length} blob(s) — none matched ${alertClass}/${alert.vehicle}`;
    return out;
  }

  // Diagnostic — useful for the UI to show calibration state per camera
  function getCalibrationStatus(camId) {
    const cal = loadCalibration(camId);
    return {
      samples:  cal.samples.length,
      ready:    cal.samples.length >= MIN_SAMPLES_TO_CLASSIFY,
      medianArea: cal.median,
    };
  }

  global.VehicleSizer = {
    PROFILES,
    parseVehicleType,
    analyzeFrame,
    getCalibrationStatus,
    // Exposed for testing
    _frameDiff: frameDiff,
    _extractBlobs: extractBlobs,
    _classifyBlob: classifyBlob,
    _meanLuminance: meanLuminance,
  };
})(window);
