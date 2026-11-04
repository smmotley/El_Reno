# KTLX historical radar overlays

These **42 PNGs are derived from 21 actual NOAA/NWS Level II radar volumes**, not simulated radar or modern radar screenshots. The included sequence covers May 31, 2013 22:42 UTC through June 1 00:14 UTC (5:42–7:14 p.m. CDT). The initial volume precedes the requested 22:45 UTC window so playback starts with an observation already available.

`manifest.json` provides the application interface. `provenance.json` records each public archive key, source URL, compressed-file size, SHA-256 checksum, volume coverage pattern, and product metadata. Raw volumes are cached outside the distributed data folder in `.cache/radar/`.

## Scientific interpretation

- KTLX's nominal **0.5°** low tilt is encoded as a **0.483398° target angle** in these files. The actual measured ray elevations vary; minimum, maximum, and median are retained for each product. No lower tilt was found in these volumes.
- The selected low tilt has **250 m native range gates and about 0.5° azimuth sampling** (720 rays). Azimuth footprints grow with distance; the raster's roughly 151 m pixel size does not imply 151 m independent radar resolution.
- Reflectivity comes from the first low-tilt surveillance sweep and velocity from the following low-tilt Doppler sweep. They are about 20 seconds apart. Product timestamps are sweep midpoints, accompanied by start/end and visible-region time ranges. The general frame timestamp follows reflectivity.
- Velocity is **base radial velocity**, in knots: green/negative toward KTLX, red/positive away. It is **not storm-relative, not dealiased, and not a measurement of the tornado's full wind speed**. Each sweep's Nyquist velocity is stored in metadata; values can fold across that limit.
- Missing, below-threshold, and range-folded gates are transparent. All other values are retained, including weak echoes. Values outside the displayed palette use the first or last color.
- The radar beam samples above ground. Radar imagery alone does not define the tornado's surface footprint or a vehicle's safety margin.

## Rendering and scales

Each transparent 480 × 368 PNG is in **EPSG:3857**, north at top, fitted to Leaflet bounds `[[35.20,-98.30],[35.70,-97.50]]`. Grid pixels sample the nearest native polar gate without smoothing or interpolation between observation times. The ground geometry uses a spherical azimuthal-equidistant projection centered on the radar and the standard 4/3-Earth beam model. A higher raster zoom does not create additional measured detail.

The exact categorical scales are in `manifest.json` under `colorScales`; each listed threshold begins a color interval. Reflectivity units are **dBZ**, with breaks from −10 to 80 dBZ. Velocity units are **kt**, with breaks from −100 to +100 kt. The unused extreme velocity bins allow consistent legends while the actual undealiased measurements are constrained by Nyquist velocity.

## Rebuild

From the repository root:

```sh
python3 -m venv .venv-radar
.venv-radar/bin/pip install -r requirements-radar.txt
.venv-radar/bin/python scripts/prepare_radar.py
```

Use `--offline` to reproduce overlays from cached listings and raw volumes. The frontend requires none of these Python packages; the PNG assets are already included. Rebuilding downloads about 210 MB of public compressed Level II files. The finished PNGs total about 1.6 MiB.

Sources: [NOAA/Unidata archive registry](https://registry.opendata.aws/noaa-nexrad/), [Py-ART Level II reader](https://arm-doe.github.io/pyart/API/generated/pyart.io.read_nexrad_archive.html), [NOAA base velocity explanation](https://www.noaa.gov/jetstream/velocity). The old `noaa-nexrad-level2` bucket was retired in 2025; the script uses `unidata-nexrad-level2`.
