# El Reno / Field Notes

A new local, interactive reconstruction of Shane Motley's May 31, 2013 tornado chase. The original camera export is preserved in `GPS.json`. This replaces the legacy Mapbox prototype with a small static application and bundled historical data. No Mapbox account, API key, build step, or package installation is needed.

## Open the map

On this Mac, double-click **Start El Reno.command**, then open **http://localhost:4173**. Keep its Terminal window open while using the map; Control+C stops the server.

Alternatively, with Node.js installed:

```sh
npm start
```

Open the localhost address in a browser. Opening `index.html` directly will not work because browsers restrict local data loading. The server listens only on this computer. No website has been deployed. The HTML, scripts, styles, `vendor`, `assets`, `GPS.json`, and `data` folders can later be served by a static host.

Basemap tiles and optional Google Fonts need internet. All radar images, chase positions, tornado evidence, and film metadata are bundled locally. YouTube/Vimeo links open the original publications. The basemap and satellite imagery provide present-day geographic context, not May 2013 imagery.

## What is included

- Grey SUV for Shane Motley / `smotley`, public Spotter Network ID **5867**.
- 86 original camera GPS fixes. UTC is a provisional clock interpretation; the clock control applies a reversible correction without changing the source.
- 21 original KTLX Level II volumes, yielding 42 low-tilt reflectivity and radial-velocity images, approximately 5:42–7:14 PM CDT. Native input has 250 m gates and 720 rays; PNGs use nearest-gate sampling on a roughly 151 m ground grid. The display grid does not improve native radar resolution.
- Independent product sweep timestamps, scan age, opacity controls, and synchronized comparison maps. Single-map mode selects one radar product to keep its color scale unambiguous.
- The official NWS surveyed contour, center path, and 39 minute-stamped estimated center positions from 6:04–6:42 PM CDT.
- 33 named El Reno Survey camera tracks with 913 source positions, clickable sources and footage. These are **surveyed camera locations, not a complete Spotter Network archive**.
- Six verified original YouTube links plus available survey video links. Video edits have not been synchronized to map time, so the six films have no invented map pin or capture timestamp.
- Timeline scrubbing, playback speeds, previous/next scans, storm/full-chase ranges, follow mode, and CDT/UTC display.
- An import format for documented spotter tracks. Imported files stay in the current browser session and remain marked unverified.

## What the distance means

With unmodified camera timestamps interpreted as UTC, the interpolated minimum is **about 1.2 miles from the NWS estimated center around 6:10 PM CDT**. Using only recorded camera fixes gives about **1.3 miles**. This is not a measured distance to the tornado's edge, a subvortex, or damaging winds. The camera clock is unverified; changing it by one minute materially changes the estimate.

The computation compares simultaneous positions, sampled at one-second intervals. Camera gaps longer than five minutes are not bridged; survey camera gaps longer than two minutes and flagged jumps are also left empty. Linear position interpolation can cut road corners. NWS center uncertainty is unquantified, not zero. The accumulated damage path is never treated as an instantaneous footprint.

See [analysis validation](docs/analysis-validation.md) and [tornado methodology](docs/tornado-methodology.md).

## Outstanding evidence

The public historical Spotter Network file has not been recovered, so `smotley` has not been matched to a richer SN track. The recovered camera dataset contains no verified Shane Motley or Tim Samaras/TWISTEX track. TWISTEX is listed as unavailable; a white vehicle marker is supported for a documented future track, but none is fabricated or placed at a crash site. The user's own clips are deferred to a later phase.

Details and original source links: [spotter research](docs/spotter-research.md), [radar provenance](data/radar/README.md), and the in-app **About & sources** panel.

To add a track, use **Chasers → Import track JSON**. The downloadable example is illustrative, not real evidence. ISO timestamps must include an explicit timezone. No account credentials or Application IDs are needed.

## Development and validation

```sh
npm run check
npm test
node scripts/validate_analysis.mjs
python3 scripts/extract_tornado.py
```

Rebuilding radar is optional; viewing requires no Python packages. The reproducible processing script and pinned requirements are supplied. It downloads about 211 MB of original volumes; allow additional space for its isolated Python environment. See `data/radar/README.md`. Temporary radar downloads and the processing environment were removed after successful generation; the finished PNGs, manifest, hashes, and validation record remain.

`js/analysis.js` contains the time, interpolation, distance, radar-selection, and import contracts. `app.js` controls the UI. Leaflet 1.9.4 is bundled with its license under `vendor/leaflet`. Meteorological and survey sources retain their source attribution; this project does not assert ownership of third-party footage or data.

The old app embedded Mapbox credentials. The replacement has no such dependency. Removing credentials from the current files does not erase older Git history; revoke any legacy secret that is still active.

In memory of Tim Samaras, Paul Samaras, Carl Young, and all who lost their lives that day.
