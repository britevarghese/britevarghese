// Shaders compiled ahead (render/Warm.js): a part of the scene that carries lights has them counted once, as the
// frames count them, and the scene is left as it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePart } from '../src/render/Warm.js';

/** A scene graph's node, as far as three.js's compile goes. */
function node(name, props = {}, kids = []) {
  const o = {
    name, visible: true, parent: null, children: kids, ...props,
    traverseVisible(fn) { if (!this.visible) return; fn(this); for (const c of this.children) c.traverseVisible(fn); },
  };
  for (const k of kids) k.parent = o;
  return o;
}
const light = (name) => node(name, { isLight: true });
/** three.js's compile, as it counts lights: the scene's visible ones, then the part's own on top when it isn't the scene. */
function fakeGl() {
  return {
    lights: [],
    compile(part, camera, scene) {
      const seen = [];
      scene.traverseVisible((o) => { if (o.isLight) seen.push(o.name); });
      if (part !== scene) part.traverseVisible((o) => { if (o.isLight) seen.push(o.name); });
      this.lights.push(seen.sort());
    },
  };
}
function world() {
  const truck = node('truck', {}, [node('body'), light('lampL'), light('lampR')]);
  const rock = node('rock', {}, [node('stone')]);
  const scene = node('scene', {}, [light('sky'), light('sun'), truck, rock, light('sunNear')]);
  return { scene, truck, rock };
}
const ALL = ['lampL', 'lampR', 'sky', 'sun', 'sunNear'];
const order = (scene) => scene.children.map((c) => c.name).join(' ');

test('the whole scene, and a part with no lights: compiled as three.js does it', () => {
  const { scene, rock } = world(), gl = fakeGl();
  compilePart(gl, scene, null, scene);
  compilePart(gl, rock, null, scene);
  assert.deepEqual(gl.lights, [ALL, ALL]);
  assert.equal(order(scene), 'sky sun truck rock sunNear');
});

test('a part of the scene that carries lights: each counted once, and the part back where it was', () => {
  const { scene, truck } = world(), gl = fakeGl();
  // (as three.js alone counts them: the truck's lamps twice over)
  gl.compile(truck, null, scene);
  assert.equal(gl.lights[0].length, 7);
  compilePart(gl, truck, null, scene);
  assert.deepEqual(gl.lights[1], ALL);
  assert.equal(order(scene), 'sky sun truck rock sunNear', 'the sun still the first of its kind, the truck where it was');
  assert.equal(truck.parent, scene);
  // (a light itself as the part, and one deeper down)
  compilePart(gl, scene.children[1], null, scene);
  compilePart(gl, truck.children[1], null, scene);
  assert.deepEqual(gl.lights[2], ALL);
  assert.deepEqual(gl.lights[3], ALL);
  assert.equal(order(scene), 'sky sun truck rock sunNear');
  assert.equal(truck.children.map((c) => c.name).join(' '), 'body lampL lampR');
});

test('a part about to join the scene: the scene\'s lights and its own', () => {
  const { scene } = world(), gl = fakeGl();
  const friend = node('friend', {}, [node('body'), light('beacon')]);
  compilePart(gl, friend, null, scene);
  assert.deepEqual(gl.lights[0], [...ALL, 'beacon'].sort());
  assert.equal(friend.parent, null);
});

test('a hidden part: its lights are not counted at all, as in a frame; and a compile that throws leaves the scene whole', () => {
  const { scene, truck } = world(), gl = fakeGl();
  truck.visible = false;
  compilePart(gl, truck, null, scene);
  assert.deepEqual(gl.lights[0], ['sky', 'sun', 'sunNear']);
  truck.visible = true;
  const broken = { compile() { throw new Error('lost'); } };
  assert.throws(() => compilePart(broken, truck, null, scene), /lost/);
  assert.equal(order(scene), 'sky sun truck rock sunNear');
});
