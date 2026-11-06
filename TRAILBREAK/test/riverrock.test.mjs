// Rock in and by the water (world/World.js stone; physics/Surfaces.js RIVER_ROCK): under a river's surface worn smooth
// and filmed with algae, at its edge wet, as rubber on stone measures (Stutzenberger and Havens, 1958: wet, 0.6 to 0.7 on
// a coarse face, about 0.22 polished smooth).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.js';
import { SURFACES, WET_SURFACES, SURFACE, RIVER_ROCK } from '../src/physics/Surfaces.js';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';

test('river rock: slick under the water, wet just above it, dry away from it', () => {
  // a river whose surface is at 0 for x < 0, dry ground beyond
  const w = { water: (x) => (x < 0 ? 0 : -Infinity), surfaces: SURFACES };
  const stone = (x, top) => World.prototype.stone.call(w, x, 0, top);
  assert.equal(stone(-3, -0.2), RIVER_ROCK, 'a boulder\'s face under the water');
  assert.ok(RIVER_ROCK.mu < 0.4 && RIVER_ROCK.mu < SURFACES[SURFACE.RIVERBED].mu, `slick: ${RIVER_ROCK.mu}, the gravel bed round it ${SURFACES[SURFACE.RIVERBED].mu}`);
  assert.equal(stone(-3, 0.3), WET_SURFACES[SURFACE.ROCK], 'just above the water: wet');
  assert.equal(stone(1.5, 0.4), WET_SURFACES[SURFACE.ROCK], 'on the bank at the water\'s edge: wet');
  assert.equal(stone(-3, 1.2), SURFACES[SURFACE.ROCK], 'well above the water: dry');
  assert.equal(stone(20, 0.1), SURFACES[SURFACE.ROCK], 'far from the water: dry');
  const wet = WET_SURFACES[SURFACE.ROCK].mu / SURFACES[SURFACE.ROCK].mu;
  assert.ok(wet > 0.6 && wet < 0.8, `wet rock in the rain or the splash: ${(wet * 100).toFixed(0)}% of dry`);
});

// a slab of rock rising at `deg` degrees up z, stood on at its foot and driven up in low range
function climb(surface, deg = 22, secs = 12) {
  const t = Math.tan(deg * Math.PI / 180);
  const g = { height: (x, z) => Math.max(0, z) * t, surfaceAt: () => surface };
  const v = new Vehicle(truckSpec('wrangler'));
  v.place(g, 0, -4, 0); v.dt.setFourWD(true, 0); v.dt.setRange(true, 0);
  for (let s = 0; s < secs; s += PHYS_DT) v.step({ throttle: 0.7, brake: 0, steer: 0, handbrake: 0 }, g);
  return v.pos.z;
}

test('river rock: a 4x4 walks up a 22 degree slab of dry rock, but spins on the same slab slimed under a river', () => {
  const dry = climb(SURFACES[SURFACE.ROCK]), slick = climb(RIVER_ROCK);
  assert.ok(dry > 12, `up the dry slab: ${dry.toFixed(1)} m`);
  assert.ok(slick < 2, `on the slimy one: ${slick.toFixed(1)} m (tan 22 degrees is 0.40, more than its grip)`);
});
