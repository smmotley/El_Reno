# Independent AIR review

Reviewed 4 November 2026 against `scripts/prepare_air.py`, the 99 cached source sweeps, and the generated map products. The review used existing downloads; it did not retrieve a second radar subset.

**Result:** the conversion faithfully renders the supplied coordinates and reflectivity values. AIR reflectivity is suitable as a clearly labeled **research preview with alignment unverified**. This review does not independently validate the archive's deployment location, bearing calibration, clock, or reflectivity calibration. AIR velocity is excluded because a primary source identifies a pre-2014 instrument limitation.

The final package was rechecked after that exclusion: **99 reflectivity PNGs and 99 provenance records**, with matching recorded PNG hashes, 1200 × 921 dimensions, and transparent palette index zero. There are no velocity PNGs or eligible velocity products. The manifest records `unverified-source-registration` and no applied coordinate correction; native velocity metadata remains only in the explicitly undisplayed audit records.

## Source and conversion checks

All **99** selected NetCDF files were independently decompressed and checked against their ZIP-directory CRC and expanded byte count. Every source sweep has:

- Exactly **0.5°** fixed elevation and 0.5° at every ray.
- **239 rays × 1,496 gates**, with actual range coordinates **30–44,880 m in 30 m steps**.
- Recorded site **35.3120994568° N, 97.7445983887° W, altitude 385 m**; this is constant across the subset.
- A north-crossing sector of approximately **−89.5° through +29.5°**, sampled at approximately 0.5° increments.
- Signed 16-bit packed `DBZ` and `VEL`, scale **0.01**, offset **0**, and fill value **−32768**. No fill-valued gates occur in these 99 source fields; this does not establish meteorological quality control.

The implementation correctly masks packed fill values before applying scale/offset, uses the actual range vector rather than the contradictory first-gate attribute of 15 m, and retains dBZ units. Source reflectivity spans **−26.27 to 86.79 dBZ** across the subset; these are archive values, not independently calibrated measurements.

Independent calculations used spherical haversine distance and bearing, inverse 4/3-Earth beam geometry including the recorded altitude, and Web Mercator pixel centers. **5,005 first-frame pixels** were checked against native source gates and color bins: **2,592 inside coverage and 2,413 outside coverage**, with zero differences. Both initially generated products were checked, giving **10,010 exact RGBA comparisons** before velocity was withdrawn. In particular, pixels beyond the observed sector/range were transparent; the missing azimuth sector was not filled.

Three off-axis forward/reverse checks further confirmed gate placement. For native zero-based ray/gate pairs 40/900, 100/800, and 180/600, independently calculated locations were respectively approximately (35.396985, −98.023851), (35.478768, −97.913306), and (35.474224, −97.742783). The nearest map pixels selected native pairs 40/900, 100/799, and 180/600. The one-gate difference is the expected consequence of rounding a native location to a coarser map pixel.

The roughly 60 m display pixels and 30 m gate spacing must not be called independent 30–60 m spatial resolution. The [AIR system paper](https://doi.org/10.1175/BAMS-D-15-00266.1), Table 2, lists **45 m native range resolution for the 2013 campaign** and approximately **1° receive beams**. The beam footprint broadens with distance. No extra smoothing, clutter removal, attenuation correction, or reflectivity recalibration was added.

## Time handling

Every source file has zero-valued ray times with malformed time units. Every filename agrees with the usable global coverage start. The full subset covers **23:11:56–23:24:57 UTC**, or **6:11:56–6:24:57 PM CDT**. The last volume filename is 23:24:51; that is its start, not the end of coverage.

The converter preserves each start/end interval and assigns its midpoint as a representative display time. Coverage durations are 8 seconds for 57 files, 7 seconds for 37, 15 seconds for four, and 6 seconds for one. The first midpoint is 23:12:00 UTC; the last is 23:24:54 UTC. No individual ray time is reconstructed. These intervals describe acquisition duration, not a statistically established clock-error bound. The unrelated source title containing a 1970 date is ignored.

### Follow-up: the 45 elevation files do not imply 45 successive scans

The archive directory contains **99 volume groups, each with 45 elevation files**. Within a group, the filename timestamp is shared: for example, `v1_s6` identifies the first volume's sixth elevation file, which contains the 0.5° sweep. The grouping does not describe 4,455 successive volume times.

This interpretation agrees with the instrument's acquisition method. [Kurdzo et al. (2017), pp. 917–918](https://doi.org/10.1175/BAMS-D-15-00266.1), explain that AIR collects the elevation beams simultaneously while rotating mechanically in azimuth. [Bodine et al. (2022), pp. 1–2](https://par.nsf.gov/servlets/purl/10325864), likewise describe simultaneous vertical imaging, offline beamforming, and 6–7-second sector volumes in a typical configuration. Simultaneous elevations do not mean every azimuth ray is acquired at the same instant: each sector still takes several seconds, and this archive's unusable ray times prevent recovering that progression exactly.

Combining the 45 elevation files makes a volume usable by software expecting an entire three-dimensional scan. In [NCAR's RadxConvert parameter example](https://github.com/NCAR/lrose-core/blob/master/codebase/apps/Radx/src/RadxConvert/RadxConvert.test), sweep aggregation and time correction are separate controls; `apply_time_offset` is disabled and its offset is zero in that example. A description of merging the files is therefore not evidence of a clock correction. The present 0.5° map reads that elevation directly and does not need to assemble all elevations first.

The 2022 overview's section IV.D independently identifies **31 May 2013 El Reno moment data** on the same [OU archive page](https://arrc.ou.edu/data.html) used here. The reviewed primary publications and archive description provide no verified event-specific clock shift, corrected deployment coordinates, or alternative event origin. This bounded search does not prove that the acquisition clock was correct. It establishes that no defensible correction has been found: preserve the source UTC intervals and keep the alignment uncertainty visible.

## Why AIR velocity is excluded

On printed page 918 and in Table 2, [Kurdzo et al. (2017)](https://repository.library.noaa.gov/view/noaa/67666/noaa_67666_DS1.pdf) report technical difficulties with AIR and omit radial-velocity estimates from before 2014. The 2013 campaign row marks velocity unavailable. This was checked in both extracted text and the rendered page.

The later public CF/Radial archive nevertheless contains a `VEL` array. Its history fields do not establish that the earlier problem was corrected. In the 99 files, values span **−29.16 to +29.16 m/s** while the nominal Nyquist metadata is about **16.81 m/s**; **7,890,003 of 35,396,856** velocity gates exceed that metadata value in magnitude. This is an additional inconsistency, not evidence that the archive has been correctly dealiased. Automatic unfolding would not repair an unidentified instrument problem. The app therefore retains WSR-88D velocity and exposes no AIR velocity layer.

## Geographic alignment remains unverified

The first AIR reflectivity image contains a prominent ring/hook feature that appears several kilometers west of the NWS estimated 23:12 tornado center when rendered with the source coordinates. The NWS estimate at that time is **35.4529158454, −98.0211476016**. This visual comparison raises a concern; it does **not** prove an archive error or establish that the visually selected feature is the surface tornado center. Radar samples an elevated volume, the inferred feature position is subjective, and the NWS center also has uncertainty.

The independent pixel and gate checks found no conversion/projection defect that explains the apparent difference. The original source position, bearing, and timing are retained. No translation, rotation, range adjustment, or clock shift has been fitted to make the radar resemble the surveyed path.

The 2017 paper's illustrated case studies are Shawnee (19 May 2013), Denver (21 May 2014), Tipton (16 May 2015), and Canadian (27 May 2015). It offers no dated first/last El Reno reflectivity panels suitable for directly validating this subset. A bounded primary-source search did not establish an independent El Reno deployment position or correction. Accordingly, the preview must keep its alignment limitation visible and must not supply tornado-center, tornado-edge, wind-speed, or closest-approach measurements.

## Review limits

CRC checks cover all source files; the independent raster-value comparison is a representative first-frame check, not a pixel-by-pixel audit of every image. The tests establish faithful transformation of supplied metadata and values. They do not certify the physical accuracy of every observed gate or resolve the archive's original acquisition/calibration uncertainties.

## Application verification

The final application passes all 51 Node checks, including 16 source-selection/data-integrity tests. AIR cannot select velocity even if a residual image is present. Tests cover every published reflectivity image's dimensions and hash, product midpoint eligibility, 25-second expiry, the inclusive recording end, and unchanged KTLX selection.

Browser inspection at 1280 × 800 and 390 × 844 verified the source switch, AIR velocity/REF–VEL comparison disabled with an explanation, restoration of KTLX comparison, preserved playback time when switching within overlapping coverage, 10-second steps from an exact image timestamp, and final AIR image selection. AIR playback stops at the exact 23:24:57 UTC coverage end rather than a rounded blank tail; Home/End can reach exact range bounds. The source-information dialog and visible alignment qualification were checked on the phone layout. No browser console errors were observed.
