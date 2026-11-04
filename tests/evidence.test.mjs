import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { normalizePoints, positionAt, haversine, MI } from '../js/analysis.js';
import { prepareRoadTrack, roadPositionAt, roadSegmentsUntil, closestRoadApproach } from '../js/road-motion.js';

const read = name => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const gpsSource = read('GPS.json').data;
const gps = normalizePoints(gpsSource);
const timeline = read('data/tornado-timeline.json');
const centers = normalizePoints(timeline.points);
const spotters = read('data/spotters.json').spotters;
const roadSource = read('data/road-routes.json');
const roadTracks = Object.fromEntries(Object.entries(roadSource.tracks).map(([id, source]) => [id, prepareRoadTrack(source)]));
const sourceTracks = [{ id: 'smotley', points: gps, interpolationLimitSeconds: 300, breakIntervals: [] }, ...spotters];
const usable = interval => ['routed', 'stationary'].includes(interval.status);

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

test('all 34 road tracks preserve every source observation and bound any coordinate adjustment', () => {
  assert.equal(Object.keys(roadSource.tracks).length, 34);
  assert.deepEqual(Object.keys(roadSource.tracks).sort(), sourceTracks.map(t => t.id).sort());
  for (const name of ['GPS.json', 'data/spotters.json']) {
    const digest = createHash('sha256').update(fs.readFileSync(new URL(`../${name}`, import.meta.url))).digest('hex');
    assert.equal(roadSource.observationSourcesSha256[name], digest, `Road routes must match the current ${name}`);
  }
  for (const source of sourceTracks) {
    const raw = roadSource.tracks[source.id], track = roadTracks[source.id];
    const points = normalizePoints(source.points);
    assert.equal(raw.points.length, points.length, source.id);
    assert.equal(track.points.length, points.length, source.id);
    assert.equal(track.interpolationLimitSeconds, source.interpolationLimitSeconds || 120, source.id);
    assert.deepEqual(raw.breakIntervals || [], source.breakIntervals || [], source.id);
    for (const [i, original] of points.entries()) {
      const p = track.points[i];
      assert.equal(p.time, original.time, source.id);
      assert.equal(p.originalLat, original.lat, source.id);
      assert.equal(p.originalLon, original.lon, source.id);
      const exact = roadPositionAt(track, p.t);
      assert.ok(exact, `${source.id} must retain an exact observation at ${p.time}`);
      if (p.roadMatched) {
        assert.ok(haversine(original, p) <= 75.2, `${source.id} moved a source point by more than the 75 m limit`);
        assert.equal(exact.status, 'road-matched');
      } else {
        assert.equal(exact.lat, original.lat, source.id);
        assert.equal(exact.lon, original.lon, source.id);
        assert.equal(exact.status, 'observed-unmatched');
      }
    }
    assert.equal(roadPositionAt(track, points[0].t - 1), null);
    assert.equal(roadPositionAt(track, points.at(-1).t + 1), null);
  }
});

test('all real-data intervals honor duration, flagged-gap and speed limits without connecting rejected brackets', () => {
  for (const source of sourceTracks) {
    const raw = roadSource.tracks[source.id], track = roadTracks[source.id];
    assert.equal(raw.intervals.length, track.points.length - 1, source.id);
    assert.equal(track.intervals.length, raw.intervals.length, source.id);
    let acceptedCount = 0;
    for (const [i, interval] of track.intervals.entries()) {
      const a = track.points[i], b = track.points[i + 1];
      assert.equal(interval.startMs, a.t, source.id);
      assert.equal(interval.endMs, b.t, source.id);
      const exceedsGap = b.t - a.t > track.interpolationLimitSeconds * 1000;
      const flagged = (source.breakIntervals || []).some(g => a.t < Date.parse(g.end) && b.t > Date.parse(g.start));
      if (exceedsGap || flagged || !usable(raw.intervals[i])) assert.equal(usable(interval), false, `${source.id} accepted a rejected interval`);
      const atMiddle = roadPositionAt(track, (a.t + b.t) / 2);
      if (!usable(interval)) {
        assert.equal(atMiddle, null, `${source.id} interpolated rejected interval ${interval.start}`);
        assert.equal(roadPositionAt(track, (a.t + b.t) / 2 + 60000, 60000), null, source.id);
        continue;
      }
      acceptedCount++;
      assert.ok(atMiddle, source.id);
      assert.equal(atMiddle.speedStatus, 'inferred-interval-average');
      assert.ok(interval.averageSpeedMph >= 0 && interval.averageSpeedMph <= 110.001, source.id);
      assert.equal(interval.cumulativeMeters.length, interval.coordinates.length, source.id);
      assert.equal(interval.cumulativeMeters[0], 0, source.id);
      assert.equal(interval.cumulativeMeters.at(-1), interval.distanceMeters, source.id);
      assert.ok(interval.cumulativeMeters.every((v, j, values) => !j || v >= values[j - 1]), source.id);
      const first = interval.coordinates[0], last = interval.coordinates.at(-1);
      assert.ok(haversine(a, { lon: first[0], lat: first[1] }) < 0.5, `${source.id} route misses its matched start`);
      assert.ok(haversine(b, { lon: last[0], lat: last[1] }) < 0.5, `${source.id} route misses its matched end`);
      assert.ok(Math.abs(interval.averageSpeedMph - interval.distanceMeters / MI / ((b.t - a.t) / 3600000)) < 1e-9, source.id);
    }
    assert.equal(roadSegmentsUntil(track).length, acceptedCount, `${source.id} must emit only accepted road pieces`);
  }
});

test('current closest estimate uses inferred road positions and keeps the original GPS-fix minimum separate', () => {
  const best = closestRoadApproach(roadTracks.smotley, centers);
  assert.ok(best);
  assert.equal(best.method, 'inferred-road-position-to-estimated-NWS-center');
  assert.ok(Math.abs(best.meters / MI - 1.239205) < .002, 'Current road-based estimate must retain its source-data regression');
  assert.ok(Math.abs(best.t - Date.parse('2013-05-31T23:10:16Z')) <= 1000);
  assert.equal(best.car.status, 'road-interpolated');
  assert.equal(best.car.gapSeconds, 102);
  assert.equal(best.tornado.gapSeconds, 60);
  assert.ok(['road-interpolated', 'road-matched', 'stationary', 'observed-unmatched'].includes(best.car.status));
  const point = roadPositionAt(roadTracks.smotley, best.t);
  assert.ok(Math.abs(best.meters - haversine(point, positionAt(centers, best.t, 60000))) < 1e-9);
  if (best.car.interval) assert.ok(usable(best.car.interval));
  const recordedFix = gps.find(p => p.time === '2013-05-31T23:10:41Z');
  const meters = haversine(recordedFix, positionAt(centers, recordedFix.t, 60000));
  assert.ok(meters > 2030 && meters < 2040);
  const fixOnlyMinimum = Math.min(...gps.map(p => {
    const center = positionAt(centers, p.t, 60000);
    return center ? haversine(p, center) : Infinity;
  }));
  assert.equal(meters, fixOnlyMinimum);
  assert.equal((fixOnlyMinimum / MI).toFixed(1), '1.3');
});

test('road-based camera clock sensitivity shifts the car exactly once and leaves NWS times fixed', () => {
  const firstCenterTime = centers[0].t;
  for (const offset of [-60000, 0, 60000]) {
    const comparison = closestRoadApproach(roadTracks.smotley, centers, offset);
    assert.ok(comparison);
    const unshifted = roadPositionAt(roadTracks.smotley, comparison.t - offset);
    assert.equal(comparison.car.lat, unshifted.lat);
    assert.equal(comparison.car.lon, unshifted.lon);
    assert.equal(comparison.car.t, comparison.t);
    const center = positionAt(centers, comparison.t, 60000);
    assert.ok(Math.abs(comparison.meters - haversine(unshifted, center)) < 1e-9);
    const expectedMiles = { '-60000': 1.656735, 0: 1.239205, 60000: .837658 };
    assert.ok(Math.abs(comparison.meters / MI - expectedMiles[offset]) < .002, 'Clock scenario must use the current inferred-road trajectory');
  }
  assert.equal(centers[0].t, firstCenterTime);
});
