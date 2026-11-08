// Changing gear flat out (physics/Drivetrain.js): a manual box's clutch goes out, the revs come down to the next gear's
// (as a driver lifts off), and it bites again with the throttle fed back in. Held flat through the gap, the engine
// used to race up to the limiter and bounce off it for half a second at every upshift.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { flat } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

/** Floored from rest on flat dirt for `seconds`: each upshift's revs through it, and the limiter's cuts in the gaps. */
function pull(id, seconds = 14) {
  const g = flat(), v = new Vehicle(truckSpec(id, ''));
  v.place(g, 0, 0, 0);
  for (let i = 0; i < 0.5 / PHYS_DT; i++) v.step({ ...IDLE, brake: 1 }, g);
  const d = v.dt, red = d.e.redline, shifts = [];
  let gear = d.gear, cut = 0, cur = null;
  for (let i = 0; i < seconds / PHYS_DT; i++) {
    v.step({ ...IDLE, throttle: 1 }, g);
    // (a change up on the move: not the gear a truck pulls away in, put in as it sets off)
    if (d.gear > gear && gear > 0 && d.shiftT > 0 && v.speed > 2) { cur = { from: gear, before: d.rpm, peak: d.rpm, after: null, t: 0 }; shifts.push(cur); }
    gear = d.gear;
    if (cur) {
      cur.t += PHYS_DT;
      if (cur.t > 0.05) cur.peak = Math.max(cur.peak, d.rpm);
      if (d.shiftT > 0 && d.throttle === 0 && d.rpm > red) cut++;
      if (cur.t >= 0.6 && cur.after === null) { cur.after = d.rpm; cur = null; }
    }
  }
  return { shifts, cut, red, kmh: v.speed * 3.6 };
}

for (const id of ['thar', 'ranger', 'hauler']) {
  test(`${id}: changing up flat out, the revs come down to the next gear's, not up to the limiter`, () => {
    const r = pull(id);
    assert.ok(r.shifts.length >= 2, `${r.shifts.length} upshifts in 14 s (${r.kmh.toFixed(0)} km/h)`);
    assert.equal(r.cut, 0, 'the limiter cut in while changing gear');
    for (const s of r.shifts) {
      // (after the shift: never back over the revs it changed at, and well down on them once it has bitten)
      assert.ok(s.peak <= Math.max(s.before, r.red) + 60, `${s.from}->${s.from + 1}: up to ${s.peak.toFixed(0)} rpm from ${s.before.toFixed(0)}`);
      assert.ok(s.after < s.before * 0.9, `${s.from}->${s.from + 1}: ${s.after.toFixed(0)} rpm 0.6 s on, from ${s.before.toFixed(0)}`);
    }
  });
}

test('from reverse to forward, the throttle already down: the revs wait at those it pulls away at, not at the limiter', () => {
  const g = flat(), v = new Vehicle(truckSpec('thar', ''));
  v.place(g, 0, 0, 0);
  for (let i = 0; i < 0.5 / PHYS_DT; i++) v.step({ ...IDLE, brake: 1 }, g);            // (held on the brake: reverse)
  assert.equal(v.dt.gear, -1);
  let peak = 0;
  for (let i = 0; i < 0.6 / PHYS_DT; i++) { v.step({ ...IDLE, throttle: 1 }, g); peak = Math.max(peak, v.dt.rpm); }
  assert.ok(v.dt.gear > 0, 'in a forward gear');
  assert.ok(peak < v.dt.e.redline - 300, `up to ${peak.toFixed(0)} rpm (redline ${v.dt.e.redline})`);
});
