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
