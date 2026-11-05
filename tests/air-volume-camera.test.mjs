import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AirVolumeViewer } from '../js/air-volume-viewer.js';

const terrain = JSON.parse(readFileSync(new URL('../data/air-surface.json', import.meta.url))).terrain;
const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≈ ${expected}`);

function viewer(width = 1280, height = 800) {
  const handlers = new Map(), viewEvents = [], labelEvents = [];
  const canvas = {
    width, height, style: {}, focus() {}, setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener() {}
  };
  const v = Object.assign(Object.create(AirVolumeViewer.prototype), {
    canvas, _width: width, _height: height, yaw: 0, pitch: .4, zoom: 1, _pan: [0, 0, 0],
    _terrain: terrain, _markers: [], _markerHits: [], _hiddenLabels: new Set(), _labelButtons: new Map(),
    _pointers: new Map(), _listeners: [], _axisLabelsVisible: true, _lastViewState: null, _lastLabelsState: null,
    _schedule() {}, onViewChange: state => viewEvents.push(state), onLabelsChange: state => labelEvents.push(state)
  });
  v._bindInteraction();
  return { v, handlers, viewEvents, labelEvents };
}

const event = (type, properties = {}) => ({ type, pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100, preventDefault() {}, stopPropagation() {}, ...properties });

test('look-direction presets and overhead orientation use the actual metric camera', () => {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const { v } = viewer(width, height);
    for (const [preset, bearing] of [['north', 0], ['east', 90], ['south', 180], ['west', 270]]) {
      assert.equal(v.setViewPreset(preset), true);
      near(v.getViewState().bearingDegrees, bearing);
    }
    v.setViewPreset('top');
    const camera = v._camera();
    near(v.getViewState().bearingDegrees, 0); near(v.getViewState().tiltDegrees, 89);
    assert.ok(camera.right[0] > .999, 'east projects to screen right');
    assert.ok(camera.up[1] > .999, 'north projects to screen up');
    assert.ok([...camera.eye, ...camera.forward, ...camera.right, ...camera.up].every(Number.isFinite));
    v.rotateView(90, 0); near(v.getViewState().bearingDegrees, 90);
    assert.equal(v.setViewPreset('invalid'), false);
  }
});

test('API, wheel, pinch, and keyboard zoom share the two-kilometer minimum', () => {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const { v, handlers } = viewer(width, height);
    const check = () => { near(v.getViewState().distanceKm, 2); assert.equal(v.getViewState().limits.canZoomIn, false); };
    v.zoomView(1e9); check();
    v.resetView();
    for (let i = 0; i < 40; i++) handlers.get('wheel')(event('wheel', { deltaY: -400, deltaMode: 0 }));
    check(); v.resetView();
    for (let i = 0; i < 70; i++) handlers.get('keydown')(event('keydown', { key: '+' }));
    check(); v.resetView();
    handlers.get('pointerdown')(event('pointerdown', { pointerType: 'touch', clientX: 100 }));
    handlers.get('pointerdown')(event('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 110 }));
    handlers.get('pointermove')(event('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 10000 }));
    check();
    v.zoomView(1e-12);
    near(v.getViewState().distanceKm, v.getViewState().limits.maxDistanceKm);
    assert.equal(v.getViewState().limits.canZoomOut, false);
  }
});

test('close focus and downward panning keep the camera above real terrain without changing it', () => {
  const heights = [...terrain.heights];
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const { v } = viewer(width, height);
    v.setMarkers([{ id: 'our-suv', x: -20, y: 15, z: .4, label: 'Our SUV', kind: 'suv' }]);
    assert.equal(v.focusMarker('our-suv'), true);
    v.zoomView(1e9); v.rotateView(0, -1000);
    near(v.getViewState().tiltDegrees, 5);
    for (const dy of [0, -1000, -10000, 10000]) {
      v.panView(0, dy);
      const c = v._camera(), ground = v._terrainHeightAt(c.eye[0], c.eye[1]) ?? c.grid.min[2];
      assert.ok(c.eye[2] >= ground + .05 - 1e-9);
      assert.ok(c.clipRange[0] < .05, 'ground clearance exceeds the near clipping distance');
      assert.ok([...c.eye, ...c.center, ...c.forward].every(Number.isFinite));
      near(c.distance, 2);
    }
    assert.deepEqual([v._markers[0].x, v._markers[0].y, v._markers[0].z], [-20, 15, .4]);
  }
  assert.deepEqual(terrain.heights, heights, 'camera protection never modifies terrain heights');
});

test('camera callbacks do not repeat when redraws or marker updates leave the view unchanged', () => {
  const { v, viewEvents } = viewer();
  v.resetView(); assert.equal(viewEvents.length, 1);
  for (let i = 0; i < 20; i++) {
    v._viewChanged(); v.setMarkers([]); v.setOpacity(.72); v.setThreshold(30);
  }
  assert.equal(viewEvents.length, 1);
  v.rotateView(15, 0); assert.equal(viewEvents.length, 2);
  v.zoomView(1.5); assert.equal(viewEvents.length, 3);
});

test('minimized labels keep marker hit targets and restore on a dot click, not a drag', () => {
  const { v, handlers, labelEvents } = viewer();
  const marker = { id: 'chaser', x: 0, y: 0, z: .4, label: 'Chaser' };
  v.setMarkers([marker]); v._markerHits = [{ marker, x: 100, y: 100, radius: 10 }];
  v.hideLabel(marker.id); assert.equal(v._hiddenLabels.size, 1); assert.equal(v._markers.length, 1);
  handlers.get('pointerdown')(event('pointerdown'));
  handlers.get('pointermove')(event('pointermove', { clientX: 120 }));
  handlers.get('pointerup')(event('pointerup'));
  assert.equal(v._hiddenLabels.size, 1, 'orbit drag cannot restore a label');
  handlers.get('pointerdown')(event('pointerdown')); handlers.get('pointerup')(event('pointerup'));
  assert.equal(v._hiddenLabels.size, 0);
  assert.deepEqual(labelEvents.at(-1), { hiddenCount: 0, visibleHiddenCount: 0 });
  v.hideLabel(marker.id); v.restoreLabels(); assert.equal(v._hiddenLabels.size, 0);
});

test('label close controls are accessible DOM buttons while the point remains drawn', () => {
  const originalDocument = globalThis.document;
  const buttons = [];
  globalThis.document = { createElement: tag => {
    const handlers = new Map(), attributes = new Map();
    const button = { tag, style: {}, handlers, attributes, addEventListener: (name, callback) => handlers.set(name, callback), setAttribute: (name, value) => attributes.set(name, value) };
    buttons.push(button); return button;
  } };
  try {
    const { v } = viewer(390, 844); v.labelControls = { append() {} };
    v.setMarkers([{ id: 'our-suv', x: 0, y: 0, z: .4, label: 'Our SUV', kind: 'suv' }]);
    const ctx = new Proxy({ measureText: text => ({ width: text.length * 6 }) }, { get: (object, key) => key in object ? object[key] : () => {}, set: (object, key, value) => { object[key] = value; return true; } });
    const project = () => [195, 400];
    v._drawMarkerAnnotations(ctx, project);
    assert.equal(buttons.length, 1); assert.equal(buttons[0].tag, 'button'); assert.equal(buttons[0].type, 'button');
    assert.equal(buttons[0].attributes.get('aria-label'), 'Hide label for Our SUV');
    buttons[0].handlers.get('click')(event('click'));
    v._drawMarkerAnnotations(ctx, project);
    assert.equal(buttons[0].hidden, true); assert.equal(v._markerHits.length, 1);
    v.restoreLabels(); v._drawMarkerAnnotations(ctx, project);
    assert.equal(buttons[0].hidden, false); assert.equal(buttons.length, 1, 'the DOM button is reused across frames');
  } finally { globalThis.document = originalDocument; }
});

test('selected chasers get a double outline at the same point, without altering our SUV', () => {
  const { v } = viewer();
  const strokes = [];
  const ctx = new Proxy({
    measureText: text => ({ width: text.length * 6 }),
    strokeRect(...rect) { strokes.push({ rect, color: this.strokeStyle, width: this.lineWidth }); }
  }, { get: (object, key) => key in object ? object[key] : () => {}, set: (object, key, value) => { object[key] = value; return true; } });
  const chaser = { id: 'selected', x: 1, y: 2, z: .4, kind: 'chaser', selected: true, color: '#ffb454' };
  v.setMarkers([chaser]); v._hiddenLabels.add(chaser.id);
  v._drawMarkerAnnotations(ctx, () => [400, 300]);
  assert.deepEqual(strokes.map(stroke => [stroke.color, stroke.width]), [['#0a1712', 6], ['#fff9e9', 2]]);
  assert.deepEqual(v._markers[0], { ...chaser, opacity: 1, priority: 1 });
  assert.equal(v._markerHits[0].x, 400); assert.equal(v._markerHits[0].y, 300);
  strokes.length = 0;
  v.setMarkers([{ ...chaser, selected: false }]);
  v._drawMarkerAnnotations(ctx, () => [400, 300]);
  assert.equal(strokes.length, 0);
  const suv = { ...chaser, id: 'our-suv', kind: 'suv', selected: true };
  v.setMarkers([suv]); v._hiddenLabels.add(suv.id);
  v._drawMarkerAnnotations(ctx, () => [400, 300]);
  assert.deepEqual(strokes.map(stroke => stroke.color), ['#eff2e8'], 'SUV keeps its existing outline only');
});
