// The Yangwang U8's float mode (spec.float, Vehicle.paddles): in deep water it floats, its wheels paddle it along and
// turn it on the spot, and it climbs out again where its wheels reach the bottom. Other trucks don't float.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';
import { flat, flooded } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };
function run(v, ground, seconds, ctrl = IDLE) {
  for (let i = 0, n = Math.round(seconds / PHYS_DT); i < n; i++) {
    v.step(typeof ctrl === 'function' ? ctrl(v) : ctrl, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
  }
}
const heading = (v) => Math.atan2(v.fwd.x, v.fwd.z);

test('the U8 floats in 2 m of water, paddles at about 3 km/h and turns on the spot; a Hummer EV stands on the bottom', () => {
  const g = flooded(flat(SURFACE.RIVERBED), 2.0);
  const v = new Vehicle(truckSpec('u8'));
  v.place(g, 0, 0, 0);
  run(v, g, 4);
  assert.ok(v.afloat, 'not afloat');
  assert.ok(v.wheels.every((w) => !w.contact) && v.up.y > 0.99, `wheels on the bottom or heeled over (up ${v.up.y.toFixed(3)})`);
  run(v, g, 30, { ...IDLE, throttle: 1 });
  const kmh = v.vel.dot(v.fwd) * 3.6;
  assert.ok(kmh > 2 && kmh < 4, `paddling at ${kmh.toFixed(2)} km/h`);
  run(v, g, 8);
  const h0 = heading(v);
  run(v, g, 15, { ...IDLE, steer: 1 });
  const turned = Math.abs(heading(v) - h0) * 180 / Math.PI;
  assert.ok(turned > 40, `turned only ${turned.toFixed(0)} degrees in 15 s`);
  const ev = new Vehicle(truckSpec('hummerev'));
  ev.place(g, 0, 0, 0);
  run(ev, g, 4);
  assert.ok(!ev.afloat && ev.wheels.some((w) => w.contact && w.N > 1000), 'the Hummer EV floated');
});

test('the U8 drives down a beach into a lake, floats, turns back and climbs out', () => {
  // (a beach falling 1 in 6 to 3 m under the water)
  const g = { height: (x, z) => Math.max(-3, -Math.max(0, z) / 6), surfaceAt: () => SURFACES[SURFACE.RIVERBED], water: () => 0 };
  const v = new Vehicle(truckSpec('u8'));
  v.place(g, 0, -10, 0);
  run(v, g, 40, (v) => ({ ...IDLE, throttle: v.vel.length() < 3 ? 1 : 0 }));
  assert.ok(v.afloat && v.pos.z > 20, `not out on the lake (z ${v.pos.z.toFixed(1)}, afloat ${v.afloat})`);
  const h0 = heading(v);
  let t = 0;
  while (t < 60) {
    let d = Math.abs(heading(v) - h0); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > Math.PI * 0.97) break;
    run(v, g, 0.5, { ...IDLE, steer: 1 }); t += 0.5;
  }
  assert.ok(t < 60, 'could not turn round');
  // back to the shore, steering for it, until out on dry land
  t = 0;
  while (t < 120 && v.pos.z > -5) {
    run(v, g, 0.5, (v) => ({ ...IDLE, throttle: 1, steer: Math.max(-1, Math.min(1, Math.sin(heading(v) - Math.PI) * 3)) })); t += 0.5;
  }
  assert.ok(v.pos.z <= -5 && !v.afloat, `still in the water after ${t} s (z ${v.pos.z.toFixed(1)})`);
});
