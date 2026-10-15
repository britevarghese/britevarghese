// The ground against the real thing: how steep a stock truck climbs on each surface (low range, 4WD, open diffs, all-
// terrain tyres at 30 psi), how far it takes to stop from 50 km/h, and how hard the ground drags. The ranges are what
// 4x4s do on those surfaces (grip: packed dirt 0.65-0.8, gravel 0.55-0.65, dry grass 0.45-0.6, rock 0.8-1.1, mud
// 0.15-0.45, loose sand 0.4-0.6, snow 0.2-0.35, ice 0.05-0.12; rolling resistance: road 0.015, grass 0.05-0.08, soft
// sand and mud 0.15-0.3).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';
import { SURFACES, SURFACE } from '../src/physics/Surfaces.js';
import { slope, softSlope, flat, soft } from './grounds.mjs';

const ground = (id, deg) => (SURFACES[id].sink ? softSlope(deg, id) : slope(deg, id));

function climbs(id, deg, psi = 30) {
  const g = ground(id, deg);
  const v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0);
  v.setPressure(psi);
  v.dt.setRange(true, 0);
  for (let n = 0; n < 14 * 480; n++) { v.step({ throttle: 1, brake: 0, steer: 0, handbrake: 0 }, g); if (v.pos.z > 12) return true; }
  return false;
}

function stop(id) {
  const g = SURFACES[id].sink ? soft(id) : flat(id);
  const v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0);
  v.vel.set(0, 0, 50 / 3.6);
  for (const w of v.wheels) w.omega = 50 / 3.6 / v.spec.tyre.radius;
  const z0 = v.pos.z;
  for (let n = 0; n < 30 * 480; n++) { v.step({ throttle: 0, brake: 1, steer: 0, handbrake: 0 }, g); if (v.vel.dot(v.fwd) < 0.15) break; }
  return v.pos.z - z0;
}

function drag(id) {
  const g = SURFACES[id].sink ? soft(id) : flat(id);
  const v = new Vehicle(truckSpec('ranger'));
  v.place(g, 0, 0, 0);
  v.vel.set(0, 0, 20 / 3.6);
  for (const w of v.wheels) w.omega = 20 / 3.6 / v.spec.tyre.radius;
  v.dt.auto = false; v.dt.gear = 0;
  for (let n = 0; n < 240; n++) v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g);
  const s0 = v.vel.length();
  for (let n = 0; n < 480; n++) v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g);
  return (s0 - v.vel.length()) / 9.81;
}

// [surface, climbs this, but not this] (degrees)
const CLIMB = [
  [SURFACE.ROCK, 34, 45], [SURFACE.DIRT, 29, 37], [SURFACE.GRAVEL, 26, 35], [SURFACE.GRASS, 23, 32],
  [SURFACE.SAND, 11, 18], [SURFACE.MUD, 8, 16], [SURFACE.SNOW, 7, 14], [SURFACE.ICE, 2, 7],
];

test('steepest climbs: rock, then dirt, gravel, grass; sand, mud and snow far less; ice hardly at all', () => {
  for (const [id, can, cannot] of CLIMB) {
    const name = SURFACES[id].name;
    assert.ok(climbs(id, can), `${name}: should climb ${can} degrees`);
    assert.ok(!climbs(id, cannot), `${name}: should not climb ${cannot} degrees`);
  }
});

test('airing down to 15 psi gets up steeper sand and mud', () => {
  assert.ok(!climbs(SURFACE.SAND, 18, 30) && climbs(SURFACE.SAND, 18, 15), 'sand at 18 degrees');
  assert.ok(!climbs(SURFACE.MUD, 14, 30) && climbs(SURFACE.MUD, 14, 15), 'mud at 14 degrees');
});

test('stopping from 50 km/h: about 11-14 m on the road, longer on grass, a hundred on ice', () => {
  const road = stop(SURFACE.ROAD), dirt = stop(SURFACE.DIRT), grass = stop(SURFACE.GRASS), ice = stop(SURFACE.ICE);
  assert.ok(road > 10 && road < 14.5, `road ${road.toFixed(1)} m`);
  assert.ok(dirt > road && dirt < 17, `dirt ${dirt.toFixed(1)} m`);
  assert.ok(grass > dirt && grass < 23, `grass ${grass.toFixed(1)} m`);
  assert.ok(ice > 80, `ice ${ice.toFixed(1)} m`);
});

test('rolling drag: the road barely, grass and gravel some, soft sand and mud a lot', () => {
  const road = drag(SURFACE.ROAD), grass = drag(SURFACE.GRASS), sand = drag(SURFACE.SAND), mud = drag(SURFACE.MUD);
  assert.ok(road < 0.02, `road ${road.toFixed(3)} g`);
  assert.ok(grass > 0.035 && grass < 0.09, `grass ${grass.toFixed(3)} g`);
  assert.ok(sand > 0.15, `sand ${sand.toFixed(3)} g`);
  assert.ok(mud > 0.15, `mud ${mud.toFixed(3)} g`);
});

test('hills: down a 20 degree slope in low range off the throttle, the engine holds the truck back', () => {
  for (const id of ['ranger', 'hauler', 'mule']) {
    const g = slope(20, SURFACE.DIRT);
    const v = new Vehicle(truckSpec(id));
    v.place(g, 0, 0, Math.PI);                                  // facing down the hill
    v.dt.setRange(true, 0);
    for (let n = 0; n < 12 * 480; n++) v.step({ throttle: 0, brake: 0, steer: 0, handbrake: 0 }, g);
    const kmh = v.vel.length() * 3.6;
    assert.ok(kmh < 18, `${id}: ${kmh.toFixed(1)} km/h after 12 s`);
    assert.equal(v.dt.gear, v.dt.firstGear, `${id} drops to first`);
  }
});
