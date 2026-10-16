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

/** The trucks with a model body (the rest are built from code in TruckModel.js and TruckBodies.js). */
export const MODEL_BODIES = new Set(['thar', 'wrangler', 'shepherd', 'bronco', 'hummer', 'hummerev', 'mule', 'ranger']);
/** Roles the game draws in its own materials: merged into one geometry each (position and normal only). */
const OWN = new Set(['paint', 'glass', 'screen', 'head_l', 'head_r', 'tail', 'reverse', 'amber']);

const loading = new Map();             // id -> Promise<asset | null>
const loaded = new Map();              // id -> asset

/** A loaded body, or null (not loaded yet, or the truck has none). */
export const truckAsset = (id) => loaded.get(id) || null;

/** Load a truck's model body (resolves null for a truck without one, or when it can't be had). */
export function loadTruckAsset(id, base = '/assets/trucks/') {
  if (!MODEL_BODIES.has(id)) return Promise.resolve(null);
  if (loaded.has(id)) return Promise.resolve(loaded.get(id));
  if (!loading.has(id)) {
    // the layout first (it names the model by its content, so a cached old one is never used)
    loading.set(id, fetch(base + id + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((layout) => new GLTFLoader().loadAsync(base + (layout.glb || id + '.glb')).then((gltf) => [gltf, layout]))
      .then(([gltf, layout]) => {
      const asset = build(id, gltf, layout);
      loaded.set(id, asset);
      return asset;
    }).catch((e) => { console.warn(`truck body ${id}:`, e); loading.delete(id); return null; }));
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
      if (!own.has(role)) own.set(role, []);
      own.get(role).push(plain);
      return;
    }
    o.material.side = o.material.side || THREE.FrontSide;
    parts.push({ role, geometry: g, material: o.material });
  });
  for (const [role, list] of own) parts.push({ role, geometry: list.length > 1 ? mergeGeometries(list) : list[0], material: null });
  for (const p of parts) { p.geometry.computeBoundingSphere(); p.geometry.userData.cached = true; }
  for (const r of rim) r.geometry.userData.cached = true;
  return { id, layout, parts, rim };
}
