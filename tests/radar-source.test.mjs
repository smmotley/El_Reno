import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { radarFrameAt } from '../js/analysis.js';
import { radarCoverage, selectRadarFrame } from '../js/radar-source.js';

const t = Date.parse('2013-05-31T23:20:00Z');
const iso = offset => new Date(t + offset * 1000).toISOString();
const frame = (source, offset, velocityOffset = offset) => ({
  time: iso(offset - 4),
  reflectivityTime: iso(offset), velocityTime: iso(velocityOffset),
  reflectivity: `data/radar-${source}/${offset}-reflectivity.png`,
  velocity: `data/radar-${source}/${offset}-velocity.png`,
  products: {
    reflectivity: { time: iso(offset), units: 'dBZ', scanStart: iso(offset - 4), scanEnd: iso(offset + 4) },
    velocity: { time: iso(velocityOffset), units: 'kt', dealiased: source === 'air' ? null : false }
  }
});
const ktlx = { id: 'ktlx', frames: [frame('ktlx', 0, 19), frame('ktlx', 280, 299)] };
// Synthetic paired fixture exercises general timing. The released 2013 AIR
// dataset explicitly blocks velocity; real-data tests enforce that decision.
const air = { id: 'air', maxAgeSeconds: 25, coverage: { start: iso(-4), end: iso(32) },
  frames: [frame('air', 0), frame('air', 8), frame('air', 16), frame('air', 28)] };

test('different source cadences select each source independently without inventing intermediate scans', () => {
  assert.equal(selectRadarFrame(air, t + 17000, 'reflectivity').frame, air.frames[2]);
  assert.equal(selectRadarFrame(ktlx, t + 17000, 'reflectivity').frame, ktlx.frames[0]);
  assert.equal(selectRadarFrame(air, t + 17000, 'reflectivity').ageSeconds, 1);
  assert.equal(selectRadarFrame(ktlx, t + 17000, 'reflectivity').ageSeconds, 17);
});

test('a frame appears at its product midpoint, never at an earlier volume or coverage start', () => {
  assert.equal(selectRadarFrame(air, t - 1, 'reflectivity'), null);
  assert.equal(selectRadarFrame(air, t, 'reflectivity').frame, air.frames[0]);
  assert.equal(selectRadarFrame(ktlx, t + 18999, 'velocity'), null);
  assert.equal(selectRadarFrame(ktlx, t + 19000, 'velocity').frame, ktlx.frames[0]);
  assert.equal(selectRadarFrame(ktlx, t + 298999, 'velocity').frame, ktlx.frames[0]);
  assert.equal(selectRadarFrame(ktlx, t + 299000, 'velocity').frame, ktlx.frames[1]);
});

test('AIR recording end is inclusive and no image survives beyond its actual coverage', () => {
  assert.deepEqual(radarCoverage(air), { start: t, end: t + 32000 });
  assert.equal(selectRadarFrame(air, t + 32000, 'velocity').frame, air.frames[3]);
  assert.equal(selectRadarFrame(air, t + 32001, 'velocity'), null);
  assert.equal(selectRadarFrame(air, t + 600000, 'reflectivity'), null);
});

test('short source age limits expire inside a recording window without selecting future data', () => {
  const sparse = { ...air, coverage: { start: iso(-4), end: iso(100) }, frames: [frame('air', 0), frame('air', 80)] };
  assert.equal(selectRadarFrame(sparse, t + 25000, 'reflectivity').ageSeconds, 25);
  assert.equal(selectRadarFrame(sparse, t + 25001, 'reflectivity'), null);
  assert.equal(selectRadarFrame(sparse, t + 79999, 'reflectivity'), null);
  assert.equal(selectRadarFrame(sparse, t + 80000, 'reflectivity').frame, sparse.frames[1]);
});

test('default KTLX expiry follows the last product midpoint, including its later velocity sweep', () => {
  assert.deepEqual(radarCoverage(ktlx), { start: t, end: t + 899000 });
  assert.equal(selectRadarFrame(ktlx, t + 880000, 'reflectivity').ageSeconds, 600);
  assert.equal(selectRadarFrame(ktlx, t + 880001, 'reflectivity'), null);
  assert.equal(selectRadarFrame(ktlx, t + 899000, 'velocity').ageSeconds, 600);
  assert.equal(selectRadarFrame(ktlx, t + 899001, 'velocity'), null);
});

test('explicit bounds exclude out-of-window images even when those images are recent', () => {
  const clipped = { ...air, coverage: { start: iso(5), end: iso(20) } };
  assert.deepEqual(radarCoverage(clipped), { start: t + 8000, end: t + 20000 });
  assert.equal(selectRadarFrame(clipped, t + 7000, 'reflectivity'), null);
  assert.equal(selectRadarFrame(clipped, t + 20000, 'reflectivity').frame, air.frames[2]);
  assert.equal(selectRadarFrame(clipped, t + 28000, 'reflectivity'), null);
});

test('source switches retain distinct images and original scientific metadata without mutation', () => {
  const before = JSON.stringify([ktlx, air]);
  const a = selectRadarFrame(air, t, 'velocity');
  const k = selectRadarFrame(ktlx, t + 19000, 'velocity');
  assert.notEqual(a.frame.velocity, k.frame.velocity);
  assert.equal(a.frame.products.velocity.units, 'kt');
  assert.equal(a.frame.products.velocity.dealiased, null);
  assert.equal(k.frame.products.velocity.dealiased, false);
  assert.equal(a.frame.products.reflectivity.units, 'dBZ');
  assert.equal(JSON.stringify([ktlx, air]), before);
});

test('product metadata timestamps work and ambiguous local timestamps never become images', () => {
  const metadata = { ...frame('air', 8), reflectivityTime: undefined };
  const bad = { ...frame('air', 0), reflectivityTime: '2013-05-31T23:20:00', velocityTime: 'invalidZ' };
  const manifest = { frames: [bad, metadata] };
  assert.equal(selectRadarFrame(manifest, t, 'reflectivity'), null);
  assert.equal(selectRadarFrame(manifest, t + 8000, 'reflectivity').frame, metadata);
  assert.equal(selectRadarFrame(manifest, t, 'velocity'), null);
});

test('invalid sources, products, bounds and age limits fail closed', () => {
  for (const manifest of [null, {}, { frames: [] }, { frames: [{ time: iso(0) }] },
    { ...air, maxAgeSeconds: NaN }, { ...air, maxAgeSeconds: Infinity },
    { ...air, maxAgeSeconds: -1 }, { ...air, maxAgeSeconds: '25' },
    { ...air, coverage: { start: iso(20), end: iso(0) } },
    { ...air, coverage: { end: '2013-05-31T23:20:30' } }]) {
    assert.equal(radarCoverage(manifest), null);
    assert.equal(selectRadarFrame(manifest, t, 'reflectivity'), null);
  }
  assert.equal(selectRadarFrame(air, t, 'spectrumWidth'), null);
  assert.equal(selectRadarFrame(air, NaN, 'reflectivity'), null);
  assert.equal(selectRadarFrame(air, Infinity, 'reflectivity'), null);
  assert.equal(selectRadarFrame({ ...air, maxAgeSeconds: 0 }, t + 1, 'velocity'), null);
});

test('unsorted frames still select the latest preceding acquisition', () => {
  const unsorted = { ...air, frames: air.frames.toReversed() };
  assert.equal(selectRadarFrame(unsorted, t + 17000, 'velocity').frame, air.frames[2]);
  assert.deepEqual(radarCoverage(unsorted), radarCoverage(air));
});

test('bundled KTLX legacy coverage labels cannot truncate the last velocity product', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/radar/manifest.json', import.meta.url), 'utf8'));
  const last = manifest.frames.at(-1), velocityTime = Date.parse(last.velocityTime);
  assert.ok(velocityTime > Date.parse(manifest.coverageEnd));
  assert.equal(selectRadarFrame(manifest, velocityTime, 'velocity').frame, last);
  assert.equal(radarCoverage(manifest).end, velocityTime + 600000);
  for (const product of ['reflectivity', 'velocity']) {
    for (const f of manifest.frames) {
      assert.equal(selectRadarFrame(manifest, Date.parse(f[`${product}Time`]), product).frame, f);
    }
  }
});


function realAIR() {
  return JSON.parse(readFileSync(new URL('../data/air/manifest.json', import.meta.url), 'utf8'));
}

test('complete AIR archive publishes 99 reflectivity observations and withholds unsupported velocity', () => {
  const manifest = realAIR();
  const provenance = JSON.parse(readFileSync(new URL('../data/air/provenance.json', import.meta.url), 'utf8'));
  assert.equal(manifest.id, 'air');
  assert.equal(manifest.site, 'AIR');
  assert.equal(manifest.completeRequestedSubset, true, 'A one-frame development preview must not pass release checks.');
  assert.equal(manifest.frameCount, 99);
  assert.equal(manifest.frames.length, 99);
  assert.equal(provenance.records.length, 99);
  assert.equal(manifest.maxAgeSeconds, 25);
  assert.deepEqual(manifest.availableProducts, ['reflectivity']);
  assert.equal(manifest.geolocation.status, 'unverified-source-registration');
  assert.equal(manifest.geolocation.appliedCorrection, null);
  assert.ok(manifest.geolocation.note.trim());
  assert.ok(manifest.unavailableProducts.velocity.reason.trim());
  assert.match(manifest.unavailableProducts.velocity.sourceUrl, /^https:\/\//);
  assert.equal(manifest.coverageStart, manifest.coverage.start);
  assert.equal(manifest.coverageEnd, manifest.coverage.end);
  assert.equal(manifest.firstProductTime, manifest.frames[0].time);
  assert.equal(manifest.lastProductTime, manifest.frames.at(-1).time);
  assert.equal(new Set(manifest.frames.map(f => f.time)).size, 99);
  assert.equal(new Set(manifest.frames.map(f => f.sourceKey)).size, 99);
  assert.equal(manifest.projection, 'EPSG:3857');
  assert.equal(manifest.bounds.length, 2);
  assert.ok(manifest.bounds[0][0] < manifest.bounds[1][0]);
  assert.ok(manifest.bounds[0][1] < manifest.bounds[1][1]);
  const records = new Map(provenance.records.map(r => [r.member, r]));
  let previous = -Infinity;
  for (const f of manifest.frames) {
    const record = records.get(f.sourceKey);
    assert.ok(record, f.sourceKey);
    assert.equal(record.localHeaderFilenameVerified, true);
    assert.equal(record.crc32Verified, true);
    assert.match(record.netcdfSha256, /^[a-f0-9]{64}$/);
    const start = Date.parse(record.globalCoverageStart), end = Date.parse(record.globalCoverageEnd);
    const midpoint = (start + end) / 2;
    assert.ok(start < end && end - start <= 20000);
    assert.ok(midpoint > previous, 'The published frame sequence must be chronological.');
    previous = midpoint;
    assert.equal(Date.parse(f.volumeTime), start);
    assert.equal(Date.parse(f.time), midpoint);
    assert.equal(f.elevation, 0.5);
    assert.equal(f.timing.rayTimesUsable, false);
    assert.equal(f.timing.rayTimesAllZero, true);
    assert.equal(f.timing.uncertaintyIntervalSeconds, (end - start) / 1000);
    assert.equal(f.timing.source, 'global time_coverage_start/end midpoint');
    assert.equal(f.velocity, undefined);
    assert.equal(f.velocityTime, undefined);
    assert.equal(f.velocityElevation, undefined);
    assert.equal(f.products.velocity, undefined);
    assert.equal(record.unavailableSourceProducts.velocity.displayed, false);
    assert.equal(record.unavailableSourceProducts.velocity.units, 'm/s');
    assert.equal(record.unavailableSourceProducts.velocity.file, undefined);
    assert.equal(record.unavailableSourceProducts.velocity.pngSha256, undefined);
    assert.equal(selectRadarFrame(manifest, midpoint, 'velocity'), null);
    for (const product of ['reflectivity']) {
      const metadata = f.products[product];
      assert.equal(Date.parse(f[`${product}Time`]), midpoint);
      assert.equal(Date.parse(metadata.time), midpoint);
      assert.equal(Date.parse(metadata.scanStart), start);
      assert.equal(Date.parse(metadata.scanEnd), end);
      assert.equal(f[`${product}Elevation`], 0.5);
      assert.equal(metadata.targetElevationDegrees, 0.5);
      assert.equal(metadata.medianElevationDegrees, 0.5);
      assert.deepEqual(metadata.elevationRangeDegrees, [0.5, 0.5]);
      assert.equal(metadata.file, f[product]);
      assert.equal(metadata.timingQuality, 'global-coverage-midpoint; ray times unavailable');
      assert.equal(metadata.units, product === 'reflectivity' ? 'dBZ' : 'kt');
      assert.equal(metadata.sourceUnits, product === 'reflectivity' ? 'dBZ' : 'm/s');
      assert.equal(metadata.sourceField, product === 'reflectivity' ? 'DBZ' : 'VEL');
      assert.equal(metadata.rangeGateMeters, 30);
      assert.deepEqual(record.products[product], metadata);
      assert.equal(selectRadarFrame(manifest, midpoint, product).frame, f);
    }
  }
  assert.equal(manifest.coverage.start, provenance.records[0].globalCoverageStart);
  assert.equal(manifest.coverage.end, provenance.records.at(-1).globalCoverageEnd);
});

test('all 99 AIR reflectivity images exist with unique paths and matching hashes and dimensions', () => {
  const manifest = realAIR();
  const ktlxManifest = JSON.parse(readFileSync(new URL('../data/radar/manifest.json', import.meta.url), 'utf8'));
  const ktlxFiles = new Set(ktlxManifest.frames.flatMap(f => [f.reflectivity, f.velocity]));
  const files = new Set();
  for (const f of manifest.frames) {
    for (const product of ['reflectivity']) {
      const file = f[product];
      assert.match(file, /^data\/air\/[A-Za-z0-9_.-]+\.png$/);
      assert.equal(files.has(file), false, `Duplicate image path: ${file}`);
      assert.equal(ktlxFiles.has(file), false, 'Source switches must not reuse a KTLX image URL.');
      files.add(file);
      const png = readFileSync(new URL('../' + file, import.meta.url));
      assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(png.toString('ascii', 12, 16), 'IHDR');
      assert.equal(png.readUInt32BE(16), manifest.imageWidth);
      assert.equal(png.readUInt32BE(20), manifest.imageHeight);
      assert.equal(createHash('sha256').update(png).digest('hex'), f.products[product].pngSha256);
    }
  }
  assert.equal(files.size, 99);
});

test('real AIR first-image and hard-end boundaries never expose future or out-of-coverage images', () => {
  const manifest = realAIR();
  const first = manifest.frames[0], last = manifest.frames.at(-1);
  const firstTime = Date.parse(first.time), end = Date.parse(manifest.coverage.end);
  assert.deepEqual(radarCoverage(manifest), { start: firstTime, end });
  for (const now of [Date.parse(manifest.coverage.start), firstTime, end, end + 1, ...manifest.frames.map(f => Date.parse(f.time))]) {
    assert.equal(selectRadarFrame(manifest, now, 'velocity'), null);
  }
  for (const product of ['reflectivity']) {
    assert.equal(selectRadarFrame(manifest, Date.parse(manifest.coverage.start), product), null);
    assert.equal(selectRadarFrame(manifest, firstTime - 1, product), null);
    assert.equal(selectRadarFrame(manifest, firstTime, product).frame, first);
    assert.equal(selectRadarFrame(manifest, end, product).frame, last);
    for (const offset of [1, 10000, 25000, 600000]) {
      assert.equal(selectRadarFrame(manifest, end + offset, product), null);
    }
    for (let i = 1; i < manifest.frames.length; i++) {
      const now = Date.parse(manifest.frames[i].time) - 1;
      const previous = manifest.frames[i - 1];
      const selected = selectRadarFrame(manifest, now, product);
      if (now - Date.parse(previous.time) <= 25000) assert.equal(selected.frame, previous);
      else assert.equal(selected, null);
    }
  }
});

test('switching between real AIR and KTLX preserves original KTLX selection and carries no source state', () => {
  const a = realAIR();
  const k = JSON.parse(readFileSync(new URL('../data/radar/manifest.json', import.meta.url), 'utf8'));
  const before = JSON.stringify([a, k]);
  const samples = [...a.frames.map(f => Date.parse(f.time)), Date.parse(a.coverage.end) + 1,
    ...k.frames.flatMap(f => [Date.parse(f.reflectivityTime), Date.parse(f.velocityTime)])];
  for (const now of samples) {
    for (const product of ['reflectivity', 'velocity']) {
      const expected = radarFrameAt(k.frames, now, product);
      const firstKTLX = selectRadarFrame(k, now, product);
      const selectedAIR = selectRadarFrame(a, now, product);
      const secondKTLX = selectRadarFrame(k, now, product);
      assert.deepEqual(firstKTLX, expected);
      assert.deepEqual(secondKTLX, expected);
      if (selectedAIR) assert.ok(a.frames.includes(selectedAIR.frame));
      if (secondKTLX) assert.ok(k.frames.includes(secondKTLX.frame));
      if (selectedAIR && secondKTLX) assert.notEqual(selectedAIR.frame[product], secondKTLX.frame[product]);
    }
  }
  assert.equal(JSON.stringify([a, k]), before);
});


test('scientifically unavailable products stay blocked despite residual images and cannot extend source coverage', () => {
  const residual = { id: 'air', maxAgeSeconds: 25,
    unavailableProducts: { velocity: { reason: 'The source publication reports unavailable velocity.', sourceUrl: 'https://doi.org/10.1175/BAMS-D-15-00266.1' } },
    frames: [{ ...frame('air', 8), velocityTime: iso(-100) },
      { velocity: 'data/air/residual-velocity.png', velocityTime: iso(1000) }] };
  assert.deepEqual(radarCoverage(residual), { start: t + 8000, end: t + 33000 });
  for (const now of [t - 100000, t + 8000, t + 33000, t + 1000000]) {
    assert.equal(selectRadarFrame(residual, now, 'velocity'), null);
  }
  assert.equal(selectRadarFrame(residual, t + 8000, 'reflectivity').frame, residual.frames[0]);
  assert.equal(radarCoverage({ ...residual, unavailableProducts: { velocity: {}, reflectivity: {} } }), null);
});
