// The spare wheel buried as a winch anchor (game/Anchor.js; physics/Vehicle.js winchStep): how hard each soil holds it,
// against field pull tests, where it gets buried, and that it gets a bogged truck out when dug into firm ground and
// ploughs out of the bog itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorHold, pickAnchor } from '../src/game/Anchor.js';
import { SURFACE, SURFACES } from '../src/physics/Surfaces.js';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { V3 } from '../src/physics/math.js';
import { bogPatch } from './grounds.mjs';

const LB = 4.448;   // N per pound-force
const spare = { d: 0.81, w: 0.27 };   // a 32 in tyre

test('anchor: a buried spare holds as the field tests found: firm earth best, loose dry sand less, soft mud least', () => {
  const sand = anchorHold(SURFACE.SAND, spare), earth = anchorHold(SURFACE.DIRT, spare);
  // a stock spare 30 in down in sand: about half a purpose-made deadman's 4,700 lb or so
  assert.ok(sand / LB > 2000 && sand / LB < 2800, `in dry sand: ${(sand / LB).toFixed(0)} lb`);
  // in firm dry earth: 3,000 to 5,000 lb
  assert.ok(earth / LB > 3000 && earth / LB < 5000, `in firm earth: ${(earth / LB).toFixed(0)} lb`);
  assert.ok(anchorHold(SURFACE.SAND, { ...spare, wet: 1 }) > sand, 'damp sand holds better than dry');
  const mud = anchorHold(SURFACE.MUD, spare), bog = anchorHold(SURFACE.MUD, { ...spare, softness: 3.4, wet: 1 });
  assert.ok(mud < earth && bog < mud * 0.6, `mud ${(mud / 1000).toFixed(1)} kN, a wet bog ${(bog / 1000).toFixed(1)} kN`);
  assert.ok(anchorHold(SURFACE.DIRT, { d: 0.9, w: 0.32 }) > earth, 'a bigger spare holds more');
  for (const id of [SURFACE.ROCK, SURFACE.ROAD, SURFACE.ICE, SURFACE.RIVERBED]) assert.equal(anchorHold(id, spare), null, `nothing to dig in ${SURFACES[id].name}`);
});

test('anchor: buried on the firmest ground ahead in reach, never under water, rock or tarmac', () => {
  // the bog for 14 m ahead, firm earth past it, a pond from 24 m
  const g = {
    height: () => 0, terrain: () => 0,
    surfaceId: (x, z) => (z < 14 ? SURFACE.MUD : SURFACE.DIRT),
    softness: (x, z) => (z < 14 ? 3 : 1),
    water: (x, z) => (z > 24 ? 0.4 : -Infinity),
  };
  const a = pickAnchor(g, 0, 0, 0, 1, 30, { radius: 0.4, width: 0.27 });
  assert.equal(a.surface, SURFACE.DIRT);
  assert.ok(a.z >= 14 && a.z <= 24, `buried ${a.z.toFixed(1)} m ahead`);
  const rock = { height: () => 0, surfaceId: () => SURFACE.ROCK };
  assert.equal(pickAnchor(rock, 0, 0, 0, 1, 30), null, 'nowhere to dig on bare rock');
});

// a stock Ranger sunk to its belly in a bog (as the boards test has it), winched toward an anchor 18 m ahead
function winchOut(hold) {
  const g = bogPatch(4, 1.2, 3), v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  for (let t = 0; t < 12; t += PHYS_DT) v.step({ throttle: 0, brake: 0, hold: 1, steer: 0, handbrake: 0 }, g);
  for (let t = 0; t < 6; t += PHYS_DT) v.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, g);
  const z0 = v.pos.z;
  assert.ok(v.attachWinch('ground', new V3(0, 0, 18), null, null, hold));
  let peak = 0, out = false;
  for (let t = 0; t < 40 && v.winch.attached && v.pos.z < 8; t += PHYS_DT) {
    v.winch.motor = 1;
    v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g);
    peak = Math.max(peak, v.winch.tension);
    out ||= v.winch.pulledOut;
  }
  return { moved: v.pos.z - z0, peak, out, anchorZ: v.winch.anchor.z };
}

test('anchor: dug into firm ground it winches a bogged truck out; dug into the bog it ploughs out', () => {
  const firm = winchOut(anchorHold(SURFACE.DIRT, { d: 0.8, w: 0.27 }));
  assert.ok(firm.moved > 6 && !firm.out, `firm earth: winched ${firm.moved.toFixed(1)} m (the line at up to ${(firm.peak / 1000).toFixed(1)} kN)`);
  const soft = winchOut(anchorHold(SURFACE.MUD, { d: 0.8, w: 0.27, softness: 4 }));
  assert.ok(soft.out && soft.moved < 1, `in the bog: it ploughed out (truck moved ${soft.moved.toFixed(2)} m)`);
  assert.ok(soft.anchorZ < 18, 'it ploughed toward the truck before it came out');
});
