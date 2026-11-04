# Independent analysis validation

The current comparison uses **inferred road positions**, not straight lines between camera fixes. It was reviewed against the original camera observations, the bundled OpenStreetMap road network, and the directly extracted NWS center estimates on November 4, 2026. It remains conditional on the camera timestamps being UTC and the camera clock being correct. Neither condition has been independently calibrated from a video or separate recording.

Run `node scripts/validate_analysis.mjs` to reproduce the current calculation. Run `npm test` for source and playback checks, and `python3 -m unittest discover -s tests -p 'test_road_graph.py'` for independent road-topology checks. Extra digits printed by the audit are computational values for reproducibility; the map should display tenths of a mile and identify the result as provisional.

## Current provisional result

| Comparison | Approximate center separation | Approximate local time |
| --- | --- | --- |
| Inferred road position compared with the estimated NWS center | **1.2 miles** | **6:10 PM CDT** |
| Original camera fixes only, without adjusting their coordinates, compared with interpolated NWS centers | **1.3 miles** | **6:11 PM CDT** |

The current road calculation selects `2013-05-31T23:10:16Z`, with an audit value of **1.239205 miles**. Its vehicle position follows the inferred road between the `23:08:59Z` and `23:10:41Z` camera observations, a 102-second interval. Its NWS position is interpolated between the published `23:10:00Z` and `23:11:00Z` estimated centers. The interval-average vehicle speed implied by that route is approximately **30.2 mph**; this is not a measured instantaneous speed at closest approach.

The separate minimum using only unadjusted camera fixes is **1.265464 miles** at `2013-05-31T23:10:41Z`. That calculation uses the original `GPS.json` coordinates. It does not use snapped coordinates or add vehicle positions between source observations. It still interpolates the NWS center to the camera observation time.

Both calculations measure simultaneous estimated **center** separation. Neither measures distance to the tornado's instantaneous edge or an individual subvortex. The full-event polygon cannot supply those measurements. A point at the calculated minimum time is an inferred position, not an additional GPS observation.

## Camera clock sensitivity

These scenarios use the same inferred-road method as the current map.

| Added correction to camera timestamps | Approximate minimum center separation | Audit time (UTC) |
| --- | --- | --- |
| −2 minutes | 2.1 miles | 23:09:20 |
| −1 minute | **1.7 miles** | 23:09:48 |
| 0 minutes | **1.2 miles** | 23:10:16 |
| +1 minute | **0.8 miles** | 23:10:43 |
| +2 minutes | 0.4 miles | 23:10:39 |

The reproducible −1, 0, and +1 minute values are 1.656735, 1.239205, and 0.837658 miles. These are illustrative scenarios, **not confidence limits** and not a reason to select a clock correction. Positive corrections move the camera observations later exactly once while leaving radar and NWS timestamps unchanged. A known external clock reference is needed to justify any correction.

## Road evidence and limits

The route manifest contains all **34 tracks and 999 original positions**: the user's 86 camera fixes plus 913 positions from 33 survey-camera tracks. Original times and coordinates survive in `time`, `originalLat`, and `originalLon`; the source file hashes are recorded in the manifest and checked by the tests.

Every position has a candidate road projection in the current bundle. The largest adjustment is approximately **60.15 m**, within the 75 m search limit. A successful snap establishes only proximity to a mapped road. It does not prove that the source position is accurate, that the vehicle was on that road, or that the road was open in 2013. Exact source-time markers use the adjusted road position when matched, so those markers must also be labeled as road-adjusted. The original observations remain available separately.

Of 965 consecutive source intervals, the current preparation accepts **582 routed intervals and 347 stationary intervals**. It leaves **34 long gaps, one flagged interval, and one unmatched interval** unavailable for interpolation. Accepted interval-average speeds remain below the 110 mph plausibility ceiling; the largest is approximately 98.59 mph. The ceiling is a rejection rule, not an assertion that those speeds were recorded.

The road graph connects shared OSM node identifiers and follows the direction and access rules handled by the preparation script. Geometric crossings without a shared node do not create an intersection. Candidate positions split existing road edges; no straight connector is inserted across a field. The independent geometry test verifies that every adjacent pair of vertices in every accepted route lies on an eligible original OSM road segment. Additional tests cover one-way travel, turn restrictions, barriers, snapping limits, and preservation of road corners.

The source is a **present-day** road network. The route between two observations is an inferred connected route with constant distance progress over the interval; neither the actual route choice nor changes in speed within the interval are observed. Complex restrictions are treated conservatively where supported. Incoming travel direction is not carried across the boundary between independently routed source intervals, so a source point exactly on a restricted intersection can leave the turn across that observation unresolved. These data cannot certify historical road availability or legal driving paths.

## Source consistency and integration requirements

- All 86 camera fixes survive. Four camera gaps exceed five minutes; playback must not bridge them. None crosses the provisional closest-approach interval.
- The NWS record has 39 centers, one every minute from `23:04` through `23:42` UTC. The maximum center-interpolation gap is 60 seconds. Both the road calculation and original-fix comparison enforce it.
- Road playback never extrapolates before the first or after the last source observation. Rejected, flagged, and excessive-gap intervals remain unavailable even after a camera clock correction; trails remain separated across them.
- The Hannon survey track retains its explicit unresolved interval from `23:16:41Z` to `23:17:00Z`. Its original endpoints survive, but interpolation inside the 19-second interval is suppressed despite its short duration.
- An NWS helper's `status: recorded` means a published source coordinate, not a precise instrument measurement. Labels should identify a published NWS estimate. `uncertaintyMeters: null` means unquantified uncertainty and must never become ±0 or a zero-radius confidence ring.
- Survey camera positions are not Spotter Network transmissions. Respect each track's interpolation limit and flagged intervals. Camera viewing azimuth is not vehicle heading.
- The one-second minimum search also includes exact source observation times and the final comparison endpoint. The additional numerical resolution does not improve the accuracy of the original camera clock, road inference, or NWS center estimates.

The current audit and evidence tests call `closestRoadApproach`. Earlier straight-line-between-fixes results have been superseded for the map's current estimate. The generic straight-line helper remains separately tested for legacy uses; it is not the current road-based validation.
