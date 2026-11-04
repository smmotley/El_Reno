// Reproduce the provisional comparison from local source files. No network needed.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizePoints, positionAt, haversine, MI } from '../js/analysis.js';
import { prepareRoadTrack, closestRoadApproach } from '../js/road-motion.js';

const read = name => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
const gps = normalizePoints(read('GPS.json').data);
const centers = normalizePoints(read('data/tornado-timeline.json').points);
const roadRoutes = read('data/road-routes.json');
const roadTrack = prepareRoadTrack(roadRoutes.tracks.smotley);
const best = closestRoadApproach(roadTrack, centers);
if (!best) throw new Error('No supported road-position/NWS overlap is available.');
const fixes = gps.flatMap(point => {
  const center = positionAt(centers, point.t, 60000);
  return center ? [{ time: point.time, meters: haversine(point, center) }] : [];
}).sort((a, b) => a.meters - b.meters);

const result = {
  interpretation: 'Provisional UTC camera clock; current estimate uses inferred road geometry and road-adjusted endpoints. Original GPS fixes are a separate comparison. Distances are to estimated NWS center, not edge or subvortices. Extra digits are computational audit values, not physical accuracy.',
  gpsObservations: gps.length,
  nwsCenters: centers.length,
  roadAdjustedMinimum: {
    time: new Date(best.t).toISOString(), miles: best.meters / MI,
    cameraStatus: best.car.status, cameraBracket: [best.car.before?.time, best.car.after?.time],
    cameraPosition: { lat: best.car.lat, lon: best.car.lon },
    routeStatus: best.car.interval?.status ?? null,
    inferredIntervalAverageSpeedMph: best.car.averageSpeedMph,
    centerStatus: best.tornado.status, centerBracket: [best.tornado.before?.time, best.tornado.after?.time],
    centerPosition: { lat: best.tornado.lat, lon: best.tornado.lon },
    method: best.method,
  },
  originalGpsFixMinimum: { time: fixes[0].time, miles: fixes[0].meters / MI },
  cameraClockSensitivity: [-2, -1, 0, 1, 2].map(minutes => {
    const comparison = closestRoadApproach(roadTrack, centers, minutes * 60000);
    return { addMinutesToCameraTime: minutes, miles: comparison ? comparison.meters / MI : null,
      time: comparison ? new Date(comparison.t).toISOString() : null };
  }),
  roadEvidence: Object.values(roadRoutes.tracks).reduce((summary, raw) => {
    const track = prepareRoadTrack(raw);
    summary.trackCount++;
    summary.originalPositionCount += track.points.length;
    summary.roadMatchedPositionCount += track.points.filter(p => p.roadMatched).length;
    for (const p of track.points) if (p.roadMatched) {
      const displacement = haversine(p, { lat: p.originalLat, lon: p.originalLon });
      summary.maximumPositionAdjustmentMeters = Math.max(summary.maximumPositionAdjustmentMeters, displacement);
    }
    for (const interval of track.intervals) {
      summary.intervalStatuses[interval.status] = (summary.intervalStatuses[interval.status] || 0) + 1;
      if (['routed', 'stationary'].includes(interval.status)) {
        summary.maximumAcceptedAverageSpeedMph = Math.max(summary.maximumAcceptedAverageSpeedMph, interval.averageSpeedMph);
      }
    }
    return summary;
  }, { trackCount: 0, originalPositionCount: 0, roadMatchedPositionCount: 0,
    maximumPositionAdjustmentMeters: 0, maximumAcceptedAverageSpeedMph: 0, intervalStatuses: {} }),
};
console.log(JSON.stringify(result, null, 2));
