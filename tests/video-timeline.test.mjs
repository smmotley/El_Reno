import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { videoClipBounds, calibratedVideoClips, videoClipAt, videoMediaTime, videoTimelineTime, previousVideoClip, nextVideoClip } from '../js/video-timeline.js';

const start = Date.parse('2013-05-31T23:12:00Z');
const clip = (id, offset, durationSeconds, camera = 'our') => Object.freeze({
  id, camera, startTime: new Date(start + offset * 1000).toISOString(), durationSeconds, path: `videos/${id}.mp4`
});
const first = clip('first', 0, 20);
const adjacent = clip('adjacent', 20, 10);
const last = clip('last', 45, 15.5);
const clips = Object.freeze([last, first, adjacent]);

test('adjacent clips have inclusive starts and exclusive ends, including the final clip', () => {
  for (const [offset, expected] of [[-0.001, null], [0, first], [19.999, first], [20, adjacent], [30, null], [45, last], [60.499, last], [60.5, null]]) {
    assert.equal(videoClipAt(clips, start + offset * 1000), expected, `offset ${offset}`);
  }
  assert.deepEqual(clips, [last, first, adjacent]);
  assert.deepEqual(calibratedVideoClips({ clips }), [first, adjacent, last]);
});

test('latest active start wins overlaps; earlier clip resumes if later overlap ends', () => {
  const broad = clip('broad', 0, 60), insert = clip('insert', 5, 10);
  const a = clip('a', 5, 10), z = clip('z', 5, 10);
  assert.equal(videoClipAt([insert, broad], start + 5000), insert);
  assert.equal(videoClipAt([broad, insert], start + 15000), broad);
  assert.equal(videoClipAt([z, broad, a], start + 6000), a);
  assert.equal(videoClipAt([a, broad, z], start + 6000), a);
});

test('camera selection never substitutes another camera in its gaps', () => {
  const other = clip('other', 25, 50, 'brendon');
  const input = [...clips, other];
  assert.equal(videoClipAt(input, start + 35000, 'our'), null);
  assert.equal(videoClipAt(input, start + 35000, 'brendon'), other);
  assert.equal(videoClipAt(input, start + 35000, 'auto'), other);
  assert.equal(videoClipAt(input, start + 46000, 'auto'), last);
  assert.equal(videoClipAt(input, start, 'missing-camera'), null);
});

test('uncalibrated, invalid-calendar, timezone-free and unusable-media entries never become global events', () => {
  const invalid = [
    null, {}, { ...first, startTime: null }, { ...first, startTime: '2013-05-31T23:12:00' },
    { ...first, startTime: '2013-02-30T23:12:00Z' }, { ...first, startTime: '2013-05-31T24:00:00Z' },
    { ...first, durationSeconds: '20' }, { ...first, durationSeconds: 0 }, { ...first, durationSeconds: Infinity },
    { ...first, durationSeconds: -1 }, { ...first, path: '' }, { ...first, camera: '' }
  ];
  assert.deepEqual(calibratedVideoClips(invalid), []);
  for (const bad of invalid) {
    assert.equal(videoClipBounds(bad), null);
    assert.equal(videoMediaTime(bad, start), null);
    assert.equal(videoTimelineTime(bad, 0), null);
  }
  assert.deepEqual(calibratedVideoClips(null), []);
  assert.equal(videoClipAt([first], NaN), null);
  assert.equal(videoMediaTime(first, Infinity), null);
  assert.equal(videoTimelineTime(first, '1'), null);
});

test('fractional media seeking round-trips without a ten-second timeline snap', () => {
  const offsetClip = { ...first, startTime: '2013-05-31T18:12:00.125-05:00', durationSeconds: 20.375, endTime: '2099-01-01T00:00:00Z' };
  assert.deepEqual(videoClipBounds(offsetClip), { startMs: start + 125, endMs: start + 20500 });
  for (const seconds of [0, 0.001, 1.375, 9.432, 20.375]) {
    const epoch = videoTimelineTime(offsetClip, seconds);
    assert.equal(epoch, start + 125 + seconds * 1000);
    assert.ok(Math.abs(videoMediaTime(offsetClip, epoch) - seconds) < 1e-8);
  }
  assert.equal(videoMediaTime(offsetClip, start - 10000), 0);
  assert.equal(videoMediaTime(offsetClip, start + 90000), 20.375);
  assert.equal(videoTimelineTime(offsetClip, -1), start + 125);
  assert.equal(videoTimelineTime(offsetClip, 500), start + 20500);
});

test('gap neighbors choose nearest completed end and future start, respecting camera', () => {
  const long = clip('long', -20, 55);
  const other = clip('other', 32, 1, 'brendon');
  const input = [...clips, long, other];
  assert.equal(previousVideoClip(input, start - 20001), null);
  assert.equal(previousVideoClip(input, start + 35000, 'our'), long);
  assert.equal(previousVideoClip(input, start + 30000, 'our'), adjacent);
  assert.equal(nextVideoClip(input, start + 30000, 'our'), last);
  assert.equal(nextVideoClip(input, start + 30000, 'auto'), other);
  assert.equal(nextVideoClip(input, start + 45000, 'our'), null);
  assert.equal(previousVideoClip(clips, start + 60500), last);
  assert.equal(previousVideoClip(clips, NaN), null);
  assert.equal(nextVideoClip(clips, Infinity), null);
});

test('host timezone cannot change camera synchronization', () => {
  const moduleURL = new URL('../js/video-timeline.js', import.meta.url).href;
  const script = `import { videoClipBounds, videoTimelineTime } from ${JSON.stringify(moduleURL)}; const c=${JSON.stringify({ ...first, startTime: '2013-05-31T18:12:00.125-05:00' })}; console.log(JSON.stringify([videoClipBounds(c),videoTimelineTime(c,1.375)]));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'].map(TZ => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(results[0], results[1]);
  assert.equal(results[0], results[2]);
});
