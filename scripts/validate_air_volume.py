#!/usr/bin/env python3
"""Independent, offline AIR volume audit against retained original NetCDF bytes.

Does not import the production converter. Requires numpy and scipy, like the
converter. Run after any newly published volumes to refresh the report.
"""
from pathlib import Path
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import struct
import zlib
import numpy as np
from scipy.io import netcdf_file

ROOT = Path(__file__).resolve().parents[1]
RE = 4 * 6371000 / 3


def sha(data):
    return hashlib.sha256(data).hexdigest()


def original_directory():
    body = (ROOT / '.cache/air/central-directory.bin').read_bytes()
    pos, result = 0, {}
    while pos < len(body):
        header = struct.unpack_from('<4s6H3I5H2I', body, pos)
        assert header[0] == b'PK\x01\x02'
        n, extra, comment = header[10:13]
        name = body[pos + 46:pos + 46 + n].decode()
        result[name] = (header[7], header[9])
        pos += 46 + n + extra + comment
    assert pos == len(body)
    return result


def source(member, directory):
    name = Path(member).name
    volume = int(name.split('_v')[1].split('_')[0])
    options = [ROOT / '.cache/air' / name.replace('.nc', '.deflate'),
               ROOT / '.cache/air-time-audit' / (name + '.deflate'),
               ROOT / f'.cache/air-volume/v{volume:03d}' / (name + '.deflate')]
    cache = next(p for p in options if p.exists())
    raw = zlib.decompress(cache.read_bytes(), -15)
    crc, size = directory[member]
    assert len(raw) == size and zlib.crc32(raw) & 0xffffffff == crc
    with netcdf_file(io.BytesIO(raw), 'r', mmap=False) as nc:
        v = nc.variables
        dbz = v['DBZ']; packed = np.array(dbz.data)
        values = packed.astype(np.float64) * float(dbz.scale_factor) + float(dbz.add_offset)
        values[packed == dbz._FillValue] = np.nan
        if 'missing_value' in dbz._attributes:
            values[packed == dbz.missing_value] = np.nan
        scalar = lambda name: np.asarray(v[name].data).flat[0].item()
        return {'values': values, 'az': np.array(v['azimuth'].data, dtype=float),
                'range': np.array(v['range'].data, dtype=float),
                'elevation': float(scalar('fixed_angle')), 'altitude': float(scalar('altitude')),
                'latitude': float(scalar('latitude')), 'longitude': float(scalar('longitude')),
                'start': nc.time_coverage_start.decode(), 'end': nc.time_coverage_end.decode(),
                'sha256': sha(raw)}


def native_coordinates(indices, manifest):
    volume = manifest['volume']
    nx, ny, nz = volume['dimensions']
    xindex = indices % nx
    yindex = indices // nx % ny
    zindex = indices // (nx * ny)
    physical = []
    for key, n, i in zip('xyz', (nx, ny, nz), (xindex, yindex, zindex)):
        lo, hi = volume['bounds'][key]
        physical.append(lo + (i + .5) * (hi - lo) / n)
    x, y, z = physical
    theta = np.hypot(x, y) / RE
    radar_radius = RE + manifest['siteLocation']['altitudeMeters']
    target_radius = RE + z
    # Law of cosines in a cancellation-resistant form, independent of the
    # converter's tangent-vector horizontal/vertical implementation.
    slant = np.sqrt((target_radius - radar_radius) ** 2 +
                    4 * target_radius * radar_radius * np.sin(theta / 2) ** 2)
    sine = (target_radius ** 2 - radar_radius ** 2 - slant ** 2) / (2 * radar_radius * slant)
    elevation = np.degrees(np.arcsin(np.clip(sine, -1, 1)))
    azimuth = np.degrees(np.arctan2(x, y))
    return elevation, azimuth, slant


def nearest(values, queries):
    right = np.minimum(np.searchsorted(values, queries), len(values) - 1)
    left = np.maximum(right - 1, 0)
    return np.where(np.abs(queries - values[left]) <= np.abs(values[right] - queries), left, right)


def compare(indices, output, manifest, sweeps, restrict_six=False):
    elevation, azimuth, slant = native_coordinates(indices, manifest)
    levels = np.array(manifest['elevationsDegrees'])
    level_index = nearest(levels, elevation)
    if restrict_six:
        keep = level_index == 5
        indices, elevation, azimuth, slant, level_index = [a[keep] for a in
            (indices, elevation, azimuth, slant, level_index)]
    reference = sweeps[5] if restrict_six else sweeps[0]
    native_az = reference['az']
    angular_error = np.abs((azimuth[:, None] - native_az[None, :] + 180) % 360 - 180)
    ray_index = np.argmin(angular_error, axis=1)
    ordered = np.degrees(np.sort(np.unwrap(np.radians(native_az))))
    az_step = np.median(np.diff(ordered))
    assert np.max(np.diff(ordered)) < az_step * 1.1, 'Unexpected unobserved internal azimuth gap'
    center = (ordered[0] + ordered[-1]) / 2
    relative_azimuth = center + (azimuth - center + 180) % 360 - 180
    azimuth_covered = ((relative_azimuth >= ordered[0] - az_step / 2) &
                       (relative_azimuth <= ordered[-1] + az_step / 2))
    gate_index = nearest(reference['range'], slant)
    valid_geometry = ((elevation >= levels[0] - .25) & (elevation <= levels[-1] + .25) &
                      (slant >= 15) & (slant <= 44895) & azimuth_covered)
    values = np.full(len(indices), np.nan)
    for index, sweep in sweeps.items():
        selected = (level_index == index) & valid_geometry
        values[selected] = sweep['values'][ray_index[selected], gate_index[selected]]
    valid = valid_geometry & np.isfinite(values)
    actual = output[indices]
    assert np.all(actual[~valid] == 0), 'Unobserved/missing native data became visible'
    assert np.all(actual[valid] > 0), 'Observed native data became missing'
    decoded = (actual[valid].astype(float) - 1) * .5 - 32
    quantization_error = np.abs(decoded - np.clip(values[valid], -32, 95))
    assert np.all(quantization_error <= .25001), 'Source value exceeds half-bin quantization error'
    expected = np.clip(np.rint((values[valid] + 32) / .5) + 1, 1, 255)
    # The native scale is stored as float32. Exact half-bin values may round
    # either way when decoded in float32 vs float64; both must stay within .25.
    tie_cases = np.count_nonzero(actual[valid] != expected)
    assert np.all(np.abs(actual[valid].astype(float) - expected) <= 1)
    return {'checkedVoxels': int(len(indices)), 'observedVoxels': int(valid.sum()),
            'missingVoxels': int((~valid).sum()), 'quantizationTieCases': int(tie_cases),
            'maxQuantizationErrorDbz': float(quantization_error.max(initial=0)),
            'sourceElevationsExercised': sorted(set(float(levels[n]) for n in level_index[valid]))}


def main():
    manifest = json.loads((ROOT / 'data/air-volume/manifest.json').read_text())
    directory = original_directory()
    assert manifest['volume']['heightReference'] == 'mean sea level'
    assert manifest['volume']['verticalExaggeration'] == 1
    assert manifest['volume']['missingValue'] == 0
    assert manifest['volume']['decode'] == {'scale': .5, 'offset': -32, 'indexOffset': 1}
    assert manifest['availableProducts'] == ['reflectivity']
    nx, ny, nz = manifest['volume']['dimensions']
    count = nx * ny * nz
    rng = np.random.default_rng(20130531)
    sample = rng.choice(count, 25000, replace=False)
    # Deliberately include all box faces/corners in addition to random interior.
    z, y, x = np.meshgrid(np.unique(np.r_[0, np.arange(0, nz, 7), nz-1]),
                         np.unique(np.r_[0, np.arange(0, ny, 11), ny-1]),
                         np.unique(np.r_[0, np.arange(0, nx, 13), nx-1]), indexing='ij')
    sample = np.unique(np.r_[sample, (x + nx * (y + ny * z)).ravel()])
    checks = []
    clipping = {'low': 0, 'high': 0}
    first = next(f for f in manifest['frames'] if f['sourceVolumeNumber'] == 1)
    sweeps = {i: source(name, directory) for i, name in enumerate(first['sourceKeys'])}
    assert len(sweeps) == 45
    assert [sweeps[i]['elevation'] for i in range(45)] == manifest['elevationsDegrees']
    for i in range(45):
        assert np.array_equal(sweeps[i]['az'], sweeps[0]['az'])
        assert np.array_equal(sweeps[i]['range'], sweeps[0]['range'])
        assert sweeps[i]['start'] == sweeps[0]['start'] and sweeps[i]['end'] == sweeps[0]['end']
        assert sweeps[i]['altitude'] == manifest['siteLocation']['altitudeMeters']
        assert sweeps[i]['latitude'] == manifest['siteLocation']['latitude']
        assert sweeps[i]['longitude'] == manifest['siteLocation']['longitude']
    for frame in manifest['frames']:
        compressed = (ROOT / frame['volumeURL']).read_bytes()
        raw = gzip.decompress(compressed)
        assert sha(compressed) == frame['sha256'] and sha(raw) == frame['uncompressedSha256']
        assert len(raw) == count == frame['uncompressedBytes']
        output = np.frombuffer(raw, dtype=np.uint8)
        provenance = json.loads((ROOT / frame['provenanceURL']).read_text())
        assert np.count_nonzero(output) == provenance['statistics']['validVoxels']
        assert len(provenance['sources']) == 45
        assert all(s['crc32Verified'] for s in provenance['sources'])
        assert provenance['siteLocation'] == manifest['siteLocation']
        clipping['low'] += provenance['statistics']['clippedLowVoxels']
        clipping['high'] += provenance['statistics']['clippedHighVoxels']
        if frame['sourceVolumeNumber'] == 1:
            result = compare(sample, output, manifest, sweeps)
        else:
            selected = source(frame['sourceKeys'][5], directory)
            assert selected['altitude'] == manifest['siteLocation']['altitudeMeters']
            assert selected['latitude'] == manifest['siteLocation']['latitude']
            assert selected['longitude'] == manifest['siteLocation']['longitude']
            result = compare(sample, output, manifest, {5: selected}, restrict_six=True)
        checks.append({'sourceVolumeNumber': frame['sourceVolumeNumber'], **result})
    report = {'auditedAtUtc': datetime.now(timezone.utc).isoformat(),
              'method': 'Offline CRC-verified native sources, independent triangle-law beam inversion and nearest native-coordinate matching; no production converter imports.',
              'publishedVolumeCount': len(checks), 'completeRequestedSubset': manifest['completeRequestedSubset'],
              'firstVolumeSourceSweepsIndependentlyVerified': 45,
              'sourceChecks': 'All 45 first-volume sources; cached 0.5-degree source for every other published volume.',
              'allPublishedOutputHashesVerified': True, 'checks': checks,
              'declaredClippedVoxels': clipping,
              'totalVoxelsChecked': sum(c['checkedVoxels'] for c in checks),
              'maxQuantizationErrorDbz': max(c['maxQuantizationErrorDbz'] for c in checks),
              'limits': 'Representative native-value checks, not every voxel. Source clock, location and reflectivity calibration remain independently unverified.'}
    (ROOT / 'docs/air-volume-audit-data.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k:v for k,v in report.items() if k != 'checks'}, indent=2))


if __name__ == '__main__':
    main()
