# AIR three-dimensional reflectivity

This dataset converts the original **45 elevation files in each of 99 AIR time groups** into compact three-dimensional reflectivity volumes. The native elevation angles run from **−2° through 20° in 0.5° steps**. Every input is an actual University of Oklahoma archive member, checked against its original ZIP CRC before use. AIR receives its elevation beams simultaneously while scanning in azimuth; the 45 elevation files are not 45 successive times.

The final dataset is complete only when `manifest.json` reports `frameCount: 99` and `completeRequestedSubset: true`. During preparation, the manifest contains only completed, verified volumes. The first, middle and last groups are prepared first for preview; missing intermediate volumes are not fabricated or filled with a future frame.

## Interpretation and limitations

These are radar reflectivity measurements, **not a solid cloud surface, tornado boundary, or wind-speed field**. A display threshold selects a reflectivity value; it does not identify the physical edge of a cloud or tornado. No AIR velocity is included because published instrument limitations leave the 2013 archive's velocity unvalidated.

The source's geographic registration, absolute clock accuracy and reflectivity calibration remain unverified. The same archived radar position and unmodified coverage times used by the two-dimensional AIR preview are preserved here. An apparent first-frame disagreement with the surveyed tornado track remains unresolved. No location, bearing, range or time adjustment was fitted to make the data match a track.

The source group intervals span **23:11:56–23:24:57 UTC on May 31, 2013**. Every source per-ray time is zero with malformed units. Each frame therefore preserves its original interval and uses the interval midpoint as a representative display time. This is not a recovered per-ray timestamp, and the interval duration is not a bound on absolute clock error. The 99 time groups and sampled siblings were independently audited in `docs/air-time-audit.md` and `docs/air-time-audit-data.json`.

## Grid contract

`manifest.volume` specifies a regular grid with dimensions **[192, 160, 96]** in **[x, y, z]** order. The corresponding array shape is **[96, 160, 192]**. Each gzip file expands to exactly **2,949,120 bytes**, with **x changing fastest**, then y, then z.

| Axis | Cell-edge bounds | Meaning | Cell spacing |
| --- | --- | --- | --- |
| x | −45,000 to +23,000 m | East of the recorded radar location | 354.1667 m |
| y | 0 to 45,000 m | North of the recorded radar location | 281.25 m |
| z | 0 to 16,000 m | Altitude above mean sea level | 166.6667 m |

Samples lie at **cell centers**, not the edges: `minimum + (index + 0.5) × spacing`. Horizontal coordinates use a radar-centered spherical azimuthal equidistant surface plane. The origin is the recorded AIR latitude/longitude, approximately 35.312099° N, 97.744598° W. The radar's recorded altitude is 385 m MSL. The z axis is absolute MSL altitude, not height above the radar or terrain. There is no vertical exaggeration. The z=0 floor is a reference plane; **no terrain model is present**.

The data type is unsigned 8-bit integer:

- `0`: missing or outside valid native coverage.
- `1` through `255`: `dBZ = (code − 1) × 0.5 − 32`.

Thus code 1 is −32 dBZ, code 65 is 0 dBZ, and code 255 is 95 dBZ. Values are rounded to the nearest 0.5 dBZ. Any clipping outside −32 to 95 dBZ is counted explicitly in each volume's provenance. A real 0 dBZ measurement is not missing.

`frame.volumeURL` names its `.bin.gz` file. `sha256` verifies the compressed bytes; `uncompressedSha256` verifies the expanded grid. Frames also provide `time`, `scanStart`, `scanEnd`, `sourceVolumeNumber`, all 45 `sourceKeys`, and the corresponding `provenanceURL`.

## Geometry and source sampling

For each voxel center, the converter computes horizontal surface arc distance `s = hypot(x, y)` and true bearing `atan2(x, y)`. With effective Earth radius `R = 4/3 × 6,371,000 m`, altitude `z`, and recorded radar altitude `H`, the inverse beam calculation is:

```text
horizontal = (R + z) × sin(s / R)
vertical   = (R + z) × cos(s / R) − (R + H)
slantRange = hypot(horizontal, vertical)
elevation  = atan2(vertical, horizontal)
```

The converter chooses the nearest native elevation, azimuth and range gate. The actual native range vector is 30–44,880 m in 30 m steps; it takes precedence over a contradictory first-gate attribute. Samples outside the observed sector, valid range, or half-sample support at the elevation edges are missing. Native fill values remain missing. The missing azimuth sector is not bridged, and no smoothing or invented intermediate scan is applied.

All 45 source elevations are processed. The Cartesian box crops measurements below 0 m MSL, above 16 km MSL, or outside the stated horizontal bounds. It does not preserve every original polar gate. Cartesian sampling is a display choice and must not be presented as independent spatial resolution. The publication lists 45 m independent range resolution for 2013 and approximately 1° receive beams; 30 m source range sampling, 0.5° elevation sampling, and display voxel spacing are different quantities.

## Reproduction and storage

Use the same NumPy, SciPy and Pillow environment specified by `requirements-air.txt`:

```sh
python3 scripts/prepare_air_volume.py --workers 8
```

The converter reads contiguous source-volume spans using bounded HTTP ranges of at most 8 MiB. Eight shared download workers overlap the current and next volume. Each of the 45 local filenames, expanded lengths, CRC32 values, volume/sweep numbers, elevations, coordinates and coverage aliases is verified independently after transfer. It never saves the full 7 GB archive. Complete raw groups are held in memory and discarded after conversion.

Existing verified 0.5° and timing-audit caches are retained, along with the first volume's remaining compressed members in ignored `.cache/air-volume/v001/`. These permit an independent first-volume validation without another archive download. The source data for later full volumes are not retained. Per-source SHA-256 hashes, archive offsets, source scales/units, coverage intervals and verification results remain in `records/volume-NNN.json` and the combined `provenance.json`.

Completed volume records are atomic checkpoints. Restarting the command reuses files only after verifying their recorded compressed hash. `--volumes 1,50,99` requests a partial preview. `--offline` requires the necessary retained source caches for any output that has not already been generated; it cannot reconstruct uncached later raw volumes. First-volume sampling can be checked with `python3 scripts/validate_air_volume.py`; see `docs/air-volume-validation.md` for independent review results.

## Sources

Atmospheric Imaging Radar data are provided by the **Advanced Radar Research Center, University of Oklahoma**. This is a derived research and educational visualization.

- [OU ARRC archive and data policy](https://arrc.ou.edu/data.html)
- [Original May 31, 2013 CF/Radial archive](https://arrc.ou.edu/data/20130531_AIR_CFRadial.zip)
- [Kurdzo et al. (2017), AIR observations and system description](https://doi.org/10.1175/BAMS-D-15-00266.1), with [public NOAA copy](https://repository.library.noaa.gov/view/noaa/67666/noaa_67666_DS1.pdf)
- [A Decade of Tornado Observations with an Imaging Radar, primary archive overview](https://par.nsf.gov/servlets/purl/10325864)
