#!/usr/bin/env python3
"""Stream 45 AIR elevation files per volume into compact Cartesian reflectivity.

The archive is read with bounded byte ranges, never retained wholesale. Only
the first volume's extra compressed members are kept for independent validation.
Existing caches support offline reconstruction. Output checkpoints are resumable.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import time
import zlib
import numpy as np
from scipy.io import netcdf_file
from prepare_air import ROOT, ARCHIVE, EARTH, directory, ranged, sector_index, UNAVAILABLE_VELOCITY

CACHE = ROOT / '.cache' / 'air-volume'
OUTPUT = ROOT / 'data' / 'air-volume'
DIMENSIONS = [192, 160, 96]
BOUNDS = {'x': [-45000, 23000], 'y': [0, 45000], 'z': [0, 16000]}
ELEVATIONS = np.arange(-2, 20.25, .5)
RE = EARTH * 4 / 3


def digest(data):
    return hashlib.sha256(data).hexdigest()


def text(value):
    return value.decode('utf-8', errors='replace').strip() if isinstance(value, bytes) else str(value)


def epoch(value):
    return datetime.fromisoformat(text(value).replace('Z', '+00:00')).timestamp()


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def atomic_json(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


def source_groups(offline=False):
    archive = directory(offline)
    body = (ROOT / '.cache/air/central-directory.bin').read_bytes()
    if digest(body) != archive['directorySha256']:
        raise ValueError('Original ZIP directory hash mismatch')
    groups, offset, rollover, previous = {}, 0, 0, -1
    for _ in range(archive['entryCount']):
        h = struct.unpack_from('<4s6H3I5H2I', body, offset)
        if h[0] != b'PK\x01\x02':
            raise ValueError('Invalid central-directory signature')
        name_len, extra_len, comment_len = h[10:13]
        name = body[offset + 46:offset + 46 + name_len].decode('utf-8' if h[3] & 0x800 else 'cp437')
        if h[16] < previous:
            rollover += 1 << 32
        previous = h[16]
        match = re.fullmatch(r'CFradial/cfrad\.(\d{8}_\d{6})_AIR_v(\d+)_s(\d+)\.nc', name)
        if match:
            item = {'name': name, 'headerOffset': h[16] + rollover, 'compression': h[4],
                    'compressedSize': h[8], 'size': h[9], 'crc32': f'{h[7]:08x}',
                    'filenameTimestamp': match[1], 'volumeNumber': int(match[2]),
                    'sourceSweepNumber': int(match[3])}
            groups.setdefault(item['volumeNumber'], []).append(item)
        offset += 46 + name_len + extra_len + comment_len
    if offset != len(body) or set(groups) != set(range(1, 100)):
        raise ValueError('Unexpected archive group inventory')
    for number, members in groups.items():
        members.sort(key=lambda m: m['sourceSweepNumber'])
        if len(members) != 45 or [m['sourceSweepNumber'] for m in members] != list(range(1, 46)):
            raise ValueError(f'Incomplete 45-tilt source group {number}')
        if len({m['filenameTimestamp'] for m in members}) != 1:
            raise ValueError('Sibling filename times disagree')
    return archive, groups


def fetch(item, archive_size, offline=False, keep=False, group_fragment=None, group_start=None):
    basename = Path(item['name']).name
    candidates = [ROOT / '.cache/air' / (basename.removesuffix('.nc') + '.deflate'),
                  ROOT / '.cache/air-time-audit' / (basename + '.deflate'),
                  CACHE / f'v{item["volumeNumber"]:03d}' / (basename + '.deflate')]
    cached = next((p for p in candidates if p.exists()), None)
    byte_range = None
    if group_fragment is not None:
        relative = item['headerOffset'] - group_start
        fragment = group_fragment[relative:relative + item['compressedSize'] + 4096]
        h = struct.unpack_from('<4s5H3I2H', fragment)
        if h[0] != b'PK\x03\x04' or h[3] != 8 or h[2] & 1:
            raise ValueError('Unsupported source member header')
        prefix = 30 + h[9] + h[10]
        filename = fragment[30:30 + h[9]].decode('utf-8' if h[2] & 0x800 else 'cp437')
        if prefix > 4096 or filename != item['name']:
            raise ValueError('Source filename or local-header length mismatch')
        packed = fragment[prefix:prefix + item['compressedSize']]
        byte_range = [item['headerOffset'] + prefix, item['headerOffset'] + prefix + item['compressedSize'] - 1]
    elif cached:
        packed = cached.read_bytes()
    else:
        if offline:
            raise FileNotFoundError(f'No cached complete source member: {basename}')
        start = item['headerOffset']
        # A small bounded overread includes the local header and avoids a
        # separate HTTP request for each header. CRC verifies the exact payload.
        end = min(start + item['compressedSize'] + 4095, archive_size - 1)
        fragment = ranged(start, end)
        h = struct.unpack_from('<4s5H3I2H', fragment)
        if h[0] != b'PK\x03\x04' or h[3] != 8 or h[2] & 1:
            raise ValueError('Unsupported source member header')
        prefix = 30 + h[9] + h[10]
        filename = fragment[30:30 + h[9]].decode('utf-8' if h[2] & 0x800 else 'cp437')
        if prefix > 4096 or filename != item['name']:
            raise ValueError('Source filename or local-header length mismatch')
        packed = fragment[prefix:prefix + item['compressedSize']]
        byte_range = [start + prefix, start + prefix + item['compressedSize'] - 1]
    raw = zlib.decompress(packed, -15)
    if len(packed) != item['compressedSize'] or len(raw) != item['size'] or f'{zlib.crc32(raw) & 0xffffffff:08x}' != item['crc32']:
        raise ValueError(f'Source CRC or size mismatch: {basename}')
    if keep and not cached:
        candidates[-1].parent.mkdir(parents=True, exist_ok=True)
        candidates[-1].write_bytes(packed)
    provenance = {**item, 'compressedByteRange': byte_range, 'crc32Verified': True,
                  'compressedSha256': digest(packed), 'netcdfSha256': digest(raw),
                  'retainedCache': str((cached or candidates[-1]).relative_to(ROOT)) if cached or keep else None}
    return raw, provenance


def start_group_download(members, archive_size, pool):
    """Fetch one contiguous ~68 MiB volume with nine parallel <=8 MiB ranges.

    The complete archive is never retained. Parsing/verifying each of the 45
    local records after assembly prevents an incorrect span from being accepted.
    """
    start = min(m['headerOffset'] for m in members)
    end = min(max(m['headerOffset'] + m['compressedSize'] + 4095 for m in members), archive_size - 1)
    payload = sum(m['compressedSize'] for m in members)
    if end - start + 1 > payload + 1024 * 1024:
        raise ValueError('Volume members are not contiguous; refusing broad archive read')
    chunk_size = 8 * 1024 * 1024
    ranges = [(begin, min(begin + chunk_size - 1, end)) for begin in range(start, end + 1, chunk_size)]
    return [pool.submit(ranged, *span) for span in ranges], start


def finish_group_download(pending):
    futures, start = pending
    return b''.join(future.result() for future in futures), start


def decode_sweep(item, raw, provenance):
    with netcdf_file(io.BytesIO(raw), 'r', mmap=False) as ds:
        var = ds.variables
        scalar = lambda name: np.asarray(var[name].data).flat[0].item()
        number, sweep = int(scalar('volume_number')), int(scalar('sweep_number'))
        elevation = float(scalar('fixed_angle'))
        if number != item['volumeNumber'] or sweep != item['sourceSweepNumber']:
            raise ValueError('Native volume/sweep numbering disagrees with filename')
        if elevation != float(ELEVATIONS[sweep - 1]) or not np.all(var['elevation'].data == elevation):
            raise ValueError('Native 45-tilt elevation sequence changed')
        start, end = text(ds.time_coverage_start), text(ds.time_coverage_end)
        aliases = [text(ds.start_datetime), text(np.asarray(var['time_coverage_start'].data).tobytes()),
                   text(ds.end_datetime), text(np.asarray(var['time_coverage_end'].data).tobytes())]
        filename_time = datetime.strptime(item['filenameTimestamp'], '%Y%m%d_%H%M%S').replace(tzinfo=timezone.utc)
        if aliases != [start, start, end, end] or epoch(start) != filename_time.timestamp():
            raise ValueError('Native coverage aliases or filename timestamp disagree')
        if not (0 < epoch(end) - epoch(start) <= 20) or not np.all(var['time'].data == 0):
            raise ValueError('Unexpected native acquisition/ray timing behavior')
        expected_units = {'azimuth': 'degrees', 'elevation': 'degrees', 'range': 'meters',
                          'latitude': 'degrees_north', 'longitude': 'degrees_east', 'altitude': 'meters', 'DBZ': 'dBZ'}
        for name, unit in expected_units.items():
            if text(var[name]._attributes.get('units', '')) != unit:
                raise ValueError(f'Unexpected native units: {name}')
        azimuth = np.asarray(var['azimuth'].data).astype(np.float64).copy()
        ranges = np.asarray(var['range'].data).astype(np.float64).copy()
        if ranges.shape != (1496,) or not np.allclose(ranges, np.arange(1, 1497) * 30):
            raise ValueError('Unexpected native range coordinates')
        source = var['DBZ']; packed = np.asarray(source.data)
        scale = float(source._attributes.get('scale_factor', 1)); offset = float(source._attributes.get('add_offset', 0))
        fill = float(source._attributes.get('_FillValue', -32768))
        if packed.shape != (len(azimuth), len(ranges)):
            raise ValueError('Native source dimensions do not match coordinates')
        values = packed.astype(np.float32) * scale + offset
        invalid = packed == fill
        if 'missing_value' in source._attributes:
            invalid |= packed == source._attributes['missing_value']
        values[invalid] = np.nan
        info = {**provenance, 'sourceSweepNumberLabel': text(var['sweep_number']._attributes.get('long_name', '')),
                'normalizedElevationIndex': sweep - 1, 'fixedAngleDegrees': elevation,
                'scanStart': iso(epoch(start)), 'scanEnd': iso(epoch(end)),
                'siteLocation': {'latitude': float(scalar('latitude')), 'longitude': float(scalar('longitude')), 'altitudeMeters': float(scalar('altitude'))},
                'rayCount': len(azimuth), 'gateCount': len(ranges), 'rangeGateMeters': 30,
                'firstGateCenterMeters': float(ranges[0]), 'lastGateCenterMeters': float(ranges[-1]),
                'sourceField': 'DBZ', 'units': 'dBZ', 'sourceScaleFactor': scale, 'sourceAddOffset': offset,
                'sourceFillValue': fill, 'sourceDecodedValueRange': [float(np.nanmin(values)), float(np.nanmax(values))],
                'rayTimesAllZero': True, 'rawRayTimeUnits': text(var['time']._attributes.get('units', '')),
                'azimuthSha256': digest(azimuth.tobytes())}
        return values, azimuth, ranges, info


def cartesian_lookup(altitude):
    nx, ny, nz = DIMENSIONS
    axis = lambda name, n: BOUNDS[name][0] + (np.arange(n) + .5) * (BOUNDS[name][1] - BOUNDS[name][0]) / n
    x, y = np.meshgrid(axis('x', nx), axis('y', ny))
    ground = np.hypot(x, y)
    theta = ground[None, :, :] / RE
    z = axis('z', nz)[:, None, None]
    horizontal = (RE + z) * np.sin(theta)
    vertical = (RE + z) * np.cos(theta) - (RE + altitude)
    slant = np.hypot(horizontal, vertical)
    elevation = np.rad2deg(np.arctan2(vertical, horizontal))
    elevation_index = np.rint((elevation - ELEVATIONS[0]) / .5).astype(np.int16)
    gate = np.rint((slant - 30) / 30).astype(np.int16)
    valid = (elevation >= ELEVATIONS[0] - .25) & (elevation <= ELEVATIONS[-1] + .25) & (slant >= 15) & (slant <= 44895)
    return {'azimuth': np.rad2deg(np.arctan2(x, y)),
            'elevation': np.clip(elevation_index, 0, 44), 'gate': np.clip(gate, 0, 1495), 'valid': valid}


def render(cube, azimuth, lookup):
    ray, sector_valid, sector = sector_index(azimuth, lookup['azimuth'])
    values = cube[lookup['elevation'], ray[None, :, :], lookup['gate']]
    valid = lookup['valid'] & sector_valid[None, :, :] & np.isfinite(values)
    output = np.zeros(values.shape, dtype=np.uint8)
    output[valid] = np.clip(np.rint((values[valid] + 32) / .5) + 1, 1, 255).astype(np.uint8)
    return output, {'validVoxels': int(valid.sum()), 'totalVoxels': int(valid.size),
                    'displayedSourceRangeDbz': [float(values[valid].min()), float(values[valid].max())],
                    'clippedLowVoxels': int(np.sum(valid & (values < -32))),
                    'clippedHighVoxels': int(np.sum(valid & (values > 95))), 'sector': sector}


def publish(records):
    records = sorted(records, key=lambda r: r['frame']['time'])
    air = json.loads((ROOT / 'data/air/manifest.json').read_text())
    frames = [r['frame'] for r in records]
    manifest = {'schemaVersion': 1, 'id': 'air-volume', 'site': 'AIR', 'name': 'AIR volumetric reflectivity',
                'frameCount': len(frames), 'expectedFrameCount': 99, 'completeRequestedSubset': len(frames) == 99,
                'field': 'DBZ', 'units': 'dBZ', 'availableProducts': ['reflectivity'],
                'unavailableProducts': {'velocity': UNAVAILABLE_VELOCITY},
                'coverage': air['coverage'], 'maxAgeSeconds': 25,
                'firstProductTime': frames[0]['time'], 'lastProductTime': frames[-1]['time'],
                'siteLocation': records[0]['siteLocation'], 'elevationsDegrees': ELEVATIONS.tolist(),
                'volume': {'dimensions': DIMENSIONS, 'bounds': BOUNDS, 'sampling': 'cell-centers',
                           'axisOrder': 'x-fastest, then y, then z', 'arrayShape': [DIMENSIONS[2], DIMENSIONS[1], DIMENSIONS[0]],
                           'datatype': 'uint8', 'compression': 'gzip', 'missingValue': 0,
                           'decode': {'scale': .5, 'offset': -32, 'indexOffset': 1},
                           'voxelSpacingMeters': [(BOUNDS[k][1] - BOUNDS[k][0]) / n for k, n in zip(['x', 'y', 'z'], DIMENSIONS)],
                           'coordinateSystem': 'Radar-centered spherical azimuthal equidistant horizontal plane; x east, y north; z altitude above mean sea level, meters',
                           'horizontalOrigin': 'Recorded AIR latitude/longitude', 'heightReference': 'mean sea level',
                           'verticalExaggeration': 1, 'terrainIncluded': False},
                'colorScales': air['colorScales'], 'geolocation': air['geolocation'], 'sources': air['sources'],
                'processing': {'spatial': 'Nearest native elevation, azimuth and range gate. All 45 archived tilts are decoded; outside sector, range and half-elevation edge support is missing. No gap fill or beam smoothing.',
                               'geometry': 'Inverse standard 4/3-Earth beam geometry including recorded radar altitude. Horizontal coordinates are spherical surface arc distance and true bearing, not flat slant distance.',
                               'time': 'All 45 elevations share one volume interval, consistent with simultaneous elevation imaging. Display time is global interval midpoint; original ray times are zero and clock accuracy remains unverified.',
                               'quantization': '0 is missing; codes 1..255 represent (code-1)*0.5-32 dBZ. Nearest 0.5 dBZ with at most 0.25 dBZ quantization error unless explicitly counted clipping occurs.',
                               'resolution': 'Cartesian display sampling is approximately 354 by 281 by 167 m. This does not establish independent spatial resolution. Native 30 m range sampling, published 45 m independent range resolution and roughly 1-degree receive beams are distinct.',
                               'cropping': 'Grid covers x -45..23 km, y 0..45 km, z 0..16 km MSL. Data below 0 m MSL or outside that box are omitted. The 0 m floor is a reference plane, not a terrain model.',
                               'interpretation': 'Reflectivity volume, not a solid cloud boundary, surface tornado outline, or wind-speed measurement. Source registration and calibration remain unverified.'},
                'frames': frames}
    atomic_json(OUTPUT / 'manifest.json', manifest)
    atomic_json(OUTPUT / 'provenance.json', {'archive': ARCHIVE, 'createdAt': iso(datetime.now(timezone.utc).timestamp()),
                'completeRequestedSubset': len(frames) == 99, 'records': records})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--volumes', help='Comma-separated source volume numbers for a partial preview')
    parser.add_argument('--workers', type=int, default=6)
    args = parser.parse_args()
    OUTPUT.mkdir(parents=True, exist_ok=True); CACHE.mkdir(parents=True, exist_ok=True)
    archive, groups = source_groups(args.offline)
    selected = [int(v) for v in args.volumes.split(',')] if args.volumes else [1, 50, 99] + [v for v in range(1, 100) if v not in (1, 50, 99)]
    if not selected or any(v not in groups for v in selected):
        raise ValueError('Volume numbers must be between 1 and 99')
    records = []
    for path in sorted((OUTPUT / 'records').glob('volume-*.json')):
        record = json.loads(path.read_text()); target = ROOT / record['frame']['volumeURL']
        if target.exists() and digest(target.read_bytes()) == record['frame']['sha256']:
            records.append(record)
    existing = {r['frame']['sourceVolumeNumber'] for r in records}
    todo = [n for n in selected if n not in existing]
    download_pool = ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8)))
    pending_groups = {}
    lookup, lookup_location, total_start, downloaded = None, None, time.monotonic(), 0
    for number in selected:
        if number in existing:
            print(f'[{len(records)}/99] source volume {number} already verified; reusing output', flush=True)
            continue
        began = time.monotonic(); members = groups[number]; source_records = []; cube = None; azimuth = None; location = None
        if args.offline:
            group_fragment, group_start = None, None
        else:
            position = todo.index(number)
            # At most the current and next ~68 MiB groups are in flight. Sharing
            # eight HTTP workers prevents per-group final-chunk idle time and
            # overlaps the next group with decoding; no raw group is persisted.
            for queued_number in todo[position:position + 2]:
                if queued_number not in pending_groups:
                    pending_groups[queued_number] = start_group_download(groups[queued_number], archive['archiveSize'], download_pool)
            group_fragment, group_start = finish_group_download(pending_groups.pop(number))
        def load(item):
            raw, provenance = fetch(item, archive['archiveSize'], args.offline, keep=number == 1,
                                    group_fragment=group_fragment, group_start=group_start)
            return decode_sweep(item, raw, provenance)
        with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
            for index, result in enumerate(pool.map(load, members)):
                values, az, ranges, info = result
                if cube is None:
                    cube = np.empty((45, len(az), len(ranges)), dtype=np.float32)
                    azimuth = az; location = info['siteLocation']; scan_start = info['scanStart']; scan_end = info['scanEnd']
                if not np.array_equal(azimuth, az) or location != info['siteLocation'] or scan_start != info['scanStart'] or scan_end != info['scanEnd']:
                    raise ValueError('Sibling coordinates or acquisition intervals disagree')
                cube[index] = values; source_records.append(info)
                if (index + 1) % 15 == 0:
                    print(f'  volume {number}: {index + 1}/45 source tilts CRC/metadata verified', flush=True)
        if lookup is None:
            lookup = cartesian_lookup(location['altitudeMeters'])
            lookup_location = location
        elif lookup_location != location:
            raise ValueError('Site changed between source volumes; rebuild geometry before rendering')
        output, stats = render(cube, azimuth, lookup)
        raw = output.tobytes(order='C'); packed = gzip.compress(raw, compresslevel=6, mtime=0)
        stem = f'air_20130531_{members[0]["filenameTimestamp"].split("_")[1]}_v{number:03d}'
        destination = OUTPUT / (stem + '.bin.gz'); temporary = destination.with_suffix('.gz.tmp')
        temporary.write_bytes(packed); temporary.replace(destination)
        frame = {'time': iso((epoch(scan_start) + epoch(scan_end)) / 2), 'scanStart': scan_start, 'scanEnd': scan_end,
                 'sourceVolumeNumber': number, 'volumeURL': destination.relative_to(ROOT).as_posix(),
                 'sha256': digest(packed), 'uncompressedSha256': digest(raw), 'compressedBytes': len(packed),
                 'uncompressedBytes': len(raw), 'sourceSweepCount': 45,
                 'sourceKeys': [m['name'] for m in members], 'provenanceURL': f'data/air-volume/records/volume-{number:03d}.json'}
        record = {'frame': frame, 'siteLocation': location, 'sourceDirectorySha256': archive['directorySha256'],
                  'retrieval': 'Contiguous source-volume span in <=8 MiB HTTP byte ranges; each of 45 local headers and expanded CRCs verified; no complete-archive retention' if group_fragment is not None else 'Verified retained member caches',
                  'statistics': stats, 'sources': source_records, 'status': 'all-45-source-CRCs-verified-and-gridded'}
        (OUTPUT / 'records').mkdir(exist_ok=True)
        atomic_json(OUTPUT / 'records' / f'volume-{number:03d}.json', record)
        records.append(record); existing.add(number); publish(records)
        downloaded += sum(m['compressedSize'] for m in members)
        elapsed = time.monotonic() - total_start
        print(f'[{len(records)}/99] volume {number}: {time.monotonic()-began:.1f}s, gzip {len(packed)/1048576:.2f} MiB, source throughput {downloaded/1048576/elapsed:.2f} MiB/s', flush=True)
    if records:
        publish(records)
    download_pool.shutdown(wait=True)
    print(f'Published {len(records)}/99 volumes; complete={len(records)==99}', flush=True)


if __name__ == '__main__':
    main()
