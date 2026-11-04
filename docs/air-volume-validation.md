# Independent AIR three-dimensional reflectivity review

Reviewed 4 November 2026. **All 99 published volumes pass the final integrity audit; independent native-data samples pass geometry, value, and missing-data checks.** The volume is a source-faithful reflectivity research preview. The original clock, geographic registration, and calibration remain unverified; this is not a precise surface tornado reconstruction.

## Reproducible native-data audit

Run `python3 scripts/validate_air_volume.py` to reproduce the final audit. The offline check uses retained original source bytes and writes [air-volume-audit-data.json](air-volume-audit-data.json). It does not import the production converter or issue any network requests. The final run completed at **22:25:44 UTC on 4 November 2026**, with `frameCount: 99` and `completeRequestedSubset: true`.

The initial review independently decompressed **all 45 elevation files in the first volume** and verified their lengths and CRCs against the original ZIP central directory. Actual elevations cover −2° through 20° at 0.5° spacing. Source site, azimuth/range coordinates, and coverage intervals agree across those files.

The independent sampler uses a triangle-law beam inversion, rather than the production converter's tangent-vector implementation. It maps Cartesian cell centers back to the nearest actual elevation, azimuth, and range coordinates. A deterministic random sample plus points on the grid boundaries checked **28,824 first-volume voxels**:

- **13,075 observed cells** agreed with original reflectivity to within the stated **0.25 dBZ** half-bin quantization error. Every one of the 45 elevations was exercised.
- **15,749 unobserved cells** remained missing, including cells beyond the measured sector/range or elevation support.
- No observed cell in the sample was incorrectly missing. Zero represented missing data independently of valid low reflectivity.

The audit also checks **422 locations in each of the other 98 volumes** against its previously cached original 0.5° file. This verifies that those output files use the appropriate native observation, without retrieving their other 44 elevation files again. Every published output's compressed and uncompressed hashes, byte count, nonmissing-cell count, source inventory, and recorded site passed.

The final independent audit covers **143 unique original files** and **70,180 sampled voxel locations**: **38,163 observed** and **32,017 missing**. All checks passed, with no source-value mismatch, no missing-sector failure, and a maximum quantization difference of **0.25 dBZ**. This is distinct from the production converter's CRC and metadata checks of **all 4,455 source files**; the independent reviewer did not download those files a second time.

All 99 source volume numbers occur once. The package contains **89,019,483 compressed bytes** (about **84.9 MiB**) and expands to 291,962,880 bytes. Recorded acquisition coverage is **23:11:56–23:24:57 UTC**; representative display midpoints are **23:12:00–23:24:54 UTC**. No extra time offset was applied.

## Geometry and value interpretation

The grid is **192 × 160 × 96 cells**, with x east, y north, and z height above mean sea level. Its domain is x −45 to +23 km, y 0 to 45 km, and z 0 to 16 km MSL, relative horizontally to the recorded AIR site. Horizontal distances are spherical surface distances. Beam placement uses the standard 4/3-Earth model and includes the recorded **385 m MSL** radar altitude.

Values are sampled at cell centers, approximately **354 × 281 × 167 m** apart. This is display sampling, not independent radar resolution: the source was sampled every 30 m in range, while the published 2013 independent range resolution was 45 m and the receive beams were approximately 1° wide. Beam footprints broaden with range. Nearest sampling adds no unobserved azimuths, elevations, or gap-filled values.

The file order is x fastest, then y, then z. Code zero is missing; positive codes decode to `(code − 1) × 0.5 − 32 dBZ`. The native packed fill value is masked before scaling. The converter records any clipping outside −32 to 95 dBZ; **none occurred in any of the 99 outputs**. Source values selected by the Cartesian grid span approximately **−26.65 to 70.02 dBZ** before half-dBZ encoding. That selected range is not the range of every original polar gate.

The radar cube omits source data below 0 m MSL and outside its finite box. Negative elevation measurements can contribute within the box; they should not be interpreted as terrain-aware near-ground coverage. The subsequently added DEM surface provides visual occlusion, described below. It is not a radar beam-blockage correction or additional clutter/attenuation filtering. When that surface is hidden, the 0 m MSL plane remains a geometric reference, **not terrain**.

## Renderer review

The reviewed WebGL renderer uploads the x-fastest data as an R8 3D texture with matching dimensions. It samples using nearest-neighbor filtering and checks code zero before decoding, so missing cells are not blended into apparent observations. Both camera and ray traversal use kilometers consistently on all axes; there is no vertical exaggeration. The height ruler explicitly refers to MSL.

The 30 dBZ initial display cutoff is adjustable. It selects reflectivity values for visualization; it is not a cloud, precipitation, or tornado boundary criterion. Opacity is a rendering control. Integration scales alpha by physical ray-step length using `1 − exp(−density × distance)`, avoiding a simple dependence on the number of ray samples. The shader stops within the grid and limits traversal to 768 samples per pixel. The renderer keeps at most three decoded arrays and one GPU volume, approximately 8.4 MiB and 2.8 MiB respectively for this grid, apart from other browser resources. It renders on interaction or data changes instead of continuously when stationary.

A review identified that literal screen-fixed arrows beside the east/north labels could become misleading after camera rotation. This was corrected to orientation-neutral east–west and north–south extent labels. Camera panning translates the eye and target together; it does not alter the data scale. The application owner checks live browser interaction, loading/error states, and visual legibility separately. The native-data audit is not a comprehensive browser-compatibility or device-performance test.

## Terrain and chaser annotations

The additional surface uses six original [Mapzen/AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) with source headers identifying SRTM and GMTED imagery. The tile metadata identifies contributing source datasets, not the exact source of every pixel. [Terrarium's documented RGB encoding](https://github.com/tilezen/joerd/blob/master/docs/formats.md) is decoded to meters and sampled into a **137 × 91 node grid at 500 m spacing**, using the same radar-centered spherical projection.

The independent offline check, `python3 scripts/validate_air_surface.py`, verifies all six original PNG hashes and **all 12,467 terrain nodes**, including **121 nodes using interpolation neighbors across tile seams**. It uses a separate 3D unit-vector inverse projection and original pixel values. Agreement is within **0.0005 m**, the expected rounding for 1 mm storage increments; that storage precision does not imply elevation accuracy. The actual JavaScript projection was checked at all nodes and its height interpolation at an additional **1,000 between-node points**. Outside-domain and missing positions were correctly rejected. Results are saved in [air-surface-audit-data.json](air-surface-audit-data.json).

Heights span approximately **311–510 m**. The DEM at the AIR origin is **379.367 m**, while the archived radar altitude remains **385 m**; no adjustment was made to either. Mapzen describes terrain relative to sea level, but a single precise vertical datum harmonized with AIR has not been established. The surface is contextual terrain from mixed source dates, **not a May 31, 2013 terrain reconstruction**, road-deck model, or measured chaser altitude.

The renderer uses real node triangles with the same metric camera. Its terrain depth reconstruction correctly converts perspective depth to distance along the viewing ray before ending the radar integration. This supplies visual occlusion only. The terrain mesh is piecewise planar, while marker heights use bilinear interpolation of the same nodes; those approximations can differ within a 500 m cell and do not provide precision clearance measurements. Neither changes the original radar data.

Chaser positions reuse the existing supported road-motion positions and inherit their gaps and clock assumptions. Checks at the first, middle, and last AIR midpoints produced respectively **17, 21, and 16 supported positions**, including our SUV; all lay within the terrain domain. The other **17, 13, and 18 tracks** were absent at those times instead of being held at stale locations. Roads and enlarged vehicle symbols are explicitly foreground annotations, and supported positions can be selected for their source/motion description. A marker-selection callback mismatch and overlapping-symbol paint priority were found during review and corrected. Live interaction and the final layout are verified separately by the application owner.

## Remaining limitations

This review confirms the transformation of the supplied radar data. It does not resolve the geographic disagreement discussed in [air-validation.md](air-validation.md), nor establish a clock correction beyond [air-time-audit.md](air-time-audit.md). No position, orientation, range, or time adjustment was fitted to make the volume align with the surveyed tornado.

The visible shape is a thresholded **reflectivity volume**, not a solid cloud surface, tornado funnel, near-ground wind field, or tornado edge. AIR velocity remains excluded because the pre-2014 instrument limitation has not been resolved by archive documentation. The preview must retain its alignment qualification and must not supply closest-approach measurements.

## Browser verification

The integrated viewer was checked in the local application at desktop (1440 × 1000) and narrow (390 × 844) sizes. The first, middle and final recorded volumes rendered without browser errors. Rotation, pan, zoom, reset, reflectivity cutoff, opacity, scan jumps, continuous playback, exact recording boundaries, and UTC/CDT labels were exercised. WSR-88D switching and comparison maps remained functional.

The added terrain and chaser view was checked with the surface toggle, radar hidden while terrain/markers remained visible, the SUV focus control, clickable SUV details, and distinct chaser colors. Markers reuse the tested 2D position functions and their supported time windows. The completed automated suite contains 66 passing checks, including every compressed/decompressed 3D file hash, the surface coordinate/interpolation contracts, and six camera/label regression tests.

The subsequent navigation update adds cardinal and north-up overhead views, screen-space panning, rotation/tilt buttons, a projected compass, and a shared 2 km minimum camera-to-target distance for buttons, wheel, keyboard and pinch. An independent review exercised 720 camera cases using the actual terrain: camera vectors remained finite and orthonormal, orientation agreed with the presets, and the camera stayed at least 50 m above the rendered terrain. These are viewing constraints only; no radar, terrain, chaser position or timestamp is changed.

Live browser checks covered 1440 × 1000, 536 × 724 and 390 × 844 layouts. Close zoom, presets, pan, reset, panel minimization/restoration, the compact layout, and 2D WSR-88D switching were exercised without console errors. Closing a chaser name leaves its marker selectable; selecting that marker or using Restore names restores the annotation. Panel visibility is saved separately for desktop and compact layouts, with at most one panel open on compact screens. The compass remains visible when the information panels are minimized.
