# AIR archive timing audit

Reviewed 4 November 2026. **No justified clock correction was found.** The archive contains 99 time volumes, each stored as 45 elevation files. Merging those files enables a three-dimensional view; it does not change the acquisition time or recover missing ray times.

## Native-file evidence

The independent audit in [air-time-audit-data.json](air-time-audit-data.json) parsed the original ZIP central directory and original NetCDF bytes, rather than relying on the rendered image manifest. It checked all 99 cached 0.5° files and seven additional elevation files from early, middle, and late volumes. Every checked member passed its original ZIP CRC. The additional retrieval used small byte ranges rather than another full archive download.

The directory contains **4,455 NetCDF members: 99 groups of 45**, with indices `s1` through `s45`. All 45 filenames in a group share one timestamp. Native `volume_number` agrees with `v1` through `v99`; native `sweep_number` agrees with `sN`, although its descriptive label incorrectly says zero-based. Sampled elevations are `s1 = −2°`, `s5 = 0°`, `s6 = 0.5°`, `s7 = 1°`, and `s45 = 20°`. Actual `s6` elevation is 0.5° in all 99 files.

In all **106 checked files**, the global coverage strings, duplicate character-array coverage strings, and global start/end aliases agree. The start agrees with the filename. Sampled sibling elevations also have identical azimuth arrays and identical coverage intervals. These are strong internal-consistency checks, but the repeated metadata may originate from the same acquisition or conversion clock.

| Quantity | Verified archive value |
| --- | --- |
| First coverage start | 2013-05-31 23:11:56 UTC / 6:11:56 PM CDT |
| Last coverage end | 2013-05-31 23:24:57 UTC / 6:24:57 PM CDT |
| Last filename timestamp | 23:24:51 UTC, the final volume's start |
| Acquisition intervals | 57 × 8 s; 37 × 7 s; 4 × 15 s; 1 × 6 s |
| Coverage continuity | Successive global intervals are contiguous |
| Representative display times | Coverage midpoints, 23:12:00–23:24:54 UTC |
| Individual ray time values | All zero in checked files; malformed time units |
| Applied time correction | 0 seconds |

The unrelated title `19700109` and ZIP filesystem dates in July 2018 are not observation times. The history/source/comment metadata supplies no conversion history establishing a correction. No alternative usable absolute time was found among the native variables.

## Acquisition method and file merging

[Kurdzo et al. (2017), pp. 917–918](https://doi.org/10.1175/BAMS-D-15-00266.1), explain that AIR acquires its elevation beams simultaneously and mechanically rotates in azimuth. [Bodine et al. (2022), pp. 1–2](https://par.nsf.gov/servlets/purl/10325864), describe simultaneous vertical imaging and typical 6–7-second sector volumes. Thus, 45 elevation files do not imply 45 successive scans. Azimuth still evolves during each sector; simultaneous elevations are not an instantaneous acquisition of the entire volume.

[NCAR's RadxConvert parameter example](https://github.com/NCAR/lrose-core/blob/master/codebase/apps/Radx/src/RadxConvert/RadxConvert.test) documents separate sweep-aggregation and optional time-offset controls. Combining same-volume elevation files is format preparation, not a clock correction. The existing 0.5° map can read one elevation directly. A 3D view groups the elevations by their shared volume identifier and coverage interval, without adding elapsed time between them.

The [Reddit post supplied by the user](https://www.reddit.com/r/weather/comments/1quesd7/3d_radar_scan_of_el_reno_record_breaking_tornado/) describes grouping the elevation files and converting them for GR2Analyst. That workflow is consistent with the archive organization; it does not supply an independent clock reference or establish a time offset. This application reads the reflectivity values directly into a browser volume, so an intermediate NEXRAD conversion is unnecessary.

The 2022 overview's section IV.D explicitly identifies the public **31 May 2013 El Reno moment-data archive** at the same [OU archive page](https://arrc.ou.edu/data.html) used here. The reviewed primary publications and archive description provide no verified event-specific time shift, corrected deployment coordinates, or alternative event origin.

## What remains uncertain

The checks establish faithful use of internally consistent source timestamps. They do **not** independently establish absolute clock accuracy. In particular, the duration of a scan is not a bound on clock error. The display midpoint is a representative time, not a reconstructed timestamp for each ray.

The apparent geographic disagreement discussed in [air-validation.md](air-validation.md) remains unresolved. It does not, by itself, identify a clock error, an incorrect radar position, or the correct surface tornado feature. No time shift or spatial adjustment has been fitted to force agreement. Both the 2D and 3D previews must retain the unverified-alignment qualification and must not supply precise tornado locations or chase-distance estimates.

## Follow-up: proposed 10–12-minute shift

A fresh byte-level check on 4 November 2026 independently decompressed all 45 first-volume members and checked them against the original ZIP CRC and length, without importing the production parser. All 45 share identical azimuth arrays and the same coverage interval, including all duplicated start/end fields:

| First-volume slice | Elevation | Native interval, CDT |
| --- | --- | --- |
| `v1_s1` | −2° | 6:11:56–6:12:04 PM |
| `v1_s6` | 0.5° | 6:11:56–6:12:04 PM |
| `v1_s45` | 20° | 6:11:56–6:12:04 PM |

The app's 6:12:00 PM label is the midpoint of that eight-second interval. Choosing its start or end would change the label by four seconds; it cannot explain a ten-minute disagreement. A further fresh read of all 99 low-tilt members again found no usable independent clock: ray times are zero, their units are malformed, pulse timing is missing, and history/source/comment fields are empty. The ZIP's July 2018 timestamps are file-processing metadata. These checks cannot rule out an acquisition-clock error that was copied into every file.

New primary evidence is available in [James Kurdzo's 2015 dissertation, §5.2.2.2, printed pp. 239–241](https://shareok.org/items/539e005a-7c39-4572-94a4-21bb3f74d7f8). The original pages were visually checked. The author describes 120° sectors with eight-second volume updates and more than 45 minutes of observations; the public archive used here is a roughly 13-minute subset. Figure 5.24 labels an El Reno volume **23:15:52 UTC**, matching native `v31`'s start exactly. That is an additional published label, not an independent calibration of the radar clock.

The same event-specific account reports **beam blockage at elevations below 2°** and a minimum usable beam height above 1.2 km. Figure 5.24 uses a **2° underlay**, not 0.5°. This is a material qualification missing from the earlier review: the existing 0.5° AIR preview lies below the reported usable elevations and is not a reliable surface-tornado location or clock reference. Comparing its apparent hook to WSR-88D or the ground survey can conflate time, beam blockage, sampling height, and geographic alignment. The elevated rotating updraft visible in a 3D reflectivity rendering is also not the surface tornado boundary.

A bounded comparison of the already rendered 0.5° images used three near-simultaneous AIR/KTLX pairs for each proposed shift, a fixed geographic region, and roughly 450 m smoothing. Mean reflectivity-pattern correlations were 0.2165 for −12 minutes, 0.2687 for −10 minutes, and 0.4356 for the archive time. These limited results do not favor the suggested earlier times, but cannot validate the clock: the AIR low beams are blocked, and sampling height, wavelength, attenuation, calibration and spatial registration differ. A separate first-volume 2° snapshot also had broad, nonunique matches against seven KTLX times. These diagnostics do not identify a tornado center or justify fitting either a time or coordinate correction.

At the app's 6:12:00 PM selection, KTLX reflectivity is its preceding sweep with midpoint **6:10:05.703 PM CDT**, approximately 114 seconds older. This cadence difference matters for comparison but does not explain ten minutes.

No clock or geographic correction has been applied. The start/end interpretation is resolved; absolute timing and registration remain unresolved. A stronger comparison must use documented usable AIR elevations, account for different sampling heights, and establish the radar origin/bearing against independent geographic evidence rather than choosing a shift from one image's appearance.
