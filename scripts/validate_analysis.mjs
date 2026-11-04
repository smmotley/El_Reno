// Reproduce the provisional comparison from local source files. No network needed.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizePoints, closestApproach, positionAt, haversine, MI } from '../js/analysis.js';

const read = name => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
const gps = normalizePoints(read('GPS.json').data);
const centers = normalizePoints(read('data/tornado-timeline.json').points);
const best = closestApproach(gps, centers);
const fixes = gps.flatMap(point => {
  const center = positionAt(centers, point.t, 60000);
  return center ? [{ time: point.time, meters: haversine(point, center) }] : [];
}).sort((a, b) => a.meters - b.meters);

const result = {
  interpretation: 'Provisional UTC camera clock; distances to estimated NWS center, not edge or subvortices. Extra digits are computational audit values, not physical accuracy.',
  gpsObservations: gps.length,
  nwsCenters: centers.length,
  interpolatedMinimum: {
    time: new Date(best.t).toISOString(), miles: best.meters / MI,
    cameraStatus: best.car.status, cameraBracket: [best.car.before?.time, best.car.after?.time],
    centerStatus: best.tornado.status, centerBracket: [best.tornado.before?.time, best.tornado.after?.time],
  },
  originalGpsFixMinimum: { time: fixes[0].time, miles: fixes[0].meters / MI },
  cameraClockSensitivity: [-2, -1, 0, 1, 2].map(minutes => {
    const comparison = closestApproach(gps, centers, minutes * 60000);
    return { addMinutesToCameraTime: minutes, miles: comparison.meters / MI, time: new Date(comparison.t).toISOString() };
  }),
};
console.log(JSON.stringify(result, null, 2));
