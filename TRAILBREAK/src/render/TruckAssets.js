// Truck bodies made from real 3D models (tools/cars.py converts them): public/assets/trucks/<id>.glb holds the body in
// the design frame (the wheels off: the game fits its own on the physics), each mesh's material named "<role>:..."
// (paint, glass, screen, head_l, head_r, tail, reverse, amber, rim, or anything else for parts kept as modelled), and
// <id>.json what the converter measured (wheels, lamps, the body's extent) with the config's layout for the game.
// The head lamps (head:..., each side's meshes named head_l or head_r) keep the model's own glass, reflectors and
// bulbs: TruckModel lights them.
//
// TruckModel builds synchronously, so a body is loaded before its truck is built (loadTruckAsset); until then (another
// player's truck arriving) the built-in body stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The trucks with a model body: all of them (TruckBodies.js's built-in bodies stand in while a model loads). */
export const MODEL_BODIES = new Set(['thar', 'wrangler', 'shepherd', 'bronco', 'hummer', 'hummerev', 'mule', 'ranger', 'bruiser', 'hauler', 'trekker', 'gecko', 'drover', 'rhino', 'gclass',
  'm4csl', 'amggt', 'c8', 'huracan', 'r8', 'm3e30', 'nsx', 'p930', 'r34', 'r35', 'rx7', 'senna', 'sti', 'supra']);
/** Roles the game draws in its own materials: merged into one geometry each (position and normal only). */
const OWN = new Set(['paint', 'glass', 'screen', 'head_l', 'head_r', 'tail', 'reverse', 'amber']);

const loading = new Map();             // id -> Promise<asset | null>
const loaded = new Map();              // id -> asset
const progress = new Map();            // id -> the share of its model come down, while it loads

/** A loaded body, or null (not loaded yet, or the truck has none). */
export const truckAsset = (id) => loaded.get(id) || null;

/** How far a truck's model has come down while it loads, 0..1 (null: not loading, or not yet known). */
export const truckAssetProgress = (id) => progress.get(id) ?? null;

/** Load a truck's model body (resolves null for a truck without one, or when it can't be had). */
export function loadTruckAsset(id, base = '/assets/trucks/') {
  if (!MODEL_BODIES.has(id)) return Promise.resolve(null);
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!loading.has(id)) {
    // the layout first (it names the model by its content, so a cached old one is never used)
    loading.set(id, fetch(base + id + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      // (its progress counted against the size it unpacks to, which the server sends as X-File-Size)
      .then((layout) => new GLTFLoader().loadAsync(base + (layout.glb || id + '.glb'), (e) => { if (e.total) progress.set(id, Math.min(1, e.loaded / e.total)); }).then((gltf) => [gltf, layout]))
      .then(([gltf, layout]) => {
      const asset = build(id, gltf, layout);
      loaded.set(id, asset);
      return asset;
    }).catch((e) => { console.warn(`truck body ${id}:`, e); loading.delete(id); return null; })
      .finally(() => progress.delete(id)));
  }
  return loading.get(id);
}

/** A geometry with every attribute as plain floats (a quantized model's 16- and 8-bit ones, read as they're meant). */
function floats(geometry) {
  const g = geometry.clone();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
    const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) out[i * k + c] = a.getComponent(i, c);
    g.setAttribute(name, new THREE.BufferAttribute(out, k));
  }
  return g;
}

/**
 * Where a model's own steering wheel is (layout.steering with `cut`: its centre, the column's tilt and yaw, the rim's
 * radius and thickness, and how far the cut reaches in front of the rim and back down the column to the boss): a test
 * for a point inside its dish, and the move into the wheel's own frame (x across, y up the rim, z down the column),
 * drawn round (a model squeezed across the body by the converter, sx, is unsqueezed about the wheel).
 */
function wheelDish(S) {
  const sx = S.sx || 1, toWheel = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(S.tilt, S.yaw || 0, 0, 'YXZ')).transpose();
  const { front = 0.05, back = 0.045, hub = 0.12, pad = 0.02 } = S.cut === true ? {} : S.cut;
  const reach = S.r + (S.tube || 0.018) + pad;
  return {
    local: (x, y, z, out) => out.set((x - S.x) * sx, y - S.y, z - S.z).applyMatrix4(toWheel),
    normal: (x, y, z, out) => out.set(x / sx, y, z).applyMatrix4(toWheel).normalize(),
    inside: (p) => {
      const rho = Math.hypot(p.x, p.y);
      return rho < reach && p.z > -front && p.z < back + (hub - back) * Math.min(1, Math.max(0, 1 - rho / S.r));
    },
  };
}

/** A geometry split by the wheel's dish: [what stays, the wheel's triangles in its own frame (or null)]. */
function cutWheel(g, dish) {
  const pos = g.attributes.position, n = pos.count, idx = g.index, p = new THREE.Vector3();
  const inV = new Uint8Array(n);
  for (let i = 0; i < n; i++) inV[i] = dish.inside(dish.local(pos.getX(i), pos.getY(i), pos.getZ(i), p)) ? 1 : 0;
  const keep = [], cut = [], count = idx ? idx.count : n;
  for (let t = 0; t < count; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    (inV[a] && inV[b] && inV[c] ? cut : keep).push(a, b, c);
  }
  if (!cut.length) return [g, null];
  const Index = n > 65535 ? Uint32Array : Uint16Array;
  g.setIndex(new THREE.BufferAttribute(new Index(keep), 1));
  // the wheel: its own vertices (only those it uses), moved into its frame
  const map = new Int32Array(n).fill(-1), used = [];
  const tris = new Index(cut.length);
  cut.forEach((v, k) => { if (map[v] < 0) { map[v] = used.length; used.push(v); } tris[k] = map[v]; });
  const w = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const out = new Float32Array(used.length * a.itemSize);
    used.forEach((v, k) => {
      if (name === 'position') dish.local(a.getX(v), a.getY(v), a.getZ(v), p).toArray(out, k * 3);
      else if (name === 'normal') dish.normal(a.getX(v), a.getY(v), a.getZ(v), p).toArray(out, k * 3);
      else for (let c = 0; c < a.itemSize; c++) out[k * a.itemSize + c] = a.getComponent(v, c);
    });
    w.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  w.setIndex(new THREE.BufferAttribute(tris, 1));
  return [g, w];
}

function build(id, gltf, layout) {
  const own = new Map(), parts = [], rim = [];
  const dish = layout.steering?.cut ? wheelDish(layout.steering) : null;
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const role = (o.material.name || '').split(':')[0];
    // (a head lamp's side is in its mesh's name, head_l or head_r: tools/cars.py names the material by the role alone)
    const side = role === 'head' ? (/^head_r/.test(o.name) ? 1 : 0) : undefined;
    let g = floats(o.geometry).applyMatrix4(o.matrixWorld);
    if (role === 'rim') { rim.push({ geometry: g, material: o.material }); return; }
    // (the steering wheel, out of whatever it is drawn in, to turn with the steering: TruckModel holds it)
    if (dish) {
      const [rest, wheel] = cutWheel(g, dish);
      g = rest;
      if (wheel) parts.push({ role, side, geometry: wheel, material: OWN.has(role) ? null : o.material, steer: true, doubleSided: o.material.side === THREE.DoubleSide });
    }
    if (OWN.has(role)) {
      const plain = new THREE.BufferGeometry();
      plain.setAttribute('position', g.attributes.position);
      plain.setAttribute('normal', g.attributes.normal);
      plain.setIndex(g.index);
      // (what the model's maker drew double-sided, a panel seen from inside as well as out, stays so in the game's
      // own materials: kept apart from the rest of its role)
      const key = o.material.side === THREE.DoubleSide ? role + '|both' : role;
      if (!own.has(key)) own.set(key, []);
      own.get(key).push(plain);
      return;
    }
    parts.push({ role, side, geometry: g, material: o.material });
  });
  for (const [key, list] of own) {
    const [role, both] = key.split('|');
    parts.push({ role, geometry: list.length > 1 ? mergeGeometries(list) : list[0], material: null, doubleSided: !!both });
  }
  for (const p of parts) { p.geometry.computeBoundingSphere(); p.geometry.userData.cached = true; }
  for (const r of rim) r.geometry.userData.cached = true;
  return { id, layout, parts, rim };
}
