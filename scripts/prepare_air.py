#!/usr/bin/env python3
"""Extract only 99 AIR 0.5-degree sweeps by HTTP byte range and render map layers.

Dependencies: numpy, scipy and Pillow. No complete 7 GB archive download, netCDF4,
Py-ART or projection-library installation is necessary for these classic files.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import re
import struct
import time
import urllib.request
import zlib
import numpy as np
from PIL import Image
from scipy.io import netcdf_file

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = 'https://arrc.ou.edu/data/20130531_AIR_CFRadial.zip'
CACHE = ROOT / '.cache' / 'air'
OUTPUT = ROOT / 'data' / 'air'
BOUNDS = [[35.20, -98.30], [35.70, -97.50]]
EARTH = 6371000.0
WEB_EARTH = 6378137.0
KNOTS = 1.9438444924406048
AIR_PAPER = 'https://repository.library.noaa.gov/view/noaa/67666/noaa_67666_DS1.pdf'
UNAVAILABLE_VELOCITY = {
    'reason': '2013 AIR velocity not validated; published instrument limitations',
    'sourceUrl': AIR_PAPER,
    'detail': 'Kurdzo et al. (2017), p. 918 and Table 2, report technical difficulties and do not present radial velocity before 2014. The later archive contains VEL, but provides no verified correction or validation history. Those values are retained only for audit, not displayed as usable winds.',
}


def text(value):
    return value.decode('utf-8', errors='replace') if isinstance(value, bytes) else str(value)


def epoch(value):
    return datetime.fromisoformat(text(value).replace('Z', '+00:00')).timestamp()


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ranged(start, end):
    """Never silently accept an HTTP 200 full-archive response to a range query."""
    if end < start or end - start > 8 * 1024 * 1024:
        raise ValueError(f'Unexpected byte-range size {start}:{end}')
    for attempt in range(4):
        try:
            req = urllib.request.Request(ARCHIVE, headers={
                'Range': f'bytes={start}-{end}', 'User-Agent': 'ElRenoHistoricalRadar/1.0 (education/outreach)',
                'Accept-Encoding': 'identity'})
            with urllib.request.urlopen(req, timeout=90) as response:
                content_range = response.headers.get('Content-Range', '')
                if response.status != 206 or not content_range.startswith(f'bytes {start}-{end}/'):
                    raise ValueError(f'Archive did not honor range: HTTP {response.status}, {content_range}')
                data = response.read(end - start + 2)
                if len(data) != end - start + 1:
                    raise ValueError('Incomplete byte-range response')
                return data
        except Exception:
            if attempt == 3:
                raise
            time.sleep(attempt + 1)


def directory(offline=False):
    path = CACHE / 'directory.json'
    if path.exists():
        return json.loads(path.read_text())
    if offline:
        raise FileNotFoundError(path)
    req = urllib.request.Request(ARCHIVE, method='HEAD', headers={'User-Agent': 'ElRenoHistoricalRadar/1.0'})
    with urllib.request.urlopen(req, timeout=60) as response:
        size = int(response.headers['Content-Length'])
        headers = {key: response.headers.get(key) for key in ['Content-Length', 'ETag', 'Last-Modified', 'Accept-Ranges']}
    tail_size = min(65557, size)
    tail = ranged(size - tail_size, size - 1)
    index = tail.rfind(b'PK\x05\x06')
    if index < 0:
        raise ValueError('No ZIP end-of-directory record')
    sig, disk, cd_disk, disk_count, count, cd_size, declared_offset, comment_length = struct.unpack_from('<4s4H2IH', tail, index)
    if disk or cd_disk or disk_count != count or index + 22 + comment_length != len(tail):
        raise ValueError('Unexpected multi-disk or incomplete ZIP directory')
    # This particular >4 GiB archive has classic 32-bit offset rollover, without
    # ZIP64 records. Locate its directory from the physical end, then restore
    # member offsets in archive order. Every selected local header is verified.
    actual_offset = size - tail_size + index - cd_size
    body = ranged(actual_offset, actual_offset + cd_size - 1)
    (CACHE / 'central-directory.bin').write_bytes(body)
    entries, offset, rollover, previous = [], 0, 0, -1
    for _ in range(count):
        header = struct.unpack_from('<4s6H3I5H2I', body, offset)
        if header[0] != b'PK\x01\x02':
            raise ValueError('Invalid central-directory signature')
        flags, method, crc, compressed, uncompressed = header[3], header[4], header[7], header[8], header[9]
        name_len, extra_len, comment_len, raw_offset = header[10], header[11], header[12], header[16]
        name = body[offset + 46:offset + 46 + name_len].decode('utf-8' if flags & 0x800 else 'cp437')
        if raw_offset < previous:
            rollover += 1 << 32
        previous = raw_offset
        absolute = raw_offset + rollover
        if absolute >= actual_offset:
            raise ValueError('Reconstructed member offset lies inside directory')
        entries.append({'name': name, 'headerOffset': absolute, 'declaredHeaderOffset': raw_offset,
                        'compression': method, 'compressedSize': compressed, 'size': uncompressed,
                        'crc32': f'{crc:08x}', 'flags': flags})
        offset += 46 + name_len + extra_len + comment_len
    if offset != len(body):
        raise ValueError('Unparsed central-directory bytes')
    selected = [item for item in entries if re.search(r'_AIR_v\d+_s6\.nc$', item['name'])]
    if len(selected) != 99:
        raise ValueError(f'Expected 99 candidate 0.5 degree sweeps, found {len(selected)}')
    record = {'archive': ARCHIVE, 'archiveSize': size, 'headers': headers,
              'entryCount': len(entries), 'netcdfCount': sum(e['name'].endswith('.nc') for e in entries),
              'directoryRange': [actual_offset, actual_offset + cd_size - 1],
              'directorySha256': sha(body), 'declaredDirectoryOffset': declared_offset,
              'offsetRolloverBytes': rollover,
              'offsetNote': 'Classic ZIP32 member offsets wrap at 4 GiB. Offsets reconstructed in central-directory order; local filename and CRC verified for every selected entry.',
              'members': selected}
    path.write_text(json.dumps(record, indent=2) + '\n')
    return record


def extract(item, offline=False):
    """Cache compressed member payload, not the full archive or expanded sweeps."""
    stem = Path(item['name']).name.removesuffix('.nc')
    cache = CACHE / f'{stem}.deflate'
    metadata = CACHE / f'{stem}.json'
    if cache.exists() and metadata.exists():
        compressed = cache.read_bytes()
        info = json.loads(metadata.read_text())
    else:
        if offline:
            raise FileNotFoundError(cache)
        start = item['headerOffset']
        header = ranged(start, start + 4095)
        fields = struct.unpack_from('<4s5H3I2H', header)
        if fields[0] != b'PK\x03\x04':
            raise ValueError(f'Bad local header: {item["name"]}')
        flags, method, name_len, extra_len = fields[2], fields[3], fields[9], fields[10]
        if flags & 1 or method != item['compression'] or method != 8:
            raise ValueError('Encrypted or non-deflate member is unsupported')
        prefix = 30 + name_len + extra_len
        if prefix > len(header):
            raise ValueError('Unexpected large local header')
        name = header[30:30 + name_len].decode('utf-8' if flags & 0x800 else 'cp437')
        if name != item['name']:
            raise ValueError(f'Local filename mismatch at {start}: {name}')
        payload_start = start + prefix
        compressed = header[prefix:min(len(header), prefix + item['compressedSize'])]
        if len(compressed) < item['compressedSize']:
            compressed += ranged(payload_start + len(compressed), payload_start + item['compressedSize'] - 1)
        info = {'member': item['name'], 'headerOffset': start,
                'compressedByteRange': [payload_start, payload_start + item['compressedSize'] - 1],
                'localHeaderFilenameVerified': True}
    if len(compressed) != item['compressedSize']:
        raise ValueError('Compressed member size mismatch')
    raw = zlib.decompress(compressed, -15)
    crc = f'{zlib.crc32(raw) & 0xffffffff:08x}'
    if len(raw) != item['size'] or crc != item['crc32']:
        raise ValueError(f'CRC or expanded size mismatch: {item["name"]}')
    info.update(compressedSha256=sha(compressed), netcdfSha256=sha(raw), crc32=crc,
                crc32Verified=True, compressedBytes=len(compressed), netcdfBytes=len(raw))
    if not cache.exists():
        cache.write_bytes(compressed)
    metadata.write_text(json.dumps(info, indent=2) + '\n')
    return raw, info


def grid(width):
    (south, west), (north, east) = BOUNDS
    xmin, xmax = np.deg2rad([west, east]) * WEB_EARTH
    ymin, ymax = WEB_EARTH * np.log(np.tan(np.pi / 4 + np.deg2rad([south, north]) / 2))
    height = round(width * (ymax - ymin) / (xmax - xmin))
    dx, dy = (xmax - xmin) / width, (ymax - ymin) / height
    xx, yy = np.meshgrid(xmin + (np.arange(width) + .5) * dx, ymax - (np.arange(height) + .5) * dy)
    lon = xx / WEB_EARTH
    lat = 2 * np.arctan(np.exp(yy / WEB_EARTH)) - np.pi / 2
    return {'lon': lon, 'lat': lat, 'width': width, 'height': height,
            'projectedPixelMeters': [dx, dy], 'extent': [xmin, ymin, xmax, ymax]}


def geometry(g, latitude, longitude):
    lat0, lon0 = np.deg2rad([latitude, longitude])
    delta = g['lon'] - lon0
    dot = np.sin(lat0) * np.sin(g['lat']) + np.cos(lat0) * np.cos(g['lat']) * np.cos(delta)
    ground = EARTH * np.arccos(np.clip(dot, -1, 1))
    azimuth = np.rad2deg(np.arctan2(np.sin(delta) * np.cos(g['lat']),
                    np.cos(lat0) * np.sin(g['lat']) - np.sin(lat0) * np.cos(g['lat']) * np.cos(delta)))
    return ground, azimuth


def sector_index(azimuth, pixel_azimuth):
    unwrapped = np.rad2deg(np.unwrap(np.deg2rad(azimuth)))
    order = np.argsort(unwrapped)
    rays = unwrapped[order]
    diffs = np.diff(rays)
    if np.any(diffs <= 0):
        raise ValueError('Duplicate or invalid ray azimuth')
    spacing = float(np.median(diffs))
    if rays[-1] - rays[0] >= 180:
        raise ValueError('Expected an AIR sector narrower than 180 degrees')
    middle = (rays[0] + rays[-1]) / 2
    pixels = middle + (pixel_azimuth - middle + 180) % 360 - 180
    right = np.clip(np.searchsorted(rays, pixels), 0, len(rays) - 1)
    left = np.clip(right - 1, 0, len(rays) - 1)
    selected = np.where(abs(pixels - rays[left]) <= abs(rays[right] - pixels), left, right)
    error = abs(pixels - rays[selected])
    valid = (pixels >= rays[0] - spacing / 2) & (pixels <= rays[-1] + spacing / 2) & (error <= spacing * .55)
    return order[selected], valid, {
        'firstRayAzimuthDegrees': float(rays[0]), 'lastRayAzimuthDegrees': float(rays[-1]),
        'sectorWidthDegrees': float(rays[-1] - rays[0]), 'medianAzimuthSpacingDegrees': spacing,
        'mask': 'Nearest ray only within the observed contiguous sector and half-ray edge support; no fill across the missing azimuth sector.'}


def decoded(variable):
    raw = np.asarray(variable.data).copy()
    mask = ~np.isfinite(raw)
    for key in ['_FillValue', 'missing_value']:
        if key in variable._attributes:
            mask |= raw == variable._attributes[key]
    data = raw.astype(np.float64) * float(variable._attributes.get('scale_factor', 1)) + float(variable._attributes.get('add_offset', 0))
    return np.ma.array(data, mask=mask)


def image_for(values, scale, destination):
    """Exact step colors, lossless indexed PNG, palette index zero transparent."""
    data = values.filled(np.nan)
    thresholds = np.array([p[0] for p in scale])
    bins = np.clip(np.searchsorted(thresholds, data, side='right') - 1, 0, len(scale) - 1) + 1
    bins[~np.isfinite(data)] = 0
    palette = [0, 0, 0]
    for _, color in scale:
        palette.extend(int(color[i:i + 2], 16) for i in (1, 3, 5))
    im = Image.fromarray(bins.astype(np.uint8), mode='P')
    im.putpalette(palette + [0] * (768 - len(palette)))
    im.save(destination, optimize=True, transparency=0)
    return {'pngSha256': sha(destination.read_bytes()), 'validPixelFraction': float(values.count() / values.size),
            'displayedValueRange': [float(values.min()), float(values.max())]}


def process(item, raw, source, g, scales):
    with netcdf_file(io.BytesIO(raw), 'r', mmap=False) as ds:
        variables = ds.variables
        scalar = lambda name: float(np.asarray(variables[name].data).flat[0])
        fixed = scalar('fixed_angle')
        elevations = decoded(variables['elevation']).filled(np.nan)
        if abs(fixed - .5) > .000001 or not np.all(np.abs(elevations - .5) < .000001):
            raise ValueError(f'Incorrect elevation in {item["name"]}: {fixed}')
        start, end = epoch(ds.time_coverage_start), epoch(ds.time_coverage_end)
        if not (0 < end - start <= 20):
            raise ValueError('Unexpected coverage interval')
        filename_time = datetime.strptime(re.search(r'cfrad\.(\d{8}_\d{6})_', item['name']).group(1), '%Y%m%d_%H%M%S').replace(tzinfo=timezone.utc).timestamp()
        if abs(filename_time - start) > 1:
            raise ValueError('Filename and coverage start disagree')
        midpoint = (start + end) / 2
        latitude, longitude, altitude = scalar('latitude'), scalar('longitude'), scalar('altitude')
        expected_units = {'range': 'meters', 'azimuth': 'degrees', 'elevation': 'degrees',
                          'latitude': 'degrees_north', 'longitude': 'degrees_east', 'altitude': 'meters'}
        for name, unit in expected_units.items():
            actual = text(variables[name]._attributes.get('units', ''))
            if actual != unit:
                raise ValueError(f'Unexpected coordinate units for {name}: {actual}')
        azimuth = decoded(variables['azimuth']).filled(np.nan)
        ranges = decoded(variables['range']).filled(np.nan)
        if not np.all(np.isfinite(azimuth)) or not np.all(np.isfinite(ranges)) or np.any(np.diff(ranges) <= 0):
            raise ValueError('Invalid native coordinates')
        spacing = float(np.median(np.diff(ranges)))
        if not np.allclose(np.diff(ranges), spacing, atol=.001):
            raise ValueError('Nonuniform range spacing needs an explicit lookup')
        ground, pixel_azimuth = geometry(g, latitude, longitude)
        ray, sector_valid, sector = sector_index(azimuth, pixel_azimuth)
        effective_radius = EARTH * 4 / 3
        angle = ground / effective_radius
        slant = (effective_radius + altitude) * np.sin(angle) / np.cos(np.deg2rad(elevations[ray]) + angle)
        gate = np.rint((slant - ranges[0]) / spacing).astype(int)
        range_valid = (slant >= ranges[0] - spacing / 2) & (slant <= ranges[-1] + spacing / 2) & (gate >= 0) & (gate < len(ranges))
        valid = sector_valid & range_valid
        gate = np.clip(gate, 0, len(ranges) - 1)
        ray_times = decoded(variables['time']).filled(np.nan)
        timing = {'source': 'global time_coverage_start/end midpoint', 'rayTimesUsable': False,
                  'rawRayTimeUnits': text(variables['time']._attributes.get('units', '')),
                  'rayTimesAllZero': bool(np.all(ray_times == 0)),
                  'uncertaintyIntervalSeconds': end - start,
                  'note': 'Per-ray times are zero and units malformed. Each displayed timestamp is a representative global coverage midpoint, not a verified ray time. No ray time is manufactured.'}
        if not timing['rayTimesAllZero']:
            raise ValueError('Ray-time behavior changed; review before accepting')
        stem = Path(item['name']).name.removesuffix('.nc')
        products, unavailable_source_products = {}, {}
        nyquist = decoded(variables['nyquist_velocity']).compressed()
        for field, product, units in [('DBZ', 'reflectivity', 'dBZ'), ('VEL', 'velocity', 'm/s')]:
            variable = variables[field]
            source_units = text(variable._attributes.get('units', ''))
            if source_units != ('m/s' if field == 'VEL' else 'dBZ'):
                raise ValueError(f'Unexpected {field} units: {source_units}')
            values = decoded(variable)
            if values.shape != (len(azimuth), len(ranges)):
                raise ValueError('Moment dimensions do not match native coordinates')
            product_info = {
                'time': iso(midpoint),
                'scanStart': iso(start), 'scanEnd': iso(end), 'sweepIndex': 5,
                'targetElevationDegrees': fixed, 'medianElevationDegrees': float(np.median(elevations)),
                'elevationRangeDegrees': [float(elevations.min()), float(elevations.max())],
                'rayCount': len(azimuth), 'gateCount': len(ranges), 'rangeGateMeters': spacing,
                'firstGateCenterMeters': float(ranges[0]), 'lastGateCenterMeters': float(ranges[-1]),
                'sourceFirstGateAttributeMeters': text(variables['range']._attributes.get('meters_to_center_of_first_gate', '')),
                'medianAzimuthSpacingDegrees': sector['medianAzimuthSpacingDegrees'],
                'sourceField': field, 'sourceUnits': source_units, 'units': units,
                'sourceScaleFactor': float(variable._attributes.get('scale_factor', 1)),
                'sourceAddOffset': float(variable._attributes.get('add_offset', 0)),
                'sourceFillValue': float(variable._attributes.get('_FillValue', np.nan)),
                'sourceDecodedValueRange': [float(values.min()), float(values.max())],
                'timingQuality': 'global-coverage-midpoint; ray times unavailable',
            }
            if field == 'VEL':
                product_info.update(dealiased=None, velocityProcessing='Unvalidated 2013 source velocity; withheld due to published instrument limitations.',
                                        archiveVelocityProcessing='unverified', appDealiasingApplied=False, appStormMotionCorrectionApplied=False,
                                        displayed=False, quality='unvalidated', publishedLimitation=UNAVAILABLE_VELOCITY,
                                        sourceFractionBeyondMetadataNyquist=float(np.mean(np.abs(values.compressed()) > nyquist.max())),
                                        nyquistVelocityMetersPerSecond=[float(nyquist.min()), float(nyquist.max())],
                                        nyquistWarning='Decoded source velocities exceed the Nyquist metadata. These metadata do not establish a valid folding interval or verified dealiasing history.')
                unavailable_source_products[product] = product_info
            else:
                sampled = values[ray, gate]
                sampled = np.ma.array(sampled.data, mask=np.ma.getmaskarray(sampled) | ~valid)
                destination = OUTPUT / f'{stem}_{product}.png'
                product_info.update(file=destination.relative_to(ROOT).as_posix(),
                                    **image_for(sampled, scales[product]['stops'], destination))
                products[product] = product_info
        frame = {'time': iso(midpoint), 'volumeTime': iso(start), 'elevation': fixed,
                 'reflectivity': products['reflectivity']['file'],
                 'reflectivityTime': iso(midpoint), 'reflectivityElevation': fixed,
                 'sourceKey': item['name'], 'sourceUrl': ARCHIVE, 'products': products,
                 'sector': sector, 'timing': timing}
        provenance = {**source, 'directoryEntry': item, 'siteLocation': {'latitude': latitude, 'longitude': longitude, 'altitudeMeters': altitude},
                      'globalCoverageStart': iso(start), 'globalCoverageEnd': iso(end), 'fixedAngleDegrees': fixed,
                      'sourceTitleIgnored': text(ds._attributes.get('title', '')), 'timing': timing, 'sector': sector,
                      'products': products, 'unavailableSourceProducts': unavailable_source_products,
                      'status': 'verified-and-rendered'}
        return frame, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--limit', type=int, help='Development only; limited builds are explicitly marked incomplete')
    parser.add_argument('--width', type=int, default=1200)
    args = parser.parse_args()
    CACHE.mkdir(parents=True, exist_ok=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    archive = directory(args.offline)
    members = archive['members'][:args.limit] if args.limit else archive['members']
    scales = json.loads((ROOT / 'data/radar/manifest.json').read_text())['colorScales']
    scales = {'reflectivity': scales['reflectivity']}
    g = grid(args.width)
    frames, records = [], []
    # Keep only a few expanded NetCDF sweeps in memory; futures finish in source
    # order, so the emitted manifest remains chronological.
    with ThreadPoolExecutor(max_workers=5) as pool:
        for i, (item, downloaded) in enumerate(zip(members, pool.map(lambda m: extract(m, args.offline), members)), 1):
            raw, source = downloaded
            frame, record = process(item, raw, source, g, scales)
            frames.append(frame); records.append(record)
            print(f'[{i}/{len(members)}] {Path(item["name"]).name}: 0.5 deg, {frame["time"]}', flush=True)
    frames.sort(key=lambda f: f['time'])
    records.sort(key=lambda r: r['globalCoverageStart'])
    assert len({f['time'] for f in frames}) == len(frames)
    location = records[0]['siteLocation']
    if any(r['siteLocation'] != location for r in records):
        raise ValueError('Radar site moved; per-frame site metadata requires UI review')
    coverage = {'start': records[0]['globalCoverageStart'], 'end': records[-1]['globalCoverageEnd']}
    manifest = {
        'schemaVersion': 1, 'id': 'air', 'name': 'Atmospheric Imaging Radar', 'site': 'AIR',
        'siteLocation': location, 'bounds': BOUNDS, 'projection': 'EPSG:3857',
        'imageWidth': g['width'], 'imageHeight': g['height'],
        'projectedPixelMeters': g['projectedPixelMeters'],
        'approximateGroundPixelMeters': [p * math.cos(math.radians(35.45)) for p in g['projectedPixelMeters']],
        'maxAgeSeconds': 25, 'coverage': coverage, 'coverageStart': coverage['start'], 'coverageEnd': coverage['end'],
        'firstProductTime': frames[0]['time'], 'lastProductTime': frames[-1]['time'],
        'frameCount': len(frames), 'completeRequestedSubset': len(frames) == 99,
        'availableProducts': ['reflectivity'], 'unavailableProducts': {'velocity': UNAVAILABLE_VELOCITY},
        'geolocation': {
            'status': 'unverified-source-registration',
            'appliedCorrection': None,
            'note': 'Rendered directly from archived radar location, true-north azimuth and range. An independent comparison flags several-kilometer disagreement between a first-frame circulation feature and the contemporaneous NWS track; the source of that discrepancy is unresolved. Do not use AIR pixels for a precise tornado position or chase-distance estimate.',
        },
        'attribution': 'Atmospheric Imaging Radar data provided by the Advanced Radar Research Center, University of Oklahoma. Derived visualization; see source publications and archive terms.',
        'sources': [
            {'title': 'OU ARRC curated radar archive and data policy', 'url': 'https://arrc.ou.edu/data.html'},
            {'title': 'AIR El Reno CF/Radial archive (7 GB; partial range retrieval used)', 'url': ARCHIVE},
            {'title': 'Isom et al. (2013), Atmospheric Imaging Radar system', 'url': 'https://doi.org/10.1175/JTECH-D-12-00063.1'},
            {'title': 'Kurdzo et al. (2017), AIR severe-storm observations', 'url': 'https://doi.org/10.1175/BAMS-D-15-00266.1'}],
        'processing': {
            'sampling': 'Nearest native polar gate on a Web Mercator pixel grid; no smoothing or temporal interpolation. Pixels outside native sector/range or missing gates are transparent.',
            'geometry': 'Spherical azimuthal-equidistant surface distance/azimuth; inverse standard 4/3-Earth beam geometry includes the recorded radar altitude. Actual range coordinate vector used, despite conflicting first-gate attribute.',
            'time': 'Global coverage midpoint, with full start/end preserved. Source per-ray times are zero with malformed units; no reliable individual ray acquisition time is available.',
            'velocity': UNAVAILABLE_VELOCITY['detail'],
            'quality': 'Limited archive quality control and calibration information; source geolocation registration unverified. No independent calibration or additional clutter/attenuation filtering applied. Radar measurements are above ground, not a surface tornado boundary.',
            'resolution': '30 m sampled range-gate spacing; the source publication lists 45 m independent range resolution for 2013. About 0.5 degree azimuth sampling and roughly 60 m raster pixels do not establish independent 60 m spatial resolution. Radar beam footprint grows with range.',
        },
        'colorScales': scales, 'frames': frames,
    }
    (OUTPUT / 'manifest.json').write_text(json.dumps(manifest, indent=2, allow_nan=False) + '\n')
    provenance = {'archive': {k: v for k, v in archive.items() if k != 'members'},
                  'createdAt': iso(datetime.now(timezone.utc).timestamp()), 'reader': 'scipy.io.netcdf_file (classic NetCDF; explicit field scale/offset/fill)',
                  'compressedSubsetBytes': sum(r['compressedBytes'] for r in records),
                  'records': records}
    (OUTPUT / 'provenance.json').write_text(json.dumps(provenance, indent=2, allow_nan=False) + '\n')
    # Remove earlier derived velocity previews so unvalidated winds cannot be
    # mistaken for a packaged, supported product. Raw source caches remain.
    for path in OUTPUT.glob('cfrad.*_AIR_v*_s6_velocity.png'):
        path.unlink()
    size = sum(Path(ROOT / f['reflectivity']).stat().st_size for f in frames)
    print(f'Completed {len(frames)} reflectivity frames. PNG total {size / 1048576:.2f} MiB; compressed subset {provenance["compressedSubsetBytes"] / 1048576:.2f} MiB.', flush=True)


if __name__ == '__main__':
    main()
