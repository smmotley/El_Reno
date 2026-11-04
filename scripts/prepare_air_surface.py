#!/usr/bin/env python3
"""Build a genuine DEM reference surface on the AIR horizontal coordinate grid.

Mapzen/AWS zoom-10 Terrarium tiles are decoded in meters, bilinearly sampled at
their pixel centers, and exported as a 137 by 91 node grid in kilometers. No
terrain flattening, synthetic missing-height fallback, or datum shift is used.
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
import time
import urllib.request
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.cache' / 'air-surface'
OUTPUT = ROOT / 'data' / 'air-surface.json'
EARTH = 6371000.0
ZOOM = 10
DIMENSIONS = [137, 91]
BOUNDS = {'x': [-45, 23], 'y': [0, 45]}
BASE = 'https://elevation-tiles-prod.s3.amazonaws.com/terrarium'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def inverse_aeqd(x_km, y_km, site):
    """Horizontal inverse of the exact spherical AEQD plane used by AIR grids."""
    latitude0, longitude0 = np.deg2rad([site['latitude'], site['longitude']])
    arc = np.hypot(x_km, y_km) * 1000 / EARTH
    bearing = np.arctan2(x_km, y_km)
    latitude = np.arcsin(np.sin(latitude0) * np.cos(arc) + np.cos(latitude0) * np.sin(arc) * np.cos(bearing))
    longitude = longitude0 + np.arctan2(np.sin(bearing) * np.sin(arc) * np.cos(latitude0),
                                      np.cos(arc) - np.sin(latitude0) * np.sin(latitude))
    return np.rad2deg(latitude), np.rad2deg(longitude)


def pixel_centers(latitude, longitude):
    """Global Web Mercator pixel coordinates, with integer indices at centers."""
    size = (1 << ZOOM) * 256
    x = (longitude + 180) / 360 * size - .5
    y = (1 - np.arcsinh(np.tan(np.deg2rad(latitude))) / np.pi) / 2 * size - .5
    return x, y


def tile(x, y, offline=False):
    url = f'{BASE}/{ZOOM}/{x}/{y}.png'
    path = CACHE / str(ZOOM) / str(x) / f'{y}.png'
    metadata_path = path.with_suffix('.json')
    if path.exists() and metadata_path.exists():
        body = path.read_bytes(); metadata = json.loads(metadata_path.read_text())
        if sha(body) != metadata['sha256'] or metadata['url'] != url:
            raise ValueError('Cached terrain source hash or URL mismatch')
    else:
        if offline:
            raise FileNotFoundError(path)
        for attempt in range(4):
            try:
                request = urllib.request.Request(url, headers={'User-Agent': 'ElRenoHistoricalRadar/1.0 (educational terrain context)'})
                with urllib.request.urlopen(request, timeout=45) as response:
                    body = response.read(2 * 1024 * 1024 + 1)
                    if response.status != 200 or len(body) > 2 * 1024 * 1024:
                        raise ValueError('Unexpected terrain tile response')
                    headers = {key: response.headers.get(key) for key in ['ETag', 'Last-Modified', 'Content-Type', 'X-Imagery-Sources', 'x-amz-meta-x-imagery-sources']}
                break
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt + 1)
        metadata = {'url': url, 'zoom': ZOOM, 'x': x, 'y': y, 'sha256': sha(body), 'bytes': len(body),
                    'retrievedAtUtc': datetime.now(timezone.utc).isoformat(), 'headers': headers}
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body); metadata_path.write_text(json.dumps(metadata, indent=2) + '\n')
    with Image.open(io.BytesIO(body)) as image:
        image.verify()
    with Image.open(io.BytesIO(body)) as image:
        if image.size != (256, 256):
            raise ValueError(f'Unexpected terrain tile dimensions: {image.size}')
        rgba = np.array(image.convert('RGBA'), dtype=np.float64)
    heights = rgba[:, :, 0] * 256 + rgba[:, :, 1] + rgba[:, :, 2] / 256 - 32768
    heights[(rgba[:, :, 3] == 0) | (heights <= -32768)] = np.nan
    metadata.update(dimensions=[256, 256], cachePath=path.relative_to(ROOT).as_posix())
    return x, y, heights, metadata


def sample(mosaic, px, py, x_tile_min, y_tile_min):
    x = px - x_tile_min * 256; y = py - y_tile_min * 256
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    dx = x - x0; dy = y - y0
    if np.any(x0 < 0) or np.any(y0 < 0) or np.any(x0 + 1 >= mosaic.shape[1]) or np.any(y0 + 1 >= mosaic.shape[0]):
        raise ValueError('Terrain mosaic lacks required bilinear neighbors')
    neighbors = [mosaic[y0, x0], mosaic[y0, x0 + 1], mosaic[y0 + 1, x0], mosaic[y0 + 1, x0 + 1]]
    if any(np.any(~np.isfinite(values)) for values in neighbors):
        raise ValueError('Missing source terrain data; refusing synthetic height fallback')
    return ((1 - dx) * (1 - dy) * neighbors[0] + dx * (1 - dy) * neighbors[1]
            + (1 - dx) * dy * neighbors[2] + dx * dy * neighbors[3])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    site = json.loads((ROOT / 'data/air-volume/manifest.json').read_text())['siteLocation']
    nx, ny = DIMENSIONS
    x, y = np.meshgrid(np.linspace(*BOUNDS['x'], nx), np.linspace(*BOUNDS['y'], ny))
    latitude, longitude = inverse_aeqd(x, y, site)
    px, py = pixel_centers(latitude, longitude)
    x_min, x_max = int(np.floor(px.min())) // 256, int(np.floor(px.max()) + 1) // 256
    y_min, y_max = int(np.floor(py.min())) // 256, int(np.floor(py.max()) + 1) // 256
    coordinates = [(tx, ty) for ty in range(y_min, y_max + 1) for tx in range(x_min, x_max + 1)]
    mosaic = np.full(((y_max - y_min + 1) * 256, (x_max - x_min + 1) * 256), np.nan)
    records = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for tx, ty, heights, metadata in pool.map(lambda pair: tile(*pair, args.offline), coordinates):
            row, column = (ty - y_min) * 256, (tx - x_min) * 256
            mosaic[row:row + 256, column:column + 256] = heights
            records.append(metadata)
    heights_m = sample(mosaic, px, py, x_min, y_min)
    if not np.all(np.isfinite(heights_m)) or heights_m.min() < 200 or heights_m.max() > 1000:
        raise ValueError(f'Unexpected regional terrain elevations: {heights_m.min()}..{heights_m.max()} m; review source rather than clamping')
    # The origin is an actual node: x index90, y index0. Compare independently
    # with a direct source pixel sample to guard against reversed row ordering.
    origin_px, origin_py = pixel_centers(site['latitude'], site['longitude'])
    origin_height = float(sample(mosaic, np.array(origin_px), np.array(origin_py), x_min, y_min))
    origin_x_index = int(round((0 - BOUNDS['x'][0]) / .5))
    if abs(float(heights_m[0, origin_x_index]) - origin_height) > .00001:
        raise ValueError('Terrain node ordering/origin sampling mismatch')
    imagery_sources = sorted({source.strip()
                              for record in records
                              for source in (record['headers'].get('X-Imagery-Sources')
                                             or record['headers'].get('x-amz-meta-x-imagery-sources')
                                             or '').split(',') if source.strip()})
    terrain = {'dimensions': DIMENSIONS, 'bounds': BOUNDS, 'sampling': 'nodes', 'axisOrder': 'x-fastest, then y',
               'units': 'km', 'heights': np.round(heights_m / 1000, 6).ravel(order='C').tolist(),
               'nodeSpacingKm': [.5, .5], 'heightRangeKm': [float(heights_m.min() / 1000), float(heights_m.max() / 1000)],
               'heightReference': 'Approximate mean sea level; source vertical datum has not been independently harmonized with radar altitude',
               'verticalExaggeration': 1, 'terrainDate': 'Not a reconstruction of terrain conditions on May 31, 2013',
               'purpose': 'Regional terrain reference for the 3D map. Resampled DEM heights are not measured chaser/GPS altitudes, road-deck elevations, or precision clearance measurements.'}
    result = {'schemaVersion': 1, 'id': 'air-surface', 'terrain': terrain, 'siteLocation': site,
              'attribution': 'Terrain: Mapzen Terrain Tiles, hosted on AWS Open Data. The downloaded tiles identify SRTM and GMTED2010 terrain imagery, courtesy of the U.S. Geological Survey.',
              'sources': [
                  {'title': 'Terrain Tiles on AWS Open Data', 'url': 'https://registry.opendata.aws/terrain-tiles/'},
                  {'title': 'Terrarium encoding and projection specification', 'url': 'https://github.com/tilezen/joerd/blob/master/docs/formats.md'},
                  {'title': 'Terrain data sources and pixel resolution', 'url': 'https://github.com/tilezen/joerd/blob/master/docs/data-sources.md'},
                  {'title': 'Mapzen/USGS attribution', 'url': 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'}],
              'provenance': {'createdAtUtc': datetime.now(timezone.utc).isoformat(), 'tiles': records, 'tileCount': len(records),
                             'declaredImagerySources': imagery_sources,
                             'imagerySourceScope': 'Source filenames reported by the downloaded tiles; per-node source contributions are not individually identified.',
                             'rebuildCommand': 'python3 scripts/prepare_air_surface.py --offline',
                             'sourceFormat': '256x256 RGB Terrarium PNG, Web Mercator, zoom 10',
                             'sourcePixelMetersNearRadar': math.cos(math.radians(site['latitude'])) * 2 * math.pi * 6378137 / (256 * (1 << ZOOM)),
                             'sourceDecodeMeters': 'red*256 + green + blue/256 - 32768',
                             'horizontalTransform': 'Inverse spherical azimuthal equidistant using Earth radius 6371000 m, the recorded AIR latitude/longitude, x east and y north',
                             'interpolation': 'Bilinear interpolation of decoded elevations with integer global pixel coordinates at pixel centers, including neighbors across tile seams',
                             'rounding': 'Exported kilometers rounded to 0.000001 km (1 mm); numeric storage precision does not imply height accuracy',
                             'modifications': 'Coordinate transform, bilinear resampling and numeric rounding only. No flattening, terrain offset, geoid correction or synthetic missing-value fill.',
                             'sourceVerticalDatum': 'The downloaded tiles do not independently establish one harmonized vertical datum. Exact source-datum consistency with AIR altitude is unverified; no NAVD88/EGM96 or ellipsoid conversion is assumed.',
                             'geographicBounds': {'south': float(latitude.min()), 'north': float(latitude.max()), 'west': float(longitude.min()), 'east': float(longitude.max())},
                             'radarOriginHeightMeters': origin_height,
                             'validation': {'finiteNodeCount': int(heights_m.size), 'regionalPlausibilityPassed': True, 'originNodeMatchesDirectTileSample': True}}}
    temporary = OUTPUT.with_suffix('.json.tmp'); temporary.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n'); temporary.replace(OUTPUT)
    print(f'Terrain ready: {nx}x{ny} nodes from {len(records)} tiles, {heights_m.min():.2f}..{heights_m.max():.2f} m; origin {origin_height:.2f} m', flush=True)


if __name__ == '__main__':
    main()
