# Local roads and inferred vehicle movement

The map bundles real OpenStreetMap road geometry so its default road context does not depend on external map tiles. Vehicle movement between supported observations follows connected road segments, including turns. These paths are **inferred**, not an independently recorded driving history.

## Evidence and road vintage

The original `GPS.json` and `data/spotters.json` observations are unchanged. The route package retains each source timestamp and coordinate as `time`, `originalLat` and `originalLon`. `lat` and `lon` are a projection onto a nearby eligible road only when `roadMatched` is true. Survey locations are camera observations; camera azimuth is never used as a vehicle heading.

The source checksum for `data/spotters.json` was updated after unavailable survey video URLs were removed and availability notes were added. An exact comparison with the preceding Git version confirmed that every other field was identical, including all 33 identities, 913 observations, source times, interpolation limits, and flagged intervals. The route geometry was not regenerated or changed. `metadataOnlySourceUpdates` in the route package records the previous/current file hashes, comparison revision, changed fields, and canonical hashes of the unchanged non-media source and route content. The source-file integrity test still checks the full current file hash.

Roads come from the public [OpenStreetMap map API](https://wiki.openstreetmap.org/wiki/API_v0.6#Retrieving_map_data_by_bounding_box:_GET_/api/0.6/map), with source node IDs, way IDs and tags retained during processing. The bounded region is 35.16–35.66°N, 98.35–97.65°W. API requests are sequential and subdivided when an area exceeds the 50,000-node response limit. Only vector data is retrieved; no map tiles are bulk-downloaded. Individual request URLs, byte sizes and SHA-256 hashes are recorded in both output files. The retained combined extract hash and observation-file hashes are also recorded.

This is the **present-day OSM network**, not a reconstruction of road existence, access, closure, damage, congestion or driving direction during the tornado on May 31, 2013. Current one-way/access tags can differ from 2013. Locations outside the bundled region have no guaranteed road coverage. OSM's source-node connections are used; roads that merely cross on the map are not automatically joined.

The road database and its derived geometry are © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Preserve attribution and the applicable database license when redistributing it. The observations retain their separate provenance.

## Matching and routing

1. Each source fix is projected onto nearby road **edges**, rather than moved to the nearest intersection. Candidates farther than 75 meters are rejected. Up to four nearest candidate projections are considered, including candidates on separate carriageways.
2. The graph is split at those edge projections while retaining real OSM connectivity. Direction follows explicit motorcar/motor-vehicle/ordinary one-way tags, including reverse one-way roads and motorway/roundabout defaults. Private or prohibited vehicle access is excluded. Ways whose conditional access or direction cannot be resolved are excluded. Applicable node barriers and vehicle access prohibitions block passage; a barrier with explicit vehicle permission can remain eligible.
3. Via-node turn restrictions are honored. Same-way U-turn restrictions distinguish reversing from continuing. Complex via-way restrictions conservatively block entry from their stated from-way into the via-way, rather than inventing a legal maneuver. Incomplete source restriction relations conservatively block passage through their via-node. Any such cases are listed in `summary.restrictionNotes`.
4. For each track, a consistent candidate projection is chosen at each observation. The sequence maximizes the number of feasible adjacent routes, then favors smaller snap displacements and shorter connected road distances. A route is a shortest eligible directed path between its selected projections. Equal or near-equal alternatives are not proof of actual driver choice.
5. No interval longer than 300 seconds for Shane's GPS or 120 seconds for survey observations is interpolated. Hannon's flagged 23:16:41–23:17:00 UTC source jump is always excluded. A route requiring an average speed over 110 mph is rejected. This ceiling rejects implausible reconstruction; it does not establish the safety or actual speed of an accepted route.
6. Off-road observations, disconnected roads, prohibited passages, excessive speeds and long gaps produce explicit unavailable intervals. There is no straight-line fallback and no connector drawn across a field from the original point to its projection. Exact unmatched observations can still be shown at their original coordinates.
7. Playback covers accepted geometry at a constant distance rate between source times. Turns occur where the road turns. The vehicle's segment heading comes from route geometry, and its displayed average speed is inferred from interval road distance and elapsed time. Stops, acceleration, slowing at turns, detours and exact turn times between observations remain unknown.

A close fit to a current road is a modeling assumption, not a quantified position-accuracy measurement. The 75-meter matching ceiling is not an uncertainty radius. Any distance-to-tornado result using these positions remains sensitive to the chosen road, observation timing and estimated tornado center.

## Output contract

`data/roads.geojson` contains road LineStrings with `kind: "road"`, source OSM way ID, highway class and available name/ref/access tags. Named place Points use `kind: "place"`, `name` and `place`. Rendering roads does not imply they are eligible for routing; `routingEligible` reports that distinction.

`data/road-routes.json` uses `schemaVersion: 1` and a `tracks` object keyed by the original survey IDs plus `smotley`. Every original point and every consecutive source bracket is represented. Tracks contain their interpolation limit, retained break intervals, source/snapped points, and intervals:

- `routed`: connected eligible road geometry with positive movement.
- `stationary`: zero movement at one road position, represented by two equal coordinates.
- `gap`: source timestamps exceed the track's maximum interpolation interval.
- `flagged`: a source warning explicitly prevents interpolation.
- `unmatched`: no acceptable road projection or route within the speed ceiling.

Accepted intervals include `[longitude, latitude]` coordinates, cumulative geodesic meters, distance and inferred average mph. Unavailable intervals have empty geometry and a reason. Route endpoints exactly equal their selected point projections. Application playback independently recomputes lengths and rejects unsupported statuses.

## Reproduction

Python 3's standard library and `curl` are sufficient:

```sh
python3 scripts/prepare_roads.py --download-map-api --input /private/tmp/el-reno-osm.json
```

The temporary XML cache supports resuming the bounded extraction. For a retained combined source extract, rerun without network access:

```sh
python3 scripts/prepare_roads.py --input /private/tmp/el-reno-osm.json
```

An optional `--download` uses the recorded equivalent Overpass query. During initial preparation, the main Overpass service returned HTTP 406 and the alternate global service timed out, so the successful source was the main OSM XML API. Live regeneration can change roads because OSM continues to be edited; hashes identify the exact prepared version.

See `docs/analysis-validation.md` for the final coverage counts and independently checked distance calculations. The route package's `summary` contains the machine-readable coverage and source restrictions.
