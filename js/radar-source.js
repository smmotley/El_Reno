import { radarFrameAt } from './analysis.js';

const PRODUCTS = ['reflectivity', 'velocity'];
const DEFAULT_MAX_AGE_SECONDS = 600;

// Acquisition timestamps must have a timezone; browser locale never determines
// when a radar image becomes eligible. Finite epoch milliseconds are also valid.
function epoch(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 8640000000000000 ? value : NaN;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

function ageLimit(manifest) {
  const seconds = manifest?.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : NaN;
}

function productFrames(manifest, product) {
  if (!Array.isArray(manifest?.frames)) return [];
  // A published scientific availability decision overrides residual files.
  // Presence of a product key blocks selection even if its reason is empty.
  if (manifest.unavailableProducts && Object.hasOwn(manifest.unavailableProducts, product)) return [];
  return manifest.frames.flatMap(frame => {
    if (!frame || typeof frame[product] !== 'string' || !frame[product].trim()) return [];
    const t = epoch(frame[`${product}Time`] ?? frame.products?.[product]?.time ?? frame.time);
    if (!Number.isFinite(t)) return [];
    return [{ original: frame, t, [product]: frame[product], [`${product}Time`]: new Date(t).toISOString() }];
  });
}

function explicitBounds(manifest) {
  const coverage = manifest?.coverage;
  if (coverage == null) return { start: -Infinity, end: Infinity };
  if (typeof coverage !== 'object' || Array.isArray(coverage)) return null;
  const start = coverage.start == null ? -Infinity : epoch(coverage.start);
  const end = coverage.end == null ? Infinity : epoch(coverage.end);
  return !Number.isNaN(start) && !Number.isNaN(end) && start <= end ? { start, end } : null;
}

/**
 * Source-specific usable time envelope in epoch milliseconds, or null.
 * Start is the first eligible product midpoint; an explicit coverage.start can
 * clip it later. An explicit coverage.end is a hard inclusive end. Otherwise
 * the last product can be held for maxAgeSeconds (600 by default).
 *
 * Legacy KTLX coverageStart/coverageEnd label scan acquisition coverage and do
 * not impose hard availability bounds: its final velocity midpoint follows
 * its coverageEnd (the final reflectivity midpoint). Only coverage.{start,end}
 * declares a hard recording window. The envelope can contain stale/missing
 * intervals; selectRadarFrame independently enforces product-specific age.
 */
export function radarCoverage(manifest) {
  const limit = ageLimit(manifest), bounds = explicitBounds(manifest);
  if (!Number.isFinite(limit) || !bounds) return null;
  const times = PRODUCTS.flatMap(product => productFrames(manifest, product))
    .map(frame => frame.t).filter(t => t >= bounds.start && t <= bounds.end);
  if (!times.length) return null;
  const start = Math.min(...times);
  const end = Number.isFinite(bounds.end) ? bounds.end : Math.max(...times) + limit;
  return Number.isFinite(end) && start <= end ? { start, end } : null;
}

/**
 * Latest preceding product midpoint within this source's coverage and age
 * limit, preserving radarFrameAt's {frame,t,ageSeconds} result and the original
 * frame object. Explicitly unavailable products are excluded even if images
 * remain in a manifest or on disk. No future frame, fallback source, or synthetic temporal frame
 * is selected. Product metadata (units, elevation, scan bounds) is unchanged.
 */
export function selectRadarFrame(manifest, time, product) {
  if (!Number.isFinite(time) || !PRODUCTS.includes(product)) return null;
  const coverage = radarCoverage(manifest), bounds = explicitBounds(manifest);
  if (!coverage || time < coverage.start || time > coverage.end) return null;
  const frames = productFrames(manifest, product).filter(frame => frame.t >= bounds.start && frame.t <= bounds.end);
  const selected = radarFrameAt(frames, time, product, ageLimit(manifest));
  return selected ? { ...selected, frame: selected.frame.original } : null;
}
