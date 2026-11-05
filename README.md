# El Reno / Field Notes

A new local, interactive reconstruction of Shane Motley's May 31, 2013 tornado chase. The original camera export is preserved in `GPS.json`. This replaces the legacy Mapbox prototype with a small static application and bundled historical data. No Mapbox account, API key, build step, or package installation is needed.

## Open the map

On this Mac, double-click **Start El Reno.command**, then open **http://localhost:4173**. Keep its Terminal window open while using the map; Control+C stops the server.

Alternatively, with Node.js installed:

```sh
npm start
```

Open the localhost address in a browser. Opening `index.html` directly will not work because browsers restrict local data loading. The development server listens only on this computer.

Dark and light road maps are bundled locally and stay visible without internet or tile requests. Optional satellite imagery, Google Fonts, and external YouTube players need internet. Radar images, chase positions, road routes, tornado evidence, and film metadata are bundled locally. The nine supplied chase clips also have prepared local viewing copies; originals and viewing copies are excluded from Git. The basemap and satellite imagery provide present-day geographic context, not May 2013 imagery.

## What is included

- Grey SUV for Shane Motley / `smotley`, public Spotter Network ID **5867**.
- 86 original camera GPS fixes. UTC is a provisional clock interpretation; the clock control applies a reversible correction without changing the source.
- 21 original KTLX Level II volumes, yielding 42 low-tilt reflectivity and radial-velocity images, approximately 5:42–7:14 PM CDT. Native input has 250 m gates and 720 rays; PNGs use nearest-gate sampling on a roughly 151 m ground grid. The display grid does not improve native radar resolution.
- A rotatable **3D scans** view with 99 recorded volumes, each assembled from all 45 AIR elevation slices (−2° through 20°). Drag to rotate, Shift-drag or use two fingers to pan, scroll/pinch to zoom, use **Reset 3D view**, and adjust the dBZ cutoff to reveal stronger echoes. The **Position** panel supplies move, rotate, tilt and zoom buttons, north/east/south/west viewpoints, and a north-up overhead view. A compass tracks orientation; zoom can approach to 2 km from the view center. Panel **×** buttons minimize information into the bottom toolbar; **Clear view** minimizes them together. Chaser-name **×** buttons leave their location symbols visible; select a symbol or use **Restore names** to bring names back. Height/extent labels can also be switched off. The timeline and reflectivity opacity control also work in 3D. **Single map** returns to the road map. The 3D view shows radar echoes, not measured cloud or tornado surfaces. Heights use mean sea level without vertical exaggeration. **Surface & chasers** adds current roads, approximate public terrain heights, and the same supported vehicle positions as the 2D map. The SUV and Ben/Brandon/Skip retain their distinct styling. Symbols are enlarged foreground annotations; their visible size and drawing order are not physical dimensions or altitude.
- An AIR / WSR-88D switch. AIR supplies 99 locally bundled 0.5° reflectivity images, approximately 6:12–6:25 PM CDT, usually 7–8 seconds apart. The **Approx. NWS alignment** switch applies the user-requested visual fit: about 6.64 km east and 0.98 km north, identically across the sequence and in both 2D and 3D. Uncheck it to restore original placement. It is a **research preview with geographic alignment unverified**; the fit does not establish the actual radar deployment location or change the clock. See [alignment method](docs/air-alignment.md). AIR velocity is excluded because of documented 2013 instrument limitations; use WSR-88D for velocity.
- Independent product sweep timestamps, scan age, separate clickable REF/VEL acquisition rows, opacity controls, and synchronized comparison maps. Single-map mode selects one radar product to keep its color scale unambiguous.
- The official NWS surveyed contour, center path, and 39 minute-stamped estimated center positions from 6:04–6:42 PM CDT.
- 33 named El Reno Survey camera tracks with 913 source positions. These are **surveyed camera locations, not a complete Spotter Network archive**. Their source JSON links are collected in **About & sources**.
- Nine supplied local clips: five have user-supplied start times and four remain untimed. Adjustable split view and fullscreen video with a live mini map share one clock with vehicles and radar. The optional video stop correction adds an approximate 52-second stop without changing the original GPS file.
- Six verified original YouTube links and Ben Holcomb’s survey-linked private video reference. These external edits are not synchronized to map time. Unavailable legacy Vimeo player URLs have been removed from the interface and playback data; no replacement synchronized archive has been verified.
- Ten-second timeline scrubbing and step buttons, continuous playback, exact scan jumps, **Storm window** and **Full chase** ranges, follow mode, and CDT/UTC display. Switching radar sources preserves the selected time and timeline bounds; AIR is empty outside its recording window.
- Inferred road routes for every published vehicle track, respecting connected roads and turns. Estimated interval-average speeds appear on the SUV card and every chaser popup.
- Distinct, consistent marker colors for Ben Holcomb (amber), Brandon Sullivan (pink), and Skip Talbot (violet), with clickable map keys and footage links.
- An import format for documented spotter tracks. Imported files stay in the current browser session and remain marked unverified.

## Watch the chase footage

Choose a clip in the **Film room**, the player’s **Clip library**, or the **VIDEO** timeline row. Select **Our SUV**, **Brendon**, or **Auto** for timed playback. Use **Split view** and drag its divider or adjust **Video size**; **Video + mini map** and **Full screen** keep the map and shared timeline available beside the footage. Seeking a timed clip moves the shared clock. The four untimed clips open separately with the map paused; filenames and camera metadata are not treated as verified recording times.

Normal playback can include sound. At **5× and faster**, footage becomes a silent frame preview following the timeline. Gaps remain visible instead of holding an old clip. The original clips are neither frozen nor retimed.

**Use video stop correction** is on by default and can be switched off to compare original GPS playback. It reconstructs the reported stop from **6:02:56–6:03:48 PM CDT**, starting about 16 seconds into the provisionally timed `12_03_51` clip. The revised supplied pin is **35.44883333, −98.07538889**; the displayed vehicle uses the nearest point on the inferred road, about 78 m north. This is an approximate reconstruction, not a new GPS measurement. The original `GPS.json` and road-route data remain unchanged, and later observations are not shifted by 52 seconds. The separate GPS clock adjustment does not change video start times.

See [clip inventory and media preparation](docs/video-media.md) and [stop reconstruction and conflicting evidence](docs/video-gps-correction.md). Four clips still need start-time references; the five timed clips use supplied anchors, including one explicitly provisional start, rather than independently verified camera clocks.

## What the distance means

With unmodified camera timestamps interpreted as UTC, the interpolated minimum is **about 1.2 miles from the NWS estimated center around 6:10 PM CDT**. Using only recorded camera fixes gives about **1.3 miles**. This is not a measured distance to the tornado's edge, a subvortex, or damaging winds. The camera clock is unverified; changing it by one minute materially changes the estimate.

The computation compares simultaneous positions, sampled at one-second intervals. Camera gaps longer than five minutes are not bridged; survey camera gaps longer than two minutes and flagged jumps are also left empty. Vehicle interpolation follows connected, directed OpenStreetMap road geometry at a constant average speed between source observations. The current road network cannot establish which route was taken in 2013 or the exact timing of stops and turns. Failed road matches, implausible speeds, and flagged intervals are not interpolated. NWS center uncertainty is unquantified, not zero. The accumulated damage path is never treated as an instantaneous footprint.

See [road methodology](docs/road-methodology.md), [analysis validation](docs/analysis-validation.md), and [tornado methodology](docs/tornado-methodology.md).

## Outstanding evidence

Current scope is Shane’s camera GPS, the supplied local clips, and the 33 published El Reno Survey tracks. The historical Spotter Network archive has not been recovered, and broader SN recovery is outside the current scope. Shane’s own historical SN reports may still be used to cross-check the camera clock and fill supported gaps if recovered. The survey contains no verified Shane Motley or Tim Samaras/TWISTEX track; no TWISTEX position is fabricated or placed at a crash site.

A bounded search did not recover a verified replacement for the survey’s synchronized video archive. The original camera-position evidence remains available, but creator YouTube edits cannot inherit the old archive’s timing. See [survey video availability and recovery limits](docs/survey-video-availability.md).

Additional research radar availability is documented in [supplemental radar research](docs/supplemental-radar-research.md). OU’s public AIR archive has volume coverage from 6:11:56–6:24:57 PM CDT. The AIR layer uses volume midpoints because the archived ray timestamps are unusable; it does not hold an image beyond the recording window. See [AIR provenance](data/air/README.md), [independent AIR checks](docs/air-validation.md), [timestamp audit](docs/air-time-audit.md), and [3D data preparation](data/air-volume/README.md), and [surface overlay methodology](docs/air-surface.md).

DOW6 and DOW8 observations of this tornado **do exist**. A working public event-specific download has not been verified. The official [FARM data-access page](https://www.farmfacility.org/contents/facilitydata.php) provides a data-request route; no DOW data is included here.

Details and original source links: [spotter research](docs/spotter-research.md), [radar provenance](data/radar/README.md), and the in-app **About & sources** panel.

To add a track, use **Chasers → Import track JSON**. The downloadable example is illustrative, not real evidence. ISO timestamps must include an explicit timezone. Imported tracks show exact original observations only until road geometry is prepared; the app never connects imported points across fields. No account credentials or Application IDs are needed.

## Development and validation

```sh
npm run check
npm test
node scripts/validate_analysis.mjs
python3 -m unittest discover -s tests -p 'test_road_graph.py'
python3 scripts/extract_tornado.py
```

To rebuild browser viewing copies from the supplied originals in `data/movies/`, install FFmpeg and ffprobe, then run:

```sh
python3 scripts/prepare_chase_videos.py
```

This preserves the nine originals and creates H.264/AAC MP4s and posters under `data/movies/web/`, with durations, hashes, codec details, and timing status in `data/chase-videos.json`. The entire `data/movies/` directory is ignored by Git, so a fresh checkout does not include the footage. Existing prepared copies require no media-processing tools to watch. See [media preparation](docs/video-media.md) for the conversion settings and timing limits.

Rebuilding radar is optional; viewing requires no Python packages. The reproducible processing script and pinned requirements are supplied. It downloads about 211 MB of original volumes; allow additional space for its isolated Python environment. See `data/radar/README.md`. Temporary radar downloads and the processing environment were removed after successful generation; the finished PNGs, manifest, hashes, and validation record remain.

`js/air-volume-viewer.js` draws the recorded reflectivity grids with WebGL2. It requires a browser with WebGL2 and gzip decompression support; the 2D map remains available if those features are unavailable. Volumes are fetched on demand, with a bounded memory cache. `scripts/prepare_air_volume.py` prepares the 45-elevation data with source checksums and publishes compact compressed grids. `scripts/prepare_air_surface.py` prepares public terrain data; `js/air-surface.js` projects current roads and time-supported chaser coordinates into the same radar-local plane.

`js/radar-source.js` enforces independent source/product timing, availability, and coverage. `scripts/prepare_air.py` retrieves only the selected AIR sweeps using verified ZIP byte ranges, then renders the source coordinates without a manual alignment shift. The separate browser display adjustment in `js/air-alignment.js` leaves those archived images and grids unchanged. See `data/air/README.md` for regeneration and scientific limitations.

`js/analysis.js` contains the source-time, distance, legacy radar-selection, and import contracts. `js/road-motion.js` handles inferred road motion; `js/timeline.js` handles 10-second navigation and product-specific scan events. `scripts/prepare_roads.py` rebuilds the local OSM road map and routes without external routing calls at playback time. `app.js` controls the UI. Leaflet 1.9.4 is bundled with its license under `vendor/leaflet`. Meteorological and survey sources retain their source attribution; this project does not assert ownership of third-party footage or data.

The old app embedded Mapbox credentials. The replacement has no such dependency. Removing credentials from the current files does not erase older Git history; revoke any legacy secret that is still active.

In memory of Tim Samaras, Paul Samaras, Carl Young, and all who lost their lives that day.
