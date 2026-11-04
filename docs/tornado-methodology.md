# Tornado evidence and limits

The tornado layers come directly from the [NWS Norman El Reno event archive](https://www.weather.gov/oun/events-20130531). The [official KMZ](https://www.weather.gov/source/oun/wxevents/20130531/gis/ElRenoTornadoPath_final.kmz) contains more than a polygon: it includes a center path and 39 time-labeled center points. No center positions were invented or digitized from pixels.

## Files and provenance

- `data/source/ElRenoTornadoPath_final.kmz` is the unmodified official download, retrieved November 4, 2026. SHA-256: `3a6fb5a007e5fab120d844e8c34136fff6cbf8f65b890ba09bdadb4bc630fdce`.
- `data/tornado.geojson` contains the full-event contour (a 72-coordinate closed ring) and the published center path (56 vertices). KML longitude/latitude values are preserved; zero altitude values are omitted.
- `data/tornado-timeline.json` contains the 39 original time-labeled point coordinates, sorted chronologically. Its separate events are concise paraphrases of the NWS event narrative.
- `data/source/elreno_tornado_ef0contour_with_times.jpg` is the [official companion map](https://www.weather.gov/images/oun/wxevents/20130531/maps/elreno_tornado_ef0contour_with_times.jpg), inspected to corroborate the meaning of the shapes and labels. It is a reference, not a source of digitized coordinates. The map has Google Earth imagery attribution; retain that attribution if presenting the image.
- `scripts/extract_tornado.py` reproduces the GeoJSON and timeline with Python's standard library and the bundled KMZ. Run `python3 scripts/extract_tornado.py` from the project directory.

The extractor reads each actual `Point/coordinates`, not the unrelated `LookAt` camera coordinates embedded in the same placemark. It validates feature counts, ring closure, geographic bounds, chronological order, and a one-minute interval between all timed points. No geometry simplification, snapping, or fitting is performed. The source's 6:17 and 6:16 placemarks are stored out of sequence; sorting resolves this without changing their coordinates.

## Time interpretation

The local labels are 6:04 through 6:42 in the evening on May 31, 2013. The NWS narrative explicitly distinguishes CST from CDT: genesis at 5:03 PM CST is 6:03 PM CDT. Oklahoma observed CDT, UTC−05:00, so the published center points become **23:04–23:42 UTC**. The conversion uses `America/Chicago`, not a fixed assumption about the machine's timezone.

There is an unresolved discrepancy within the NWS page: the narrative gives dissipation at 6:42 PM CDT, while its tornado table gives an end at 6:44 PM CDT. The KMZ stops at 6:42. This reconstruction preserves that discrepancy; it does not extrapolate the center into those final two minutes or backward to genesis.

`GPS.json` contains timestamp strings ending in `Z`, which designate UTC. The user remembers a camera export but cannot yet verify the camera clock. Temporal overlap with the storm is plausible but does **not** calibrate the clock. Keep UTC as a provisional interpretation and preserve the original records. A synchronized video, known time reference, or matching historical Spotter Network reports could later constrain clock offset.

## What the map can measure

**Estimated center distance:** A same-time distance between a camera or other vehicle position and the NWS estimated tornado center. Between NWS minute marks the display may interpolate linearly for smooth playback, only between consecutive published points; interpolated locations must be labeled as such. This interpolation can simplify turns and the loop. The full center-path LineString does not assign times to its additional vertices and must not be converted into timed observations by evenly spacing times along it.

**Distance to the surveyed swath:** A purely geographic distance to the full-event polygon. Being within this polygon at a different time does not establish contact with the tornado. A zero distance means the location falls inside the eventual mapped area, not zero contemporaneous tornado separation.

**Tornado edge or subvortex separation:** Not supplied by these layers. The outline accumulates the event's footprint and is not an instantaneous boundary. A centerpoint has no documented radius. The official source also describes damaging winds outside the mapped tornado. Do not convert maximum width into a fixed buffer and call it the tornado edge, and do not assume the circulation center tracks every subvortex.

## Uncertainty

The NWS KMZ does not provide a quantified location error or time confidence interval. Accordingly, `uncertaintyMeters` is `null`, meaning **unquantified**, never zero. Source coordinates have many decimal places, which reflect storage precision rather than demonstrated accuracy. The data do not support a newly invented confidence radius.

Any closest-approach result additionally depends on vehicle sampling, interpolation, gaps, and camera clock offset. Report it as an estimate relative to the NWS center, keep sensible distance precision, and show the time/position source. Do not describe an exact closest approach to the tornado's edge or a guarantee of safety. Independent video calibration can improve the reconstruction in a later phase.
