// NIGHTSHIFT audio - small shared helpers (no DOM / three.js deps).

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Smoothly move an AudioParam toward a value (safe to call every frame). */
export function glide(param, value, t, tc = 0.04) {
  if (!param || !Number.isFinite(value)) return;
  param.setTargetAtTime(value, t, tc);
}

/** Immediately-ish set a param, cancelling prior automation. */
export function hardSet(param, value, t) {
  if (!param || !Number.isFinite(value)) return;
  param.cancelScheduledValues(t);
  param.setValueAtTime(value, t);
}

/** Attack / exponential decay envelope on a gain param. */
export function envAD(param, t, attack, peak, decay, floor = 0.0001) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(Math.max(peak, floor * 2), t + Math.max(0.001, attack));
  param.exponentialRampToValueAtTime(floor, t + Math.max(0.001, attack) + Math.max(0.005, decay));
}

export function vec(p) {
  return p && typeof p === 'object'
    ? { x: num(p.x), y: num(p.y), z: num(p.z) }
    : { x: 0, y: 0, z: 0 };
}

export function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

export function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Cheap spatialisation against a listener {position, forward, right, velocity}.
 * Returns {dist, dir, pan (-1..1), gain (distance law), air (lowpass Hz), behind 0..1}
 */
export function spatial(listener, position, ref = 8, rolloff = 1, maxDist = 300) {
  const p = vec(position);
  const d = { x: p.x - listener.position.x, y: p.y - listener.position.y, z: p.z - listener.position.z };
  const dist = Math.hypot(d.x, d.y, d.z);
  const dir = dist > 1e-4 ? { x: d.x / dist, y: d.y / dist, z: d.z / dist } : { x: 0, y: 0, z: -1 };
  let pan = dot(dir, listener.right);
  // keep some centre energy when very close so sounds don't hard-pan in your lap
  pan *= clamp(dist / 4, 0, 1);
  const behind = clamp(-dot(dir, listener.forward), 0, 1);
  let gain = ref / (ref + rolloff * Math.max(0, dist - ref));
  // fade to silence at max distance
  if (dist > maxDist * 0.7) gain *= clamp(1 - (dist - maxDist * 0.7) / (maxDist * 0.3), 0, 1);
  const air = clamp(18000 * Math.exp(-dist / 120) * (1 - behind * 0.35), 700, 18000);
  return { dist, dir, pan: clamp(pan, -1, 1), gain, air, behind };
}

export function createPanner(ctx) {
  if (typeof ctx.createStereoPanner === 'function') return ctx.createStereoPanner();
  // Fallback: a plain gain node with a fake `pan` param sink.
  const g = ctx.createGain();
  g.pan = { setTargetAtTime() {}, setValueAtTime() {}, cancelScheduledValues() {}, value: 0 };
  return g;
}

export function safeStop(src, t) {
  try { src.stop(t); } catch (_) { /* already stopped */ }
}

export function safeDisconnect(node) {
  try { node.disconnect(); } catch (_) { /* ignore */ }
}
