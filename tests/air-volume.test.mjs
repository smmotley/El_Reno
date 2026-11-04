import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { createVolumeRadarSource, radarCoverage, selectRadarFrame } from '../js/radar-source.js';

const read = path => readFileSync(new URL('../' + path, import.meta.url));
const json = path => JSON.parse(read(path));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = json('data/air-volume/manifest.json');
const planar = json('data/air/manifest.json');
const source = createVolumeRadarSource(planar, manifest);

test('the released 3D collection contains all 99 original volumes and 45 elevations', () => {
  assert.equal(manifest.completeRequestedSubset, true, 'Partial conversion must not pass release checks.');
  assert.equal(manifest.frameCount, 99);
  assert.equal(manifest.expectedFrameCount, 99);
  assert.equal(manifest.frames.length, 99);
  assert.deepEqual(manifest.frames.map(f => f.sourceVolumeNumber), Array.from({length:99}, (_,i) => i+1));
  assert.deepEqual(manifest.elevationsDegrees, Array.from({length:45}, (_,i) => -2 + i/2));
  assert.deepEqual(manifest.availableProducts, ['reflectivity']);
  assert.ok(manifest.unavailableProducts.velocity.reason);
  assert.equal(manifest.geolocation.appliedCorrection, null);
});

test('every compressed 3D file matches its provenance and full decoded grid', () => {
  const grid = manifest.volume;
  assert.equal(grid.datatype, 'uint8');
  assert.equal(grid.missingValue, 0);
  assert.equal(grid.compression, 'gzip');
  assert.equal(grid.axisOrder, 'x-fastest, then y, then z');
  assert.deepEqual(grid.arrayShape, grid.dimensions.toReversed());
  assert.equal(grid.heightReference, 'mean sea level');
  assert.equal(grid.verticalExaggeration, 1);
  assert.equal(grid.terrainIncluded, false);
  const expectedBytes = grid.dimensions.reduce((a,b) => a*b,1);
  for (const frame of manifest.frames) {
    const compressed = read(frame.volumeURL), decoded = gunzipSync(compressed);
    assert.equal(compressed.length, frame.compressedBytes, frame.volumeURL);
    assert.equal(digest(compressed), frame.sha256, frame.volumeURL);
    assert.equal(decoded.length, expectedBytes, frame.volumeURL);
    assert.equal(decoded.length, frame.uncompressedBytes, frame.volumeURL);
    assert.equal(digest(decoded), frame.uncompressedSha256, frame.volumeURL);
    const record = json(frame.provenanceURL);
    assert.deepEqual(record.frame, frame);
    let valid = 0;
    for (const value of decoded) if(value !== grid.missingValue) valid++;
    assert.equal(valid, record.statistics.validVoxels);
    assert.ok(valid > 0 && valid < expectedBytes, 'Observed and unobserved cells must remain distinct.');
    assert.equal(record.statistics.clippedLowVoxels, 0);
    assert.equal(record.statistics.clippedHighVoxels, 0);
  }
});

test('each 3D volume groups only its own 45 verified slices with one original interval', () => {
  for (const frame of manifest.frames) {
    const record = json(frame.provenanceURL);
    assert.equal(frame.sourceSweepCount, 45);
    assert.equal(record.sources.length, 45);
    assert.deepEqual(record.sources.map(s => s.name), frame.sourceKeys);
    assert.equal(new Set(frame.sourceKeys).size, 45);
    assert.equal(Date.parse(frame.time), (Date.parse(frame.scanStart)+Date.parse(frame.scanEnd))/2);
    assert.deepEqual(record.siteLocation, manifest.siteLocation);
    for (const [index,slice] of record.sources.entries()) {
      assert.equal(slice.crc32Verified, true);
      assert.match(slice.netcdfSha256, /^[a-f0-9]{64}$/);
      assert.equal(slice.volumeNumber, frame.sourceVolumeNumber);
      assert.equal(slice.normalizedElevationIndex, index);
      assert.equal(slice.fixedAngleDegrees, manifest.elevationsDegrees[index]);
      assert.equal(slice.scanStart, frame.scanStart);
      assert.equal(slice.scanEnd, frame.scanEnd);
      assert.deepEqual(slice.siteLocation, manifest.siteLocation);
      assert.equal(slice.sourceField, 'DBZ');
      assert.equal(slice.units, 'dBZ');
      assert.equal(slice.rayTimesAllZero, true);
    }
  }
});

test('2D and 3D choose the same observation throughout the recorded window', () => {
  assert.deepEqual(radarCoverage(source), radarCoverage(planar));
  assert.equal(manifest.frames[0].time, planar.frames[0].time);
  assert.equal(manifest.frames.at(-1).time, planar.frames.at(-1).time);
  for (const frame of manifest.frames) {
    const time = Date.parse(frame.time);
    const a = selectRadarFrame(source, time, 'reflectivity');
    const b = selectRadarFrame(planar, time, 'reflectivity');
    assert.equal(a.frame.time, b.frame.time);
    assert.equal(a.frame.sourceKeys[5], b.frame.sourceKey);
    assert.equal(a.frame.reflectivity, frame.volumeURL);
    assert.equal(a.ageSeconds, 0);
    assert.equal(selectRadarFrame(source, time, 'velocity'), null);
  }
  const bounds = radarCoverage(source);
  for(let time=bounds.start;time<=bounds.end;time+=1000) {
    assert.equal(selectRadarFrame(source,time,'reflectivity')?.frame.time, selectRadarFrame(planar,time,'reflectivity')?.frame.time);
  }
  assert.equal(selectRadarFrame(source,bounds.start-1,'reflectivity'),null);
  assert.equal(selectRadarFrame(source,bounds.end+1,'reflectivity'),null);
});

test('missing 3D intervals expire without borrowing 2D imagery or future volumes', () => {
  const sparse = createVolumeRadarSource(planar,{...manifest,frames:[manifest.frames[0],manifest.frames.at(-1)]});
  const first = Date.parse(sparse.frames[0].time), last = Date.parse(sparse.frames[1].time);
  assert.equal(selectRadarFrame(sparse,first+25000,'reflectivity').ageSeconds,25);
  assert.equal(selectRadarFrame(sparse,first+25001,'reflectivity'),null);
  assert.equal(selectRadarFrame(sparse,last-1,'reflectivity'),null);
  assert.equal(selectRadarFrame(sparse,last,'reflectivity').frame,sparse.frames[1]);
  assert.equal(createVolumeRadarSource(planar,{frames:[]}),null);
  assert.equal(createVolumeRadarSource(planar,null),null);
  assert.equal(planar.frames[0].volumeURL,undefined,'The 2D manifest must not be mutated.');
});
