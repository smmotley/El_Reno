const PRODUCTS = ['reflectivity', 'velocity'];
const PRODUCT_LABELS = { reflectivity: 'Reflectivity', velocity: 'Radial velocity' };

function bounds(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
    throw new RangeError('Timeline bounds must be finite epoch milliseconds in chronological order.');
  }
}

/**
 * Snap user scrubbing/stepping to an epoch-aligned quantum, independently of
 * the display timezone. Inclusive endpoints may be off-grid when a custom
 * chase range starts or ends between ticks. Exact radar-marker selection
 * should bypass this helper and use the event's unrounded t directly.
 */
export function snapTimelineTime(time, start, end, stepMs = 10000) {
  bounds(start, end);
  if (!Number.isFinite(time) || !Number.isSafeInteger(stepMs) || stepMs <= 0) {
    throw new RangeError('Timeline time must be finite and its step must be a positive integer number of milliseconds.');
  }
  const snapped = Math.round(time / stepMs) * stepMs;
  return Math.min(end, Math.max(start, snapped));
}

// Parsing timezone-free strings would make event positions depend on the
// viewer's computer timezone, so only explicit ISO offsets or epoch ms pass.
function epoch(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return NaN;
  return Date.parse(value);
}

/**
 * One rail event per actual product image, using that product's acquisition
 * midpoint. Sweep partners remain distinct even when their volume is shared.
 * `label` is explicitly UTC; the UI may format `t` in its selected timezone.
 */
export function buildRadarEvents(frames, start, end) {
  bounds(start, end);
  if (!Array.isArray(frames)) throw new TypeError('Radar frames must be an array.');
  const events = [];
  frames.forEach((frame, frameIndex) => {
    if (!frame || typeof frame !== 'object') return;
    for (const product of PRODUCTS) {
      if (!frame[product]) continue;
      const timestamp = frame[`${product}Time`] ?? frame.products?.[product]?.time ?? frame.time;
      const t = epoch(timestamp);
      if (!Number.isFinite(t) || t < start || t > end) continue;
      const clock = new Date(t).toISOString().slice(11, 23);
      events.push({
        id: `radar-${product}-${frameIndex}-${t}`,
        product,
        t,
        label: `${PRODUCT_LABELS[product]} · ${clock} UTC`,
        frameIndex
      });
    }
  });
  return events.sort((a, b) => a.t - b.t || a.frameIndex - b.frameIndex || PRODUCTS.indexOf(a.product) - PRODUCTS.indexOf(b.product));
}

/**
 * Return the original latest eligible product event, or null. The optional
 * age limit matches radarFrameAt's ten-minute expiry; future events are never
 * eligible. Pass a full-coverage event list when selecting images so the
 * observation immediately preceding the visible rail can still be held.
 */
export function activeRadarEvent(events, time, product, maxAgeMs = 600000) {
  if (!Array.isArray(events)) throw new TypeError('Radar events must be an array.');
  if (!Number.isFinite(time) || !PRODUCTS.includes(product) || !(maxAgeMs >= 0)) return null;
  let active = null;
  for (const event of events) {
    if (event.product !== product || !Number.isFinite(event.t)) continue;
    if (event.t <= time && time - event.t <= maxAgeMs && (!active || event.t > active.t)) active = event;
  }
  return active;
}
