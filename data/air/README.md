# AIR El Reno reflectivity archive

This package contains **99 actual 0.5° AIR reflectivity sweeps** from the University of Oklahoma Advanced Radar Research Center's May 31, 2013 archive. It is an exploratory historical overlay, with unresolved source-registration uncertainty. It does not supply a precise tornado center or a surface wind boundary.

## Products and limits

- Available: source `DBZ` reflectivity, displayed in dBZ. All 99 fixed-angle values and every selected ray elevation are exactly 0.5° in the archived files.
- **AIR velocity is withheld.** Kurdzo et al. (2017), p. 918 and Table 2, describe technical difficulties and do not present radial velocity before 2014. Although the subsequently published archive contains `VEL`, its correction and validation history are not established. No AIR velocity PNGs or eligible velocity frames are packaged. KTLX velocity is a separate radar product.
- The undisplayed archive `VEL` values also exceed the approximately 16.809 m/s Nyquist metadata. That metadata cannot establish a valid folding interval or dealiasing history. Source scales, fill values, extrema and Nyquist values remain in `provenance.json` for audit, in source m/s, without treating them as validated wind estimates.
- Geographic placement follows the source's latitude, longitude, true-north azimuth and range coordinates. Independent calculations confirm the conversion, but comparison of a first-frame circulation feature with the contemporaneous NWS track raises a several-kilometer discrepancy. Its cause, including feature identification and source metadata, remains unresolved. **No arbitrary location, azimuth or time correction has been applied. Do not use this overlay for a precise chase-distance estimate.**
- Source calibration and quality-control history are limited. No new clutter filtering, attenuation correction, reflectivity calibration, smoothing or motion correction is applied.

## Time and coverage

The 99 source volumes cover **23:11:56–23:24:57 UTC on May 31, 2013**, equivalent to **6:11:56–6:24:57 p.m. CDT**. The first representative frame time is 23:12:00 UTC and the last is 23:24:54 UTC, mostly 7–8 seconds apart.

Every source ray-time array contains zero, and its units are malformed. The valid global `time_coverage_start` and `time_coverage_end` attributes therefore provide each frame's full acquisition interval. The displayed timestamp is their midpoint, not a verified instant for an individual ray. Filenames independently agree with the global start times. No ray timestamps are invented.

The application selects only an eligible midpoint at or before the chosen playback time, limits age to 25 seconds, and suppresses this dataset outside its explicit coverage. It cannot display AIR data for the earlier closest-approach estimate. Reflectivity coverage ends at the last source interval, with no extrapolation beyond it.

## Geometry, sampling and color

Images have 1,200 × 921 pixels in Web Mercator, covering bounds `[[35.20, -98.30], [35.70, -97.50]]`. This is approximately 60 m ground pixel spacing near the center of the image. The native range coordinates run from 30 to 44,880 m in 30 m steps. They take precedence over the contradictory `meters_to_center_of_first_gate=15` attribute. The publication lists **45 m independent range resolution** for 2013; sample spacing and raster spacing do not establish independent resolution. Angular beam width further limits spatial detail with distance.

The converter calculates spherical surface distance and true bearing from each pixel to the recorded radar location, then inverts the standard 4/3-Earth beam model including recorded radar altitude. It samples the nearest native ray and gate. An explicit azimuth-sector and range mask leaves missing coverage transparent, with no wraparound interpolation across the unobserved sector. Native missing or fill values remain transparent. The recorded site is approximately 35.312099° N, 97.744598° W, altitude 385 m; its real-world registration is unverified as described above.

Source signed-integer values are decoded using each file's scale, offset and fill value; `DBZ` uses scale 0.01, offset 0 and fill −32768. Lossless indexed PNGs use the same step palette as KTLX. Each value takes the color at the greatest threshold not exceeding it; values outside the scale use its first/last colors. There is no synthetic reflectivity outside the native data coverage.

| dBZ threshold | Color | dBZ threshold | Color |
| ---: | --- | ---: | --- |
| −10 | `#526782` | 40 | `#e6c700` |
| 0 | `#00c5e8` | 45 | `#ff9500` |
| 5 | `#0094ed` | 50 | `#ff342a` |
| 10 | `#0063c7` | 55 | `#dc0022` |
| 15 | `#0033a6` | 60 | `#a80020` |
| 20 | `#00eb35` | 65 | `#f000ec` |
| 25 | `#00c229` | 70 | `#a900df` |
| 30 | `#008a22` | 75 | `#e6c4ff` |
| 35 | `#f6f500` | 80 | `#ffffff` |

## Reproduction and integrity

From the project root, install the small dependency set in an isolated environment if needed, then run:

```sh
python3 -m venv .venv-air
.venv-air/bin/pip install -r requirements-air.txt
.venv-air/bin/python scripts/prepare_air.py
```

Only the 99 `_s6.nc` members are retrieved, and their actual elevations are verified rather than assumed from the suffix. The script uses HTTP byte ranges and rejects a server response that attempts to return the whole archive. It retrieves about 148.46 MiB of compressed sweep payloads, rather than the complete 7 GB ZIP. The selected compressed members are retained in ignored `.cache/air/`; expanded NetCDF sweeps are processed in memory. Rebuild entirely from those caches with `python3 scripts/prepare_air.py --offline`.

The source archive has wrapped classic 32-bit ZIP offsets despite its greater-than-4-GiB size. Physical member offsets are reconstructed in archive order. Each selected local filename, compressed and expanded size, and expanded CRC32 is verified. SHA-256 hashes of compressed members, expanded NetCDF contents and final PNGs are recorded. Every one of the 99 records must pass verification before the final manifest is written. `--limit` is a development option whose manifest explicitly marks the result incomplete.

`manifest.json` is the application contract: reflectivity file/time/elevation, geographic bounds, explicit acquisition intervals, color scale, unavailable-product reasons and quality notes. `provenance.json` preserves source byte ranges, archive headers, directory metadata, per-file hashes, native coordinates, source decoding information and audit-only velocity metadata. See `docs/air-validation.md` for independent scientific and rendering checks.

## Sources and attribution

Atmospheric Imaging Radar data are provided by the **Advanced Radar Research Center, University of Oklahoma**. The official archive policy permits research, education and outreach and requests acknowledgement and relevant publication citations. This package is a derived visualization, not an independently validated radar research product.

- [OU ARRC curated radar archive and data policy](https://arrc.ou.edu/data.html)
- [Original May 31, 2013 AIR CF/Radial archive](https://arrc.ou.edu/data/20130531_AIR_CFRadial.zip)
- [Isom et al. (2013), The Atmospheric Imaging Radar: Simultaneous Volumetric Observations Using a Phased Array Weather Radar](https://doi.org/10.1175/JTECH-D-12-00063.1)
- [Kurdzo et al. (2017), Observations of Severe Local Storms and Tornadoes with the Atmospheric Imaging Radar](https://doi.org/10.1175/BAMS-D-15-00266.1), including [public NOAA copy](https://repository.library.noaa.gov/view/noaa/67666/noaa_67666_DS1.pdf), p. 918 and Table 2 for the 2013 velocity limitation.
