# Local chase video media

Nine original recordings are preserved unchanged in `data/movies/`. Browser copies and real-frame posters are in `data/movies/web/`. The originals total **1,631,195,206 bytes (1.52 GiB)**; the nine MP4 derivatives total **435718962 bytes (415.5 MiB)**. They contain about **9 minutes 14 seconds** of footage.

## Timing and attribution

Start times below come from the user, interpreted as May 31, 2013 Oklahoma daylight time (CDT, UTC−05:00). They are estimates, not independently verified camera-clock calibrations. The manifest stores explicit UTC ISO timestamps; unregistered clips have `startTime: null` and may be played independently without a timed map placement. Filename clocks and all embedded creation/ingestion timestamps are retained as evidence only.

| Clip identifier | Camera / attribution | Source duration | Browser duration | Start, CDT | Status |
|---|---|---:|---:|---|---|
| hdv-115528 | Our vehicle | 8.508 s | 8.511 s | Unregistered | unregistered |
| hdv-120351 | Our vehicle | 62.729 s | 62.732 s | 18:02:40 | provisional |
| hdv-120459 | Our vehicle | 55.923 s | 55.937 s | 18:04:40 | user-supplied |
| hdv-120739 | Our vehicle | 14.181 s | 14.181 s | Unregistered | unregistered |
| hdv-120959 | Our vehicle | 53.353 s | 53.320 s | 18:09:20 | user-supplied |
| hdv-121054 | Our vehicle | 53.053 s | 53.053 s | 18:10:30 | user-supplied |
| dsc-0770 | Unassigned camera | 17.517 s | 17.517 s | Unregistered | unregistered |
| dsc-0771 | Brendon | 182.683 s | 182.683 s | 18:10:17 | user-supplied |
| dsc-0774 | Unassigned camera | 105.856 s | 105.856 s | Unregistered | unregistered |

Only `DSC_0771.MOV` is confirmed as Brendon’s recording. The other two DSC files have similar Nikon container/encoding metadata, but that does not identify their owner or synchronize their clocks. They remain assigned to “Unassigned camera.” The six HDV `(id)` files are identified as recordings from our vehicle.

`hdv-120351` provisionally starts at **18:02:40 CDT**, replacing the rough **18:03:30** estimate. The revised supplied stop reference is about **16 seconds** into this clip at **35.44883333, −98.07538889**, with the requested road-track stop spanning **18:02:56–18:03:48**. The reconstructed vehicle uses the nearest point on the inferred road, about 78 m north of that pin; see [stop reconstruction and conflicting evidence](video-gps-correction.md). The actual browser clip ends at about **18:03:42.732**, roughly 5.3 seconds before that requested road-stop end. Video playback is continuous: no freeze, extension, time warp, or artificial stationary interval was added. Road-track timing is a separate reconstruction.

## Browser copies

- Six Sony HDV inputs: MPEG-2, 1440×1080 anamorphic samples with 4:3 pixel aspect, 29.97 frames / 59.94 fields per second, interlaced, stereo floating-point PCM. They are deinterlaced with `bwdif` at the source frame cadence and resized to the corresponding 1920×1080 square-pixel display.
- Three Nikon inputs: 1920×1080 H.264, 23.976 fps, full-range video, mono PCM. They remain at the source frame cadence; full-range luma is converted to limited range without relabeling the source color matrix/transfer.
- All derivatives: H.264 High profile, yuv420p, 1920×1080 progressive, AAC audio, source mono/stereo channel count, 48 kHz audio, MP4 faststart. Encoding uses libx264 `veryfast`, CRF 22, and approximately one-second GOPs for seeking.
- The browser’s MP4 duration is the manifest `durationSeconds`; source duration and detailed probes remain under `media.source`. Measured container-duration differences are bounded to about one video frame. No time-offset or time-scale filter was applied.
- The MP4 metadata excludes inherited unverified clock tags. The manifest preserves the original file metadata and SHA-256 checksums.
- Posters are actual frames taken one second into each derivative; some originals begin out of focus or looking into the sky.

## Inventory contract

`data/chase-videos.json` contains `schemaVersion`, totals and `clips`. Each clip has stable `id`, `title`, `camera` (`our`, `brendon` or `unassigned`), `creator`, `sourcePath`, browser `path`, `posterPath`, nullable `startTime`, measured `durationSeconds`, `calibration`, `notes`, `ready` and `media` inventory/provenance. The JSON can be checked into source control; original and derived movie files stay outside Git.

## Reproduction and checks

Run `python3 scripts/prepare_chase_videos.py` with FFmpeg/FFprobe installed. At most two encoders run simultaneously. Valid source-hash/output-hash matches are reused; `--force` rebuilds browser copies only. Each output is staged under a temporary MP4 name, checked, then moved into place. Conversion logs and processing records are kept under ignored `.cache/chase-videos/`.

Verification completed for all nine clips:

- Original SHA-256 values were re-read after processing and remained unchanged.
- All MP4 files fully decode without FFmpeg errors.
- H.264/AAC codecs, square pixels, progressive output, video starts at zero, and duration agreement were checked.
- The `moov` atom precedes `mdat` in every file, confirming faststart layout.
- Keyframes begin at zero and are no more than 1.001 seconds apart.

Serve the MP4s with `video/mp4` and HTTP byte-range support for efficient seeking. No videos were uploaded or deployed by this media-preparation task.
