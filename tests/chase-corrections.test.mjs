import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyChaseCorrections } from '../js/chase-corrections.js';
import { prepareRoadTrack, roadPositionAt, roadSegmentsUntil, closestRoadApproach } from '../js/road-motion.js';
import { haversine, normalizePoints } from '../js/analysis.js';

const base = Date.parse('2013-05-31T23:00:00Z');
const stamp = seconds => new Date(base + seconds * 1000).toISOString();
const at = (track, seconds, offset = 0) => roadPositionAt(track, base + seconds * 1000, offset);
const coordinate = pose => [pose.lon, pose.lat];
const clone = object => structuredClone(object);

function fixture() {
  return prepareRoadTrack({ id: 'smotley', interpolationLimitSeconds: 300,
    points: [
      { time: stamp(0), lon: 0, lat: 0, roadMatched: true },
      { time: stamp(30), lon: .005, lat: 0, roadMatched: true },
      { time: stamp(120), lon: .005, lat: .005, roadMatched: true },
    ], intervals: [
      { start: stamp(0), end: stamp(30), status: 'routed', coordinates: [[0, 0], [.005, 0]] },
      { start: stamp(30), end: stamp(120), status: 'routed', coordinates: [[.005, 0], [.005, .005]] },
    ] });
}
function settings() {
  return { schemaVersion: 1, trackId: 'smotley', enabledByDefault: true, corrections: [{
    id: 'test-stop', type: 'stationary-stop', start: stamp(20), end: stamp(72),
    window: { start: stamp(0), end: stamp(120) }, requestedLocation: { lat: 0, lon: .005 },
    maxRoadSnapMeters: 80, supersededSourceTimes: [stamp(30)],
  }] };
}

test('a reversible 52-second stop preserves source objects and bounded endpoints', () => {
  const original = fixture(), config = settings();
  const originalCopy = clone(original), configCopy = clone(config);
  const corrected = applyChaseCorrections(original, config);
  assert.deepEqual(original, originalCopy);
  assert.deepEqual(config, configCopy);
  assert.deepEqual(coordinate(at(corrected, 0)), coordinate(at(original, 0)));
  assert.deepEqual(coordinate(at(corrected, 120)), coordinate(at(original, 120)));
  assert.equal(corrected.chaseCorrections.enabled, true);
  assert.equal(corrected.chaseCorrections.applied[0].durationSeconds, 52);
  assert.equal(corrected.chaseCorrections.applied[0].supersededObservations[0].t, base + 30000);
  assert.equal(corrected.points.some(p => p.t === base + 30000), false);
  for (let second = 20; second <= 72; second++) assert.deepEqual(coordinate(at(corrected, second)), [.005, 0]);
  for (let second = 21; second < 72; second++) {
    assert.equal(at(corrected, second).status, 'stationary');
    assert.equal(at(corrected, second).averageSpeedMph, 0);
    assert.equal(at(corrected, second).interval.reconstruction, true);
  }
  assert.equal(at(corrected, 20).recordedObservation, false);
  assert.equal(at(corrected, 20).reconstruction, true);
  assert.ok(haversine(at(corrected, 19.999), at(corrected, 20)) < .1);
  assert.ok(haversine(at(corrected, 72), at(corrected, 72.001)) < .1);
  const disabled = applyChaseCorrections(original, config, { enabled: false });
  assert.deepEqual(disabled.points, original.points);
  assert.deepEqual(disabled.intervals, original.intervals);
});

test('road trails retain turns, stop while video time advances, and apply clock offset only once', () => {
  const corrected = applyChaseCorrections(fixture(), settings());
  const first = roadSegmentsUntil(corrected, base + 25000);
  const second = roadSegmentsUntil(corrected, base + 65000);
  assert.deepEqual(first, second);
  assert.deepEqual(roadSegmentsUntil(corrected).map(part => part.map(coordinate)),
    [[[0, 0], [.005, 0]], [[.005, 0]], [[.005, 0], [.005, .005]]]);
  assert.deepEqual(coordinate(at(corrected, 100, 60000)), coordinate(at(corrected, 40)));
  assert.deepEqual(roadSegmentsUntil(corrected, base + 100000, 60000),
    roadSegmentsUntil(corrected, base + 40000).map(part => part.map(p => ({ ...p, t: p.t + 60000 }))));
  assert.equal(at(corrected, -1), null);
  assert.equal(at(corrected, 121), null);
});

test('rejects a wrong track, repeated application, distant anchors, blocked roads and changed observations', () => {
  const original = fixture(), config = settings();
  assert.throws(() => applyChaseCorrections({ ...original, id: 'someone-else' }, config), /target this track/);
  const once = applyChaseCorrections(original, config);
  assert.throws(() => applyChaseCorrections(once, config), /original track/);
  assert.throws(() => applyChaseCorrections(once, config, { enabled: false }), /original track/);
  const distant = clone(config); distant.corrections[0].requestedLocation.lat = 1;
  assert.throws(() => applyChaseCorrections(original, distant), /farther/);
  const blocked = clone(original); blocked.intervals[0].status = 'flagged';
  assert.throws(() => applyChaseCorrections(blocked, config), /cannot be bridged/);
  const changed = clone(config); changed.corrections[0].supersededSourceTimes = [];
  assert.throws(() => applyChaseCorrections(original, changed), /observations.*changed/);
  const tooFast = clone(config); tooFast.corrections[0].start = stamp(1);
  assert.throws(() => applyChaseCorrections(original, tooFast), /implausible/);
});

test('real correction preserves every outside fix and the original closest-approach result', () => {
  const source = JSON.parse(readFileSync(new URL('../data/road-routes.json', import.meta.url))).tracks.smotley;
  const sourceCopy = clone(source);
  const config = JSON.parse(readFileSync(new URL('../data/chase-corrections.json', import.meta.url)));
  const timeline = JSON.parse(readFileSync(new URL('../data/tornado-timeline.json', import.meta.url)));
  const original = prepareRoadTrack(source), corrected = applyChaseCorrections(original, config);
  const audit = corrected.chaseCorrections.applied[0];
  assert.deepEqual(source, sourceCopy);
  assert.equal(audit.start, '2013-05-31T23:02:56.000Z');
  assert.equal(audit.end, '2013-05-31T23:03:48.000Z');
  assert.ok(audit.snapDistanceMeters > 78 && audit.snapDistanceMeters < 79);
  const correction = config.corrections[0];
  assert.ok(haversine(audit.roadLocation, correction.reviewedRoadLocation) < .01);
  assert.ok(Math.abs(audit.snapDistanceMeters - correction.reviewedRoadSnapMeters) < .01);
  assert.equal(correction.maxRoadSnapMeters, 80);
  assert.ok(Math.abs(correction.requestedLocation.lat - (35 + 26 / 60 + 55.8 / 3600)) < 1e-12);
  assert.ok(Math.abs(correction.requestedLocation.lon + (98 + 4 / 60 + 31.4 / 3600)) < 1e-12);
  assert.equal(correction.supersededLocationCandidates.length, 1);
  assert.equal(correction.supersededLocationCandidates[0].active, false);
  assert.deepEqual(correction.supersededLocationCandidates[0].requestedLocation, { lat: 35.448966, lon: -98.06655 });
  assert.deepEqual(audit.supersededLocationCandidates, correction.supersededLocationCandidates);
  assert.equal(audit.roadSnapLimitMeters, 80);
  const previousLimit = clone(config); previousLimit.corrections[0].maxRoadSnapMeters = 75;
  assert.throws(() => applyChaseCorrections(original, previousLimit), /farther/);
  assert.equal(audit.supersededObservations.length, 1);
  assert.equal(audit.supersededObservations[0].time, '2013-05-31T23:02:59Z');
  assert.equal(corrected.points.length, original.points.length + 1);
  for (const p of original.points) if (p.t <= Date.parse(audit.windowStart) || p.t >= Date.parse(audit.windowEnd)) {
    assert.deepEqual(corrected.points.find(q => q.t === p.t), p);
    assert.deepEqual(coordinate(roadPositionAt(corrected, p.t)), coordinate(roadPositionAt(original, p.t)));
  }
  for (const interval of original.intervals) if (interval.endMs <= Date.parse(audit.windowStart) || interval.startMs >= Date.parse(audit.windowEnd)) {
    assert.deepEqual(corrected.intervals.find(q => q.startMs === interval.startMs), interval);
  }
  const centers = normalizePoints(timeline.points);
  const baselineClosest = closestRoadApproach(original, centers);
  const correctedClosest = closestRoadApproach(corrected, centers);
  assert.equal(correctedClosest.t, baselineClosest.t);
  assert.equal(correctedClosest.meters, baselineClosest.meters);
  assert.equal(config.corrections[0].durationSeconds,
    (Date.parse(config.corrections[0].end) - Date.parse(config.corrections[0].start)) / 1000);
  assert.equal(Date.parse(config.corrections[0].start),
    Date.parse(config.corrections[0].clipStart) + config.corrections[0].videoElapsedStartSeconds * 1000);
});
