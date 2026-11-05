/**
 * Reversible, explicitly approximate video-based reconstruction of our road track.
 * This does not edit GPS observations, video timing, radar, or other chase tracks.
 * Call applyChaseCorrections(originalPreparedTrack, config, { enabled }) and pass
 * the returned prepared track to the existing road playback / analysis helpers.
 * Corrections use baseline UTC; the normal playback clock offset is applied later.
 */
import { EARTH_METERS, MI, haversine } from './analysis.js';
import { prepareRoadTrack } from './road-motion.js';

const radians = value => value * Math.PI / 180;
const iso = value => new Date(value).toISOString();
const equal = (a, b) => a[0] === b[0] && a[1] === b[1];
const point = coordinate => ({ lon: coordinate[0], lat: coordinate[1] });
const distance = (a, b) => haversine(point(a), point(b));
const time = value => typeof value === 'number' ? value : Date.parse(value);

function requireValue(condition, message) {
  if (!condition) throw new TypeError('Chase correction: ' + message);
}

function nearestRoadPosition(coordinates, anchor) {
  const cosLat = Math.cos(radians(anchor.lat));
  let best = null;
  for (let i = 0; i < coordinates.length - 1; i++) {
    const a = coordinates[i], b = coordinates[i + 1];
    const ax = radians(a[0] - anchor.lon) * EARTH_METERS * cosLat;
    const ay = radians(a[1] - anchor.lat) * EARTH_METERS;
    const dx = radians(b[0] - a[0]) * EARTH_METERS * cosLat;
    const dy = radians(b[1] - a[1]) * EARTH_METERS;
    const denominator = dx * dx + dy * dy;
    const fraction = denominator ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator)) : 0;
    const coordinate = [a[0] + fraction * (b[0] - a[0]), a[1] + fraction * (b[1] - a[1])];
    const meters = haversine(anchor, point(coordinate));
    if (!best || meters < best.meters) best = { coordinate, meters, segment: i };
  }
  return best;
}

function uniqueAdjacent(coordinates) {
  return coordinates.filter((c, i) => !i || !equal(c, coordinates[i - 1])).map(c => c.slice());
}

function routeLength(coordinates) {
  return coordinates.slice(1).reduce((sum, coordinate, i) => sum + distance(coordinates[i], coordinate), 0);
}

function reconstructStop(track, correction) {
  requireValue(correction.type === 'stationary-stop', 'only stationary-stop corrections are supported.');
  requireValue(typeof correction.id === 'string' && correction.id.length > 0, 'an evidence identifier is required.');
  const start = time(correction.start), end = time(correction.end);
  const windowStart = time(correction.window?.start), windowEnd = time(correction.window?.end);
  requireValue([start, end, windowStart, windowEnd].every(Number.isFinite) &&
    windowStart < start && start < end && end < windowEnd, 'the stop must be strictly inside its reconstruction window.');
  const requestedLocation = correction.requestedLocation;
  requireValue(requestedLocation && Number.isFinite(requestedLocation.lat) && Number.isFinite(requestedLocation.lon) &&
    Math.abs(requestedLocation.lat) <= 90 && Math.abs(requestedLocation.lon) <= 180, 'the requested anchor is invalid.');
  requireValue(Number.isFinite(correction.maxRoadSnapMeters) && correction.maxRoadSnapMeters >= 0,
    'a finite nonnegative road-snap limit is required.');
  const left = track.points.find(p => p.t === windowStart), right = track.points.find(p => p.t === windowEnd);
  requireValue(left && right && left.roadMatched && right.roadMatched,
    'window endpoints must be original road-matched fixes.');
  const affected = track.intervals.filter(i => i.endMs > windowStart && i.startMs < windowEnd);
  requireValue(affected.length && affected[0].startMs === windowStart && affected.at(-1).endMs === windowEnd,
    'the window must cover complete source intervals.');
  requireValue(affected.every((i, index) => ['routed', 'stationary'].includes(i.status) &&
    i.coordinates.length && (!index || i.startMs === affected[index - 1].endMs)),
    'missing, flagged, or unavailable intervals cannot be bridged.');
  requireValue(affected.every((i, index) => !index || equal(affected[index - 1].coordinates.at(-1), i.coordinates[0])),
    'source road geometry must be continuous.');
  const coordinates = uniqueAdjacent(affected.flatMap(i => i.coordinates));
  requireValue(coordinates.length >= 2 && equal(coordinates[0], [left.lon, left.lat]) &&
    equal(coordinates.at(-1), [right.lon, right.lat]), 'source roads must meet the unchanged endpoint fixes.');
  const closest = nearestRoadPosition(coordinates, requestedLocation);
  requireValue(closest && closest.meters <= correction.maxRoadSnapMeters,
    'the requested anchor is farther from the existing road than allowed.');
  const beforeCoordinates = uniqueAdjacent([...coordinates.slice(0, closest.segment + 1), closest.coordinate]);
  const afterCoordinates = uniqueAdjacent([closest.coordinate, ...coordinates.slice(closest.segment + 1)]);
  const supersededObservations = track.points.filter(p => p.t > windowStart && p.t < windowEnd).map(p => ({ ...p }));
  if (correction.supersededSourceTimes) {
    const expected = correction.supersededSourceTimes.map(time).sort((a, b) => a - b);
    requireValue(expected.length === supersededObservations.length && expected.every((t, i) => t === supersededObservations[i].t),
      'the observations inside the correction window have changed.');
  }
  const evidence = { reconstruction: true, approximate: true, correctionId: correction.id,
    evidence: 'user-video-reconstruction', method: 'user-video-stop-bounded-road-reconstruction' };
  const intervals = [
    { start: iso(windowStart), end: iso(start), status: 'routed', coordinates: beforeCoordinates, ...evidence },
    { start: iso(start), end: iso(end), status: 'stationary', coordinates: [closest.coordinate.slice()], ...evidence },
    { start: iso(end), end: iso(windowEnd), status: 'routed', coordinates: afterCoordinates, ...evidence },
  ];
  const speedLimit = correction.maxMovingSpeedMph ?? 110;
  requireValue(Number.isFinite(speedLimit) && speedLimit > 0, 'the moving-speed limit is invalid.');
  for (const interval of intervals) {
    const speed = routeLength(interval.coordinates) / MI / ((time(interval.end) - time(interval.start)) / 3600000);
    requireValue(speed <= speedLimit, 'the reconstruction would require an implausible interval-average speed.');
  }
  const stopPoint = timestamp => ({ time: iso(timestamp), t: timestamp, ...point(closest.coordinate),
    originalLat: requestedLocation.lat, originalLon: requestedLocation.lon,
    roadMatched: true, snapDistanceMeters: closest.meters, source: 'user-video-anchor',
    recordedObservation: false, ...evidence });
  const result = prepareRoadTrack({ ...track,
    points: [...track.points.filter(p => p.t <= windowStart || p.t >= windowEnd), stopPoint(start), stopPoint(end)],
    intervals: [...track.intervals.filter(i => i.endMs <= windowStart || i.startMs >= windowEnd), ...intervals],
  });
  // The original interpolation limit still applies; a correction cannot silently
  // create a hidden gap or bypass an inherited source break.
  requireValue(result.intervals.filter(i => i.correctionId === correction.id)
    .every(i => ['routed', 'stationary'].includes(i.status)), 'the correction violates the track interpolation rules.');
  return { track: result, audit: { id: correction.id, type: correction.type, start: iso(start), end: iso(end),
    windowStart: iso(windowStart), windowEnd: iso(windowEnd), durationSeconds: (end - start) / 1000,
    requestedLocation: { ...requestedLocation }, roadLocation: point(closest.coordinate),
    snapDistanceMeters: closest.meters, roadSnapLimitMeters: correction.maxRoadSnapMeters,
    supersededLocationCandidates: (correction.supersededLocationCandidates || []).map(candidate => ({
      ...candidate, requestedLocation: { ...candidate.requestedLocation },
    })),
    supersededObservations, source: correction.source,
    movingLegs: result.intervals.filter(i => i.correctionId === correction.id && i.status === 'routed')
      .map(i => ({ start: i.start, end: i.end, distanceMeters: i.distanceMeters, averageSpeedMph: i.averageSpeedMph })),
  } };
}

/** Return an independent prepared track; source observations and config stay unchanged. */
export function applyChaseCorrections(input, config, { enabled = config?.enabledByDefault ?? false } = {}) {
  requireValue(!input.chaseCorrections?.enabled, 'apply corrections to the original track, not an already corrected track.');
  const original = prepareRoadTrack(input);
  if (!enabled) return { ...original, chaseCorrections: { enabled: false, approximate: false, applied: [] } };
  requireValue(config?.schemaVersion === 1 && config.trackId === input.id && Array.isArray(config.corrections),
    'the configuration must target this track and use schema version 1.');
  const corrections = [...config.corrections].sort((a, b) => time(a.window?.start) - time(b.window?.start));
  requireValue(corrections.every((c, i) => !i || time(c.window?.start) >= time(corrections[i - 1].window?.end)),
    'reconstruction windows must not overlap.');
  requireValue(new Set(corrections.map(c => c.id)).size === corrections.length, 'correction identifiers must be unique.');
  let track = original;
  const applied = [];
  for (const correction of corrections) {
    const result = reconstructStop(track, correction);
    track = result.track; applied.push(result.audit);
  }
  return { ...track, chaseCorrections: { enabled: true, approximate: true,
    label: config.label || 'Video stop reconstruction', sourceTrackUnmodified: true, applied } };
}
