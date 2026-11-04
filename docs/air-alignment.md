# Approximate AIR display alignment

On 2026-11-04 the user requested a constant horizontal shift of AIR to align the feature marked in their first 6:12 PM CDT scan with the corresponding NWS minute center. This optional display adjustment is enabled by default. The **Approx. NWS alignment** checkbox under the AIR source description restores original archive placement when unchecked and remembers the choice locally.

This is an approximate visual fit, not a verified correction to radar deployment coordinates, azimuth calibration, or the clock. The feature's identity and surface relationship remain unverified. In particular, low-level blockage below 2° is documented for this deployment in [Kurdzo's dissertation](https://shareok.org/items/539e005a-7c39-4572-94a4-21bb3f74d7f8), printed pages 239–241. The earlier [timing and origin audit](air-time-audit.md) describes the original-coordinate data, whose files remain unchanged.

## Geographic anchors

| Anchor at 23:12:00 UTC / 6:12:00 PM CDT | Latitude | Longitude |
| --- | ---: | ---: |
| Center of the user's red disk in the original AIR placement | 35.44392162014116 | −98.09445593991626 |
| NWS minute center, directly from the archived survey | 35.4529158454014 | −98.02114760158207 |

The screenshot was fitted as a north-up Web Mercator map using road-interpolated positions for Ben Holcomb, Brandon Sullivan and Skip Talbot. Those three anchors fit within 0.26 screenshot pixels (RMS 0.194). Held-out NWS and SUV markers agree within 0.62 and 0.84 pixels. Scale is approximately 11.7 ground meters per pixel. The red disk spans approximately a 350 m radius; this describes the user's marking, **not a statistical confidence interval or verified accuracy bound**. Coordinate digits preserve reproducibility, not measurement accuracy.

Full marker coordinates, fitting coefficients, residuals and screenshot hash are in [air-alignment-fit.json](air-alignment-fit.json). The application uses the geographic anchor pair in [air-alignment.json](../data/air-alignment.json), not manually entered offsets for individual frames.

## Display transforms

- **2D:** add 8,160.646894 m east and 1,229.052181 m north in Web Mercator. These are projection meters, not ground distances. The image remains the same size in projected coordinates and is not resampled.
- **3D:** add 6.643673944 km east and 0.979104453 km north in the existing spherical azimuthal-equidistant plane centered on the recorded AIR site. Heights are unchanged. The source grid and texture values remain intact; the volume bounding box and extent labels move.
- The reported shift is approximately **6.64 km east and 0.98 km north** (4.13 and 0.61 miles). Both projections place the chosen source anchor exactly at the target. Their translation approximations differ by up to about **50 m** across the full display domain (independent dense-grid check: maximum 46.9 m).

The same shift applies to every AIR frame and elevation; there is no time-dependent fitting, rotation, scaling or timestamp correction. KTLX, roads, terrain, NWS positions, vehicles and separation estimates remain unchanged. Toggling in 3D preserves the camera position so the radar moves against a fixed ground reference. Reset view may deliberately reframe the adjusted radar volume. The AIR archive-site marker remains at the stored coordinates and its popup explicitly distinguishes that marker from shifted imagery.

## Verification

Automated tests check exact geographic anchor agreement, source immutability, fixed image scale, all 99 image frames, original placement restoration, and KTLX bypass. Renderer tests verify the shader bounds and voxel coordinates, stationary camera and SUV focus, fixed terrain/roads/chasers, and repeated toggle restoration without accumulation. Live browser checks cover the 2D and 3D controls, unchanged clock, persistence, and compact layout.
