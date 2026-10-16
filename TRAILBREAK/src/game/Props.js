// The map builder's props (ui/Builder.js): ramps, kickers, containers, logs, rocks, barrels, tyre stacks, barriers,
// fences and mud pits to put down on a map, and the start line and checkpoints that make a race of them. Each is a
// shape the trucks drive on: its top, as a height over the ground under its footprint (World.propTop), the way the
// boulders are, so the tyres and the hull climb, jump and crash on them with the same physics as everything else.
//
// A layout: { v: 1, map, name, props: [{ type, x, z, yaw }] }. It travels as a share code (a link, or the room's
// copy for friends): short arrays in base64url.
//
// Pure logic: runs in Node for the tests.
import { SURFACE } from '../physics/Surfaces.js';

/**
 * shape: what its top is over its footprint (u across, v along its length, in its own frame):
 *   box     flat, h high, |u| < hx, |v| < hz            wedge   rising from 0 at v = -hz to h at +hz (a ramp)
 *   kicker  a curved ramp, steepening to its lip        log     a cylinder lying across (along u), radius r
 *   ridge   peaked along its middle (a pile of logs)
 *   dome    a rounded rock rx by rz, ry high            disc    an upright cylinder r across, h high
 *   paint   no height: the ground under it (mud)        marker  nothing to drive on: the start, a checkpoint
 * surface: what it is to the tyres (physics/Surfaces.js).
 */
export const PROP_TYPES = {
  ramp: { name: 'Ramp', group: 'Jumps', shape: 'wedge', hx: 1.6, hz: 3.2, h: 1.2, surface: SURFACE.ROAD, color: '#9a7a52' },
  bigramp: { name: 'Big ramp', group: 'Jumps', shape: 'wedge', hx: 2.4, hz: 6, h: 2.6, surface: SURFACE.ROAD, color: '#9a7a52' },
  kicker: { name: 'Kicker', group: 'Jumps', shape: 'kicker', hx: 1.5, hz: 2.2, h: 1.1, surface: SURFACE.ROAD, color: '#a3845a' },
  dirtmound: { name: 'Dirt mound', group: 'Jumps', shape: 'dome', rx: 4, rz: 4, ry: 1.4, surface: SURFACE.DIRT, color: '#7a5b3a' },
  container: { name: 'Container', group: 'Obstacles', shape: 'box', hx: 1.22, hz: 6.06, h: 2.59, surface: SURFACE.ROAD, color: '#b5452d' },
  crate: { name: 'Crate', group: 'Obstacles', shape: 'box', hx: 0.6, hz: 0.6, h: 1.2, surface: SURFACE.ROAD, color: '#a88a5c' },
  log: { name: 'Log', group: 'Obstacles', shape: 'log', hx: 3, r: 0.32, surface: SURFACE.DIRT, color: '#6b4a32' },
  logpile: { name: 'Log pile', group: 'Obstacles', shape: 'ridge', hx: 2.4, hz: 0.84, h: 1.45, surface: SURFACE.DIRT, color: '#6b4a32' },
  rock: { name: 'Rock', group: 'Obstacles', shape: 'dome', rx: 1.5, rz: 1.2, ry: 1.1, surface: SURFACE.ROCK, color: '#7d7a72' },
  bigrock: { name: 'Boulder', group: 'Obstacles', shape: 'dome', rx: 2.6, rz: 2.2, ry: 2, surface: SURFACE.ROCK, color: '#76736b' },
  barrel: { name: 'Barrel', group: 'Track', shape: 'disc', r: 0.3, h: 0.9, surface: SURFACE.ROAD, color: '#2f6fa8' },
  tyres: { name: 'Tyre stack', group: 'Track', shape: 'disc', r: 0.5, h: 0.75, surface: SURFACE.ROCK, color: '#222' },
  barrier: { name: 'Barrier', group: 'Track', shape: 'box', hx: 1.5, hz: 0.3, h: 0.8, surface: SURFACE.ROAD, color: '#c9c4b8' },
  fence: { name: 'Fence', group: 'Track', shape: 'box', hx: 2, hz: 0.08, h: 1.1, surface: SURFACE.DIRT, color: '#8a6a45' },
  mud: { name: 'Mud pit', group: 'Track', shape: 'paint', r: 6, surface: SURFACE.MUD, color: '#3b2a1c' },
  start: { name: 'Start line', group: 'Race', shape: 'marker', hx: 5, color: '#f3ead7' },
  checkpoint: { name: 'Checkpoint', group: 'Race', shape: 'marker', hx: 5, color: '#e8642a' },
};
export const PROP_IDS = Object.keys(PROP_TYPES);
export const MAX_PROPS = 300;

/** How far its footprint reaches from its middle (m), for the grid and for picking. */
export function reach(type) {
  const T = PROP_TYPES[type];
  if (!T) return 0;
  if (T.shape === 'dome') return Math.max(T.rx, T.rz);
  if (T.shape === 'disc' || T.shape === 'paint') return T.r;
  if (T.shape === 'log') return Math.hypot(T.hx, T.r);
  return Math.hypot(T.hx || 1, T.hz || 1);
}

/** Its point in its own frame: (u across, v along). */
export function toLocal(p, x, z) {
  const dx = x - p.x, dz = z - p.z, c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
}

/**
 * Settle a prop on the ground: y0, the height its shape stands on (a ramp at its foot, so it starts level with the
 * ground; the rest on the mean of the ground under it).
 */
export function settle(p, terrain) {
  const T = PROP_TYPES[p.type], c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const at = (u, v) => terrain(p.x + u * c + v * s, p.z - u * s + v * c);
  if (T.shape === 'wedge' || T.shape === 'kicker') p.y0 = Math.min(at(-T.hx, -T.hz), at(T.hx, -T.hz), at(0, -T.hz));
  else if (T.shape === 'log') p.y0 = Math.min(at(-T.hx, 0), at(T.hx, 0), at(0, 0));
  else if (T.shape === 'dome') p.y0 = at(0, 0) - T.ry * 0.12;
  else if (T.shape === 'disc' || T.shape === 'box' || T.shape === 'ridge') {
    const hx = T.hx ?? T.r, hz = T.hz ?? T.r;
    p.y0 = (at(-hx, -hz) + at(hx, -hz) + at(-hx, hz) + at(hx, hz) + at(0, 0)) / 5;
  } else p.y0 = at(0, 0);
  return p;
}

/** The top of a prop at (x, z), or -Infinity off it (or if it has no height). */
export function propTop(p, x, z) {
  const T = PROP_TYPES[p.type];
  if (!T) return -Infinity;
  const [u, v] = toLocal(p, x, z), y0 = p.y0 ?? 0;
  switch (T.shape) {
    case 'box': return Math.abs(u) < T.hx && Math.abs(v) < T.hz ? y0 + T.h : -Infinity;
    case 'wedge': return Math.abs(u) < T.hx && Math.abs(v) < T.hz ? y0 + T.h * (v + T.hz) / (2 * T.hz) : -Infinity;
    case 'kicker': return Math.abs(u) < T.hx && Math.abs(v) < T.hz ? y0 + T.h * Math.pow((v + T.hz) / (2 * T.hz), 1.7) : -Infinity;
    case 'ridge': return Math.abs(u) < T.hx && Math.abs(v) < T.hz ? y0 + T.h * (1 - Math.abs(v) / T.hz) : -Infinity;
    case 'log': return Math.abs(u) < T.hx && Math.abs(v) < T.r ? y0 + T.r + Math.sqrt(T.r * T.r - v * v) : -Infinity;
    case 'dome': { const q = (u / T.rx) ** 2 + (v / T.rz) ** 2; return q < 1 ? y0 + T.ry * Math.sqrt(1 - q) : -Infinity; }
    case 'disc': return u * u + v * v < T.r * T.r ? y0 + T.h : -Infinity;
    default: return -Infinity;
  }
}

/** Is (x, z) inside a mud pit (or another painted ground)? */
export function paintAt(p, x, z) {
  const T = PROP_TYPES[p.type];
  return T?.shape === 'paint' && (x - p.x) ** 2 + (z - p.z) ** 2 < T.r * T.r;
}

// ---------------------------------------------------------------- sharing
const b64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s))));
const unb64 = (s) => (typeof Buffer !== 'undefined' ? Buffer.from(s, 'base64').toString('utf8') : decodeURIComponent(escape(atob(s))));

/** A layout as a share code: base64url of [v, map, name, [[type index, x dm, z dm, yaw centi-rad], ...]]. */
export function encodeLayout(L) {
  const props = (L.props || []).slice(0, MAX_PROPS).map((p) => [PROP_IDS.indexOf(p.type), Math.round(p.x * 10), Math.round(p.z * 10), Math.round(((p.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) * 100)]);
  return b64(JSON.stringify([1, L.map || '', String(L.name || '').slice(0, 40), props])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A share code back to a layout, checked (unknown props and junk dropped); null if it isn't one. */
export function decodeLayout(code) {
  try {
    const s = String(code).replace(/-/g, '+').replace(/_/g, '/');
    const a = JSON.parse(unb64(s + '='.repeat((4 - (s.length % 4)) % 4)));
    if (!Array.isArray(a) || a[0] !== 1 || !Array.isArray(a[3])) return null;
    const num = (n) => typeof n === 'number' && Number.isFinite(n);
    const props = a[3].slice(0, MAX_PROPS).filter((q) => Array.isArray(q) && q.length === 4 && q.every(num) && PROP_IDS[q[0]] && Math.abs(q[1]) < 12000 && Math.abs(q[2]) < 12000)
      .map((q) => ({ type: PROP_IDS[q[0]], x: q[1] / 10, z: q[2] / 10, yaw: q[3] / 100 }));
    return { v: 1, map: typeof a[1] === 'string' ? a[1].slice(0, 16) : '', name: typeof a[2] === 'string' ? a[2].slice(0, 40) : '', props };
  } catch { return null; }
}

/**
 * A layout's race, if it has a start line and at least one checkpoint: an event (game/Events.js) from the start
 * through the checkpoints in the order they were put down, the last one the finish. Par times from its length.
 */
export function customRace(L, terrain) {
  const start = L.props.find((p) => p.type === 'start'), cps = L.props.filter((p) => p.type === 'checkpoint');
  if (!start || !cps.length) return null;
  const pts = [[start.x, start.z], ...cps.map((p) => [p.x, p.z])];
  let length = 0;
  for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  const gates = cps.map((p, i) => ({ x: p.x, z: p.z, r: 7, near: 7, dir: [Math.sin(p.yaw), Math.cos(p.yaw)], lap: 1, cp: i + 1, finish: i === cps.length - 1, y: terrain(p.x, p.z) }));
  const t = (v) => Math.max(5, Math.round(length / v));
  // (lined up facing the first checkpoint)
  const yaw = Math.atan2(cps[0].x - start.x, cps[0].z - start.z);
  return { id: 'custom', kind: 'rally', race: true, custom: true, name: L.name || 'Custom race', desc: `Your own course: ${cps.length} checkpoint${cps.length > 1 ? 's' : ''}, ${Math.round(length)} m.`,
    laps: 1, cps: cps.length - 1, start: { x: start.x, z: start.z, yaw }, gates, line: pts, length, par: { gold: t(11), silver: t(8.5), bronze: t(6) }, prize: 0.5 };
}
