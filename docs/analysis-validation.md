# Independent analysis validation

The numeric comparison was reviewed against the bundled original camera observations and directly extracted NWS center points on November 4, 2026. It is conditional on the camera timestamps being UTC and the camera clock being correct. Neither condition has been independently calibrated from a video or separate recording.

Run `node scripts/validate_analysis.mjs` to reproduce the audit values. Run `npm test` to include the source-consistency checks in `tests/evidence.test.mjs`. Extra digits printed by the audit script are for reproducibility only; the public display should use tenths of a mile and call the result an estimate.

## Provisional result

| Comparison | Approximate center separation | Approximate local time |
| --- | --- | --- |
| One-second scan of interpolated camera and NWS positions | **1.2 miles** | **6:10 PM CDT** |
| Minimum using the original camera fixes only, with NWS center interpolation | **1.3 miles** | **6:11 PM CDT** |

For computational reproduction, the scan selects `2013-05-31T23:10:16Z`, while the nearest original fix is `2013-05-31T23:10:41Z`. The scan's camera position is interpolated between the `23:08:59Z` and `23:10:41Z` fixes, a 102-second interval. Its NWS position is interpolated between the published `23:10:00Z` and `23:11:00Z` estimated centers. The scan therefore does not establish that a GPS measurement was made at the displayed minimum time.

Both calculations measure simultaneous estimated **center** separation. Neither measures distance to the tornado's instantaneous edge or to an individual subvortex. The full-event polygon cannot supply either measurement.

## Camera clock sensitivity

| Added correction to camera timestamps | Approximate minimum center separation |
| --- | --- |
| −2 minutes | 2.1 miles |
| −1 minute | 1.6 miles |
| 0 minutes | 1.2 miles |
| +1 minute | 0.8 miles |
| +2 minutes | 0.4 miles |

These are illustrative scenarios, **not confidence limits** and not a reason to select a clock correction. The time correction changes when each camera fix is compared with the storm; it leaves radar and NWS timestamps unchanged. A positive correction moves the camera observations later. A known external clock reference is needed to justify any correction.

## Source consistency and integration requirements

- All 86 original camera fixes survive normalization. Four camera gaps exceed five minutes (22 minutes, about 61 minutes, about 107 minutes and about 91 minutes); playback must not bridge them. None crosses the provisional closest-approach interval.
- The NWS record has 39 timed centers, one every minute from `23:04` through `23:42` UTC. A 60-second maximum interpolation gap matches the source contract. A 120-second center limit currently produces the same result only because the bundled sequence has no missing minute; it would incorrectly bridge a missing future record.
- Exact timestamps may display an original source position; between observations the marker must identify interpolation. There is no extrapolation before the first or after the final source observation.
- The NWS center points are estimates even at their exact timestamps. A helper's `status: recorded` means a published source coordinate, not an instrument measurement with known accuracy. Popups should say “published NWS center” or equivalent.
- Source uncertainty is unquantified. `uncertaintyMeters: null` must never be rendered as ±0, a zero-radius confidence ring, or an exact measurement.
- The Hannon survey track has an explicit unresolved interval from `23:16:41Z` to `23:17:00Z`. The 19-second gap passes an ordinary duration limit but implies approximately 226 mph. Playback must suppress interpolation inside it and split the path there. Preserve its original endpoints without claiming those endpoints are validated.
- Other survey camera positions are not Spotter Network transmissions. Respect each track's `interpolationLimitSeconds` and `breakIntervals`. Camera viewing azimuth is not a vehicle heading.

The implementation review found the time-offset sign and single application of the offset correct. The one-second minimum search is adequate as a numerical estimate at the display precision above; coordinate and clock uncertainty dominate that search resolution.
