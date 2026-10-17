// Truck bodies made from real 3D models (tools/cars.py converts them): public/assets/trucks/<id>.glb holds the body in
// the design frame (the wheels off: the game fits its own on the physics), each mesh's material named "<role>:..."
// (paint, glass, screen, head_l, head_r, tail, reverse, amber, rim, or anything else for parts kept as modelled), and
// <id>.json what the converter measured (wheels, lamps, the body's extent) with the config's layout for the game.
//
// TruckModel builds synchronously, so a body is loaded before its truck is built (loadTruckAsset); until then (another
// player's truck arriving) the built-in body stands in.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** The trucks with a model body: all of them (TruckBodies.js's built-in bodies stand in while a model loads). */
export const MODEL_BODIES = new Set(['thar', 'wrangler', 'shepherd', 'bronco', 'hummer', 'hummerev', 'mule', 'ranger', 'bruiser', 'hauler', 'trekker', 'gecko', 'drover', 'rhino']);
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

function build(id, gltf, layout) {
  const own = new Map(), parts = [], rim = [];
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const role = (o.material.name || '').split(':')[0];
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (role === 'rim') { rim.push({ geometry: g, material: o.material }); return; }
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
    parts.push({ role, geometry: g, material: o.material });
  });
  for (const [key, list] of own) {
    const [role, both] = key.split('|');
    parts.push({ role, geometry: list.length > 1 ? mergeGeometries(list) : list[0], material: null, doubleSided: !!both });
  }
  for (const p of parts) { p.geometry.computeBoundingSphere(); p.geometry.userData.cached = true; }
  for (const r of rim) r.geometry.userData.cached = true;
  return { id, layout, parts, rim };
}
