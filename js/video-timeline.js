/** Video timing is independent of the dashboard's ten-second scrubber ticks. */
const ZONED_ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/i;

function startEpoch(value) {
  if (typeof value !== 'string') return NaN;
  const match = ZONED_ISO.exec(value);
  if (!match) return NaN;
  const [, year, month, day, hour, minute, second, , zoneHour = '0', zoneMinute = '0'] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1] || Number(hour) > 23 ||
      Number(minute) > 59 || Number(second) > 59 || Number(zoneHour) > 23 || Number(zoneMinute) > 59) return NaN;
  return Date.parse(value);
}

/**
 * Accept {id,camera,startTime,durationSeconds,path}; return derived epoch-ms
 * bounds or null. A null/ambiguous start is uncalibrated, never an inferred
 * recording time. Existing endTime/timestamp fields are deliberately ignored.
 */
export function videoClipBounds(clip) {
  if (!clip || typeof clip !== 'object' ||
      !['id', 'camera', 'path'].every(key => typeof clip[key] === 'string' && clip[key].trim()) ||
      !Number.isFinite(clip.durationSeconds) || clip.durationSeconds <= 0) return null;
  const startMs = startEpoch(clip.startTime);
  const endMs = startMs + clip.durationSeconds * 1000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || Math.abs(endMs) > 8.64e15) return null;
  return { startMs, endMs };
}

const compareId = (a, b) => a.clip.id < b.clip.id ? -1 : a.clip.id > b.clip.id ? 1 : 0;

function entries(input, camera) {
  const clips = Array.isArray(input) ? input : input?.clips;
  if (!Array.isArray(clips) || typeof camera !== 'string' || !camera) return [];
  return clips.flatMap(clip => {
    if (camera !== 'auto' && clip?.camera !== camera) return [];
    const interval = videoClipBounds(clip);
    return interval ? [{ clip, ...interval }] : [];
  }).sort((a, b) => a.startMs - b.startMs || compareId(a, b));
}

/** Sorted original clip references. A selected camera is a strict filter. */
export function calibratedVideoClips(input, camera = 'auto') {
  return entries(input, camera).map(entry => entry.clip);
}

/**
 * Active interval is [start,end), including the last clip. In an overlap,
 * latest start wins; equal starts choose the lexically smallest id. 'auto'
 * admits every camera, while 'our'/'brendon'/other IDs never cross-fill gaps.
 */
export function videoClipAt(input, timeMs, camera = 'auto') {
  if (!Number.isFinite(timeMs)) return null;
  let active = null;
  for (const entry of entries(input, camera)) {
    if (entry.startMs > timeMs) break;
    if (timeMs < entry.endMs && (!active || entry.startMs > active.startMs)) active = entry;
  }
  return active?.clip ?? null;
}

/** Epoch milliseconds to clamped media seconds; preserves fractional seeks. */
export function videoMediaTime(clip, timeMs) {
  const interval = videoClipBounds(clip);
  if (!interval || !Number.isFinite(timeMs)) return null;
  return Math.min(clip.durationSeconds, Math.max(0, (timeMs - interval.startMs) / 1000));
}

/**
 * Media seconds to epoch milliseconds, clamped to the clip. At media duration
 * this returns the exact exclusive end; videoClipAt may select a next clip or
 * return null there. This helper never snaps to dashboard scrubber ticks.
 */
export function videoTimelineTime(clip, mediaSeconds) {
  const interval = videoClipBounds(clip);
  if (!interval || !Number.isFinite(mediaSeconds)) return null;
  return interval.startMs + Math.min(clip.durationSeconds, Math.max(0, mediaSeconds)) * 1000;
}

/** Closest completed clip (end <= time), by latest end, then latest start/id. */
export function previousVideoClip(input, timeMs, camera = 'auto') {
  if (!Number.isFinite(timeMs)) return null;
  let previous = null;
  for (const entry of entries(input, camera)) {
    if (entry.endMs <= timeMs && (!previous || entry.endMs > previous.endMs ||
        (entry.endMs === previous.endMs && entry.startMs > previous.startMs))) previous = entry;
  }
  return previous?.clip ?? null;
}

/** Closest upcoming clip (start > time). Active clips are not future clips. */
export function nextVideoClip(input, timeMs, camera = 'auto') {
  if (!Number.isFinite(timeMs)) return null;
  return entries(input, camera).find(entry => entry.startMs > timeMs)?.clip ?? null;
}
