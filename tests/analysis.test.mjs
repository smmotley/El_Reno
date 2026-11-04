import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePoints, positionAt, splitTrack, closestApproach, radarFrameAt, validateSpotterImport, haversine } from '../js/analysis.js';
const points = normalizePoints([{ lat: 35, lon: -98, time: '2013-05-31T23:00:00Z' }, { lat: 35.02, lon: -98, time: '2013-05-31T23:02:00Z' }, { lat: 36, lon: -98, time: '2013-05-31T23:20:00Z' }]);
test('UTC timestamps are absolute and camera corrections apply once', () => {
  const t = Date.parse('2013-05-31T23:01:00Z');
  assert.equal(positionAt(points, t).lat, 35.010000000000005);
  assert.equal(positionAt(points, t + 60000, 300000, 60000).lat, positionAt(points, t).lat);
});
test('missing track intervals stay missing; endpoints remain recorded', () => {
  assert.equal(positionAt(points, points[0].t - 1), null);
  assert.equal(positionAt(points, Date.parse('2013-05-31T23:10:00Z')), null);
  assert.equal(positionAt(points, points.at(-1).t + 1), null);
  assert.equal(positionAt(points, points.at(-1).t).status, 'recorded');
  assert.equal(splitTrack(points).length, 2);
});
test('each radar product uses the preceding sweep, never a future scan', () => {
  const frame = { time: '2013-05-31T23:00:00Z', reflectivityTime: '2013-05-31T23:00:15Z', velocityTime: '2013-05-31T23:01:00Z', reflectivity: 'r.png', velocity: 'v.png' };
  const t = Date.parse('2013-05-31T23:00:30Z');
  assert.equal(radarFrameAt([frame], t, 'reflectivity').ageSeconds, 15);
  assert.equal(radarFrameAt([frame], t, 'velocity'), null);
  assert.equal(radarFrameAt([frame], t + 700000, 'reflectivity'), null);
});
test('closest approach compares simultaneous positions and does not bridge gaps', () => {
  const centers = normalizePoints([{ lat: 35.01, lon: -98, time: '2013-05-31T23:00:00Z' }, { lat: 35.01, lon: -98, time: '2013-05-31T23:01:00Z' }, { lat: 35.01, lon: -98, time: '2013-05-31T23:02:00Z' }]);
  const best = closestApproach(points, centers);
  assert.equal(best.t, Date.parse('2013-05-31T23:01:00Z'));
  assert.ok(best.meters < 0.001);
  assert.equal(closestApproach(points, centers, 3600000), null);
});
test('great-circle distance has expected scale', () => assert.ok(Math.abs(haversine({lat: 0, lon: 0}, {lat: 0, lon: 1}) - 111195) < 1));
test('import rejects ambiguous timestamps and malformed coordinates', () => {
  assert.throws(() => validateSpotterImport({spotters:[{name:'A',points:[{time:'2013-05-31T18:00:00',lat:35,lon:-98}]}]}), /timezone/);
  assert.throws(() => validateSpotterImport([{name:'A',points:[{time:'2013-05-31T23:00:00Z',lat:999,lon:-98}]}]), /invalid/);
});
