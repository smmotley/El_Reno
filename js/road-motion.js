/**
 * Playback along inferred road geometry, with source observations kept separate.
 *
 * Input: a track from data/road-routes.json `tracks[id]`, containing points
 * {time,lat,lon,originalLat,originalLon,roadMatched,snapDistanceMeters} and intervals
 * {start,end,status,coordinates:[[lon,lat],...]}.
 *
 * Exports:
 * prepareRoadTrack(input): parse times; recompute cumulative geodesic lengths and
 * inferred interval-average speed. The source object is never mutated.
 * roadPositionAt(track,time,offsetMs=0): return null across unavailable intervals;
 * otherwise return {lat,lon,t,status,headingDegrees,averageSpeedMph,speedStatus,
 * roadMatched,...}. Exact unmatched fixes use status 'observed-unmatched'.
 * roadSegmentsUntil(track,time=Infinity,offsetMs=0): arrays of {lat,lon,t} along
 * admissible road polylines only. Separate intervals never gain field connectors.
 * closestRoadApproach(track,centers,offsetMs=0): one-second simultaneous comparison
 * against normalized NWS centers, with at most 60 seconds between center samples.
 *
 * All intervals describe inferred travel, not measured instantaneous speed or
 * proof that the driver took the suggested road. A positive clock offset moves
 * vehicle observations later, leaving the NWS chronology unchanged.
 */
import { haversine, MI, normalizePoints, positionAt } from './analysis.js';

const usable = interval => interval && ['routed', 'stationary'].includes(interval.status);
const validCoordinate = c => Array.isArray(c) && c.length >= 2 &&
  typeof c[0] === 'number' && typeof c[1] === 'number' &&
  Number.isFinite(c[0]) && Number.isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
const pointFor = c => ({ lon: c[0], lat: c[1] });
const sameCoordinate = (a, b) => a[0] === b[0] && a[1] === b[1];
const timestamp = value => typeof value === 'number' ? value : Date.parse(value);

function heading(a, b) {
  if (sameCoordinate(a, b)) return null;
  const radians = n => n * Math.PI / 180;
  const lat1 = radians(a[1]), lat2 = radians(b[1]), deltaLon = radians(b[0] - a[0]);
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

/** Normalize one track. Trust geometry and elapsed time, not cached speed fields. */
export function prepareRoadTrack(input) {
  if (!input || !Array.isArray(input.points) || !Array.isArray(input.intervals)) {
    throw new TypeError('A road track needs points and intervals arrays.');
  }
  const points = normalizePoints(input.points.map(p => ({ ...p, t: timestamp(p.time ?? p.t) })));
  const limit = Number.isFinite(input.interpolationLimitSeconds) && input.interpolationLimitSeconds > 0
    ? input.interpolationLimitSeconds * 1000 : (input.id === 'smotley' ? 300000 : 120000);
  const breaks = (input.breakIntervals || []).map(b => ({ start: timestamp(b.start), end: timestamp(b.end) }));
  const intervals = input.intervals.map(raw => {
    const startMs = timestamp(raw.start), endMs = timestamp(raw.end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new TypeError('Road intervals need valid increasing start and end times.');
    }
    const interval = { ...raw, startMs, endMs, coordinates: [], cumulativeMeters: [],
      distanceMeters: null, averageSpeedMph: null, speedStatus: null };
    if (!usable(interval)) return interval;
    if (breaks.some(b => startMs < b.end && endMs > b.start)) {
      return { ...interval, status: 'flagged', reason: 'An unresolved source interval blocks interpolation.' };
    }
    if (endMs - startMs > limit) {
      return { ...interval, status: 'gap', reason: 'The observation gap exceeds the track interpolation limit.' };
    }
    if (!Array.isArray(raw.coordinates) || !raw.coordinates.length || raw.coordinates.some(c => !validCoordinate(c))) {
      return { ...interval, status: 'unmatched', reason: 'No usable road geometry is available.' };
    }
    interval.coordinates = raw.coordinates.map(c => c.slice(0, 2));
    interval.cumulativeMeters = [0];
    for (let i = 1; i < interval.coordinates.length; i++) {
      const segmentMeters = haversine(pointFor(interval.coordinates[i - 1]), pointFor(interval.coordinates[i]));
      interval.cumulativeMeters.push(interval.cumulativeMeters.at(-1) + segmentMeters);
    }
    interval.distanceMeters = interval.cumulativeMeters.at(-1);
    if (raw.status === 'stationary' && interval.distanceMeters > 0.01) {
      return { ...interval, status: 'unmatched', coordinates: [], cumulativeMeters: [],
        distanceMeters: null, reason: 'A stationary interval unexpectedly contains movement.' };
    }
    if (interval.distanceMeters === 0) interval.status = 'stationary';
    interval.averageSpeedMph = interval.distanceMeters / MI / ((endMs - startMs) / 3600000);
    interval.speedStatus = 'inferred-interval-average';
    return interval;
  }).sort((a, b) => a.startMs - b.startMs);
  if (intervals.some((interval, i) => i && interval.startMs < intervals[i - 1].endMs)) {
    throw new TypeError('Road intervals must not overlap.');
  }
  return { ...input, points, intervals, interpolationLimitSeconds: limit / 1000, prepared: true };
}

function exactPoint(points, target) {
  let lo = 0, hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t === target) return points[mid];
    if (points[mid].t < target) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

function intervalAt(intervals, target) {
  let lo = 0, hi = intervals.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, interval = intervals[mid];
    if (target < interval.startMs) hi = mid - 1;
    else if (target >= interval.endMs) lo = mid + 1;
    else return interval;
  }
  return null;
}

function alongInterval(interval, fraction) {
  const coords = interval.coordinates, cumulative = interval.cumulativeMeters;
  const distance = Math.max(0, Math.min(1, fraction)) * interval.distanceMeters;
  if (!interval.distanceMeters) return { ...pointFor(coords[0]), headingDegrees: null, segmentIndex: 0 };
  // At an interior vertex use the outgoing nonzero segment. At the endpoint use
  // the last nonzero segment. Duplicate vertices never produce a division by zero.
  let index = 0;
  while (index < coords.length - 2 && cumulative[index + 1] <= distance) index++;
  while (index > 0 && cumulative[index + 1] === cumulative[index]) index--;
  const segmentMeters = cumulative[index + 1] - cumulative[index];
  const f = segmentMeters ? (distance - cumulative[index]) / segmentMeters : 0;
  const a = coords[index], b = coords[index + 1];
  return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f,
    headingDegrees: heading(a, b), segmentIndex: index };
}

function intervalEvidence(interval) {
  return interval ? { averageSpeedMph: interval.averageSpeedMph, speedStatus: interval.speedStatus,
    gapSeconds: (interval.endMs - interval.startMs) / 1000,
    before: { time: interval.start, t: interval.startMs }, after: { time: interval.end, t: interval.endMs }, interval }
    : { averageSpeedMph: null, speedStatus: null, gapSeconds: 0 };
}

/** Return a source fix or a distance-weighted position along its inferred road. */
export function roadPositionAt(track, time, offsetMs = 0) {
  if (!track?.points?.length || !Number.isFinite(time) || !Number.isFinite(offsetMs)) return null;
  const target = time - offsetMs;
  if (target < track.points[0].t || target > track.points.at(-1).t) return null;
  const observed = exactPoint(track.points, target);
  if (observed) {
    if (observed.roadMatched !== true) {
      return { ...observed, lat: observed.originalLat ?? observed.lat, lon: observed.originalLon ?? observed.lon,
        t: time, status: 'observed-unmatched', roadMatched: false, headingDegrees: null,
        averageSpeedMph: null, speedStatus: null, gapSeconds: 0 };
    }
    const next = track.intervals.find(i => i.startMs === target && usable(i));
    const previous = track.intervals.find(i => i.endMs === target && usable(i));
    const interval = next || previous;
    const pose = interval ? alongInterval(interval, next ? 0 : 1) : null;
    return { ...observed, ...intervalEvidence(interval), t: time, status: 'road-matched', roadMatched: true,
      headingDegrees: pose?.headingDegrees ?? null };
  }
  const interval = intervalAt(track.intervals, target);
  if (!usable(interval)) return null;
  const fraction = (target - interval.startMs) / (interval.endMs - interval.startMs);
  return { ...alongInterval(interval, fraction), ...intervalEvidence(interval), t: time, roadMatched: true,
    status: interval.status === 'stationary' ? 'stationary' : 'road-interpolated',
    interpolationFraction: fraction };
}

/** Full or elapsed road pieces, never straight connectors through missing data. */
export function roadSegmentsUntil(track, time = Infinity, offsetMs = 0) {
  if (!track?.intervals?.length || Number.isNaN(time) || !Number.isFinite(offsetMs)) return [];
  const target = time - offsetMs;
  const segments = [];
  for (const interval of track.intervals) {
    if (interval.startMs > target) break;
    if (!usable(interval)) continue;
    const duration = interval.endMs - interval.startMs;
    const fraction = Math.max(0, Math.min(1, (target - interval.startMs) / duration));
    const distance = fraction * interval.distanceMeters;
    const segment = interval.coordinates.flatMap((c, i) => interval.cumulativeMeters[i] <= distance
      ? [{ ...pointFor(c), t: interval.startMs + (interval.distanceMeters ? interval.cumulativeMeters[i] / interval.distanceMeters * duration : 0) + offsetMs }]
      : []);
    if (fraction < 1 && interval.distanceMeters) {
      const head = alongInterval(interval, fraction);
      if (!segment.length || segment.at(-1).lat !== head.lat || segment.at(-1).lon !== head.lon) {
        segment.push({ lat: head.lat, lon: head.lon, t: time });
      }
    }
    if (segment.length) segments.push(segment);
  }
  return segments;
}

/** Provisional center comparison at one-second steps plus original fix times. */
export function closestRoadApproach(track, centers, offsetMs = 0) {
  if (!track?.points?.length || !centers?.length || !Number.isFinite(offsetMs)) return null;
  const start = Math.max(track.points[0].t + offsetMs, centers[0].t);
  const end = Math.min(track.points.at(-1).t + offsetMs, centers.at(-1).t);
  if (end < start) return null;
  const times = new Set([end]);
  for (let t = start; t <= end; t += 1000) times.add(t);
  for (const p of track.points) if (p.t + offsetMs >= start && p.t + offsetMs <= end) times.add(p.t + offsetMs);
  let best = null;
  for (const t of [...times].sort((a, b) => a - b)) {
    const car = roadPositionAt(track, t, offsetMs), tornado = positionAt(centers, t, 60000);
    if (!car || !tornado) continue;
    const meters = haversine(car, tornado);
    if (!best || meters < best.meters) best = { t, meters, car, tornado,
      method: 'inferred-road-position-to-estimated-NWS-center', sampleSeconds: 1 };
  }
  return best;
}
