import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAirAlignment, radarDisplayBounds } from '../js/air-alignment.js';
import { radarLocalPosition } from '../js/air-surface.js';

const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const config=json('../data/air-alignment.json'),air=json('../data/air/manifest.json');
const alignment=createAirAlignment(config,air.siteLocation);
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`);

test('both projections align the marked feature with the actual 6:12 NWS point',()=>{
  const nws=json('../data/tornado-timeline.json').points.find(p=>Date.parse(p.time)===Date.parse(config.time));
  assert.deepEqual(config.target,{lat:nws.lat,lon:nws.lon});
  assert.equal(Date.parse(air.frames[0].time),Date.parse(config.time));
  const mapped=alignment.translate(config.source);
  near(mapped.lat,nws.lat);near(mapped.lon,nws.lon);
  const a=radarLocalPosition(config.source.lat,config.source.lon,air.siteLocation);
  const b=radarLocalPosition(nws.lat,nws.lon,air.siteLocation);
  a.forEach((value,i)=>near(value+alignment.localKm[i],b[i]));
  near(alignment.localKm[0],6.643673944275299);
  near(alignment.localKm[1],.9791044533639997);
});

test('all AIR images share a constant translation with no change to image scale or source metadata',()=>{
  const before=JSON.stringify(air);
  const project=([lat,lon])=>[6378137*lon*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
  for(const frame of air.frames){
    assert.ok(frame.reflectivity);
    const adjusted=radarDisplayBounds('air',air.bounds,alignment,true);
    adjusted.forEach((corner,i)=>project(corner).forEach((value,j)=>near(value-project(air.bounds[i])[j],alignment.mercatorMeters[j])));
  }
  assert.equal(JSON.stringify(air),before);
  assert.equal(air.frames.length,99);
});

test('original option and WSR-88D bypass the display transform entirely',()=>{
  assert.strictEqual(radarDisplayBounds('air',air.bounds,alignment,false),air.bounds);
  const ktlx=json('../data/radar/manifest.json');
  assert.strictEqual(radarDisplayBounds('ktlx',ktlx.bounds,alignment,true),ktlx.bounds);
  assert.strictEqual(radarDisplayBounds('ktlx',ktlx.bounds,alignment,false),ktlx.bounds);
});
