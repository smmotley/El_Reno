import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSpotterImport, positionAt } from '../js/analysis.js';

const start = '2013-05-31T23:10:00Z';
const end = '2013-05-31T23:12:00Z';
const track = extra => ({ name: 'Documented chaser', points: [{ time: start, lat: 35.4, lon: -98 }, { time: end, lat: 35.41, lon: -97.99 }], ...extra });
const parse = extra => validateSpotterImport({ spotters: [track(extra)] })[0];

test('imports derive time only from the zoned ISO clock and discard authority claims', () => {
  const result = parse({ imported: false, verified: true, markerHtml: '<script/>', kind: 'twistex', points: [{ time: '2013-05-31T18:10:00-05:00', lat: 35.4, lon: -98, t: 0, status: 'verified' }] });
  assert.equal(result.points[0].t, Date.parse(start));
  assert.equal(result.points[0].status, undefined);
  assert.equal(result.imported, true);
  assert.equal(result.verified, undefined);
  assert.equal(result.markerHtml, undefined);
  assert.equal(result.kind, 'twistex');
  assert.equal(parse().kind, 'imported');
  assert.equal(parse({ kind: 'survey-camera' }).kind, 'survey-camera');
});

test('malformed optional metadata is rejected before it can poison the viewer', () => {
  for (const invalid of [{ breakIntervals: 'invalid' }, { breakIntervals: [null] }, { videos: 'invalid' }, { videos: [5] }, { videos: [''] }, { sourceUrl: {} }, { name: {} }, { kind: [] }]) {
    assert.throws(() => parse(invalid));
  }
  for (const input of [null, {}, { spotters: [] }, { spotters: [null] }]) assert.throws(() => validateSpotterImport(input));
});

test('an invalid gap setting cannot enable interpolation through missing observations', () => {
  for (const value of ['invalid', '120', null, 0, -1, 121, Infinity, NaN]) assert.throws(() => parse({ interpolationLimitSeconds: value }), /interpolationLimitSeconds/);
  const result = parse({ interpolationLimitSeconds: 30 });
  assert.equal(positionAt(result.points, Date.parse(start) + 60000, result.interpolationLimitSeconds * 1000), null);
  assert.equal(parse().interpolationLimitSeconds, 120);
});

test('break intervals require real, zoned, increasing and ordered timestamps', () => {
  for (const interval of [{ start: '2013-05-31T23:10:00', end }, { start, end: start }, { start: end, end: start }, { start: '2013-02-30T23:10:00Z', end }, { start, end, reason: {} }]) {
    assert.throws(() => parse({ breakIntervals: [interval] }));
  }
  assert.throws(() => parse({ breakIntervals: [{ start, end }, { start: '2013-05-31T23:11:00Z', end: '2013-05-31T23:13:00Z' }] }), /ordered/);
  assert.throws(() => parse({ breakIntervals: [{ start: end, end: '2013-05-31T23:13:00Z' }, { start, end }] }), /ordered/);
  const interval = { start, end, reason: 'Documented gap', unsupported: true };
  assert.deepEqual(parse({ breakIntervals: [interval] }).breakIntervals, [{ start, end, reason: 'Documented gap' }]);
});

test('position validation rejects coerced coordinates, invalid dates and duplicate instants', () => {
  for (const value of ['', '35.4', null, false, NaN, Infinity, 91]) {
    assert.throws(() => parse({ points: [{ time: start, lat: value, lon: -98 }] }), /invalid coordinates/);
  }
  for (const value of ['2013-05-31T23:10:00', '2013-02-30T23:10:00Z', '2013-13-01T23:10:00Z', '2013-05-31T25:10:00Z', '2013-05-31T23:10:00+25:00']) {
    assert.throws(() => parse({ points: [{ time: value, lat: 35.4, lon: -98 }] }));
  }
  assert.throws(() => parse({ points: [{ time: start, lat: 35.4, lon: -98 }, { time: '2013-05-31T18:10:00-05:00', lat: 35.41, lon: -98 }] }), /duplicate/);
});

test('batch validation does not mutate inputs or return partial results on a later failure', () => {
  const input = { spotters: [track({ points: [{ time: end, lat: 35.41, lon: -97.99 }, { time: start, lat: 35.4, lon: -98 }], videos: ['known-video'], breakIntervals: [{ start, end }] }), track({ videos: 'invalid' })] };
  const before = structuredClone(input);
  assert.throws(() => validateSpotterImport(input), /videos/);
  assert.deepEqual(input, before);
  const [result] = validateSpotterImport({ spotters: [input.spotters[0]] });
  assert.equal(result.points[0].time, start);
  result.points[0].lat = 0;
  result.videos.push('another');
  result.breakIntervals[0].reason = 'changed';
  assert.deepEqual(input, before);
});
