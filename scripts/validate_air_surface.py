#!/usr/bin/env python3
"""Offline independent DEM decode, projection and client height-sampling audit."""
from pathlib import Path
import hashlib
import json
import math
import subprocess
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
surface = json.loads((ROOT / 'data/air-surface.json').read_text())
terrain = surface['terrain']
nx, ny = terrain['dimensions']
assert terrain['sampling'] == 'nodes' and terrain['axisOrder'] == 'x-fastest, then y'
assert terrain['units'] == 'km' and terrain['verticalExaggeration'] == 1
x, y = np.meshgrid(np.linspace(*terrain['bounds']['x'], nx), np.linspace(*terrain['bounds']['y'], ny))

# Independent inverse AEQD via 3D unit vectors and a local tangent basis.
# This does not use the producer's latitude/longitude destination formulas.
lat0, lon0 = map(math.radians, (surface['siteLocation']['latitude'], surface['siteLocation']['longitude']))
origin = np.array([math.cos(lat0)*math.cos(lon0), math.cos(lat0)*math.sin(lon0), math.sin(lat0)])
east = np.array([-math.sin(lon0), math.cos(lon0), 0])
north = np.array([-math.sin(lat0)*math.cos(lon0), -math.sin(lat0)*math.sin(lon0), math.cos(lat0)])
distance = np.hypot(x, y)
nonzero = np.where(distance == 0, 1, distance)
tangent = x[...,None]/nonzero[...,None]*east + y[...,None]/nonzero[...,None]*north
xyz = np.cos(distance[...,None]/6371)*origin + np.sin(distance[...,None]/6371)*tangent
latitude = np.degrees(np.arctan2(xyz[...,2], np.hypot(xyz[...,0], xyz[...,1])))
longitude = np.degrees(np.arctan2(xyz[...,1], xyz[...,0]))

tiles = {}
for record in surface['provenance']['tiles']:
    body = (ROOT / record['cachePath']).read_bytes()
    assert hashlib.sha256(body).hexdigest() == record['sha256']
    with Image.open(ROOT / record['cachePath']) as image:
        assert image.size == (256, 256)
        tiles[record['x'],record['y']] = np.asarray(image.convert('RGBA')).astype(float)
size = 256 * (2 ** surface['provenance']['tiles'][0]['zoom'])
px = (longitude+180)/360*size - .5
py = (1-np.log(np.tan(np.pi/4 + np.radians(latitude)/2))/np.pi)/2*size - .5

def height(global_x, global_y):
    tile = tiles[global_x//256,global_y//256]
    r,g,b,a = tile[global_y%256,global_x%256]
    assert a > 0
    h = r*256 + g + b/256 - 32768
    assert h > -32768
    return h

expected = []
seam_nodes = 0
for u,v in zip(px.ravel(),py.ravel()):
    i,j = math.floor(u),math.floor(v)
    a,b = u-i,v-j
    value = (height(i,j)*(1-a)*(1-b) + height(i+1,j)*a*(1-b)
             + height(i,j+1)*(1-a)*b + height(i+1,j+1)*a*b)
    expected.append(value)
    seam_nodes += i//256 != (i+1)//256 or j//256 != (j+1)//256
expected = np.asarray(expected)
actual = np.asarray(terrain['heights']) * 1000
error = np.abs(actual-expected)
assert len(actual) == nx*ny and np.all(np.isfinite(actual))
assert error.max() <= .000501, 'Terrain differs from original pixels beyond 1mm storage rounding'

# Compare the independent inverse coordinates with the actual browser helper.
# Test node sampling plus arbitrary between-node positions separately.
rng = np.random.default_rng(20130531)
between = []
grid = np.asarray(terrain['heights']).reshape(ny,nx)
for _ in range(1000):
    i,j = int(rng.integers(nx-1)),int(rng.integers(ny-1))
    a,b = rng.random(2)
    h = grid[j,i]*(1-a)*(1-b)+grid[j,i+1]*a*(1-b)+grid[j+1,i]*(1-a)*b+grid[j+1,i+1]*a*b
    between.append([float(x[j,i]+a*.5),float(y[j,i]+b*.5),float(h)])
payload = {'nodes':np.column_stack([latitude.ravel(),longitude.ravel(),x.ravel(),y.ravel(),actual/1000]).tolist(), 'between':between}
javascript = """
import fs from 'node:fs';
import {radarLocalPosition,surfaceHeight,surfacePosition} from './js/air-surface.js';
const data=JSON.parse(fs.readFileSync(0,'utf8'));
const raw=JSON.parse(fs.readFileSync('data/air-surface.json','utf8'));
let maxProjectionErrorKm=0,maxHeightErrorKm=0;
for(const [lat,lon,x,y,z] of data.nodes){
  const p=radarLocalPosition(lat,lon,raw.siteLocation);
  maxProjectionErrorKm=Math.max(maxProjectionErrorKm,Math.hypot(p[0]-x,p[1]-y));
  maxHeightErrorKm=Math.max(maxHeightErrorKm,Math.abs(surfaceHeight(raw.terrain,x,y)-z));
}
for(const [x,y,z] of data.between)maxHeightErrorKm=Math.max(maxHeightErrorKm,Math.abs(surfaceHeight(raw.terrain,x,y)-z));
if(maxProjectionErrorKm>1e-8||maxHeightErrorKm>1e-12)throw Error('Client projection or terrain sampling differs');
for(const [x,y] of [[-45.001,0],[23.001,0],[0,-.001],[0,45.001]])if(surfaceHeight(raw.terrain,x,y)!==null)throw Error('Terrain extrapolation');
if(surfacePosition(null,raw)!==null)throw Error('Missing position became a marker');
process.stdout.write(JSON.stringify({nodes:data.nodes.length,betweenNodeChecks:data.between.length,maxProjectionErrorMeters:maxProjectionErrorKm*1000,maxClientHeightErrorMeters:maxHeightErrorKm*1000,outsideDomainRejected:true,missingPositionRejected:true}));
"""
client = subprocess.run(['node','--input-type=module','-e',javascript],cwd=ROOT,input=json.dumps(payload),text=True,capture_output=True,check=True)
report = {'method':'Independent 3D unit-vector inverse projection, original PNG hashes and RGB decoding, bilinear source-pixel sampling, then actual JavaScript forward-projection and height-helper checks. No producer imports or downloads.',
          'sourceTilesVerified':len(tiles),'terrainNodesChecked':nx*ny,'nodesUsingTileSeamNeighbors':int(seam_nodes),
          'maxNodeDifferenceMeters':float(error.max()),'elevationRangeMeters':[float(actual.min()),float(actual.max())],
          'radarOriginDemMeters':float(actual[90]),'archivedRadarAltitudeMeters':surface['siteLocation']['altitudeMeters'],
          'client':json.loads(client.stdout),'limitations':'Approximate sea-level terrain from mixed source dates/datums;500m output mesh is not a road-deck or GPS-altitude measurement. Radar registration remains unverified.'}
(ROOT / 'docs/air-surface-audit-data.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
