// Recovery boards (traction boards): a pair of stiff, cleated plastic boards a driver carries for getting out of mud and
// sand. Stuck, you dig in front of the wheels and wedge a board's end under each tyre's tread, then drive out slowly:
// the tread climbs the cleats instead of spinning a deeper hole, and the board spreads the load over ground that won't
// carry a tyre (a tyre's footprint is a tenth of a square metre; a board is nearly four). Once out, you go back for them.
//
// Here the pair goes under the wheels that are in deepest (the front pair's or the rear's), in front of them going
// ahead (behind them in reverse), each from under its tyre's tread to lie on the ground ahead, tilted up out of the
// rut over the highest of the ground under it, no steeper than a tyre will climb: the mud above that dug away first,
// as a driver digs a ramp for each with the shovel. To the tyres a board is firm, gripping ground a few centimetres
// proud of the mud, and under it the dug-out ground is the board's: its top (boardTop), world/World.js's height and
// surfaceAt.
//
// A board: { x0, z0 (the end under the tread), dx, dz (along it, out of the rut), y0, y1 (its ends' heights), x, z,
// yaw (its middle and heading, to draw it) }. Pure logic: runs in Node for the tests.

/** A board's size (m): about the common 1.15 m by 0.33 m; its top stands t above the ground it lies on. */
export const BOARD = { len: 1.15, w: 0.33, t: 0.035 };
// (the steepest it lies: the ramp dug for it no steeper than a tyre in mud will climb onto, about 17 degrees)
const MAX_TILT = 0.3;

/** The top of a board at (x, z), or -Infinity off it. */
export function boardTop(b, x, z) {
  const ex = x - b.x0, ez = z - b.z0, s = ex * b.dx + ez * b.dz;
  if (s < 0 || s > BOARD.len || Math.abs(ez * b.dx - ex * b.dz) > BOARD.w / 2) return -Infinity;
  return b.y0 + (b.y1 - b.y0) * s / BOARD.len + BOARD.t;
}

/** The highest board top at (x, z) among a list, or -Infinity. */
export function boardsTop(list, x, z) {
  let top = -Infinity;
  for (let i = 0; i < list.length; i++) { const t = boardTop(list[i], x, z); if (t > top) top = t; }
  return top;
}

/**
 * Dig out under a truck before the boards go in: a truck sunk past its clearance is beached on its belly and axles, its
 * weight on the mud between the wheels and none to the tyres, and no board under a tyre will move it. The mud under its
 * belly and axles, between the tyres' tracks and out past both ends (where the ground will give, ground.deform), is
 * dug down to as deep as its deepest tyre stands; the tyres' own holes are left as they are. Returns how deep.
 */
export function digOut(v, ground) {
  if (!ground.deform) return 0;
  const deep = Math.max(...v.wheels.map((w) => w.sink || 0));
  if (deep < 0.05) return 0;
  const fx = v.fwd.x, fz = v.fwd.z, fl = Math.hypot(fx, fz) || 1, a = v.axles, f = a[0], r = a[a.length - 1];
  const mid = (f.zc + r.zc) / 2, wb = Math.abs(f.zc - r.zc), inside = Math.min(...a.map((q) => q.half)) - (v.spec.tyre.width || 0.3) / 2 - 0.06;
  ground.deform(v.pos.x + fx / fl * mid, v.pos.z + fz / fl * mid, fx / fl, fz / fl, Math.max(0.3, inside), wb / 2 + 0.7, deep, 0);
  return deep;
}

/** Which pair of wheels is in deepest: 'front' or 'rear' (by how far each pair has sunk, and spins). */
export function stuckPair(v) {
  const deep = (a, b) => (v.wheels[a].sink || 0) + (v.wheels[b].sink || 0) + 0.02 * (Math.min(5, v.wheels[a].slipSpeed || 0) + Math.min(5, v.wheels[b].slipSpeed || 0));
  return deep(2, 3) > deep(0, 1) ? 'rear' : 'front';
}

/**
 * Lay the pair under a truck's tyres: under the pair of wheels (front or rear) that is in deepest, ahead of them or
 * (back) behind. Each starts under its tyre's tread, at the height the tyre stands, and rests on the highest of the
 * ground under it out to its far end, as far as it may tilt.
 */
export function layBoards(v, ground, back = false, pair = stuckPair(v)) {
  const out = [];
  for (const w of pair === 'rear' ? v.wheels.slice(2) : v.wheels.slice(0, 2)) {
    // (along the wheel's heading on the level, out of the rut the way the truck will go)
    let dx = w.headX, dz = w.headZ;
    const l = Math.hypot(dx, dz) || 1;
    dx = (back ? -dx : dx) / l; dz = (back ? -dz : dz) / l;
    // (the end under the tread: where the tyre stands, or under its bottom if it is off the ground)
    const r = v.spec.tyre.radius, cx = w.contact ? w.cx : w.hub.x, cz = w.contact ? w.cz : w.hub.z;
    const y0 = (w.contact ? w.cy : w.hub.y - r) - 0.01;
    const x0 = cx - dx * 0.05, z0 = cz - dz * 0.05;
    let rise = -Infinity;
    for (let s = 0.25; s <= BOARD.len + 1e-6; s += 0.15) rise = Math.max(rise, (ground.height(x0 + dx * s, z0 + dz * s) - y0) / s);
    const y1 = y0 + Math.min(MAX_TILT, Math.max(-MAX_TILT, rise)) * BOARD.len;
    out.push({ x0, z0, dx, dz, y0, y1, x: x0 + dx * BOARD.len / 2, z: z0 + dz * BOARD.len / 2, yaw: Math.atan2(dx, dz) });
  }
  return out;
}
