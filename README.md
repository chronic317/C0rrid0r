# C0RRID0R

**Real-time investigative dashboard for missing-persons alerts in Indiana.**

C0RRID0R pulls live alerts from the Indiana State Police (Amber, Silver, Green, Blue) and ties each one to nearby INDOT traffic cameras, so independent investigators, families, and volunteers can watch the highway corridors a missing person may be traveling — in real time.

Built by [Naptown Unsolved](mailto:naptownunsolved@gmail.com).

> **This is not an official law enforcement tool.** Always defer to ISP and local authorities during active emergencies. For emergencies, call 911.

---

## What it does

- **Pulls all four Indiana alert types** every 3 minutes from the official ISP pages
- **Geocodes each alert's last-known location** so pins land on the actual map (not all stacked at downtown Indy)
- **Connects each alert to ~734 live INDOT cameras** via the CARS feed (with 511in.org GraphQL fallback) and matches them by corridor (I-65, I-70, I-69, I-74, I-465, I-80/90, I-94, I-64, US-31, US-30)
- **Scans corridor cameras** for vehicles matching the alert's color and size class, and queues flagged frames for **human review** — never auto-acted on, never sent anywhere
- **Reviewer dashboard**: queued flags appear in a grid with thumbnail, camera, alert, reason, timestamp. Reviewer can save, mark reviewed, or dismiss

The scanner is intentionally a triage tool, not an identification tool. It narrows the haystack — a human looks at every flag.

---

## Architecture

```
C0RRID0R/
├── api/                            Vercel-style serverless functions
│   ├── alertproxy.js               Proxies in.gov alert pages (timeout, cache)
│   ├── camproxy.js                 Proxies CARS still images (id allowlist, fallback chain)
│   ├── streamproxy.js              Proxies HLS streams (exact-hostname allowlist)
│   ├── cameralocations.js          CARS XML feed → camera index, GraphQL fallback
│   └── geocode.js                  Nominatim proxy for alert addresses
└── public/
    ├── index.html                  Desktop UI shell
    ├── mobile.html                 Mobile UI shell
    └── js/
        ├── corridor-core.js        Parser, escape, geocoding, scan log, image fetcher
        ├── vehicle-sizer.js        Motion detection + size/aspect classifier
        ├── flag-queue.js           Review queue with cooldown + perceptual-hash dedup
        ├── desktop-app.js          Desktop orchestration
        └── mobile-app.js           Mobile orchestration
```

---

## How the scanner works

When an alert is active, every 2 minutes the scanner pulls a fresh frame from each of that alert's corridor cameras and runs the following pipeline:

### 1. Frame differencing
Compare the current frame to the previous frame. Pixels that didn't change are ignored. Result: an empty highway produces zero motion regions, so an empty road at night never falsely flags a "black sedan" alert just because the asphalt is dark.

### 2. Connected-component blob extraction
Group changed pixels into bounding-box blobs. Each blob is a candidate vehicle.

### 3. Per-camera self-calibration
We don't know each camera's focal length, mount height, or angle, so we can't measure absolute size. Instead, the system maintains a rolling window of blob sizes per camera in `localStorage`. After ~15 vehicles have been observed, the median blob area becomes "1 sedan unit" — because sedans dominate U.S. traffic (~60%). A blob 2.5× the median is a truck. 0.7× is a compact. 6× is a semi.

### 4. Aspect-ratio classification
Aspect ratio is scale-invariant. Manufacturer dimensions (length:height):

| Class    | Reference        | L × W × H (m)         | L/H  |
|----------|------------------|-----------------------|------|
| compact  | Honda Civic      | 4.55 × 1.80 × 1.41    | 3.23 |
| sedan    | Toyota Camry     | 4.88 × 1.84 × 1.45    | 3.37 |
| suv      | Honda CR-V       | 4.68 × 1.86 × 1.69    | 2.77 |
| fullsuv  | Chevy Tahoe      | 5.35 × 2.06 × 1.94    | 2.76 |
| pickup   | Ford F-150       | 5.89 × 2.03 × 1.96    | 3.00 |
| van      | Honda Odyssey    | 5.32 × 1.99 × 1.74    | 3.06 |
| semi     | Day cab          | ~21 × 2.59 × 4.0      | 5.25 |

A blob with L/H > 4.5 is a semi regardless of distance from the camera. Below that, calibrated relative size disambiguates compact / sedan / SUV / pickup / fullsuv.

### 5. Color check inside the blob
Color analysis runs on pixels *inside* the blob's bounding box only — not the whole frame. This kills false positives where a dark cloud at the top of the frame would otherwise match a "black sedan" alert.

### 6. Match decision
A flag fires only when **both** size class and color match. The alert text is parsed for vehicle type (`Black Honda Civic` → `compact`, `Silver F-150` → `pickup`, `semi truck` → `semi`) with a compatibility map allowing for visual confusion between similar classes (compact ↔ sedan, pickup ↔ fullsuv).

### 7. Flag queue (not auto-download)
Flagged frames go to an in-memory review queue with:
- **5-minute cooldown** per camera (no flooding from sequential frames)
- **Perceptual hash dedup** over a 15-minute window (the same vehicle in two consecutive scans collapses to one entry)
- **500-flag cap** with FIFO eviction

The reviewer opens the queue from the status bar and decides what to do with each flag — save, mark reviewed, or dismiss. Nothing is sent anywhere automatically.

---

## Running locally

C0RRID0R is built for Vercel-style serverless deployment. Each file in `api/` is a function; everything in `public/` is static.

### Required env vars (CARS official feed)

```
CCTV_USERNAME=<your CARS username>
CCTV_PASSWORD=<your CARS password>
```

Without these, the system falls back to the 511in.org GraphQL endpoint, which returns roughly the same camera set publicly.

### Deploy on Vercel

1. Fork or clone this repo
2. Connect the repo to a new Vercel project
3. Add the env vars above (Settings → Environment Variables)
4. Deploy — `public/` is served as the site root, `api/*.js` becomes `/api/*`

### Routes

- `/` → desktop dashboard
- `/mobile.html` → mobile dashboard
- `/api/alertproxy?type=amber|silver|green|blue` → ISP page proxy
- `/api/camproxy?id=<device-id>` → still image proxy
- `/api/streamproxy?url=<allowlisted-url>` → HLS stream proxy
- `/api/cameralocations` → camera index (CARS or fallback)
- `/api/geocode?q=<location-string>` → Nominatim proxy

---

## Security and privacy

- **No personal data is stored.** Alerts are pulled live from in.gov on each refresh; nothing is persisted server-side.
- **No accounts, no auth, no tracking.** The only stored state is per-browser `localStorage` for camera calibration and geocoding cache.
- **All upstream proxies are allowlisted** to ISP, INDOT (`trafficwise.org`, `carsprogram.org`), and Nominatim. Hostname checks are exact (no substring matches).
- **Camera image IDs are validated** against `^[A-Za-z0-9_\-\/]{1,64}$` before being passed to upstream URLs.
- **All user-derived strings** (alert text, camera titles) are HTML-escaped before insertion into the DOM.
- **Nominatim queries respect the public usage policy**: 1.1 s between requests, 30-day per-query cache, descriptive User-Agent with contact email.

---

## Limitations to know about

1. **Frame differencing assumes a static camera.** When INDOT cameras pan/tilt, the entire frame becomes "motion" and you may get a one-shot false flag (cooldown will suppress further hits for 5 min).
2. **Calibration is per-browser.** Each reviewer's browser builds its own median model in `localStorage`. Acceptable for a volunteer tool; not synced across reviewers.
3. **Aspect ratio assumes the road runs roughly horizontally** in the frame. True for most highway cams, less so for some surface-street cams.
4. **The classifier is a triage tool, not an identification tool.** A flag means "worth a human glance," not "this is the vehicle." Always review.

---

## Contributing

Issues and PRs welcome. Particularly useful contributions:

- Real-camera test fixtures for the parser (current ISP page + expected output)
- Better vehicle-text → class regex coverage (especially for less-common makes)
- Server-side calibration sync (so reviewers share a model per camera)
- Dark-mode tile-server alternative (the current OSM filter is hacky)

---

## Credits

- Alert data: [Indiana State Police](https://www.in.gov/isp/)
- Camera feeds: INDOT via the [CARS program](https://www.carsprogram.org/) and [511in.org](https://511in.org/)
- Maps: [OpenStreetMap](https://www.openstreetmap.org/) contributors
- Geocoding: [Nominatim](https://nominatim.org/)
- Built by [Naptown Unsolved](mailto:naptownunsolved@gmail.com), an independent investigative platform based in Indianapolis

---

## License

TBD — contact naptownunsolved@gmail.com before redistributing.
