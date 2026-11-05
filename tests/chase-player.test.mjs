import test from 'node:test';
import assert from 'node:assert/strict';
import { ChasePlayer } from '../js/chase-player.js';

const start = Date.parse('2013-05-31T23:10:00Z');
const clips = [
  { id: 'our', camera: 'our', path: 'our.mp4', startTime: new Date(start).toISOString(), durationSeconds: 30 },
  { id: 'other', camera: 'brendon', path: 'other.mp4', startTime: new Date(start).toISOString(), durationSeconds: 30 }
];
class ControlElement extends EventTarget {
  constructor() {
    super();
    this.hidden = false; this.disabled = false; this.value = ''; this.attributes = {};
    this._text = ''; this.textNode = null; this.textWrites = 0;
  }
  get textContent() { return this._text; }
  set textContent(value) {
    this._text = String(value); this.textNode = { text: this._text }; this.textWrites++;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector() { return this.child ??= new ControlElement(); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}
const element = () => new ControlElement();

function harness(t, { offset = 0, readyState = 1, speed = 1, playing = true } = {}) {
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => { if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument; });
  const state = { t: start + offset * 1000, playing, speed };
  const requests = [], playChanges = [], messages = [];
  let currentTime = 0;
  const video = {
    readyState, seeking: false, paused: true, duration: 30, muted: true,
    get currentTime() { return currentTime; },
    set currentTime(value) { currentTime = value; this.seeking = true; },
    pause() { this.paused = true; },
    load() { this.readyState = readyState; this.seeking = false; currentTime = 0; },
    play() {
      this.paused = false;
      let resolve, reject;
      const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
      requests.push({ resolve, reject, mediaTime: currentTime, src: this.src });
      return promise;
    }
  };
  const player = Object.assign(Object.create(ChasePlayer.prototype), {
    clips, camera: 'our', layout: 'split', active: null, loadedId: null,
    pendingPlay: null, failedId: null, timeButtons: [], video,
    elements: Object.fromEntries([
      'video-empty', 'video-previous', 'video-next', 'video-gap-message',
      'chase-video-title', 'clip-elapsed', 'clip-seek', 'video-play',
      'video-mute', 'video-sync-status', 'video-anchor', 'video-buffer'
    ].map(id => [id, element()])),
    actions: {
      getState: () => state, format: value => new Date(value).toISOString(),
      toast: message => messages.push(message),
      play: value => { playChanges.push(value); state.playing = value; player.render(); }
    }
  });
  player.bindPlaybackControls();
  return { player, state, video, requests, playChanges, messages };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('metadata-only media requests playback and holds the map until buffered', t => {
  const { player, video, requests } = harness(t);
  player.render();
  assert.equal(video.preload, 'auto');
  assert.equal(requests.length, 1, 'HAVE_METADATA must be enough to initiate fetching/playback');
  assert.equal(requests[0].mediaTime, 0);
  assert.equal(player.isBuffering(), true);
  video.paused = true; // Some engines keep this true while the request is pending.
  player.render();
  player.render();
  assert.equal(requests.length, 1, 'one unresolved request, even while media remains paused');
  video.readyState = 3;
  assert.equal(player.isBuffering(), false);
});

test('fractional target seek is established before requesting playback during loading', t => {
  const { player, video, requests } = harness(t, { offset: 12.345 });
  player.render();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].mediaTime, 12.345);
  assert.equal(video.seeking, true);
  assert.equal(player.isBuffering(), true);
  video.readyState = 3;
  assert.equal(player.isBuffering(), true, 'the clock must still wait for seek completion');
  video.seeking = false;
  assert.equal(player.isBuffering(), false);
});

test('a stale play rejection from a replaced camera cannot pause or clear the new request', async t => {
  const { player, requests, playChanges, messages } = harness(t, { offset: 5 });
  player.render();
  player.camera = 'brendon';
  player.render();
  const currentRequest = player.pendingPlay;
  assert.equal(requests.length, 2);
  assert.equal(requests[1].src, 'other.mp4');
  assert.equal(requests[1].mediaTime, 5);
  requests[0].reject(Object.assign(new Error('old request'), { name: 'NotAllowedError' }));
  await flush();
  assert.equal(player.pendingPlay, currentRequest);
  assert.deepEqual(playChanges, []);
  assert.deepEqual(messages, []);
  requests[1].resolve();
  await flush();
  assert.equal(player.pendingPlay, null);
});

test('a gap cancels pending playback without freezing the timeline or accepting stale errors', async t => {
  const { player, state, video, requests, playChanges } = harness(t);
  player.render();
  state.t = start + 30000;
  player.render();
  assert.equal(player.active, null);
  assert.equal(player.pendingPlay, null);
  assert.equal(video.paused, true);
  assert.equal(video.hidden, true);
  assert.equal(player.isBuffering(), false);
  requests[0].reject(Object.assign(new Error('old request'), { name: 'NotAllowedError' }));
  await flush();
  assert.deepEqual(playChanges, []);
});

test('fast preview does not request playback or block the clock', t => {
  const { player, video, requests } = harness(t, { offset: 8.125, speed: 5 });
  player.render();
  assert.equal(video.currentTime, 8.125);
  assert.equal(video.paused, true);
  assert.equal(requests.length, 0);
  assert.equal(player.isBuffering(), false);
});

test('a current autoplay rejection pauses once and releases its pending request', async t => {
  const { player, state, requests, playChanges, messages } = harness(t);
  player.render();
  requests[0].reject(Object.assign(new Error('needs gesture'), { name: 'NotAllowedError' }));
  await flush();
  assert.deepEqual(playChanges, [false]);
  assert.equal(state.playing, false);
  assert.equal(player.pendingPlay, null);
  assert.equal(messages.length, 1);
});

test('real play/pause click handlers remain reversible across repeated playback updates', t => {
  const { player, state, video, requests } = harness(t, { playing: false, readyState: 3 });
  player.render();
  const button = player.elements['video-play'];
  for (let cycle = 0; cycle < 4; cycle++) {
    button.click();
    assert.equal(state.playing, true);
    assert.equal(video.paused, false);
    assert.equal(button.attributes['aria-label'], 'Pause synchronized video');
    state.t += 100;
    player.render();
    button.click();
    assert.equal(state.playing, false);
    assert.equal(video.paused, true);
    assert.equal(button.attributes['aria-label'], 'Play synchronized video');
    player.render();
    assert.equal(video.paused, true);
  }
  assert.equal(requests.length, 4);
});

test('sound click handler toggles actual media mute while playing and paused', t => {
  const { player, state, video } = harness(t);
  player.render();
  const sound = player.elements['video-mute'];
  assert.equal(sound.textContent, 'Turn sound on');
  sound.click();
  assert.equal(video.muted, false);
  assert.equal(sound.textContent, 'Turn sound off');
  assert.equal(sound.attributes['aria-label'], sound.textContent);
  player.render();
  assert.equal(video.muted, false);
  player.elements['video-play'].click();
  assert.equal(state.playing, false);
  sound.click();
  assert.equal(video.muted, true);
  assert.equal(sound.textContent, 'Turn sound on');
  sound.click();
  assert.equal(video.muted, false);
  assert.equal(video.paused, true, 'changing sound must not start a paused clip');
});

test('late play resolution and media-event renders cannot resume after pause click', async t => {
  const { player, state, video, requests } = harness(t, { playing: false });
  player.render();
  player.elements['video-play'].click();
  assert.equal(requests.length, 1);
  player.elements['video-play'].click();
  assert.equal(state.playing, false);
  assert.equal(player.pendingPlay, null);
  requests[0].resolve();
  await flush();
  video.readyState = 3; video.seeking = false;
  player.render(); // Same path used by canplay and seeked events.
  player.render();
  assert.equal(video.paused, true);
  assert.equal(state.playing, false);
  assert.equal(requests.length, 1);
});

test('unchanged playing controls preserve their child nodes across timeline renders', t => {
  const { player, state } = harness(t);
  player.render();
  const play = player.elements['video-play'], sound = player.elements['video-mute'];
  const playNode = play.textNode, soundNode = sound.textNode;
  const playWrites = play.textWrites, soundWrites = sound.textWrites;
  for (let i = 0; i < 20; i++) { state.t += 100; player.render(); }
  assert.equal(play.textNode, playNode);
  assert.equal(sound.textNode, soundNode);
  assert.equal(play.textWrites, playWrites);
  assert.equal(sound.textWrites, soundWrites);
  sound.click();
  assert.notEqual(sound.textNode, soundNode, 'an actual sound change updates its action label');
});

test('fast preview sound control is explicitly silent and does not toggle mute', t => {
  const { player, video } = harness(t, { speed: 5 });
  player.render();
  const sound = player.elements['video-mute'];
  assert.equal(sound.disabled, true);
  assert.equal(sound.textContent, 'Preview · no audio');
  assert.equal(sound.attributes['aria-label'], sound.textContent);
  sound.click();
  assert.equal(video.muted, true);
  assert.equal(video.paused, true);
});
