// The map builder's props (game/Props.js): their shapes, share codes, a layout's race, and the trucks driving on them
// with the real physics: up a ramp and into the air, over a log, stopped by a container.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROP_TYPES, propTop, settle, encodeLayout, decodeLayout, customRace, paintAt, oldCoastAside } from '../src/game/Props.js';
import { SURFACE } from '../src/physics/Surfaces.js';
import { generateWorld } from '../src/world/WorldGen.js';
import { World } from '../src/world/World.js';
import { Vehicle } from '../src/physics/Vehicle.js';
import { truckSpec } from '../src/physics/trucks.js';

const flat = () => 10;

test('the shapes: a ramp rises along its length, a log is round, a rock domed, a box flat; markers have no height', () => {
  const ramp = settle({ type: 'ramp', x: 0, z: 0, yaw: 0 }, flat), T = PROP_TYPES.ramp;
  assert.equal(ramp.y0, 10);
  assert.ok(Math.abs(propTop(ramp, 0, -T.hz + 0.01) - 10) < 0.01 && Math.abs(propTop(ramp, 0, T.hz - 0.01) - (10 + T.h)) < 0.01);
  assert.equal(propTop(ramp, T.hx + 0.1, 0), -Infinity);
  // turned a quarter: it rises along x
  const turned = settle({ type: 'ramp', x: 0, z: 0, yaw: Math.PI / 2 }, flat);
  assert.ok(propTop(turned, 2, 0) > propTop(turned, -2, 0));
  const log = settle({ type: 'log', x: 0, z: 0, yaw: 0 }, flat);
  assert.ok(Math.abs(propTop(log, 1, 0) - (10 + 2 * PROP_TYPES.log.r)) < 1e-9 && propTop(log, 1, 0.2) < propTop(log, 1, 0));
  assert.ok(propTop(settle({ type: 'rock', x: 0, z: 0, yaw: 0 }, flat), 0, 0) > propTop(settle({ type: 'rock', x: 0, z: 0, yaw: 0 }, flat), 1, 0));
  assert.equal(propTop(settle({ type: 'container', x: 0, z: 0, yaw: 0 }, flat), 0.5, 5), 10 + PROP_TYPES.container.h);
  assert.equal(propTop({ type: 'checkpoint', x: 0, z: 0, yaw: 0, y0: 10 }, 0, 0), -Infinity);
  assert.ok(paintAt({ type: 'mud', x: 0, z: 0, yaw: 0 }, 3, 3) && !paintAt({ type: 'mud', x: 0, z: 0, yaw: 0 }, 9, 0));
});

test('share codes: a layout round trips (to a decimetre); junk is refused or dropped', () => {
  const L = { map: 'ashwood', name: 'Jump park', props: [{ type: 'ramp', x: 12.34, z: -56.78, yaw: 1.2 }, { type: 'checkpoint', x: 0, z: 40, yaw: 6.1 }] };
  const code = encodeLayout(L);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeLayout(code);
  assert.equal(back.map, 'ashwood'); assert.equal(back.name, 'Jump park');
  assert.equal(back.props.length, 2);
  assert.ok(Math.abs(back.props[0].x - 12.3) < 0.051 && Math.abs(back.props[0].z + 56.8) < 0.051 && Math.abs(back.props[0].yaw - 1.2) < 0.006);
  assert.equal(decodeLayout('not a code'), null);
  assert.equal(decodeLayout(encodeLayout({ props: [{ type: 'spaceship', x: 0, z: 0, yaw: 0 }] })).props.length, 0);
});

test('a layout with a start line and checkpoints is a race, in the order they were put down', () => {
  const L = { name: 'Loop', props: [{ type: 'ramp', x: 0, z: 0, yaw: 0 }, { type: 'start', x: 0, z: 0, yaw: 0 }, { type: 'checkpoint', x: 0, z: 100, yaw: 0 }, { type: 'checkpoint', x: 100, z: 100, yaw: Math.PI / 2 }] };
  const R = customRace(L, flat);
  assert.equal(R.gates.length, 2);
  assert.ok(R.gates[1].finish && !R.gates[0].finish);
  assert.equal(R.length, 200);
  assert.ok(R.par.gold < R.par.silver && R.par.silver < R.par.bronze);
  assert.equal(customRace({ props: [{ type: 'start', x: 0, z: 0, yaw: 0 }] }, flat), null);
});

test('on the real ground: up a ramp and into the air, over a log, stopped by a container; mud in a mud pit', async () => {
  const world = new World(await generateWorld({}));
  // a level, open run across the station's yard
  const x0 = -108, z0 = 436, y = world.terrain(x0, z0);
  const yaw = Math.PI / 2;                               // heading +x
  const run = (props, steps, throttle = 0.8) => {
    world.setProps(props);
    world.deformGrid.chunks.clear();
    const v = new Vehicle(truckSpec('wrangler'));          // (an automatic: the running start finds its gear)
    v.place(world, x0, z0, yaw);
    v.dt.setFourWD(true, 0);
    // a running start: 12 m/s
    v.vel.set(12, 0, 0); for (const w of v.wheels) w.omega = 12 / v.spec.tyre.radius;
    let air = 0, maxAir = 0, maxX = -1e9, minUp = 1;
    for (let i = 0; i < steps; i++) {
      v.step({ throttle, brake: 0, steer: 0, handbrake: 0 }, world);
      const off = v.wheels.every((w) => !w.contact);
      air = off ? air + 1 / 480 : 0; maxAir = Math.max(maxAir, air);
      maxX = Math.max(maxX, v.pos.x); minUp = Math.min(minUp, v.up.y);
    }
    return { v, maxAir, maxX, minUp };
  };
  assert.ok(Math.abs(world.terrain(x0 + 40, z0) - y) < 0.3, 'level ground for the test');
  const jump = run([{ type: 'ramp', x: x0 + 25, z: z0, yaw }], 480 * 4);
  assert.ok(jump.maxAir > 0.35, `in the air ${jump.maxAir.toFixed(2)} s off the ramp`);
  assert.ok(jump.v.up.y > 0.7, 'landed on its wheels');
  const log = run([{ type: 'log', x: x0 + 20, z: z0, yaw }], 480 * 4);
  assert.ok(log.maxX > x0 + 30, `over the log (got to ${(log.maxX - x0).toFixed(0)} m)`);
  const wall = run([{ type: 'container', x: x0 + 22, z: z0, yaw: 0 }], 480 * 4, 0.6);
  assert.ok(wall.maxX < x0 + 22, `stopped by the container (got to ${(wall.maxX - x0).toFixed(1)} m)`);
  world.setProps([{ type: 'mud', x: x0, z: z0, yaw: 0 }]);
  assert.equal(world.surfaceAt(x0 + 2, z0).id, SURFACE.MUD);
  world.setProps([]);
  assert.notEqual(world.surfaceAt(x0 + 2, z0).id, SURFACE.MUD);
});

test('what was built on the old 2 km coast map is put aside, once; what was built on the 8 km one stays', () => {
  const P = (x, z) => ({ type: 'ramp', x, z, yaw: 0 });
  const s = oldCoastAside({ current: { coast: { v: 1, map: 'coast', props: [P(100, -300), P(-900, 700)] }, ashwood: { v: 1, map: 'ashwood', props: [P(10, 10)] } },
    saved: [{ map: 'coast', name: 'old', props: [P(0, 0)] }, { map: 'coast', name: 'new', props: [P(-1800, -900)] }, { map: 'kerala', name: 'k', props: [P(5, 5)] }] });
  assert.equal(s.current.coast, undefined, 'not applied to the new map');
  assert.equal(s.current['coast-2km'].props.length, 2, 'but kept');
  assert.equal(s.current.ashwood.props.length, 1);
  assert.deepEqual(s.saved.map((c) => c.map), ['coast-2km', 'coast', 'kerala']);
  // once: from then on everything built on the coast is the new map's
  s.current.coast = { v: 1, map: 'coast', props: [P(50, 50)] };
  assert.equal(oldCoastAside(s).current.coast.props.length, 1);
});
