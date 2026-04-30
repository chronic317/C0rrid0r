/* ============================================================================
 * C0RRID0R DESKTOP APP
 * Orchestrates UI for index.html using shared modules.
 * ========================================================================== */
(function () {
  'use strict';
  const esc = window.Corridor.escapeHtml;
  const { parseAlerts, inferCameras, geocodeAlerts, logScan, loadFrameAsImageData } = window.Corridor;

  // ── CONSTANTS ────────────────────────────────────────
  const CAM    = id => '/api/camproxy?id=' + encodeURIComponent(id) + '&t=' + Date.now();
  const PROXY  = '/api/alertproxy?type=';

  const ISP_SOURCES = ['amber', 'silver', 'green', 'blue'];

  const FALLBACK_CAMERAS = [
    {id:'cam-i65-gary', img:'01-032-005-cam1', label:'I-65 — Gary',           route:'I-65',    lat:41.52, lon:-87.31},
    {id:'cam-i65-laf',  img:'01-032-008-cam1', label:'I-65 — Lafayette',      route:'I-65',    lat:40.41, lon:-86.87},
    {id:'cam-i65-indn', img:'01-032-017-cam1', label:'I-65 — Indianapolis N', route:'I-65',    lat:39.92, lon:-86.12},
    {id:'cam-i65-col',  img:'01-032-038-cam1', label:'I-65 — Columbus',       route:'I-65',    lat:39.18, lon:-85.90},
    {id:'cam-i65-jeff', img:'01-006-003-cam1', label:'I-65 — Jeffersonville', route:'I-65',    lat:38.34, lon:-85.73},
    {id:'cam-i70-th',   img:'01-032-041-cam1', label:'I-70 — Terre Haute',    route:'I-70',    lat:39.47, lon:-87.38},
    {id:'cam-i70-inw',  img:'01-032-049-cam1', label:'I-70 — Indianapolis W', route:'I-70',    lat:39.77, lon:-86.28},
    {id:'cam-i70-ine',  img:'01-002-073-cam1', label:'I-70 — Indianapolis E', route:'I-70',    lat:39.77, lon:-85.93},
    {id:'cam-i70-rich', img:'01-002-164-cam1', label:'I-70 — Richmond',       route:'I-70',    lat:39.83, lon:-84.89},
    {id:'cam-i69-mun',  img:'01-002-186-cam1', label:'I-69 — Muncie',         route:'I-69',    lat:40.19, lon:-85.39},
    {id:'cam-i69-fw',   img:'01-006-011-cam1', label:'I-69 — Fort Wayne',     route:'I-69',    lat:41.08, lon:-85.13},
    {id:'cam-i74-craw', img:'01-011-007-cam1', label:'I-74 — Crawfordsville', route:'I-74',    lat:40.04, lon:-86.85},
    {id:'cam-i74-shel', img:'01-032-017-cam1', label:'I-74 — Shelbyville',    route:'I-74',    lat:39.52, lon:-85.74},
    {id:'cam-i90-sb',   img:'01-032-038-cam1', label:'I-80/90 — South Bend',  route:'I-80/90', lat:41.68, lon:-86.24},
    {id:'cam-i90-elk',  img:'01-032-049-cam1', label:'I-80/90 — Elkhart',     route:'I-80/90', lat:41.68, lon:-85.96},
    {id:'cam-i465-sw',  img:'01-002-073-cam1', label:'I-465 — SW',            route:'I-465',   lat:39.70, lon:-86.24},
    {id:'cam-i465-ne',  img:'01-002-164-cam1', label:'I-465 — NE',            route:'I-465',   lat:39.90, lon:-86.02},
    {id:'cam-us31',     img:'01-032-008-cam1', label:'US-31 — Indy N',        route:'US-31',   lat:40.03, lon:-86.02},
    {id:'cam-i94-ham',  img:'01-032-005-cam1', label:'I-94 — Hammond',        route:'I-94',    lat:41.57, lon:-87.50},
    {id:'cam-i64-ev',   img:'01-006-003-cam1', label:'I-64 — Evansville',     route:'I-64',    lat:37.97, lon:-87.57},
  ];

  const ROUTE_CENTERS = {
    'I-65':  [{lat:41.52,lon:-87.31},{lat:40.41,lon:-86.87},{lat:39.92,lon:-86.12},{lat:39.18,lon:-85.90},{lat:38.34,lon:-85.73}],
    'I-70':  [{lat:39.47,lon:-87.38},{lat:39.77,lon:-86.28},{lat:39.77,lon:-85.93},{lat:39.83,lon:-84.89}],
    'I-69':  [{lat:40.19,lon:-85.39},{lat:41.08,lon:-85.13}],
    'I-74':  [{lat:40.04,lon:-86.85},{lat:39.52,lon:-85.74}],
    'I-465': [{lat:39.70,lon:-86.24},{lat:39.90,lon:-86.02}],
    'I-80/90': [{lat:41.68,lon:-86.24},{lat:41.68,lon:-85.96}],
    'I-94':  [{lat:41.57,lon:-87.50}],
    'I-64':  [{lat:37.97,lon:-87.57}],
    'US-31': [{lat:40.03,lon:-86.02}],
  };

  const COLOR = {amber:'#f5a623', silver:'#a8b4c0', green:'#2dcc70', blue:'#4a9eff'};

  // ── STATE ────────────────────────────────────────────
  let ALERTS = [];
  let LIVE_CAMERAS = [];
  let selAlert = null, selCam = null, curFilter = 'all';
  let map, camMarkers = {}, alertMarkers = {}, routeIndexes = {};
  let hlsInstance = null;
  let scanIntervals = {}, flagCount = 0;
  // Per-camera previous frame for motion detection
  let prevFrames = new Map();  // camId -> ImageData

  // ── INIT ────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    initClock();
    initMap();
    bindButtons();
    bindFilters();
    bindReviewQueue();
    fetchAllAlerts();
    loadLiveCameras();
    setInterval(fetchAllAlerts, 3 * 60 * 1000);
    setInterval(loadLiveCameras, 30 * 60 * 1000);
  });

  function bindButtons() {
    document.getElementById('btn-refresh').onclick = refreshCam;
    document.getElementById('btn-open').onclick    = openFeed;
    document.getElementById('btn-test-scan').onclick = runTestScan;
    document.getElementById('btn-intro-dismiss').onclick = dismissIntro;
    document.getElementById('queue-pill').onclick = openReviewQueue;

    if (sessionStorage.getItem('corridor_intro_seen')) {
      const o = document.getElementById('intro-overlay');
      if (o) o.style.display = 'none';
    }
  }

  function dismissIntro() {
    const overlay = document.getElementById('intro-overlay');
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity .3s ease';
    setTimeout(() => overlay.style.display = 'none', 300);
    sessionStorage.setItem('corridor_intro_seen', '1');
  }

  function bindFilters() {
    document.querySelectorAll('.ftab').forEach(t => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.ftab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
        curFilter = t.dataset.f;
        renderAlerts();
      });
    });
  }

  // ── REVIEW QUEUE WIRING ─────────────────────────────
  function bindReviewQueue() {
    window.FlagQueue.setOnChange(updateQueuePill);
    document.getElementById('btn-close-review').onclick    = () => document.getElementById('review-overlay').classList.remove('on');
    document.getElementById('btn-clear-queue').onclick     = () => { window.FlagQueue.clear(); renderReviewGrid(); };
    document.getElementById('btn-download-all').onclick    = () => window.FlagQueue.downloadAll();
    document.getElementById('review-overlay').addEventListener('click', e => {
      if (e.target.id === 'review-overlay') document.getElementById('review-overlay').classList.remove('on');
    });
    updateQueuePill(window.FlagQueue.snapshot());
  }

  function updateQueuePill(snap) {
    const pill = document.getElementById('queue-pill');
    pill.textContent = snap.pending + ' PENDING';
    pill.classList.toggle('zero', snap.pending === 0);
    if (document.getElementById('review-overlay').classList.contains('on')) renderReviewGrid();
  }

  function openReviewQueue() {
    renderReviewGrid();
    document.getElementById('review-overlay').classList.add('on');
  }

  function renderReviewGrid() {
    const all = window.FlagQueue.getAll();
    document.getElementById('review-count').textContent = all.length;
    const grid = document.getElementById('review-grid');
    if (!all.length) {
      grid.innerHTML = '<div class="review-empty">No flagged frames yet.<br>Flags appear here when scanner detects vehicles matching active alerts.</div>';
      return;
    }
    grid.innerHTML = all.map(f => `
      <div class="review-card${f.reviewed ? ' reviewed' : ''}" data-id="${esc(f.id)}">
        <div class="thumb-img" data-action="view"><img src="${f.dataUrl}" alt=""></div>
        <div class="info">
          <strong>${esc(f.alert.type.toUpperCase())} — ${esc(f.alert.subject)}</strong><br>
          ${esc(f.cam.title)}<br>
          ${esc(new Date(f.ts).toLocaleString('en-US', {timeZone: 'America/Indiana/Indianapolis'}))}<br>
          <span style="color:var(--red)">${esc(f.reason)}</span>
        </div>
        <div class="actions">
          <button class="btn" data-action="download">↓ SAVE</button>
          <button class="btn" data-action="reviewed">✓ MARK</button>
          <button class="btn" data-action="dismiss">✕ DISMISS</button>
        </div>
      </div>
    `).join('');
    grid.onclick = e => {
      const card = e.target.closest('.review-card');
      if (!card) return;
      const id = card.dataset.id;
      const action = e.target.dataset.action;
      if (action === 'view')     window.open(window.FlagQueue.get(id).dataUrl, '_blank');
      if (action === 'download') window.FlagQueue.download(id);
      if (action === 'reviewed') window.FlagQueue.markReviewed(id);
      if (action === 'dismiss')  window.FlagQueue.dismiss(id);
    };
  }

  // ── CLOCK ───────────────────────────────────────────
  function initClock() {
    function tick() {
      const t = new Date().toLocaleTimeString('en-US', {hour12:false, timeZone:'America/Indiana/Indianapolis'});
      document.getElementById('clock').textContent = t + ' ET';
      document.getElementById('last-sync').textContent = t.slice(0, 5);
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── MAP ─────────────────────────────────────────────
  function initMap() {
    map = L.map('map', {center:[39.9,-86.1], zoom:7, zoomControl:false, attributionControl:false});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      crossOrigin: true,
    }).addTo(map);
    L.control.attribution({prefix: false}).addTo(map);
    L.control.zoom({position:'bottomright'}).addTo(map);
    // Register zoom listener ONCE — was leaking on every loadLiveCameras call
    map.on('zoomend', updateCamDotVisibility);
    plotFallbackCameras();
  }

  function plotFallbackCameras() {
    FALLBACK_CAMERAS.forEach(cam => {
      const el = document.createElement('div');
      el.className = 'cam-dot';
      const mk = L.marker([cam.lat, cam.lon], {
        icon: L.divIcon({className:'', html:el, iconSize:[8,8], iconAnchor:[4,4]})
      }).addTo(map);
      mk.on('click', () => pickCamera(cam));
      camMarkers[cam.id] = {mk, el, data:cam};
    });
  }

  // ── LIVE CAMERAS ────────────────────────────────────
  function getNextRouteCoord(route) {
    const coords = ROUTE_CENTERS[route];
    if (!coords) return {lat: 39.9 + (Math.random()-0.5)*2, lon: -86.1 + (Math.random()-0.5)*2};
    if (!routeIndexes[route]) routeIndexes[route] = 0;
    const c = coords[routeIndexes[route] % coords.length];
    routeIndexes[route]++;
    return {lat: c.lat + (Math.random()-0.5)*0.08, lon: c.lon + (Math.random()-0.5)*0.08};
  }

  function addCameraMarker(cam, coords) {
    const el = document.createElement('div');
    el.className = 'cam-dot';
    const mk = L.marker([coords.lat, coords.lon], {
      icon: L.divIcon({className:'', html:el, iconSize:[8,8], iconAnchor:[4,4]})
    }).addTo(map);
    mk.bindTooltip(cam.title, {permanent:false, direction:'top'});
    mk.on('click', () => pickLiveCamera(cam));
    camMarkers[cam.id] = {mk, el, data:cam};
  }

  async function loadLiveCameras() {
    try {
      const res = await fetch('/api/cameralocations');
      const json = await res.json();
      if (!json.cameras || !json.cameras.length) return;
      LIVE_CAMERAS = json.cameras;

      // Clear old markers
      Object.values(camMarkers).forEach(({mk}) => map.removeLayer(mk));
      camMarkers = {};
      routeIndexes = {};

      let placed = 0;
      LIVE_CAMERAS.forEach(cam => {
        const coords = (cam.lat && cam.lon)
          ? {lat: cam.lat, lon: cam.lon}
          : getNextRouteCoord(cam.route);
        if (cam.lat && cam.lon) placed++;
        addCameraMarker(cam, coords);
      });

      updateCamDotVisibility();
      document.getElementById('feed-status').textContent =
        'LIVE — ' + json.total + ' CAMS — ' + placed + ' PLACED';
    } catch(e) {
      console.warn('Camera index load failed:', e);
    }
  }

  function updateCamDotVisibility() {
    if (!map) return;
    const zoom = map.getZoom();
    const show = zoom >= 8;
    Object.values(camMarkers).forEach(({mk}) => {
      const el = mk.getElement();
      if (el) el.style.display = show ? '' : 'none';
    });
  }

  // ── ALERTS ──────────────────────────────────────────
  async function fetchAllAlerts() {
    document.getElementById('feed-status').textContent = 'SYNCING...';
    const results = [];
    let id = 1;
    for (const type of ISP_SOURCES) {
      try {
        const res = await fetch(PROXY + type);
        const html = await res.text();
        const parsed = parseAlerts(html, type, id);
        results.push(...parsed);
        id += parsed.length;
      } catch(e) { console.warn('fetch fail', type, e); }
    }

    // Attach matched cameras now that we know LIVE_CAMERAS
    for (const a of results) {
      a.cams = inferCameras(a.corridor, LIVE_CAMERAS, FALLBACK_CAMERAS);
    }

    ALERTS = results;
    updateStats();
    renderAlerts();
    rebuildAlertMarkers();

    // Geocode in the background — updates pin positions when each one resolves
    if (ALERTS.length) {
      document.getElementById('feed-status').textContent =
        `GEOCODING 0/${ALERTS.length}...`;
      geocodeAlerts(ALERTS, (done, total) => {
        document.getElementById('feed-status').textContent =
          `GEOCODING ${done}/${total}...`;
        rebuildAlertMarkers();
      }).then(() => {
        document.getElementById('feed-status').textContent =
          LIVE_CAMERAS.length ? 'LIVE — ' + LIVE_CAMERAS.length + ' CAMS' : 'LIVE';
      });
    } else {
      document.getElementById('feed-status').textContent =
        LIVE_CAMERAS.length ? 'LIVE — ' + LIVE_CAMERAS.length + ' CAMS' : 'LIVE';
    }

    if (ALERTS.length) startScanningForAlerts(ALERTS);
  }

  function updateStats() {
    const c = t => ALERTS.filter(a => a.type === t).length;
    document.getElementById('s-amber').textContent  = c('amber')  + ' AMBER';
    document.getElementById('s-silver').textContent = c('silver') + ' SILVER';
    document.getElementById('s-green').textContent  = c('green')  + ' GREEN';
    document.getElementById('s-blue').textContent   = c('blue')   + ' BLUE';
    document.getElementById('total-ct').textContent = ALERTS.length ? ALERTS.length + ' TOTAL' : 'ALL CLEAR';
  }

  function rebuildAlertMarkers() {
    Object.values(alertMarkers).forEach(mk => map.removeLayer(mk));
    alertMarkers = {};
    ALERTS.forEach(a => {
      const el = document.createElement('div');
      el.className = 'alert-pin';
      el.style.cssText = `background:${COLOR[a.type]};box-shadow:0 0 8px ${COLOR[a.type]}`;
      const mk = L.marker([a.lat, a.lon], {
        icon: L.divIcon({className:'', html:el, iconSize:[11,11], iconAnchor:[5,5]}),
        zIndexOffset: 1000
      }).addTo(map);
      mk.on('click', () => pickAlert(a));
      alertMarkers[a.id] = mk;
    });
  }

  function renderAlerts() {
    const src = curFilter === 'all' ? ALERTS : ALERTS.filter(a => a.type === curFilter);
    if (!src.length) {
      document.getElementById('alert-list').innerHTML =
        `<div class="no-alerts"><span>◉ ALL CLEAR</span><br><br>No active ${curFilter==='all'?'':esc(curFilter)+' '}alerts in Indiana.<br>Refreshes every 3 minutes.</div>`;
      return;
    }
    document.getElementById('alert-list').innerHTML = src.map(a => `
      <div class="acard ${esc(a.type)}${selAlert?.id===a.id?' active':''}" data-id="${a.id}">
        <div class="abadge ab-${esc(a.type)}">${esc(a.type.toUpperCase())} — ${esc(a.state)}</div>
        <div class="aname">${esc(a.subject)}</div>
        <div class="avehicle">${esc(a.vehicle)}</div>
        <div class="aplate ${esc(a.type)}">${esc(a.plate)} · ${esc(a.ps)}</div>
        <div class="ameta"><span>${esc(a.corridor)}</span><span>${a.elapsed!=='—'?'+'+esc(a.elapsed):''}</span></div>
      </div>`).join('');
    document.getElementById('alert-list').onclick = e => {
      const card = e.target.closest('.acard');
      if (!card) return;
      const id = parseInt(card.dataset.id, 10);
      const a = ALERTS.find(x => x.id === id);
      if (a) pickAlert(a);
    };
  }

  function pickAlert(a) {
    selAlert = a;
    renderAlerts();
    map.flyTo([a.lat, a.lon], 9, {duration:1.2});
    Object.values(camMarkers).forEach(({el}) => {
      el.style.background = 'var(--green)';
      el.style.boxShadow  = 'none';
      el.style.transform  = 'scale(1)';
    });
    a.cams.forEach(cid => {
      const c = camMarkers[cid];
      if (c) {
        c.el.style.background = COLOR[a.type];
        c.el.style.boxShadow  = `0 0 9px ${COLOR[a.type]}`;
        c.el.style.transform  = 'scale(1.5)';
      }
    });
    renderDetail(a);
    renderNearby(a);
    const firstId = a.cams[0];
    if (firstId) {
      const liveCam = LIVE_CAMERAS.find(c => c.id === firstId);
      if (liveCam) pickLiveCamera(liveCam);
      else {
        const fallbackCam = FALLBACK_CAMERAS.find(c => c.id === firstId);
        if (fallbackCam) pickCamera(fallbackCam);
      }
    }
  }

  function renderDetail(a) {
    const c = COLOR[a.type];
    document.getElementById('alert-detail').innerHTML = `
      <div class="dl">SUBJECT</div><div class="dv" style="font-size:13px;font-weight:700">${esc(a.subject)}</div>
      <div class="hr"></div>
      <div class="dl">VEHICLE</div><div class="dv">${esc(a.vehicle)}</div>
      <div class="dl">LICENSE PLATE</div><div class="dv mono ${esc(a.type)}">${esc(a.plate)} · ${esc(a.ps)}</div>
      <div class="hr"></div>
      <div class="dl">LAST KNOWN LOCATION</div><div class="dv">${esc(a.lastSeen)}</div>
      <div class="dl">DIRECTION OF TRAVEL</div><div class="dv">${esc(a.dir)}</div>
      ${a.suspect?`<div class="hr"></div><div class="dl">SUSPECT</div><div class="dv">${esc(a.suspect)}</div>`:''}
      <div class="hr"></div>
      <div class="row2">
        <div><div class="dl">ISSUED</div><div class="dv" style="font-family:'IBM Plex Mono',monospace;font-size:10px">${a.issued!=='—'?esc(a.issued)+' ET':'—'}</div></div>
        <div><div class="dl">ELAPSED</div><div class="dv" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${c}">${esc(a.elapsed)}</div></div>
      </div>
      <div class="dl">C0RRID0R CAMERAS</div>
      <div class="dv" style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:${c}">${a.cams.length} ACTIVE — ${esc(a.corridor)}</div>
      ${a.isReal?`<div class="hr"></div><div style="font-family:'IBM Plex Mono',monospace;font-size:8px;color:var(--green)">● SOURCE: INDIANA STATE POLICE — LIVE</div>`:''}`;
  }

  function renderNearby(a) {
    const sec = document.getElementById('near-sec');
    if (!a.cams.length) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    document.getElementById('thumb-grid').innerHTML = a.cams.map(cid => {
      const liveCam = LIVE_CAMERAS.find(c => c.id === cid);
      const fallCam = FALLBACK_CAMERAS.find(c => c.id === cid);
      const imgSrc  = liveCam ? liveCam.imageUrl : (fallCam ? CAM(fallCam.img) : '');
      const label   = liveCam ? liveCam.title : (fallCam?.label || cid);
      return `<div class="thumb" data-camid="${esc(cid)}" title="${esc(label)}">
        <img data-src="${esc(imgSrc)}" alt="" loading="lazy">
      </div>`;
    }).join('');
    const grid = document.getElementById('thumb-grid');
    grid.onclick = e => {
      const t = e.target.closest('.thumb');
      if (!t) return;
      const id = t.dataset.camid;
      const liveCam = LIVE_CAMERAS.find(c => c.id === id);
      if (liveCam) pickLiveCamera(liveCam);
      else pickCamera(FALLBACK_CAMERAS.find(c => c.id === id));
    };
    lazyLoadImages(grid);
  }

  // ── LAZY LOADING ────────────────────────────────────
  function lazyLoadImages(container) {
    const imgs = container.querySelectorAll('img[data-src]');
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            const img = e.target;
            img.src = img.dataset.src;
            img.onerror = () => { img.parentElement.style.background='#111'; };
            obs.unobserve(img);
          }
        });
      }, {rootMargin: '100px'});
      imgs.forEach(img => obs.observe(img));
    } else {
      imgs.forEach(img => img.src = img.dataset.src);
    }
  }

  // ── CAMERA — STILL IMAGE ────────────────────────────
  function pickCamera(cam) {
    if (!cam) return;
    selCam = cam;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const img = document.getElementById('cam-img');
    const ph  = document.getElementById('cam-ph');
    ph.textContent = 'LOADING...';
    img.style.display = 'none';
    ph.style.display  = 'flex';
    const tmp = new Image();
    tmp.onload  = () => {
      img.src = tmp.src; img.style.display = 'block';
      ph.style.display = 'none';
      document.getElementById('cam-live').style.display='inline';
      stampTime();
    };
    tmp.onerror = () => {
      ph.innerHTML = `<span style="font-size:9px;color:var(--dim);text-align:center">FEED UNAVAILABLE<br><span style="color:var(--text)">${esc(cam.label)}</span></span>`;
      ph.style.display = 'flex';
    };
    tmp.src = CAM(cam.img);
    document.getElementById('cam-lbl').textContent = cam.label;
    document.getElementById('cam-sub').textContent = cam.route;
    document.getElementById('cam-meta').style.display = 'block';
    Object.values(camMarkers).forEach(({el}) => el.classList.remove('sel'));
    if (camMarkers[cam.id]) camMarkers[cam.id].el.classList.add('sel');
  }

  // ── CAMERA — LIVE HLS ───────────────────────────────
  function pickLiveCamera(cam) {
    if (!cam) return;
    selCam = cam;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    const img     = document.getElementById('cam-img');
    const ph      = document.getElementById('cam-ph');
    const liveTag = document.getElementById('cam-live');
    ph.textContent       = 'LOADING STREAM...';
    img.style.display    = 'none';
    ph.style.display     = 'flex';
    liveTag.style.display = 'none';
    document.getElementById('cam-lbl').textContent = cam.title || cam.id;
    document.getElementById('cam-sub').textContent = cam.route || '';
    document.getElementById('cam-meta').style.display = 'block';

    if (cam.streamUrl && typeof Hls !== 'undefined' && Hls.isSupported()) {
      let videoEl = document.getElementById('cam-video');
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = 'cam-video';
        videoEl.style.cssText = 'width:100%;height:100%;object-fit:cover;display:none;background:#000;position:absolute;top:0;left:0';
        videoEl.muted = true;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        document.querySelector('.cam-viewport').appendChild(videoEl);
      }
      // Route HLS through our streamproxy so allowed domains stay tightly scoped
      const proxiedUrl = '/api/streamproxy?url=' + encodeURIComponent(cam.streamUrl);
      hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true });
      hlsInstance.loadSource(proxiedUrl);
      hlsInstance.attachMedia(videoEl);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        videoEl.play().catch(() => {});
        videoEl.style.display  = 'block';
        img.style.display      = 'none';
        ph.style.display       = 'none';
        liveTag.style.display  = 'inline';
        liveTag.textContent    = '⬤ LIVE VIDEO';
        stampTime();
      });
      hlsInstance.on(Hls.Events.ERROR, (e, d) => {
        if (d.fatal) { videoEl.style.display='none'; loadStillFromLive(cam, img, ph, liveTag); }
      });
    } else {
      loadStillFromLive(cam, img, ph, liveTag);
    }
    Object.values(camMarkers).forEach(({el}) => el.classList.remove('sel'));
    if (camMarkers[cam.id]) camMarkers[cam.id].el.classList.add('sel');
  }

  function loadStillFromLive(cam, img, ph, liveTag) {
    const tmp = new Image();
    tmp.onload  = () => { img.src=tmp.src; img.style.display='block'; ph.style.display='none'; liveTag.style.display='inline'; liveTag.textContent='⬤ LIVE'; stampTime(); };
    tmp.onerror = () => { ph.innerHTML=`<span style="font-size:9px;color:var(--dim);text-align:center">FEED UNAVAILABLE<br><span style="color:var(--text)">${esc(cam.title||cam.id)}</span></span>`; ph.style.display='flex'; };
    // Always go through proxy — direct CARS URLs taint the canvas (no CORS)
    tmp.src = '/api/camproxy?id=' + encodeURIComponent(cam.id) + '&t=' + Date.now();
  }

  function stampTime() {
    const t = new Date().toLocaleTimeString('en-US', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'});
    document.getElementById('cam-ts').textContent = t + ' ET';
  }

  function refreshCam() {
    if (!selCam) return;
    if (selCam.streamUrl || selCam.imageUrl || selCam.id?.includes('-')) pickLiveCamera(selCam);
    else pickCamera(selCam);
  }

  function openFeed() {
    if (selCam?.imageUrl) window.open(selCam.imageUrl, '_blank');
    else if (selCam?.img) window.open(CAM(selCam.img), '_blank');
    else if (selCam?.id)  window.open('/api/camproxy?id=' + encodeURIComponent(selCam.id), '_blank');
  }

  // ── SCANNER ─────────────────────────────────────────
  function startScanningForAlerts(alerts) {
    Object.values(scanIntervals).forEach(i => clearInterval(i));
    scanIntervals = {};
    if (!alerts.length) return;
    document.getElementById('scan-panel').style.display = 'flex';
    alerts.forEach(alert => {
      logScan(`SCAN STARTED — ${alert.type.toUpperCase()} — ${alert.subject}`, 'info');
      logScan(`TARGET: ${alert.vehicle} · ${alert.plate}`, 'info');
      const vt = window.VehicleSizer.parseVehicleType(alert.vehicle);
      logScan(`SIZE FILTER: ${vt}`, 'info');
      scanCorridorCameras(alert);
      scanIntervals[alert.id] = setInterval(() => scanCorridorCameras(alert), 2 * 60 * 1000);
    });
  }

  function scanCorridorCameras(alert) {
    if (!alert.cams.length) {
      logScan(`✗ NO CAMERAS for ${alert.subject} (corridor: ${alert.corridor})`, 'info');
      return;
    }
    alert.cams.forEach(cid => {
      const cam = LIVE_CAMERAS.find(c => c.id === cid) || FALLBACK_CAMERAS.find(c => c.id === cid);
      if (cam) captureAndAnalyze(cam, alert);
    });
  }

  async function captureAndAnalyze(cam, alert) {
    const camId = cam.id || cam.label;
    let frame;
    try {
      frame = await loadFrameAsImageData(cam);
    } catch (e) {
      logScan(`✗ FEED ERROR — ${cam.title || cam.label}: ${e.message}`, 'info');
      return;
    }

    const prev = prevFrames.get(camId);
    const result = window.VehicleSizer.analyzeFrame({
      camId,
      current:  frame.imageData,
      previous: prev,
      alert,
    });

    // Update prev frame for next pass
    prevFrames.set(camId, frame.imageData);

    const ts = new Date().toLocaleTimeString('en-US', {hour12:false, timeZone:'America/Indiana/Indianapolis'});
    const calStat = window.VehicleSizer.getCalibrationStatus(camId);
    const calNote = calStat.ready ? '' : ` [calibrating ${calStat.samples}/15]`;

    if (result.flagged) {
      flagCount++;
      document.getElementById('scan-count').textContent = flagCount + ' FLAGGED';
      logScan(`⬤ FLAGGED — ${cam.title || cam.label} @ ${ts} — ${result.reason}`, 'flagged');
      // Hand to review queue (handles dedup + cooldown)
      const offerResult = window.FlagQueue.offer(frame.canvas, {
        alert, cam, ts: new Date().toISOString(), reason: result.reason, detail: result.detail,
      });
      if (offerResult.added) {
        logScan(`  ↳ QUEUED for review (${window.FlagQueue.snapshot().pending} pending)`, 'sent');
      } else {
        logScan(`  ↳ skipped (${offerResult.reason})`, 'info');
      }
    } else {
      logScan(`✓ CLEAR — ${cam.title || cam.label} @ ${ts} — ${result.reason}${calNote}`, 'info');
    }
  }

  // ── TEST SCAN ───────────────────────────────────────
  async function runTestScan() {
    if (!LIVE_CAMERAS.length) {
      logScan('✗ NO LIVE CAMERAS LOADED YET', 'info');
      return;
    }
    const cam = LIVE_CAMERAS[Math.floor(Math.random() * LIVE_CAMERAS.length)];
    const fakeAlert = {
      type: 'amber', subject: 'TEST SUBJECT',
      vehicle: 'Black sedan', plate: 'TEST123',
      lastSeen: 'TEST LOCATION', dir: 'Northbound',
      corridor: cam.route, cams: [cam.id], isReal: false,
    };
    document.getElementById('scan-panel').style.display = 'flex';
    logScan(`⬤ TEST SCAN — ${cam.title}`, 'info');

    // Two captures so we have a previous frame for motion
    try {
      const f1 = await loadFrameAsImageData(cam);
      logScan(`  ↳ frame 1 captured (${f1.width}x${f1.height})`, 'info');
      await new Promise(r => setTimeout(r, 1500));
      const f2 = await loadFrameAsImageData(cam);
      logScan(`  ↳ frame 2 captured`, 'info');
      const result = window.VehicleSizer.analyzeFrame({
        camId: cam.id, current: f2.imageData, previous: f1.imageData, alert: fakeAlert,
      });
      const luminance = window.VehicleSizer._meanLuminance(f2.imageData);
      logScan(`  ↳ scene luminance: ${luminance.toFixed(0)} (${result.sceneNight ? 'NIGHT' : 'DAY'})`, 'info');
      logScan(`  ↳ motion blobs: ${result.blobs.length}`, 'info');
      if (result.flagged) {
        flagCount++;
        document.getElementById('scan-count').textContent = flagCount + ' FLAGGED';
        logScan(`⬤ TEST FLAGGED — ${result.reason}`, 'flagged');
        window.FlagQueue.offer(f2.canvas, {
          alert: fakeAlert, cam, ts: new Date().toISOString(),
          reason: '[TEST] ' + result.reason, detail: result.detail,
        });
        logScan(`  ↳ QUEUED for review`, 'sent');
      } else {
        logScan(`✓ TEST CLEAR — ${result.reason}`, 'info');
      }
    } catch (e) {
      logScan(`✗ TEST FAILED: ${e.message}`, 'info');
    }
  }
})();
