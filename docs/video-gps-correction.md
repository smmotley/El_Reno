# Video stop reconstruction

This optional reconstruction adds the user's reported 52-second vehicle stop to our SUV's inferred road motion. The original `GPS.json`, road-route data, and original playback remain available unchanged. This is approximate user video evidence, not an independently calibrated camera clock or a new GPS observation.

## Timing and location supplied by the user

- Clip: `2013-05-31 12_03_51 (id).mov` (player ID `hdv-120351`).
- Requested synchronized clip start: May 31, 2013, **6:02:40 PM CDT**, or `23:02:40Z`.
- Stop begins **about 16 seconds** into that clip and lasts **52 seconds**.
- Reconstructed stop: **6:02:56–6:03:48 PM CDT**, or `23:02:56–23:03:48Z`; clip elapsed times 0:16–1:08.
- Revised approximate pin: **35°26′55.8″N 98°04′31.4″W**, or **35.44883333, −98.07538889**.

The first pin, **35.448966, −98.066550**, is retained in the configuration's `supersededLocationCandidates` as an inactive reference. The revised pin is about 801 m farther west. It is closer to the 6:02:59 PM camera fix (about 212 m versus 609 m), and baseline inferred road playback passes its longitude at about **6:02:46 PM**, approximately ten seconds before the requested stop begins. The first candidate's inferred passage was about 6:04:11 PM. These comparisons favor the revised candidate, but sparse GPS fixes and an unverified camera clock cannot establish the exact stopping place.

The vehicle remains stationary while the clip and map clock advance continuously. The correction module does not pause video, alter radar acquisition times, change other chasers, or add 52 seconds to later observations. The existing optional camera-clock setting is separate: it is applied once by the normal road-playback helpers after this baseline reconstruction.

## Reconciling the conflicting camera fix

The source camera export contains a fix at `23:02:59Z`, three seconds after the requested stop starts, at **35.449565, −98.07323**. That is about 212 m from the revised stop pin. The original road-matched version is about 195 m east of the displayed stopping point. Keeping that fix in corrected playback at its original time would cause a jump during the reported stop.

The correction therefore supersedes this one interior fix in the reconstructed track only. It remains in `GPS.json`, the original track, and the returned `chaseCorrections.applied[0].supersededObservations` audit metadata. The helper verifies that this exact source time is the only interior observation; a changed source dataset requires a new review rather than silently dropping additional fixes.

The bounded edit reconnects to unchanged source fixes at **22:59:52Z** and **23:05:02Z**. Every fix and road interval outside those bounds retains its original time and position. No later camera timestamp is shifted.

## Road geometry and inferred movement

The revised stop pin is approximately **78.0 m south** of the existing inferred road. To preserve connected road motion, the displayed stop is the nearest point on that polyline: approximately **35.44953506, −98.07538639**. This displacement is an explicit display choice; it does not establish the actual lane, shoulder, or stopping position. Following review of the measured 78.03 m displacement, this correction's maximum road snap was explicitly changed from 75 m to **80 m**. Other road matches and their limits are unchanged. The reviewed road location and snap distance are retained in the configuration and checked against the generated result by the real-data test.

The existing road geometry between the bounding fixes is split at the stopping point. The three replacement intervals are:

| Baseline UTC interval | Reconstruction | Inferred distance / average speed |
| --- | --- | --- |
| 22:59:52–23:02:56 | Approach along the existing road | About 2,598 m / 31.6 mph |
| 23:02:56–23:03:48 | Stationary at the road anchor | 52 seconds / 0 mph |
| 23:03:48–23:05:02 | Departure along the remaining road | About 1,233 m / 37.3 mph |

These moving speeds are interval averages used for interpolation, not measurements or a reconstruction of acceleration. The source road shape, turns, and bounding coordinates are preserved. Missing or flagged source intervals cannot be bridged. Reconstructed movement above 110 mph is rejected, as are discontinuous roads, changed observations, overlapping correction windows, and repeated application to a corrected track.

## Implementation and labels

`data/chase-corrections.json` records the user's timing, revised candidate coordinate, bounded window, superseded source time, and limitations. `applyChaseCorrections(originalPreparedTrack, config, { enabled })` in `js/chase-corrections.js` produces a prepared track accepted by `roadPositionAt`, `roadSegmentsUntil`, and `closestRoadApproach`. Its audit metadata retains the inactive first candidate and the reviewed 80 m snap limit.

Always call this helper with the saved original track when toggling modes. The helper does not mutate its input or the configuration. Corrected intervals and synthetic stop endpoints carry `reconstruction: true`, `approximate: true`, and `evidence: 'user-video-reconstruction'`. The synthetic endpoints also carry `recordedObservation: false`. Between endpoints, inspect `car.interval.reconstruction`; at a synthetic endpoint, `car.reconstruction` is also available. A reconstructed interval's duration must not be labeled as time between recorded GPS fixes.

The default-on **Video stop reconstruction** toggle should clearly distinguish this approximation from original GPS playback. A separate video-start adjustment belongs to the clip's own synchronization metadata and is not a global shift of the camera GPS or storm chronology.

## Validation

The focused tests use a route with a right-angle turn and the real chase data. They verify the full 52-second dwell, continuity on both sides, unchanged outside fixes and intervals, source immutability, road-only trails, one-time clock-offset application, no extrapolation, preservation of the conflicting observation in audit metadata, and rejection of unsupported edits.

For the nominal zero-offset camera interpretation, this early bounded correction leaves the existing provisional closest-center result unchanged: **about 1.2 miles around 6:10 PM CDT**. This is still separation from the estimated NWS center, not the tornado edge or damaging winds, and the camera's absolute clock remains unverified.

Reproduce the focused checks with `node --test tests/chase-corrections.test.mjs`.
