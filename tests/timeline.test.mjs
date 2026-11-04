import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { snapTimelineTime, buildRadarEvents, activeRadarEvent } from '../js/timeline.js';
import { radarFrameAt } from '../js/analysis.js';

const start = Date.parse('2013-05-31T22:45:00Z');
const end = Date.parse('2013-06-01T00:15:00Z');
const frames = [
  { time: '2013-05-31T23:28:23.000Z', reflectivityTime: '2013-05-31T23:28:31.306Z', velocityTime: '2013-05-31T23:28:50.756Z', reflectivity: 'r.png', velocity: 'v.png' },
  { time: '2013-05-31T23:32:59.000Z', reflectivityTime: '2013-05-31T23:33:07.300Z', velocityTime: '2013-05-31T23:33:26.750Z', reflectivity: 'r2.png', velocity: 'v2.png' }
];

test('scrubbing snaps to UTC ten-second ticks without anchoring the quantum to range start', () => {
  const target = Date.parse('2013-05-31T23:28:36.001Z');
  assert.equal(snapTimelineTime(target, start, end), Date.parse('2013-05-31T23:28:40Z'));
  assert.equal(snapTimelineTime(target - 2000, start + 3333, end), Date.parse('2013-05-31T23:28:30Z'));
  assert.equal(snapTimelineTime(target, start, end, 20000), Date.parse('2013-05-31T23:28:40Z'));
});

test('snapping clips at inclusive bounds including nonaligned endpoints and a zero-length range', () => {
  assert.equal(snapTimelineTime(start - 60000, start + 3333, end), start + 3333);
  assert.equal(snapTimelineTime(end + 60000, start, end - 2222), end - 2222);
  assert.equal(snapTimelineTime(start, start + 1, start + 1), start + 1);
  assert.throws(() => snapTimelineTime(start, end, start), /bounds/);
  assert.throws(() => snapTimelineTime(start, start, end, 0), /positive integer/);
});

test('clock timezone cannot change snapping or acquisition-event times', () => {
  const moduleURL = new URL('../js/timeline.js', import.meta.url).href;
  const script = `import {snapTimelineTime,buildRadarEvents} from ${JSON.stringify(moduleURL)}; console.log(JSON.stringify([snapTimelineTime(${start + 360015},${start},${end}),buildRadarEvents(${JSON.stringify(frames)},${start},${end})]));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Kolkata'].map(TZ => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(results[0], results[1]);
  assert.equal(results[0], results[2]);
});

test('product events preserve distinct midpoints and exact fractional scan times', () => {
  const events = buildRadarEvents(frames, start, end);
  assert.equal(events.length, 4);
  assert.deepEqual(events.map(e => e.product), ['reflectivity', 'velocity', 'reflectivity', 'velocity']);
  assert.equal(events[0].t, Date.parse(frames[0].reflectivityTime));
  assert.equal(events[1].t, Date.parse(frames[0].velocityTime));
  assert.equal(events[0].frameIndex, events[1].frameIndex);
  assert.notEqual(events[0].id, events[1].id);
  assert.notEqual(events[0].t, snapTimelineTime(events[0].t, start, end));
  assert.match(events[0].label, /23:28:31\.306 UTC$/);
});

test('rail clips inclusively, skips missing images and rejects ambiguous timezone-free timestamps', () => {
  const events = buildRadarEvents(frames, Date.parse(frames[0].velocityTime), Date.parse(frames[1].reflectivityTime));
  assert.deepEqual(events.map(e => [e.frameIndex, e.product]), [[0, 'velocity'], [1, 'reflectivity']]);
  assert.equal(buildRadarEvents([{ reflectivity: 'r.png', reflectivityTime: '2013-05-31T23:00:00' }], start, end).length, 0);
  assert.equal(buildRadarEvents([{ reflectivityTime: '2013-05-31T23:00:00Z' }], start, end).length, 0);
  const metadata = buildRadarEvents([{ velocity: 'v.png', products: { velocity: { time: '2013-05-31T18:00:00-05:00' } } }], start, end);
  assert.equal(metadata[0].t, Date.parse('2013-05-31T23:00:00Z'));
});

test('active product never uses a future image and expires exactly after its age limit', () => {
  const events = buildRadarEvents(frames, start, end);
  assert.equal(activeRadarEvent(events, events[0].t, 'reflectivity'), events[0]);
  assert.equal(activeRadarEvent(events, events[0].t, 'velocity'), null);
  assert.equal(activeRadarEvent(events, events[1].t - 1, 'velocity'), null);
  assert.equal(activeRadarEvent(events, events[1].t, 'velocity'), events[1]);
  assert.equal(activeRadarEvent(events.toReversed(), events[3].t, 'velocity'), events[3]);
  assert.equal(activeRadarEvent(events, events[3].t + 600000, 'velocity'), events[3]);
  assert.equal(activeRadarEvent(events, events[3].t + 600001, 'velocity'), null);
});

test('bundled acquisition events agree with the actual image selection at every product midpoint', () => {
  const manifest = JSON.parse(readFileSync(new URL('../data/radar/manifest.json', import.meta.url), 'utf8'));
  const allTimes = manifest.frames.flatMap(f => [Date.parse(f.reflectivityTime), Date.parse(f.velocityTime)]);
  const events = buildRadarEvents(manifest.frames, Math.min(...allTimes), Math.max(...allTimes));
  assert.equal(events.length, 42);
  for (const event of events) {
    for (const product of ['reflectivity', 'velocity']) {
      const active = activeRadarEvent(events, event.t, product);
      const selected = radarFrameAt(manifest.frames, event.t, product);
      assert.equal(active?.t ?? null, selected?.t ?? null);
      if (active) assert.equal(manifest.frames[active.frameIndex], selected.frame);
    }
  }
});
