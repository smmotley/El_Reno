# Surface locations in the AIR 3D view

The optional surface layer adds geographic context beneath the measured reflectivity. Vehicle positions reuse the **same camera and El Reno Survey observations, road interpolation, gap rules, and camera-clock correction** as the 2D map. They are evaluated at the chase time, independently of the latest available radar midpoint. The overlay does not invent a chaser location when its source track is unavailable.

## Coordinates and ground heights

Latitude/longitude is converted to the volume's spherical azimuthal equidistant plane, centered at the archived AIR site. Both directions use a 6,371 km Earth radius, with x east and y north. Display heights and horizontal coordinates are in kilometers, with no vertical exaggeration.

The ground grid uses [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/), decoded according to the [original Terrarium format](https://github.com/tilezen/joerd/blob/master/docs/formats.md). The pixel formula is `R × 256 + G + B / 256 − 32768` meters. The preparation script samples geographic pixel centers bilinearly onto a 137 × 91 node grid at 500 m spacing. Runtime bilinear sampling estimates a ground height for each vehicle and road vertex. Missing or out-of-grid heights remain unavailable; the application does not substitute a zero-elevation marker.

These are approximate terrain elevations for context, not measured vehicle altitudes or a reconstruction of the May 2013 road surface. Terrarium combines multiple elevation sources; a single precise vertical datum relationship to the radar's archived altitude has not been established. Road cuts, bridges, local relief below the display grid, and terrain changes are not modeled. None of these heights is used in the existing horizontal closest-approach calculation.

## Roads and symbols

Roads come from the already bundled current OpenStreetMap network. The 3D display simplifies road geometry with a 25 m tolerance, clips it to the terrain domain, and samples terrain at intervals no greater than 500 m along displayed segments. This simplification affects rendering only. Vehicle interpolation continues to use the original prepared road routes.

Markers retain the SUV styling and the featured chasers' distinct colors. Marker symbols and names are enlarged **foreground annotations**, drawn for visibility through radar echoes. Their screen size and order do not represent vehicle dimensions, altitude, optical visibility, or exposure to damaging winds. Lower-priority names may be omitted when crowded; the location dots remain. The surface and markers can be hidden together, and the existing route/spotter layer controls govern the respective vehicle groups and opacity.

AIR's source geographic registration and absolute clock remain unverified. The overlay deliberately does not shift the radar to match a chaser or the NWS survey. It must not be used to infer a more precise vehicle-to-tornado distance. See [AIR validation](air-validation.md), [time audit](air-time-audit.md), and [independent 3D review](air-volume-validation.md).

## Attribution and reproduction

Terrain: **Mapzen; USGS SRTM and GMTED2010**, identified by the retrieved tile source metadata. See [provider attribution](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Roads: **OpenStreetMap contributors**, ODbL. Terrain retrieval URLs, hashes, decoding, and sampling metadata are retained with `data/air-surface.json`; raw source tiles are cached outside the distributed application.

Run `python3 scripts/prepare_air_surface.py` using the radar preparation environment to regenerate the terrain grid. The completed application loads only bundled files and needs no terrain service or account at playback time.
