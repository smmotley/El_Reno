# El Reno / Field Notes

A new local, interactive reconstruction of Shane Motley's May 31, 2013 tornado chase. The original camera export is preserved in `GPS.json`. This replaces the legacy Mapbox prototype with a small static application and bundled historical data. No Mapbox account, API key, build step, or package installation is needed.

## Open the map

On this Mac, double-click **Start El Reno.command**, then open **http://localhost:4173**. Keep its Terminal window open while using the map; Control+C stops the server.

Alternatively, with Node.js installed:

```sh
npm start
```

Open the localhost address in a browser. Opening `index.html` directly will not work because browsers restrict local data loading. The server listens only on this computer. No website has been deployed. The HTML, scripts, styles, `vendor`, `assets`, `GPS.json`, and `data` folders can later be served by a static host.

Dark and light road maps are bundled locally and stay visible without internet or tile requests. Optional satellite imagery and Google Fonts need internet. All radar images, chase positions, road routes, tornado evidence, and film metadata are bundled locally. YouTube/Vimeo links open the original publications. The basemap and satellite imagery provide present-day geographic context, not May 2013 imagery.

## What is included

- Grey SUV for Shane Motley / `smotley`, public Spotter Network ID **5867**.
- 86 original camera GPS fixes. UTC is a provisional clock interpretation; the clock control applies a reversible correction without changing the source.
- 21 original KTLX Level II volumes, yielding 42 low-tilt reflectivity and radial-velocity images, approximately 5:42–7:14 PM CDT. Native input has 250 m gates and 720 rays; PNGs use nearest-gate sampling on a roughly 151 m ground grid. The display grid does not improve native radar resolution.
- Independent product sweep timestamps, scan age, separate clickable REF/VEL acquisition rows, opacity controls, and synchronized comparison maps. Single-map mode selects one radar product to keep its color scale unambiguous.
- The official NWS surveyed contour, center path, and 39 minute-stamped estimated center positions from 6:04–6:42 PM CDT.
- 33 named El Reno Survey camera tracks with 913 source positions, clickable sources and footage. These are **surveyed camera locations, not a complete Spotter Network archive**.
- Six verified original YouTube links, Ben Holcomb’s survey-linked private video reference, and survey video links. Video edits have not been synchronized to map time; no map pin or capture timestamp is invented. Ben’s YouTube reference is explicitly marked private.
- Ten-second timeline scrubbing and step buttons, continuous playback, exact scan jumps, storm/full-chase ranges, follow mode, and CDT/UTC display.
- Inferred road routes for every published vehicle track, respecting connected roads and turns. Estimated interval-average speeds appear on the SUV card and every chaser popup.
- Distinct, consistent marker colors for Ben Holcomb (amber), Brandon Sullivan (pink), and Skip Talbot (violet), with clickable map keys and footage links.
- An import format for documented spotter tracks. Imported files stay in the current browser session and remain marked unverified.

## What the distance means

With unmodified camera timestamps interpreted as UTC, the interpolated minimum is **about 1.2 miles from the NWS estimated center around 6:10 PM CDT**. Using only recorded camera fixes gives about **1.3 miles**. This is not a measured distance to the tornado's edge, a subvortex, or damaging winds. The camera clock is unverified; changing it by one minute materially changes the estimate.

The computation compares simultaneous positions, sampled at one-second intervals. Camera gaps longer than five minutes are not bridged; survey camera gaps longer than two minutes and flagged jumps are also left empty. Vehicle interpolation follows connected, directed OpenStreetMap road geometry at a constant average speed between source observations. The current road network cannot establish which route was taken in 2013 or the exact timing of stops and turns. Failed road matches, implausible speeds, and flagged intervals are not interpolated. NWS center uncertainty is unquantified, not zero. The accumulated damage path is never treated as an instantaneous footprint.

See [road methodology](docs/road-methodology.md), [analysis validation](docs/analysis-validation.md), and [tornado methodology](docs/tornado-methodology.md).

## Outstanding evidence

Current scope is Shane’s camera GPS plus the 33 published El Reno Survey tracks. The historical Spotter Network archive has not been recovered, and broader SN recovery is outside the current scope. Shane’s own historical SN reports may still be used to cross-check the camera clock and fill supported gaps if recovered. The survey contains no verified Shane Motley or Tim Samaras/TWISTEX track; no TWISTEX position is fabricated or placed at a crash site. The user’s own clips are deferred to a later phase.

Additional research radar availability is documented in [supplemental radar research](docs/supplemental-radar-research.md). OU’s public AIR archive covers 6:11:56–6:24:51 PM CDT; it is not yet an app layer.

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

Rebuilding radar is optional; viewing requires no Python packages. The reproducible processing script and pinned requirements are supplied. It downloads about 211 MB of original volumes; allow additional space for its isolated Python environment. See `data/radar/README.md`. Temporary radar downloads and the processing environment were removed after successful generation; the finished PNGs, manifest, hashes, and validation record remain.

`js/analysis.js` contains the source-time, distance, radar-selection, and import contracts. `js/road-motion.js` handles inferred road motion; `js/timeline.js` handles 10-second navigation and product-specific scan events. `scripts/prepare_roads.py` rebuilds the local OSM road map and routes without external routing calls at playback time. `app.js` controls the UI. Leaflet 1.9.4 is bundled with its license under `vendor/leaflet`. Meteorological and survey sources retain their source attribution; this project does not assert ownership of third-party footage or data.

The old app embedded Mapbox credentials. The replacement has no such dependency. Removing credentials from the current files does not erase older Git history; revoke any legacy secret that is still active.

In memory of Tim Samaras, Paul Samaras, Carl Young, and all who lost their lives that day.
