// The garage: what each upgrade does to a truck, checked the way a driver would notice it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vehicle, PHYS_DT } from '../src/physics/Vehicle.js';
import { TRUCKS, TRUCK_IDS, truckSpec, truckBase } from '../src/physics/trucks.js';
import { SURFACE, SURFACES } from '../src/physics/Surfaces.js';
import {
  PRESETS, CATEGORIES, presetBuild, stockBuild, encodeBuild, decodeBuild, normalizeBuild, buildStats, optionsFor, maxTyre,
} from '../src/physics/Upgrades.js';
import { flat, softSlope, slope, soft, slopeWithIce, block, flooded } from './grounds.mjs';

const IDLE = { throttle: 0, brake: 0, steer: 0, handbrake: 0 };

function run(v, ground, seconds, ctrl = IDLE) {
  const n = Math.round(seconds / PHYS_DT);
  for (let i = 0; i < n; i++) {
    v.step(typeof ctrl === 'function' ? ctrl(v) : ctrl, ground);
    if (!Number.isFinite(v.pos.x + v.pos.y + v.pos.z)) throw new Error('simulation blew up');
  }
}

function truck(id, build, ground = flat(), yaw = 0) {
  const v = new Vehicle(truckSpec(id, build));
  v.place(ground, 0, 0, yaw);
  return v;
}

/** Lowest point under the axles (diff housing) above flat ground at y = 0, at rest. */
function diffClearance(v) {
  let low = Infinity;
  for (const ax of v.axles) {
    for (const pt of ax.under) {
      const p = v.toWorld({ x: pt.x, y: ax.yDroop + (ax.zL + ax.zR) / 2 - pt.drop, z: ax.zc + pt.dz, clone() { return this; } }, v.pos.clone());
      low = Math.min(low, p.y);
    }
  }
  return low;
}

test('builds: codes round-trip, presets are valid, stock reproduces the factory truck', () => {
  for (const id of TRUCK_IDS) {
    const base = truckBase(id);
    const stock = truckSpec(id);
    assert.equal(stock.mass, base.mass);
    assert.ok(Math.abs(stock.cgHeight - base.cgHeight) < 1e-9 && Math.abs(stock.cgZ - base.cgZ) < 1e-9, 'same centre of gravity');
    for (const p of PRESETS) {
      const b = presetBuild(base, p.id);
      assert.deepEqual(decodeBuild(base, encodeBuild(b)), b, `${id} ${p.id} round trip`);
      assert.deepEqual(normalizeBuild(base, b), b, `${id} ${p.id} is a valid build`);
      assert.equal(encodeBuild(b).length, CATEGORIES.length);
    }
    // garbage in, stock out; out-of-range choices are clamped
    assert.deepEqual(decodeBuild(base, '!!'), stockBuild(base));
    const odd = normalizeBuild(base, { lift: 9, engine: -3, tyre: 37 });
    assert.equal(odd.lift, 3);
    assert.equal(odd.engine, 0);
    assert.ok(odd.tyre <= maxTyre(base, odd.lift));
    for (const cat of CATEGORIES) assert.ok(optionsFor(cat, id).length > 1, `${cat.id} has options`);
  }
});

test('a lift raises the body but not the diffs; bigger tyres raise both', () => {
  const g = flat();
  const settle = (build) => { const v = truck('ranger', build, g); run(v, g, 2, { ...IDLE, handbrake: 1 }); return v; };
  const stock = settle(undefined), lift = settle({ lift: 2 }), tyres = settle({ tyre: 33 }), both = settle({ lift: 2, tyre: 35 });
  const belly = (v) => v.pos.y + v.boxes[1].c.y - v.boxes[1].h.y;          // the belly box, level truck
  const dStock = diffClearance(stock), dLift = diffClearance(lift), dTyres = diffClearance(tyres), dBoth = diffClearance(both);
  assert.ok(Math.abs(dStock - 0.215) < 0.02, `stock: ${(dStock * 100).toFixed(1)} cm under the diffs`);
  assert.ok(Math.abs(dLift - dStock) < 0.01, `a lift doesn't raise the diffs (${(dLift * 100).toFixed(1)} cm)`);
  assert.ok(dTyres - dStock > 0.02, `33s raise the diffs by ${((dTyres - dStock) * 100).toFixed(1)} cm`);
  assert.ok(dBoth - dStock > 0.04, `35s raise the diffs by ${((dBoth - dStock) * 100).toFixed(1)} cm`);
  assert.ok(belly(lift) - belly(stock) > 0.09, `a 4" lift raises the belly by ${((belly(lift) - belly(stock)) * 100).toFixed(1)} cm`);
  assert.ok(both.pos.y - stock.pos.y > 0.08, 'and the centre of gravity');
  const s0 = buildStats(stock.spec), s1 = buildStats(both.spec);
  assert.ok(s1.approach > s0.approach + 5 && s1.breakover > s0.breakover + 5 && s1.tip < s0.tip - 2, 'better angles, easier to tip');
});

test('bigger tyres blunt the acceleration; deeper axle gears give it back', () => {
  const t50 = (build) => {
    const g = flat();
    const v = truck('ranger', build, g);
    run(v, g, 1, { ...IDLE, handbrake: 1 });
    for (let i = 0; i < 20 / PHYS_DT; i++) {
      v.step({ ...IDLE, throttle: 1 }, g);
      if (v.speed * 3.6 >= 50) return i * PHYS_DT;
    }
    return Infinity;
  };
  const stock = t50(undefined), big = t50({ lift: 2, tyre: 35 }), regeared = t50({ lift: 2, tyre: 35, gears: 2 });
  assert.ok(big > stock * 1.1, `0-50 km/h: stock ${stock.toFixed(2)} s, on 35s ${big.toFixed(2)} s`);
  assert.ok(regeared < big * 0.95, `35s with 4.56 gears ${regeared.toFixed(2)} s`);
});

test('airing down: the tyres sink less in sand, and the truck gets up a sandy slope far faster than at 30 psi', () => {
  const drive = (psi) => {
    const g = softSlope(15, SURFACE.SAND);
    const v = truck('hauler', { wheels: 2 }, g);
    v.setPressure(psi);
    v.dt.setRange(true, 0);
    let sink = 0, n = 0;
    run(v, g, 1, { ...IDLE, brake: 1 });
    const z0 = v.pos.z;
    const steps = Math.round(15 / PHYS_DT);
    for (let i = 0; i < steps; i++) {
      v.step({ ...IDLE, throttle: 1 }, g);
      if (i < steps / 3) { sink += v.wheels.reduce((s, w) => s + w.sink, 0) / 4; n++; }
    }
    return { sink: sink / n, dist: v.pos.z - z0 };
  };
  const hard = drive(30), soft8 = drive(8);
  assert.ok(soft8.sink < hard.sink * 0.8, `rut depth ${(hard.sink * 100).toFixed(1)} cm at 30 psi, ${(soft8.sink * 100).toFixed(1)} cm at 8 psi`);
  assert.ok(soft8.dist > hard.dist * 1.4, `up a 15 degree dune in 15 s: ${hard.dist.toFixed(1)} m at 30 psi, ${soft8.dist.toFixed(1)} m at 8 psi`);
});

test('pressure: steel wheels stop at 14 psi, beadlocks go to 6; no compressor, no airing back up', () => {
  const g = flat();
  const steel = truck('ranger', undefined, g), bead = truck('ranger', { wheels: 2 }, g);
  steel.psiTarget = 4; bead.psiTarget = 4;
  run(steel, g, 20, { ...IDLE, handbrake: 1 }); run(bead, g, 20, { ...IDLE, handbrake: 1 });
  assert.equal(steel.psi, 14);
  assert.equal(bead.psi, 6);
  steel.psiTarget = 30; bead.psiTarget = 30;
  run(steel, g, 5, { ...IDLE, handbrake: 1 }); run(bead, g, 5, { ...IDLE, handbrake: 1 });
  assert.equal(steel.psi, 14, 'no air without a compressor');
  assert.ok(bead.psi > 9, `the compressor pumps them up (${bead.psi.toFixed(1)} psi)`);
  steel.airSupply = true; steel.psiTarget = 30;
  run(steel, g, 5, { ...IDLE, handbrake: 1 });
  assert.equal(steel.psi, 30, 'the station air line');
  // soft tyres: the truck sits lower and steers vaguer
  assert.ok(bead.tyre.stiffness < steel.tyre.stiffness && bead.tyre.alphaPeak > steel.tyre.alphaPeak);
});

test('lockers work only when fitted; a limited-slip diff gets further with one tyre on ice', () => {
  assert.equal(truck('ranger').dt.setLocker('rear', true, 0), false, 'stock: open diffs');
  assert.equal(truck('ranger', { diffs: 2 }).dt.setLocker('rear', true, 0), true, 'selectable rear locker');
  assert.equal(truck('ranger', { diffs: 2 }).dt.setLocker('front', true, 0), false, 'no front locker in that build');
  const go = (diffs) => {
    // ice under the left rear tyre, 2WD, a gentle slope
    const spec = truckSpec('ranger', { diffs });
    const half = spec.axles[1].track / 2, zr = spec.axles[1].z - spec.cgZ;
    const g = slopeWithIce(3, [[half - 0.5, -99, half + 0.5, zr + 9]]);
    const v = truck('ranger', { diffs }, g);
    v.dt.setFourWD(false, 0);
    run(v, g, 1, { ...IDLE, brake: 1 });
    const z0 = v.pos.z;
    run(v, g, 5, { ...IDLE, throttle: 0.6 });
    return v.pos.z - z0;
  };
  const open = go(0), lsd = go(1);
  assert.ok(lsd > open + 1, `open diff ${open.toFixed(2)} m, limited slip ${lsd.toFixed(2)} m`);
});

test('manual gearbox: no creep at idle, and the engine holds the truck back downhill', () => {
  const g = flat();
  const auto = truck('ranger', undefined, g), stick = truck('mule', undefined, g);
  run(auto, g, 4); run(stick, g, 4);
  assert.ok(auto.speed > 0.3, `the automatic creeps at idle (${auto.speed.toFixed(2)} m/s)`);
  assert.ok(Math.abs(stick.speed) < 0.05, `the manual sits still (${stick.speed.toFixed(3)} m/s)`);
  // down a 25 degree slope in low range first, off the pedals: the hauler's granny low barely lets it roll
  const down = slope(25, SURFACE.DIRT);
  const h = truck('hauler', undefined, down, Math.PI);
  h.dt.setRange(true, 0);
  h.dt.auto = false; h.dt.gear = 1;
  run(h, down, 1, { ...IDLE, brake: 1 });
  run(h, down, 6, IDLE);
  assert.ok(h.speed < 1.6, `engine braking holds it to ${h.speed.toFixed(2)} m/s`);
  assert.ok(h.dt.clutch > 0.9 && h.dt.rpm > 600, 'clutch in, the engine turning');
});

test('crawl ratio: the crawler build creeps up a 35 degree rock slope that stops the stock truck', (t) => {
  const g = slope(35, SURFACE.ROCK);
  const climb = (build) => {
    const v = truck('ranger', build, g);
    v.dt.setRange(true, 0);
    v.dt.auto = false; v.dt.gear = 1;
    run(v, g, 0.5, { ...IDLE, brake: 1 });
    const z0 = v.pos.z;
    run(v, g, 8, { ...IDLE, throttle: 0.5 });
    return v.pos.z - z0;
  };
  const stock = climb(undefined), crawler = climb(presetBuild(TRUCKS.ranger, 'crawler'));
  t.diagnostic(`35 degree rock: stock ${stock.toFixed(2)} m, crawler ${crawler.toFixed(2)} m`);
  assert.ok(crawler > 3 && crawler > stock + 1, `35 degree rock: stock ${stock.toFixed(2)} m, crawler ${crawler.toFixed(2)} m`);
});

test('snorkel: deep water stops the stock engine (cosmetic damage: chokes it); with a snorkel it keeps running', () => {
  const wade = (build, level = 'forgiving') => {
    const g = flooded(flat(), 1.05);
    const v = truck('ranger', build, g);
    v.damage.setLevel(level);
    run(v, g, 3, { ...IDLE, throttle: 0.2 });
    return v;
  };
  const stock = wade(undefined), snork = wade({ intake: 1 });
  assert.ok(stock.flooded && !stock.dt.running, 'stock air cleaner under water: stalled');
  assert.ok(!snork.flooded && snork.dt.running, 'snorkel: running');
  const choked = wade(undefined, 'cosmetic'), breathing = wade({ intake: 1 }, 'cosmetic');
  assert.ok(!choked.flooded && choked.dt.running && choked.dt.powerMul < 0.5, `cosmetic: still running, choked (${choked.dt.powerMul})`);
  assert.equal(breathing.dt.powerMul, 1, 'snorkel: full power');
  // out of the water it starts again after a few seconds
  const dry = flat();
  run(stock, dry, 4, IDLE);
  assert.ok(stock.dt.running && !stock.flooded, 'restarted once dry');
});

test('tyres too big for the lift rub: the bump stops are extended', () => {
  const base = TRUCKS.ranger;
  const fits = truckSpec('ranger', { lift: 1, tyre: 33 }), rubs = truckSpec('ranger', { tyre: 33 });
  assert.equal(fits.rubInches, 0);
  assert.equal(rubs.rubInches, 2);
  assert.ok(rubs.axles[0].bumpTravel < fits.axles[0].bumpTravel - 0.04);
  assert.equal(normalizeBuild(base, { lift: 0, tyre: 37 }).tyre, 33, 'no room for 37s without a lift');
  assert.equal(normalizeBuild(base, { lift: 3, tyre: 37 }).tyre, 37);
});

test('the diff hangs up on a rock between the wheels; bigger tyres carry it over', () => {
  // a 23 cm block under the front diff, 3 m ahead
  const go = (build) => {
    const spec = truckSpec('ranger', build);
    const dx = spec.axles[0].diffX, zf = spec.axles[0].z - spec.cgZ;
    const g = block(dx - 0.3, dx + 0.3, zf + 3, zf + 3.6, 0.23);
    const v = truck('ranger', build, g);
    v.dt.setRange(true, 0);
    run(v, g, 0.5, { ...IDLE, brake: 1 });
    let hit = 0;
    const steps = Math.round(10 / PHYS_DT);
    for (let i = 0; i < steps; i++) { v.step({ ...IDLE, throttle: v.speed < 1 ? 0.35 : 0 }, g); hit = Math.max(hit, v.hullContact); }
    return { z: v.pos.z, hit };
  };
  const stock = go(undefined), big = go({ lift: 2, tyre: 35 });
  assert.ok(stock.hit > 0.2, `stock: the diff hits the rock (${stock.hit.toFixed(2)})`);
  assert.ok(big.hit < 0.05 && big.z > 6, `on 35s it clears (${big.hit.toFixed(2)}), z ${big.z.toFixed(1)}`);
});

test('lift kits raise the centre of gravity: on a tilt table the tall build lifts its wheels much sooner', () => {
  // the way rollover stability is measured: tilt the ground slowly until the uphill tyres leave it
  const tilt = (build) => {
    let deg = 20;
    const g = { height: (x) => x * Math.tan(deg * Math.PI / 180), surfaceAt: () => SURFACES[SURFACE.ROCK] };
    const v = truck('mule', build, g);
    v.dt.auto = false; v.dt.gear = 1;
    run(v, g, 2, { ...IDLE, brake: 1 });
    let off = 0;
    while (deg < 60) {
      deg += 1.5 * PHYS_DT;
      v.step({ ...IDLE, brake: 1 }, g);
      off = v.wheels[0].N + v.wheels[2].N === 0 ? off + PHYS_DT : 0;
      if (off > 0.15) return deg;
    }
    return deg;
  };
  const stock = tilt(undefined), tall = tilt({ lift: 3, tyre: 37, rack: 2 });
  assert.ok(stock > 36 && stock < 44, `stock Mule lifts its wheels at ${stock.toFixed(1)} degrees`);
  assert.ok(tall < stock - 5, `6" lift, 37s and a loaded roof rack: ${tall.toFixed(1)} degrees`);
});
