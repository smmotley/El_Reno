#!/usr/bin/env python3
"""Build georeferenced El Reno radar overlays from NOAA's public Level II archive.

Run from any directory with the isolated environment described in
requirements-radar.txt. Downloads are cached under .cache/radar; only the
rendered PNGs, provenance, and manifest belong in the public application.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("PYART_QUIET", "1")
os.environ.setdefault("MPLCONFIGDIR", str(ROOT / ".cache" / "matplotlib"))
import numpy as np
from PIL import Image
from pyproj import CRS, Transformer
from pyart.io.nexrad_level2 import NEXRADLevel2File

ARCHIVE = "https://unidata-nexrad-level2.s3.amazonaws.com"
BOUNDS = [[35.20, -98.30], [35.70, -97.50]]
EARTH_RADIUS = 6371000.0
MPS_TO_KNOTS = 1.9438444924406048
# Each interval begins at its listed value. The last color is the overflow bin.
REFLECTIVITY_SCALE = [
    [-10, "#526782"], [0, "#00c5e8"], [5, "#0094ed"], [10, "#0063c7"],
    [15, "#0033a6"], [20, "#00eb35"], [25, "#00c229"], [30, "#008a22"],
    [35, "#f6f500"], [40, "#e6c700"], [45, "#ff9500"], [50, "#ff342a"],
    [55, "#dc0022"], [60, "#a80020"], [65, "#f000ec"], [70, "#a900df"],
    [75, "#e6c4ff"], [80, "#ffffff"],
]
VELOCITY_SCALE = [
    [-100, "#e6fff9"], [-80, "#93ffe7"], [-60, "#37f5c2"], [-40, "#05d875"],
    [-25, "#08a747"], [-10, "#176b38"], [-2, "#666978"], [2, "#784740"],
    [10, "#a33130"], [25, "#e83e38"], [40, "#ff7055"], [60, "#ffa37e"],
    [80, "#ffdfb3"], [100, "#ffffff"],
]


def utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(value: datetime) -> str:
    return value.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def request(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "ElRenoHistoricalRadar/1.0 (public NOAA archive)"})
    with urllib.request.urlopen(req, timeout=90) as response:
        return response.read()


def list_keys(site: str, start: datetime, end: datetime, cache: Path, offline: bool) -> list[dict]:
    """Include one preceding volume so the playback has an initial observation."""
    ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
    day = start.replace(hour=0, minute=0, second=0, microsecond=0)
    found = []
    while day <= end:
        prefix = day.strftime(f"%Y/%m/%d/{site}/")
        listing = cache / f"listing-{site}-{day:%Y%m%d}.xml"
        if not listing.exists():
            if offline:
                raise FileNotFoundError(f"Missing cached archive listing: {listing}")
            listing.write_bytes(request(ARCHIVE + "/?" + urllib.parse.urlencode({"list-type": "2", "prefix": prefix})))
        xml = ET.fromstring(listing.read_bytes())
        if xml.findtext("s:IsTruncated", namespaces=ns) == "true":
            raise RuntimeError("Archive listing was truncated; pagination is required before using it.")
        for item in xml.findall("s:Contents", ns):
            key = item.findtext("s:Key", namespaces=ns)
            match = re.search(r"(\d{8})_(\d{6})(?:_V\d+)?(?:\.gz)?$", key or "")
            if match:
                time = datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                if start - timedelta(minutes=6) <= time <= end:
                    found.append({"key": key, "size": int(item.findtext("s:Size", namespaces=ns)), "time": iso(time),
                                  "etag": item.findtext("s:ETag", namespaces=ns).strip('"')})
        day += timedelta(days=1)
    found.sort(key=lambda item: item["time"])
    before = [item for item in found if utc(item["time"]) < start]
    return before[-1:] + [item for item in found if utc(item["time"]) >= start]


def download(item: dict, cache: Path, offline: bool) -> Path:
    path = cache / Path(item["key"]).name
    if not path.exists() or path.stat().st_size != item["size"]:
        if offline:
            raise FileNotFoundError(f"Missing or incomplete raw volume: {path}")
        content = request(f"{ARCHIVE}/{item['key']}")
        if len(content) != item["size"]:
            raise ValueError(f"Download size mismatch for {item['key']}")
        temporary = path.with_suffix(path.suffix + ".part")
        temporary.write_bytes(content)
        temporary.replace(path)
    return path


def make_grid(bounds: list, width: int) -> dict:
    (south, west), (north, east) = bounds
    to_mercator = Transformer.from_crs(4326, 3857, always_xy=True)
    min_x, min_y = to_mercator.transform(west, south)
    max_x, max_y = to_mercator.transform(east, north)
    height = round(width * (max_y - min_y) / (max_x - min_x))
    dx, dy = (max_x - min_x) / width, (max_y - min_y) / height
    xx, yy = np.meshgrid(min_x + (np.arange(width) + .5) * dx, max_y - (np.arange(height) + .5) * dy)
    lon, lat = Transformer.from_crs(3857, 4326, always_xy=True).transform(xx, yy)
    return {"width": width, "height": height, "x": xx, "y": yy, "lon": lon, "lat": lat,
            "extent": [min_x, min_y, max_x, max_y], "pixelMeters": [dx, dy]}


def sampling_geometry(grid: dict, latitude: float, longitude: float) -> tuple:
    # Same spherical azimuthal-equidistant geometry used by Py-ART, with a 4/3
    # Earth-radius beam model applied separately when converting slant range.
    local = CRS.from_proj4(f"+proj=aeqd +lat_0={latitude} +lon_0={longitude} +R={EARTH_RADIUS} +units=m +no_defs")
    east, north = Transformer.from_crs(4326, local, always_xy=True).transform(grid["lon"], grid["lat"])
    return np.hypot(east, north), np.mod(np.rad2deg(np.arctan2(east, north)), 360)


def nearest_rays(azimuths: np.ndarray, pixels: np.ndarray) -> tuple:
    order = np.argsort(azimuths)
    angles = azimuths[order]
    extended = np.concatenate(([angles[-1] - 360], angles, [angles[0] + 360]))
    indices = np.concatenate(([order[-1]], order, [order[0]]))
    right = np.searchsorted(extended, pixels)
    left = right - 1
    selected = np.where(abs(pixels - extended[left]) <= abs(extended[right] - pixels), left, right)
    diffs = np.diff(np.concatenate((angles, [angles[0] + 360])))
    spacing = float(np.median(diffs[diffs > .01]))
    return indices[selected], abs(pixels - extended[selected]), spacing


def rgba(values: np.ma.MaskedArray, scale: list) -> np.ndarray:
    thresholds = np.array([row[0] for row in scale])
    colors = np.array([[int(row[1][i:i+2], 16) for i in (1, 3, 5)] + [255] for row in scale], dtype=np.uint8)
    data = values.filled(np.nan)
    bins = np.clip(np.searchsorted(thresholds, data, side="right") - 1, 0, len(scale) - 1)
    pixels = colors[bins]
    pixels[~np.isfinite(data)] = 0
    return pixels


def render_product(reader: NEXRADLevel2File, moment: str, geometry: tuple, grid: dict, target: Path) -> dict:
    candidates = []
    for sweep, scan in enumerate(reader.scan_info()):
        if moment in scan["moments"]:
            elevation = float(reader.get_target_angles([sweep])[0])
            # At a split low tilt choose the earliest sweep containing the
            # requested moment. Never borrow a higher tilt from another time.
            candidates.append((elevation, sweep, scan))
    if not candidates:
        raise ValueError(f"No {moment} sweep in volume")
    nominal, sweep, scan = min(candidates, key=lambda candidate: (round(candidate[0], 2), candidate[1]))
    if nominal > .55:
        raise ValueError(f"Requested lowest tilt unavailable: {moment} has {nominal:.3f} degrees")
    azimuths = reader.get_azimuth_angles([sweep])
    elevations = reader.get_elevation_angles([sweep])
    ranges = reader.get_range(sweep, moment)
    data = reader.get_data(moment, len(ranges), [sweep])
    ground_range, pixel_azimuth = geometry
    ray, angular_error, spacing = nearest_rays(azimuths, pixel_azimuth)
    effective_radius = EARTH_RADIUS * 4 / 3
    central_angle = ground_range / effective_radius
    slant_range = effective_radius * np.sin(central_angle) / np.cos(np.deg2rad(elevations[ray]) + central_angle)
    gate_spacing = float(np.median(np.diff(ranges)))
    gates = np.rint((slant_range - ranges[0]) / gate_spacing).astype(int)
    valid = (gates >= 0) & (gates < len(ranges)) & (angular_error <= spacing * .80)
    sampled = np.ma.array(data[ray, np.clip(gates, 0, len(ranges) - 1)], mask=~valid | np.ma.getmaskarray(data[ray, np.clip(gates, 0, len(ranges) - 1)]))
    if moment == "VEL":
        sampled = sampled * MPS_TO_KNOTS
    pixels = rgba(sampled, VELOCITY_SCALE if moment == "VEL" else REFLECTIVITY_SCALE)
    # Fixed categorical palette is deliberately preserved in lossless PNG.
    Image.fromarray(pixels).save(target, optimize=True)
    time_base, seconds = reader.get_times([sweep])
    start, end = time_base + timedelta(seconds=float(seconds.min())), time_base + timedelta(seconds=float(seconds.max()))
    covered_times = seconds[ray][~np.ma.getmaskarray(sampled)]
    nyquist = reader.get_nyquist_vel([sweep])
    info = {
        "file": target.relative_to(ROOT).as_posix(),
        "time": iso(start + (end - start) / 2), "scanStart": iso(start), "scanEnd": iso(end),
        "sweepIndex": sweep, "targetElevationDegrees": round(nominal, 6),
        "medianElevationDegrees": round(float(np.median(elevations)), 6),
        "elevationRangeDegrees": [round(float(elevations.min()), 6), round(float(elevations.max()), 6)],
        "rayCount": len(azimuths), "medianAzimuthSpacingDegrees": round(spacing, 6),
        "rangeGateMeters": gate_spacing, "firstGateCenterMeters": float(ranges[0]),
        "gateCount": len(ranges), "units": "kt" if moment == "VEL" else "dBZ",
        "validPixelFraction": round(float(sampled.count() / sampled.size), 5),
        "displayedValueRange": [round(float(sampled.min()), 3), round(float(sampled.max()), 3)],
    }
    if covered_times.size:
        info["visibleRegionTimeRange"] = [iso(time_base + timedelta(seconds=float(covered_times.min()))), iso(time_base + timedelta(seconds=float(covered_times.max())))]
    if moment == "VEL":
        info["nyquistVelocityKnots"] = [round(float(nyquist.min() * MPS_TO_KNOTS), 3), round(float(nyquist.max() * MPS_TO_KNOTS), 3)]
        info["dealiased"] = False
    return info


def build(args: argparse.Namespace) -> None:
    cache, output = ROOT / ".cache" / "radar", ROOT / "data" / "radar"
    cache.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    keys = list_keys(args.site, utc(args.start), utc(args.end), cache, args.offline)
    if args.limit:
        keys = keys[:args.limit]
    if not keys:
        raise RuntimeError("No matching archive volumes")
    with ThreadPoolExecutor(max_workers=4) as pool:
        raw_paths = list(pool.map(lambda item: download(item, cache, args.offline), keys))
    grid = make_grid(BOUNDS, args.width)
    frames, records = [], []
    location = None
    for number, (item, raw_path) in enumerate(zip(keys, raw_paths), 1):
        print(f"[{number}/{len(keys)}] Processing {raw_path.name}", flush=True)
        opener = gzip.open if raw_path.suffix == ".gz" else open
        with opener(raw_path, "rb") as file:
            reader = NEXRADLevel2File(file)
        latitude, longitude, altitude = reader.location()
        if location is None:
            location = {"latitude": latitude, "longitude": longitude, "altitudeMeters": altitude}
            geometry = sampling_geometry(grid, latitude, longitude)
        assert abs(latitude - location["latitude"]) < .0001 and abs(longitude - location["longitude"]) < .0001
        stem = raw_path.name.split("_V")[0]
        ref = render_product(reader, "REF", geometry, grid, output / f"{stem}_reflectivity.png")
        vel = render_product(reader, "VEL", geometry, grid, output / f"{stem}_velocity.png")
        archive_url = f"{ARCHIVE}/{item['key']}"
        frame = {
            "time": ref["time"], "volumeTime": item["time"], "reflectivity": ref["file"], "velocity": vel["file"],
            "reflectivityTime": ref["time"], "velocityTime": vel["time"],
            "reflectivityElevation": ref["targetElevationDegrees"], "velocityElevation": vel["targetElevationDegrees"],
            "elevation": ref["targetElevationDegrees"], "sourceKey": item["key"], "sourceUrl": archive_url,
            "products": {"reflectivity": ref, "velocity": vel},
        }
        frames.append(frame)
        records.append({**item, "url": archive_url, "sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
                        "vcp": reader.get_vcp_pattern(), "products": frame["products"]})
        del reader
    manifest = {
        "schemaVersion": 1, "site": args.site, "siteLocation": location, "bounds": BOUNDS,
        "projection": "EPSG:3857", "imageWidth": grid["width"], "imageHeight": grid["height"],
        "projectedPixelMeters": [round(n, 3) for n in grid["pixelMeters"]],
        "approximateGroundPixelMeters": [round(n * math.cos(math.radians(35.45)), 3) for n in grid["pixelMeters"]],
        "attribution": "Derived visualization of NOAA/NWS NEXRAD Level II data, accessed via NSF Unidata's public archive.",
        "sources": [
            {"title": "NOAA NEXRAD open archive", "url": "https://registry.opendata.aws/noaa-nexrad/"},
            {"title": "NOAA radar base velocity interpretation", "url": "https://www.noaa.gov/jetstream/velocity"},
            {"title": "Py-ART Level II reader", "url": "https://arm-doe.github.io/pyart/API/generated/pyart.io.read_nexrad_archive.html"},
        ],
        "processing": {
            "sampling": "Nearest native polar gate, no temporal or spatial interpolation; spherical azimuthal-equidistant ground range with standard 4/3-Earth beam model; EPSG:3857 raster pixel centers.",
            "missing": "Below-threshold, missing and range-folded Level II gates remain transparent.",
            "time": "Each product's time is its sweep midpoint, with full scan start/end and visible-region ray-time range preserved in products. Frame time follows reflectivity.",
            "velocity": "Uncorrected base radial velocity relative to KTLX. Negative values move toward the radar; positive away. Not storm-relative velocity or tornado wind speed. Aliasing is possible beyond each sweep's Nyquist velocity.",
            "resolution": "Native range-gate spacing and measured azimuth spacing are recorded per product. Raster sampling is about 151 m; native azimuth footprint increases with distance and is coarser than the raster near El Reno.",
            "geometry": "Radar measurements are elevated above ground. This overlay must not be interpreted as a surveyed tornado boundary.",
        },
        "colorScales": {
            "reflectivity": {"units": "dBZ", "type": "step", "stops": REFLECTIVITY_SCALE, "underflow": "First color", "overflow": "Last color"},
            "velocity": {"units": "kt", "type": "step", "stops": VELOCITY_SCALE, "negative": "Toward KTLX", "positive": "Away from KTLX", "underflow": "First color", "overflow": "Last color"},
        },
        "coverageStart": frames[0]["time"], "coverageEnd": frames[-1]["time"], "frames": frames,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    provenance = {"createdAt": iso(datetime.now(timezone.utc)), "archive": ARCHIVE, "reader": "arm_pyart 2.3.0 NEXRADLevel2File", "requestedPeriod": [args.start, args.end], "records": records}
    (output / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
    total = sum(path.stat().st_size for path in output.glob("*.png"))
    print(f"Wrote {len(frames)} frame pairs; PNG total {total / 1024 ** 2:.2f} MiB; {grid['width']} × {grid['height']} pixels.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", default="KTLX")
    parser.add_argument("--start", default="2013-05-31T22:45:00Z")
    parser.add_argument("--end", default="2013-06-01T00:15:00Z")
    parser.add_argument("--width", type=int, default=480)
    parser.add_argument("--offline", action="store_true", help="Use only already cached listings and raw volumes")
    parser.add_argument("--limit", type=int, help="Process a small subset while developing")
    build(parser.parse_args())
