import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the app's selection and marker-update functions with map/DOM adapters;
// loading the entire browser entry point would also start network and map setup.
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const selectionCode = app.slice(app.indexOf('function updateSpotterSelectionUI()'), app.indexOf('function updateRadar('));
const domElement = (id, tagName = 'BUTTON') => ({
  dataset: { spotterSelection: id }, tagName, attributes: {},
  classList: { values: new Set(), toggle(name, enabled) { enabled ? this.values.add(name) : this.values.delete(name); }, contains(name) { return this.values.has(name); } },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; }, querySelector() { return null; }
});

class Marker {
  constructor(point, options = {}) { this.point = point; this.options = options; this.events = {}; this.element = null; }
  bindTooltip() { return this; } bindPopup() { return this; }
  on(name, handler) { this.events[name] = handler; return this; }
  fire(name, event = {}) { this.events[name]?.(event); }
  setLatLng(point) { this.point = point; return this; }
  setLatLngs(points) { this.points = points; return this; }
  setOpacity(opacity) { this.opacity = opacity; return this; }
  setStyle(style) { this.style = style; return this; }
  setPopupContent() { return this; } setTooltipContent() { return this; }
  setZIndexOffset(value) { this.options.zIndexOffset = value; return this; }
  getElement() { return this.element; }
  addTo(map) { map.layers.add(this); this.element = domElement(''); return this; }
}

function context() {
  const maps = Array.from({ length: 2 }, () => ({
    people: new Map(), selectedTrail: new Marker(),
    map: { layers: new Set(), hasLayer(marker) { return this.layers.has(marker); },
      removeLayer(marker) { this.layers.delete(marker); marker.element = null; },
      panTo() { assert.fail('selection must not pan'); }, setView() { assert.fail('selection must not change the view'); } }
  }));
  const elements = [domElement('a'), domElement('b'), domElement('a', 'ARTICLE')];
  const state = { t: 100, offset: 0, selectedSpotter: null, follow: true, playing: true, volume: false, visible: { spotters: true }, opacity: { spotters: .7 } };
  const spotters = [{ id: 'a', name: 'First chaser' }, { id: 'b', name: 'Second chaser' }];
  let volumeUpdates = 0;
  const sandbox = vm.createContext({ state, spotters, maps,
    document: { querySelectorAll: () => elements },
    L: { marker: (point, options) => new Marker(point, options), divIcon: options => options },
    featuredChasers: {}, chaserColor: () => '#8eb5bc', esc: value => value,
    latlng: point => [point.lat, point.lon], speedText: () => 'Road estimate', spotterPopup: spotter => spotter.name,
    spotterPosition: (spotter, time) => spotter.id === 'a' && time === 200 ? null : { lat: 35, lon: spotter.id === 'a' ? -98 : -97.9 },
    spotterSegments: () => [], roadTrack: {}, roadPositionAt: () => null,
    updateVolumeSurface: () => { volumeUpdates++; },
    setPresent(map, marker, shown) { if (shown && !map.hasLayer(marker)) marker.addTo(map); else if (!shown && map.hasLayer(marker)) map.removeLayer(marker); }
  });
  vm.runInContext(selectionCode, sandbox);
  return { sandbox, state, maps, elements, volumeUpdates: () => volumeUpdates };
}

test('marker selection persists through popup closure, scrubbing, gaps and reappearance in both maps', () => {
  const { sandbox, state, maps, elements } = context();
  for (const map of maps) sandbox.updatePeople(map);
  maps[0].people.get('a').fire('click');
  assert.equal(state.selectedSpotter, 'a');
  assert.equal(state.t, 100); assert.equal(state.follow, true); assert.equal(state.playing, true);
  assert.equal(elements[0].attributes['aria-pressed'], 'true');
  maps[0].people.get('a').fire('popupclose');
  for (const time of [150, 200, 300]) {
    state.t = time;
    for (const map of maps) {
      sandbox.updatePeople(map);
      const marker = map.people.get('a');
      assert.equal(map.map.hasLayer(marker), time !== 200);
      if (time !== 200) assert.equal(marker.getElement().classList.contains('selected-chaser'), true);
    }
    assert.equal(state.selectedSpotter, 'a');
  }
  maps[1].people.get('b').fire('click');
  for (const map of maps) {
    assert.equal(map.people.get('a').getElement().classList.contains('selected-chaser'), false);
    assert.equal(map.people.get('b').getElement().classList.contains('selected-chaser'), true);
    assert.equal(map.people.get('a').options.zIndexOffset, 100);
  }
  assert.equal(elements[0].attributes['aria-pressed'], 'false');
  assert.equal(elements[1].attributes['aria-pressed'], 'true');
  assert.equal(state.t, 300);
});

test('selection stays recorded when chaser layers are hidden and is restored without moving time', () => {
  const { sandbox, state, maps } = context();
  state.visible.spotters = false;
  assert.equal(sandbox.selectSpotter('a'), true);
  assert.equal(maps[0].people.size, 0);
  state.visible.spotters = true;
  for (const map of maps) {
    sandbox.updatePeople(map);
    assert.equal(map.people.get('a').getElement().classList.contains('selected-chaser'), true);
  }
  assert.equal(sandbox.selectSpotter('smotley'), false, 'our SUV cannot be turned into a selected survey chaser');
  assert.equal(state.selectedSpotter, 'a');
  assert.equal(state.t, 100);
});

test('selection refreshes the existing 3D surface without changing time or camera state', () => {
  const { sandbox, state, volumeUpdates } = context();
  state.volume = true;
  sandbox.selectSpotter('b');
  assert.equal(volumeUpdates(), 1);
  assert.equal(state.selectedSpotter, 'b');
  assert.equal(state.volume, true); assert.equal(state.t, 100); assert.equal(state.follow, true);
});

test('Leaflet Enter keypress selects the focused chaser and clears the prior highlight', () => {
  const { sandbox, state, maps } = context();
  sandbox.selectSpotter('a');
  const second = maps[0].people.get('b');
  second.fire('keypress', { originalEvent: { key: 'x', keyCode: 88 } });
  assert.equal(state.selectedSpotter, 'a');
  second.fire('keypress', { originalEvent: { key: 'Enter', keyCode: 13 } });
  assert.equal(state.selectedSpotter, 'b');
  for (const map of maps) {
    assert.equal(map.people.get('a').getElement().classList.contains('selected-chaser'), false);
    assert.equal(map.people.get('b').getElement().classList.contains('selected-chaser'), true);
  }
  assert.equal(state.t, 100); assert.equal(state.follow, true); assert.equal(state.playing, true);
  maps[1].people.get('a').fire('keypress', { originalEvent: { keyCode: 13 } });
  assert.equal(state.selectedSpotter, 'a', 'legacy keyCode matches the bundled Leaflet Enter behavior');
});
