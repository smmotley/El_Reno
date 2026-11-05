import { calibratedVideoClips, videoClipAt, videoClipBounds, videoMediaTime, videoTimelineTime, previousVideoClip, nextVideoClip } from './video-timeline.js';

const clock = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
const cameraName = camera => ({our: 'Our SUV', brendon: 'Brendon', unassigned: 'Unassigned camera'})[camera] || camera;
const setText = (element, value) => {
  const text = String(value ?? '');
  if (element.textContent !== text) element.textContent = text;
};

/** One shared dashboard clock. The media element never changes the map clock implicitly. */
export class ChasePlayer {
  constructor(manifest, { getState, seek, play, resize, format, toast }) {
    this.clips = manifest.clips || [];
    this.actions = { getState, seek, play, resize, format, toast };
    this.camera = 'auto';
    this.layout = 'split';
    this.active = null;
    this.loadedId = null;
    this.pendingPlay = null;
    this.failedId = null;
    this.timeButtons = [];
    const map = document.querySelector('.map-workspace');
    this.stage = document.createElement('section');
    this.stage.className = 'playback-stage';
    this.stage.dataset.layout = 'split';
    this.stage.setAttribute('aria-label', 'Synchronized video and map');
    map.before(this.stage);
    this.stage.innerHTML = `
      <div class="stage-toolbar">
        <div class="focus-switch" role="group" aria-label="Video and map layout">
          <button data-focus="map" aria-pressed="false">Map</button>
          <button data-focus="split" aria-pressed="true">Split view</button>
          <button data-focus="video" aria-pressed="false">Video + mini map</button>
        </div>
        <label class="split-size">Video size <input id="video-size" type="range" min="25" max="75" value="50" aria-label="Video share of split view"></label>
        <button id="viewer-fullscreen" class="viewer-fullscreen" aria-label="Fullscreen video with map and timeline">⛶ <span>Full screen</span></button>
      </div>
      <div class="stage-content">
        <section class="chase-video-panel" aria-label="Time-synchronized chase footage">
          <div class="chase-video-heading"><div><span class="eyebrow">FROM THE ROAD</span><strong id="chase-video-title">Your chase, on the same clock.</strong></div>
            <label class="camera-choice"><span>Camera</span><select id="chase-camera" aria-label="Camera for synchronized video"><option value="auto">Auto · available camera</option><option value="our">Our SUV</option><option value="brendon">Brendon</option></select></label>
          </div>
          <div class="chase-video-picture">
            <video id="chase-video" preload="metadata" playsinline muted aria-label="Synchronized chase video"></video>
            <div id="video-empty" class="video-empty"><span class="empty-film">▷</span><strong>No timed footage at this moment</strong><p id="video-gap-message"></p><div><button id="video-previous">← Previous clip</button><button id="video-next">Next clip →</button></div></div>
            <span id="video-buffer" class="video-buffer" role="status" hidden>Loading video…</span>
          </div>
          <div class="chase-video-controls">
            <div class="clip-transport"><button id="video-play" aria-label="Play synchronized video">▶</button><output id="clip-elapsed">— / —</output><input id="clip-seek" type="range" min="0" max="1" step="0.05" value="0" aria-label="Seek within the current video"><button id="video-mute" aria-label="Turn sound on">Turn sound on</button></div>
            <div class="video-clock-line"><span id="video-sync-status">One clock for footage, vehicles, and radar</span><span id="video-anchor"></span></div>
            <label class="clip-picker-label"><span>Clip library</span><select id="chase-clip" aria-label="Choose a video clip"><option value="">Jump to a clip…</option></select></label>
          </div>
        </section>
        <div class="split-divider" role="separator" tabindex="0" aria-label="Resize video and map" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-valuenow="50"></div>
      </div>`;
    this.stage.querySelector('.stage-content').append(map);
    const mini = document.createElement('button');
    mini.className = 'mini-map-expand'; mini.textContent = 'LIVE MAP ↗'; mini.title = 'Return to split view';
    mini.addEventListener('click', () => this.setLayout('split')); map.append(mini);
    this.video = document.getElementById('chase-video');
    this.video.muted = true;
    this.elements = Object.fromEntries([...this.stage.querySelectorAll('[id]')].map(el => [el.id, el]));
    this.elements['chase-camera'].addEventListener('change', event => { this.camera = event.target.value; this.render(); });
    this.bindPlaybackControls();
    this.elements['clip-seek'].addEventListener('input', event => {
      if (!this.active) return;
      const clip = this.active, seconds = Number(event.target.value);
      play(false);
      // Seeking to the last frame must not accidentally select a following clip.
      seek(videoTimelineTime(clip, Math.min(seconds, clip.durationSeconds - .04)));
    });
    this.elements['video-previous'].addEventListener('click', () => this.jump(previousVideoClip(this.clips, getState().t, this.camera)));
    this.elements['video-next'].addEventListener('click', () => this.jump(nextVideoClip(this.clips, getState().t, this.camera)));
    for (const button of this.stage.querySelectorAll('[data-focus]')) button.addEventListener('click', () => this.setLayout(button.dataset.focus));
    this.elements['video-size'].addEventListener('input', event => this.setRatio(Number(event.target.value)));
    const divider = this.stage.querySelector('.split-divider');
    divider.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      this.setRatio(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : Number(this.elements['video-size'].value) + (event.key === 'ArrowLeft' ? -5 : 5));
    });
    divider.addEventListener('pointerdown', event => { divider.setPointerCapture(event.pointerId); });
    divider.addEventListener('pointermove', event => {
      if (!divider.hasPointerCapture(event.pointerId)) return;
      const bounds = this.stage.querySelector('.stage-content').getBoundingClientRect();
      this.setRatio((event.clientX - bounds.left) / bounds.width * 100);
    });
    this.elements['viewer-fullscreen'].addEventListener('click', async () => {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      this.beforeFullscreen = this.layout;
      this.setLayout('video');
      try { await document.documentElement.requestFullscreen(); }
      catch { toast('Video focus is open. Your browser did not allow full screen.'); }
    });
    document.addEventListener('fullscreenchange', () => {
      document.body.classList.toggle('viewer-fullscreen-active', !!document.fullscreenElement);
      this.elements['viewer-fullscreen'].setAttribute('aria-label', document.fullscreenElement ? 'Exit full screen' : 'Fullscreen video with map and timeline');
      this.elements['viewer-fullscreen'].querySelector('span').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
      if (!document.fullscreenElement && this.beforeFullscreen) { this.setLayout(this.beforeFullscreen); this.beforeFullscreen = null; }
      resize();
    });
    this.video.addEventListener('loadedmetadata', () => this.render());
    this.video.addEventListener('seeked', () => this.render());
    this.video.addEventListener('canplay', () => this.render());
    this.video.addEventListener('error', () => {
      this.failedId = this.loadedId; this.render();
    });
    this.buildLibrary();
    this.setLayout('split');
  }

  bindPlaybackControls() {
    this.elements['video-play'].addEventListener('click', () => this.actions.play(!this.actions.getState().playing));
    this.elements['video-mute'].addEventListener('click', () => {
      if (this.elements['video-mute'].disabled) return;
      this.video.muted = !this.video.muted;
      this.render();
    });
  }

  setRatio(value) {
    const ratio = Math.max(25, Math.min(75, value));
    this.stage.style.setProperty('--video-share', `${ratio}%`);
    this.elements['video-size'].value = ratio;
    this.stage.querySelector('.split-divider').setAttribute('aria-valuenow', String(Math.round(ratio)));
    this.actions.resize();
  }

  setLayout(layout) {
    this.layout = ['map','split','video'].includes(layout) ? layout : 'split';
    this.stage.dataset.layout = this.layout;
    document.body.classList.toggle('video-focus', this.layout === 'video');
    for (const button of this.stage.querySelectorAll('[data-focus]')) button.setAttribute('aria-pressed', String(button.dataset.focus === this.layout));
    this.actions.resize(); this.render();
  }

  jump(clip) {
    if (!clip) return;
    const bounds = videoClipBounds(clip);
    this.actions.play(false);
    if (!bounds) { this.openUntimed(clip); return; }
    this.camera = clip.camera;
    this.elements['chase-camera'].value = this.camera;
    if (this.layout === 'map') this.setLayout('split');
    this.actions.seek(bounds.startMs);
  }

  openUntimed(clip) {
    let dialog = document.getElementById('untimed-video-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'untimed-video-dialog';
      dialog.setAttribute('aria-labelledby', 'untimed-title');
      dialog.innerHTML = '<button class="dialog-close" aria-label="Close untimed video">×</button><p class="eyebrow">TIME NOT REGISTERED</p><h2 id="untimed-title"></h2><p>The map is paused. This clip needs a verified start time before it can share the chase timeline.</p><video controls playsinline preload="metadata" aria-label="Untimed clip preview"></video>';
      document.body.append(dialog);
      dialog.querySelector('button').addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { dialog.querySelector('video').pause(); dialog.querySelector('video').removeAttribute('src'); dialog.querySelector('video').load(); });
    }
    dialog.querySelector('h2').textContent = clip.title;
    dialog.querySelector('video').src = clip.path;
    dialog.showModal();
  }

  buildLibrary() {
    const select = this.elements['chase-clip'];
    const catalog = document.getElementById('chase-clip-list');
    const summary = document.createElement('p'); summary.className = 'clip-library-summary';
    summary.textContent = `${calibratedVideoClips(this.clips).length} timed clips · ${this.clips.filter(c => !videoClipBounds(c)).length} awaiting a time reference`;
    catalog.append(summary);
    for (const clip of this.clips) {
      const bounds = videoClipBounds(clip);
      const option = document.createElement('option'); option.value = clip.id;
      option.textContent = `${clip.title} · ${bounds ? this.actions.format(bounds.startMs) : 'time not registered'}`;
      select.append(option);
      const button = document.createElement('button'); button.className = 'local-clip-card';
      if (clip.posterPath) { const poster = document.createElement('img'); poster.src = clip.posterPath; poster.loading = 'lazy'; poster.alt = ''; button.append(poster); }
      const detail = document.createElement('span'); const title = document.createElement('strong'); title.textContent = clip.title;
      const note = document.createElement('small'); note.textContent = `${cameraName(clip.camera)} · ${clock(clip.durationSeconds)} · ${bounds ? this.actions.format(bounds.startMs) : 'not synchronized'}`;
      detail.append(title, note); button.append(detail);
      button.addEventListener('click', () => this.jump(clip)); catalog.append(button);
    }
    select.addEventListener('change', () => { this.jump(this.clips.find(c => c.id === select.value)); select.value = ''; });
  }

  buildRail(start, end) {
    let row = document.getElementById('video-scan-row');
    if (!row) {
      row = document.createElement('div'); row.id = 'video-scan-row'; row.className = 'scan-row video-scan-row';
      row.innerHTML = '<div class="scan-caption"><span>VIDEO</span><output id="scan-video-time">—</output></div><div class="scan-rail video-rail" id="video-rail" role="group" aria-label="Timed video coverage"></div>';
      document.getElementById('radar-rails').append(row);
    }
    const rail = document.getElementById('video-rail'); rail.replaceChildren(); this.timeButtons = [];
    for (const clip of calibratedVideoClips(this.clips)) {
      const bounds = videoClipBounds(clip);
      if (bounds.endMs <= start || bounds.startMs >= end) continue;
      const button = document.createElement('button'); button.className = 'video-span'; button.dataset.camera = clip.camera;
      button.style.left = `${(Math.max(start, bounds.startMs) - start) / (end - start) * 100}%`;
      button.style.width = `${(Math.min(end, bounds.endMs) - Math.max(start, bounds.startMs)) / (end - start) * 100}%`;
      button.title = `${cameraName(clip.camera)} · ${this.actions.format(bounds.startMs)}–${this.actions.format(bounds.endMs)} · ${clip.title}`;
      button.setAttribute('aria-label', button.title); button.addEventListener('click', () => this.jump(clip));
      rail.append(button); this.timeButtons.push({button, clip});
    }
  }

  isBuffering() {
    const state = this.actions.getState();
    return this.layout !== 'map' && !!this.active && this.failedId !== this.active.id && state.playing && state.speed <= 4 && (this.video.readyState < 3 || this.video.seeking);
  }

  render() {
    const state = this.actions.getState();
    const clip = videoClipAt(this.clips, state.t, this.camera);
    const elements = this.elements;
    this.active = clip;
    const failed = clip && this.failedId === clip.id;
    this.video.hidden = !clip || failed;
    elements['video-empty'].hidden = !!clip && !failed;
    setText(elements['video-empty'].querySelector('strong'), failed ? 'This viewing copy could not load' : 'No timed footage at this moment');
    const previous = previousVideoClip(this.clips, state.t, this.camera), next = nextVideoClip(this.clips, state.t, this.camera);
    elements['video-previous'].disabled = !previous; elements['video-next'].disabled = !next;
    setText(elements['video-gap-message'], failed ? 'The map still works. Make sure the prepared video files are available.' : next ? `Next ${this.camera === 'auto' ? 'available' : cameraName(this.camera)} clip starts at ${this.actions.format(videoClipBounds(next).startMs)}.` : 'This camera has no later timed clip in the collection. The map continues through the gap.');
    setText(elements['chase-video-title'], clip ? clip.title : 'Your chase, on the same clock.');
    const elapsed = clip ? videoMediaTime(clip, state.t) : 0;
    setText(elements['clip-elapsed'], clip ? `${clock(elapsed)} / ${clock(clip.durationSeconds)}` : '— / —');
    elements['clip-seek'].disabled = !clip;
    elements['clip-seek'].max = clip?.durationSeconds || 1; elements['clip-seek'].value = elapsed;
    elements['clip-seek'].setAttribute('aria-valuetext', clip ? `${clock(elapsed)} of ${clock(clip.durationSeconds)}` : 'No timed clip');
    setText(elements['video-play'], state.playing ? 'Ⅱ' : '▶');
    elements['video-play'].setAttribute('aria-label', state.playing ? 'Pause synchronized video' : 'Play synchronized video');
    const fast = state.speed > 4;
    elements['video-mute'].disabled = fast;
    const soundAction = fast ? 'Preview · no audio' : this.video.muted ? 'Turn sound on' : 'Turn sound off';
    setText(elements['video-mute'], soundAction);
    elements['video-mute'].setAttribute('aria-label', soundAction);
    setText(elements['video-sync-status'], clip ? (fast ? `${state.speed}× frame preview` : 'Synchronized') + ' · ' + this.actions.format(state.t) : 'No video here · map and radar remain on the shared clock');
    setText(elements['video-anchor'], clip ? (clip.calibration?.status === 'provisional' ? 'Approx. start ' : 'Start ') + this.actions.format(videoClipBounds(clip).startMs) : '');
    const railTime = document.getElementById('scan-video-time');
    if (railTime) setText(railTime, clip ? cameraName(clip.camera) : 'No timed clip');
    for (const item of this.timeButtons) item.button.classList.toggle('active', item.clip.id === clip?.id);
    if (!clip || failed || this.layout === 'map') { this.pendingPlay = null; this.video.pause(); elements['video-buffer'].hidden = true; return; }
    if (this.loadedId !== clip.id) {
      this.loadedId = clip.id; this.failedId = null; this.pendingPlay = null; this.video.pause();
      this.video.preload = 'auto';
      this.video.src = clip.path; this.video.poster = clip.posterPath || ''; this.video.load();
    }
    const threshold = state.playing && !fast ? .35 : .025;
    if (this.video.readyState >= 1 && !this.video.seeking && Math.abs(this.video.currentTime - elapsed) > threshold) {
      this.video.currentTime = Math.min(elapsed, Math.max(0, this.video.duration - .025));
    }
    elements['video-buffer'].hidden = this.video.readyState >= 3 && !this.video.seeking;
    if (state.playing && !fast) {
      this.video.playbackRate = state.speed;
      // Request playback once metadata and the intended seek are established.
      // Waiting for HAVE_FUTURE_DATA first can deadlock metadata-only preload;
      // the shared clock remains paused by isBuffering() during the download.
      if (this.video.paused && this.video.readyState >= 1 && !this.pendingPlay) {
        const request = { clipId: clip.id };
        this.pendingPlay = request;
        const rejected = error => {
          if (this.pendingPlay !== request || this.loadedId !== request.clipId) return;
          if (error.name === 'NotAllowedError') { this.actions.play(false); this.actions.toast('Press Play to start the synchronized footage.'); }
        };
        try {
          Promise.resolve(this.video.play()).catch(rejected).finally(() => {
            if (this.pendingPlay === request) this.pendingPlay = null;
          });
        } catch (error) {
          rejected(error);
          if (this.pendingPlay === request) this.pendingPlay = null;
        }
      }
    } else { this.pendingPlay = null; this.video.pause(); }
  }
}
