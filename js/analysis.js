export const EARTH_METERS = 6371008.8;
export const MI = 1609.344;
const radians = n => n * Math.PI / 180;

export function haversine(a, b) {
  const dLat = radians(b.lat - a.lat), dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function normalizePoints(points) {
  return points.map(p => ({ ...p, lat: Number(p.lat ?? p['-lat']), lon: Number(p.lon ?? p['-lon']), t: typeof p.t === 'number' ? p.t : Date.parse(p.time) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180)
    .sort((a, b) => a.t - b.t)
    .filter((p, i, a) => !i || p.t !== a[i - 1].t);
}

// Never extrapolate or bridge missing observations beyond the stated maximum gap.
export function positionAt(points, time, maxGapMs = 300000, offsetMs = 0) {
  if (!points.length) return null;
  const target = time - offsetMs;
  let lo = 0, hi = points.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t === target) return { ...points[mid], t: time, status: 'recorded', gapSeconds: 0 };
    if (points[mid].t < target) lo = mid + 1; else hi = mid - 1;
  }
  if (hi < 0 || lo >= points.length) return null;
  const a = points[hi], b = points[lo], gap = b.t - a.t;
  if (gap > maxGapMs) return null;
  const fraction = (target - a.t) / gap;
  return { lat: a.lat + (b.lat - a.lat) * fraction, lon: a.lon + (b.lon - a.lon) * fraction, t: time, status: 'interpolated', gapSeconds: gap / 1000, before: a, after: b };
}

export function splitTrack(points, maxGapMs = 300000, end = Infinity, offsetMs = 0) {
  const segments = [];
  let current = [];
  for (const p of points) {
    if (p.t + offsetMs > end) break;
    if (current.length && p.t - current.at(-1).t > maxGapMs) { segments.push(current); current = []; }
    current.push(p);
  }
  const head = positionAt(points, end, maxGapMs, offsetMs);
  if (head && head.status === 'interpolated') current.push(head);
  if (current.length) segments.push(current);
  return segments;
}

// Scan products are selected independently using their own sweep acquisition times.
export function radarFrameAt(frames, time, product, maxAgeMs = 600000) {
  let best = null, bestTime = -Infinity;
  for (const frame of frames) {
    if (!frame[product]) continue;
    const t = Date.parse(frame[`${product}Time`] || frame.time);
    if (t <= time && t > bestTime && time - t <= maxAgeMs) { best = frame; bestTime = t; }
  }
  return best ? { frame: best, t: bestTime, ageSeconds: (time - bestTime) / 1000 } : null;
}

// A one-second numerical estimate, not an exact observed closest distance.
export function closestApproach(track, centers, offsetMs = 0) {
  if (!track.length || !centers.length) return null;
  const start = Math.max(track[0].t + offsetMs, centers[0].t);
  const end = Math.min(track.at(-1).t + offsetMs, centers.at(-1).t);
  let best = null;
  for (let t = start; t <= end; t += 1000) {
    const car = positionAt(track, t, 300000, offsetMs), tornado = positionAt(centers, t, 60000);
    if (!car || !tornado) continue;
    const meters = haversine(car, tornado);
    if (!best || meters < best.meters) best = { t, meters, car, tornado };
  }
  return best;
}

export function validateSpotterImport(input) {
  const list = Array.isArray(input) ? input : input?.spotters;
  if (!Array.isArray(list) || !list.length || list.length > 5000) throw new Error('Expected a JSON object with a spotters array (1–5,000 tracks).');
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const timestamp = (value, label) => {
    const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!match) throw new Error(`${label} needs an ISO timestamp with an explicit timezone.`);
    const [, year, month, day, hour, minute, second = '0', , zone] = match;
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    const invalidOffset = zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59);
    const time = Date.parse(value);
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > days || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || invalidOffset || !Number.isFinite(time)) {
      throw new Error(`${label} contains an invalid timestamp.`);
    }
    return time;
  };
  return list.map((s, i) => {
    const label = `Track ${i + 1}`;
    if (!isObject(s) || typeof s.name !== 'string' || !s.name.trim() || !Array.isArray(s.points) || !s.points.length) throw new Error(`${label} needs a name and points.`);
    if (s.points.length > 100000) throw new Error(`Track ${i + 1} is too large.`);
    const points = s.points.map((p, j) => {
      if (!isObject(p)) throw new Error(`${label} contains an invalid position.`);
      const t = timestamp(p.time, `${label}, position ${j + 1}`);
      if (typeof p.lat !== 'number' || typeof p.lon !== 'number' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) throw new Error(`${label} contains invalid coordinates; latitude and longitude must be numbers.`);
      // Incoming numeric t and source-status claims never override the supplied clock.
      return { time: p.time, lat: p.lat, lon: p.lon, t };
    }).sort((a, b) => a.t - b.t);
    if (points.some((p, j) => j && p.t === points[j - 1].t)) throw new Error(`${label} contains duplicate positions at the same time.`);

    const result = { id: `import-${i}`, name: s.name.trim(), kind: 'imported', points, videos: [], breakIntervals: [], interpolationLimitSeconds: 120, imported: true };
    // Copy only metadata the viewer understands, without retaining arbitrary fields.
    for (const key of ['id', 'username', 'kind', 'sourceKey', 'sourceLabel', 'sourceUrl', 'surveyVideoUrl', 'note']) {
      if (s[key] === undefined || (key === 'username' && s[key] === null)) continue;
      if (typeof s[key] !== 'string') throw new Error(`${label} ${key} must be text.`);
      if ((key === 'id' || key === 'kind') && !s[key].trim()) throw new Error(`${label} ${key} must not be empty.`);
      result[key] = s[key];
    }
    if (s.videos !== undefined) {
      if (!Array.isArray(s.videos) || s.videos.some(id => typeof id !== 'string' || !id.trim())) throw new Error(`${label} videos must be an array of video IDs.`);
      result.videos = [...s.videos];
    }
    if (s.interpolationLimitSeconds !== undefined) {
      if (typeof s.interpolationLimitSeconds !== 'number' || !Number.isFinite(s.interpolationLimitSeconds) || s.interpolationLimitSeconds <= 0 || s.interpolationLimitSeconds > 120) throw new Error(`${label} interpolationLimitSeconds must be a number greater than 0 and at most 120.`);
      result.interpolationLimitSeconds = s.interpolationLimitSeconds;
    }
    if (s.breakIntervals !== undefined) {
      if (!Array.isArray(s.breakIntervals)) throw new Error(`${label} breakIntervals must be an array.`);
      let previousEnd = -Infinity;
      result.breakIntervals = s.breakIntervals.map((interval, j) => {
        if (!isObject(interval)) throw new Error(`${label} has an invalid break interval.`);
        const start = timestamp(interval.start, `${label}, break ${j + 1} start`);
        const end = timestamp(interval.end, `${label}, break ${j + 1} end`);
        if (end <= start || start < previousEnd) throw new Error(`${label} break intervals must have increasing start/end times and be ordered without overlap.`);
        if (interval.reason !== undefined && typeof interval.reason !== 'string') throw new Error(`${label} break reason must be text.`);
        previousEnd = end;
        return { start: interval.start, end: interval.end, ...(interval.reason !== undefined ? { reason: interval.reason } : {}) };
      });
    }
    return result;
  });
}
