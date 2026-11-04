import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoints, haversine, MI } from '../js/analysis.js';
import { prepareRoadTrack, roadPositionAt, roadSegmentsUntil, closestRoadApproach } from '../js/road-motion.js';

const epoch = Date.parse('2013-05-31T23:00:00Z');
const iso = seconds => new Date(epoch + seconds * 1000).toISOString();
const time = seconds => epoch + seconds * 1000;
const observation = (seconds, lon, lat, roadMatched = true) => ({
  time: iso(seconds), lon, lat, originalLon: lon, originalLat: lat, roadMatched,
  snapDistanceMeters: roadMatched ? 0 : null,
});
const lShape = [[0, 0], [0.01, 0], [0.01, 0.01]];
function input(coordinates = lShape, seconds = 120, status = 'routed') {
  return { id: 'smotley', interpolationLimitSeconds: 300,
    points: [observation(0, ...coordinates[0]), observation(seconds, ...coordinates.at(-1))],
    intervals: [{ start: iso(0), end: iso(seconds), status, coordinates }] };
}
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('distance-weighted L route reaches its corner instead of cutting across a field', () => {
  const track = prepareRoadTrack(input());
  const halfway = roadPositionAt(track, time(60));
  close(halfway.lon, 0.01);
  close(halfway.lat, 0);
  assert.equal(halfway.status, 'road-interpolated');
  close(halfway.headingDegrees, 0); // North after the turn.
  close(roadPositionAt(track, time(30)).headingDegrees, 90); // East before the turn.
  assert.ok(halfway.lon !== 0.005);
});

test('speed comes from route distance and elapsed time, not straight-line separation or cached values', () => {
  const raw = input();
  raw.intervals[0].distanceMeters = 10;
  raw.intervals[0].averageSpeedMph = 999;
  raw.intervals[0].cumulativeMeters = [0, 1, 2];
  const track = prepareRoadTrack(raw), interval = track.intervals[0];
  const direct = haversine(track.points[0], track.points[1]);
  assert.ok(interval.distanceMeters > direct * 1.4);
  close(interval.averageSpeedMph, interval.distanceMeters / MI / (120 / 3600));
  assert.equal(interval.speedStatus, 'inferred-interval-average');
  assert.equal(raw.intervals[0].averageSpeedMph, 999); // Source remains unchanged.
  assert.equal(roadPositionAt(track, time(30)).speedStatus, 'inferred-interval-average');
});

test('exact matched endpoints survive, while extrapolation and declared gaps stay unavailable', () => {
  const track = prepareRoadTrack(input());
  assert.equal(roadPositionAt(track, time(-1)), null);
  assert.equal(roadPositionAt(track, time(121)), null);
  assert.equal(roadPositionAt(track, time(0)).status, 'road-matched');
  close(roadPositionAt(track, time(120)).lat, 0.01);
  const gap = prepareRoadTrack(input(lShape, 120, 'gap'));
  assert.equal(roadPositionAt(gap, time(60)), null);
  assert.equal(roadPositionAt(gap, time(0)).status, 'road-matched');
  assert.deepEqual(roadSegmentsUntil(gap), []);
  const mislabeledLongGap = prepareRoadTrack(input(lShape, 301));
  assert.equal(mislabeledLongGap.intervals[0].status, 'gap');
  assert.equal(roadPositionAt(mislabeledLongGap, time(60)), null);
});

test('a positive clock correction shifts playback later exactly once', () => {
  const track = prepareRoadTrack(input());
  const original = roadPositionAt(track, time(60));
  const shifted = roadPositionAt(track, time(120), 60000);
  close(shifted.lat, original.lat);
  close(shifted.lon, original.lon);
  assert.equal(shifted.t, time(120));
  assert.equal(roadPositionAt(track, time(30), 60000), null);
  assert.deepEqual(roadSegmentsUntil(track, time(120), 60000).map(s => s.map(p => [p.lon, p.lat])),
    roadSegmentsUntil(track, time(60)).map(s => s.map(p => [p.lon, p.lat])));
});

test('stationary duplicate positions do not create NaNs, movement or a heading', () => {
  const track = prepareRoadTrack(input([[0.01, 0.01], [0.01, 0.01]], 120, 'stationary'));
  const stationary = roadPositionAt(track, time(60));
  assert.equal(stationary.status, 'stationary');
  assert.equal(stationary.averageSpeedMph, 0);
  assert.equal(stationary.headingDegrees, null);
  close(stationary.lon, 0.01);
  close(stationary.lat, 0.01);
  assert.equal(roadPositionAt(track, time(120)).averageSpeedMph, 0);
  const repeatedVertex = prepareRoadTrack(input([[0, 0], [0, 0], [0.01, 0], [0.01, 0.01], [0.01, 0.01]]));
  assert.ok(Number.isFinite(roadPositionAt(repeatedVertex, time(120)).headingDegrees));
  close(roadPositionAt(repeatedVertex, time(60)).lon, 0.01);
});

test('flagged intervals block interpolation even when their duration is short', () => {
  const declared = prepareRoadTrack(input(lShape, 19, 'flagged'));
  assert.equal(roadPositionAt(declared, time(10)), null);
  assert.deepEqual(roadSegmentsUntil(declared), []);
  const raw = input(lShape, 19);
  raw.breakIntervals = [{ start: iso(0), end: iso(19) }];
  const inherited = prepareRoadTrack(raw);
  assert.equal(inherited.intervals[0].status, 'flagged');
  assert.equal(roadPositionAt(inherited, time(10)), null);
  assert.equal(roadPositionAt(inherited, time(19)).status, 'road-matched');
});

test('unmatched exact fixes keep original positions without producing any connecting route', () => {
  const raw = input(lShape, 120, 'unmatched');
  raw.points[0] = { ...raw.points[0], lat: 1, lon: 1, originalLat: 0, originalLon: 0, roadMatched: false };
  const track = prepareRoadTrack(raw), exact = roadPositionAt(track, time(0));
  assert.equal(exact.status, 'observed-unmatched');
  assert.equal(exact.lat, 0);
  assert.equal(exact.lon, 0);
  assert.equal(exact.averageSpeedMph, null);
  assert.equal(roadPositionAt(track, time(1)), null);
  assert.deepEqual(roadSegmentsUntil(track), []);
});

test('elapsed trails contain road vertices and a road head, never diagonal connectors', () => {
  const track = prepareRoadTrack(input());
  const route = roadSegmentsUntil(track, time(90));
  assert.equal(route.length, 1);
  assert.deepEqual(route[0].map(p => [p.lon, p.lat]), [[0, 0], [0.01, 0], [0.01, 0.005]]);
  assert.deepEqual(roadSegmentsUntil(track, time(-1)), []);
  const raw = input();
  raw.points.push(observation(150, 1, 1), observation(270, 1.01, 1));
  raw.intervals.push({ start: iso(120), end: iso(150), status: 'gap', coordinates: [] },
    { start: iso(150), end: iso(270), status: 'routed', coordinates: [[1, 1], [1.01, 1]] });
  const parts = roadSegmentsUntil(prepareRoadTrack(raw));
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0].at(-1), { lon: 0.01, lat: 0.01, t: time(120) });
  assert.deepEqual(parts[1][0], { lon: 1, lat: 1, t: time(150) });
});

test('closest approach follows the road and restricts NWS interpolation to one minute', () => {
  const track = prepareRoadTrack(input());
  const centers = normalizePoints([0, 60, 120, 180].map(s => ({ time: iso(s), lat: 0, lon: 0.01 })));
  const result = closestRoadApproach(track, centers);
  assert.equal(result.t, time(60));
  assert.ok(result.meters < 0.001);
  assert.equal(closestRoadApproach(track, centers, 60000).t, time(120));
  assert.equal(closestRoadApproach(track, centers, 3600000), null);
  const missingMinute = [centers[0], centers[2]];
  assert.ok(closestRoadApproach(track, missingMinute).meters > 1000);
});

test('invalid geometry and conflicting intervals fail without drawing fabricated movement', () => {
  const invalid = input([[0, 0], [NaN, 1]]);
  const prepared = prepareRoadTrack(invalid);
  assert.equal(prepared.intervals[0].status, 'unmatched');
  assert.deepEqual(roadSegmentsUntil(prepared), []);
  const overlap = input();
  overlap.intervals.push({ start: iso(60), end: iso(180), status: 'routed', coordinates: lShape });
  assert.throws(() => prepareRoadTrack(overlap), /overlap/);
});
