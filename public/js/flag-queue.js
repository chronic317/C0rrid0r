/* ============================================================================
 * C0RRID0R FLAG QUEUE
 *
 * Replaces the auto-download behavior. Flagged frames are kept in memory in
 * a review queue with thumbnail + metadata. Reviewer can:
 *   - View queue as a grid
 *   - Inspect any flag at full size
 *   - Download single flag or "download all"
 *   - Dismiss false positives
 *   - Clear the queue
 *
 * De-duplication: per-camera cooldown (5 min default) and frame-hash check
 * prevent the same vehicle being flagged twice from sequential frames.
 *
 * Exposed as window.FlagQueue.
 * ========================================================================== */
(function (global) {
  'use strict';

  const queue = [];                 // Active flags
  const lastFlagPerCam = new Map(); // camId -> timestamp
  const recentHashes = new Map();   // camId -> [{hash, t}]
  const COOLDOWN_MS = 5 * 60 * 1000;   // 5 min between flags from same camera
  const HASH_WINDOW_MS = 15 * 60 * 1000;
  const QUEUE_MAX = 500;

  let onChange = null; // callback fired after queue changes

  function setOnChange(fn) { onChange = fn; }

  // Fast perceptual-ish hash: average brightness of an 8×8 grid, returned as
  // a 64-bit fingerprint. Two frames with the same hash are visually similar
  // enough that we should treat them as the same flag event.
  function quickHash(canvas) {
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const ctx = c.getContext('2d');
    ctx.drawImage(canvas, 0, 0, 8, 8);
    const d = ctx.getImageData(0, 0, 8, 8).data;
    let sum = 0, vals = [];
    for (let i = 0; i < d.length; i += 4) {
      const v = (d[i] + d[i+1] + d[i+2]) / 3;
      vals.push(v); sum += v;
    }
    const mean = sum / vals.length;
    let bits = '';
    for (const v of vals) bits += v > mean ? '1' : '0';
    return bits;
  }

  function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length) return Infinity;
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
    return d;
  }

  function isDuplicate(camId, hash) {
    const list = recentHashes.get(camId) || [];
    const cutoff = Date.now() - HASH_WINDOW_MS;
    const fresh = list.filter(h => h.t > cutoff);
    recentHashes.set(camId, fresh);
    for (const h of fresh) {
      if (hammingDistance(h.hash, hash) <= 8) return true;  // ≤8 of 64 bits diff
    }
    return false;
  }

  function recordHash(camId, hash) {
    const list = recentHashes.get(camId) || [];
    list.push({ hash, t: Date.now() });
    recentHashes.set(camId, list);
  }

  // canvas: HTMLCanvasElement of the captured frame
  // meta: { alert, cam, ts, reason, detail }
  // Returns true if added, false if skipped (cooldown / duplicate)
  function offer(canvas, meta) {
    const camId = meta.cam.id || meta.cam.label || 'unknown';
    const lastT = lastFlagPerCam.get(camId);
    if (lastT && Date.now() - lastT < COOLDOWN_MS) return { added: false, reason: 'cooldown' };

    const hash = quickHash(canvas);
    if (isDuplicate(camId, hash)) return { added: false, reason: 'duplicate frame' };

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    const item = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      ts: meta.ts || new Date().toISOString(),
      alert: {
        type:    meta.alert.type,
        subject: meta.alert.subject,
        vehicle: meta.alert.vehicle,
        plate:   meta.alert.plate,
        corridor: meta.alert.corridor,
      },
      cam: {
        id:    meta.cam.id,
        title: meta.cam.title || meta.cam.label || meta.cam.id,
        route: meta.cam.route,
      },
      reason: meta.reason || '',
      detail: meta.detail || null,
      dataUrl,
      hash,
      reviewed: false,
    };
    queue.push(item);
    lastFlagPerCam.set(camId, Date.now());
    recordHash(camId, hash);
    while (queue.length > QUEUE_MAX) queue.shift();
    if (onChange) onChange(snapshot());
    return { added: true, item };
  }

  function snapshot() {
    return {
      total:    queue.length,
      pending:  queue.filter(f => !f.reviewed).length,
      reviewed: queue.filter(f => f.reviewed).length,
    };
  }

  function getAll()        { return queue.slice(); }
  function getPending()    { return queue.filter(f => !f.reviewed); }
  function get(id)         { return queue.find(f => f.id === id); }
  function dismiss(id)     {
    const idx = queue.findIndex(f => f.id === id);
    if (idx >= 0) {
      queue.splice(idx, 1);
      if (onChange) onChange(snapshot());
    }
  }
  function markReviewed(id) {
    const f = get(id);
    if (f) {
      f.reviewed = true;
      if (onChange) onChange(snapshot());
    }
  }
  function clear() {
    queue.length = 0;
    if (onChange) onChange(snapshot());
  }

  // Trigger a download for a single flag
  function download(id) {
    const f = get(id);
    if (!f) return;
    const filename = `CORRIDOR_FLAG_${f.alert.type.toUpperCase()}_${(f.alert.plate || 'NOPLATE').replace(/[^\w]/g, '')}_${f.ts.replace(/[:.]/g,'-')}.jpg`;
    const link = document.createElement('a');
    link.href = f.dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Download all pending flags as separate files (browser may pause after a
  // few — that's a browser policy thing; we space them out)
  async function downloadAll() {
    const pending = getPending();
    for (let i = 0; i < pending.length; i++) {
      download(pending[i].id);
      await new Promise(r => setTimeout(r, 300));
    }
  }

  global.FlagQueue = {
    setOnChange,
    offer,
    snapshot,
    getAll,
    getPending,
    get,
    dismiss,
    markReviewed,
    clear,
    download,
    downloadAll,
    // tunables
    setCooldown: ms => { /* allow runtime override */ Object.defineProperty(global.FlagQueue, '_cooldown', { value: ms }); },
  };
})(window);
