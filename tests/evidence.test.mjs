import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizePoints, closestApproach, positionAt, haversine, MI } from '../js/analysis.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const gpsSource = read('GPS.json').data;
const gps = normalizePoints(gpsSource);
const timeline = read('data/tornado-timeline.json');
const centers = normalizePoints(timeline.points);

test('bundled NWS centers retain the published one-minute CDT chronology', () => {
  assert.equal(centers.length, 39);
  assert.equal(centers[0].time, '2013-05-31T23:04:00Z');
  assert.equal(centers.at(-1).time, '2013-05-31T23:42:00Z');
  assert.equal(centers[0].sourceLabel, '6:04 PM CDT');
  assert.equal(timeline.uncertaintyMeters, null);
  assert.equal(timeline.interpolation.maximumGapSeconds, 60);
  centers.slice(1).forEach((p, i) => assert.equal(p.t - centers[i].t, 60000));
  assert.equal(positionAt(centers, Date.parse('2013-05-31T23:03:59Z'), 60000), null);
  assert.equal(positionAt(centers, Date.parse('2013-05-31T23:42:01Z'), 60000), null);
});

test('camera source retains all 86 observations and original UTC strings', () => {
  assert.equal(gpsSource.length, 86);
  assert.equal(gps.length, gpsSource.length);
  assert.equal(gps[0].time, '2013-05-31T19:33:07Z');
  assert.equal(gps.at(-1).time, '2013-06-01T02:55:15Z');
  assert.equal(positionAt(gps, Date.parse('2013-05-31T22:00:00Z')), null);
});

test('provisional center separation agrees with independent source-coordinate calculation', () => {
  const best = closestApproach(gps, centers);
  assert.ok(best.meters > 1980 && best.meters < 1990);
  assert.ok(Math.abs(best.t - Date.parse('2013-05-31T23:10:16Z')) <= 1000);
  assert.equal(best.car.status, 'interpolated');
  assert.equal(best.car.gapSeconds, 102);
  assert.equal(best.tornado.gapSeconds, 60);
  const recordedFix = gps.find(p => p.time === '2013-05-31T23:10:41Z');
  const meters = haversine(recordedFix, positionAt(centers, recordedFix.t, 60000));
  assert.ok(meters > 2030 && meters < 2040);
  assert.ok(best.meters < meters);
  assert.equal((best.meters / MI).toFixed(1), '1.2');
});

test('camera clock sensitivity changes the inferred result without shifting NWS times', () => {
  const firstCenterTime = centers[0].t;
  const earlier = closestApproach(gps, centers, -60000);
  const later = closestApproach(gps, centers, 60000);
  assert.ok(earlier.meters / MI > 1.6 && earlier.meters / MI < 1.7);
  assert.ok(later.meters / MI > 0.8 && later.meters / MI < 0.9);
  assert.equal(centers[0].t, firstCenterTime);
});
