// Wet brakes (physics/Vehicle.js brakeWet): through water deep enough to reach them, a truck's brakes grip weakly until
// the heat of braking dries them, as the US standard's water-recovery test has it (FMVSS 105, S5.1.5: 2 minutes at
// 5 mph through a 6 in trough, then five stops from 30 mph; the fifth back near dry).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';

function recovery(id, depth) {
  let level = -Infinity;
  const g = { height: () => 0, surfaceAt: () => SURFACES[SURFACE.ROAD], water: () => level };
  const v = new Vehicle(truckSpec(id));
  v.place(g, 0, 0, 0);
  const upTo = (sp) => { for (let t = 0; t < 30 && v.vel.dot(v.fwd) < sp; t += PHYS_DT) v.step({ throttle: 0.8, brake: 0, steer: 0, handbrake: 0 }, g); };
  // (a stop from 30 mph on the same pedal, about 10 ft/s2 dry)
  const stop = () => { const z0 = v.pos.z; for (let t = 0; t < 20 && v.vel.dot(v.fwd) > 0.3; t += PHYS_DT) v.step({ throttle: 0, brake: 0.3, steer: 0, handbrake: 0 }, g); return v.pos.z - z0; };
  upTo(13.4);
  const dry = stop();
  level = depth;
  for (let t = 0; t < 20; t += PHYS_DT) {
    const sp = v.vel.dot(v.fwd);
    v.step({ throttle: Math.max(0, Math.min(1, (2.2 - sp) * 0.5 + 0.2)), brake: sp > 2.6 ? 0.2 : 0, steer: 0, handbrake: 0 }, g);
  }
  level = -Infinity;
  const stops = [];
  for (let k = 0; k < 5; k++) { upTo(13.4); stops.push(stop()); }
  return { dry, stops };
}

test('wet brakes: out of a 6 in ford a truck stops far longer, and four stops dry the brakes', () => {
  const { dry, stops } = recovery('ranger', 0.152);
  assert.ok(stops[0] > dry * 1.35, `first stop wet: ${stops[0].toFixed(1)} m against ${dry.toFixed(1)} m dry`);
  for (let k = 1; k < 5; k++) assert.ok(stops[k] < stops[k - 1] + 0.05, `each stop dries them more: ${stops.map((d) => d.toFixed(1)).join(', ')} m`);
  assert.ok(stops[4] < dry * 1.06, `the fifth back near dry: ${stops[4].toFixed(1)} m`);
});

test('wet brakes: water that doesn\'t reach them leaves them dry', () => {
  const { dry, stops } = recovery('ranger', 0.08);
  assert.ok(Math.abs(stops[0] - dry) < 0.2, `through 8 cm of water: ${stops[0].toFixed(1)} m, dry ${dry.toFixed(1)} m`);
});
