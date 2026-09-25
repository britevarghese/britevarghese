// Generates NIGHTSHIFT's original vehicle models as binary glTF (GLB) files.
//   node tools/generate-models.mjs
// Output: public/assets/models/<car>.glb (lod0 + lod1 groups) and wheels.glb
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { CAR_SPECS } from './carbuilder/specs.mjs';
import { buildCar, makeMaterials, panelLayout } from './carbuilder/build.mjs';
import { tireGeometry, rimGeometry, brakeGeometry, WHEEL_REF } from './carbuilder/wheels.mjs';
import { stampModels } from './carimport/stamp.mjs';

// Minimal FileReader polyfill so GLTFExporter's binary path works in Node.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); this.onload?.({ target: this }); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64'); this.onloadend?.(); this.onload?.({ target: this }); }); }
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public/assets/models');
fs.mkdirSync(outDir, { recursive: true });

async function exportGLB(object, file) {
  const exporter = new GLTFExporter();
  const data = await exporter.parseAsync(object, { binary: true, onlyVisible: false });
  fs.writeFileSync(path.join(outDir, file), Buffer.from(data));
  return data.byteLength;
}

const manifest = { cars: {}, wheels: { file: 'wheels.glb', ref: WHEEL_REF, rims: 5 } };
for (const [id, spec] of Object.entries(CAR_SPECS)) {
  const mats = makeMaterials();
  const scene = new THREE.Scene();
  const car = new THREE.Group();
  car.name = id;
  car.add(buildCar(spec, mats, 0));
  car.add(buildCar(spec, mats, 1));
  scene.add(car);
  const bytes = await exportGLB(scene, id + '.glb');
  manifest.cars[id] = {
    file: id + '.glb', name: spec.name, class: spec.class, length: spec.length, width: spec.width,
    wheels: spec.wheels.map((w) => ({ id: w.id, r: w.r, w: w.w })),
    panels: panelLayout(spec),
  };
  console.log(`${id}.glb  ${(bytes / 1024).toFixed(1)} KB`);
}

{
  const scene = new THREE.Scene();
  const rubber = new THREE.MeshStandardMaterial({ name: 'rubber', color: 0x161616, roughness: 0.92, metalness: 0 });
  const rim = new THREE.MeshStandardMaterial({ name: 'rim', color: 0xb8bcc2, roughness: 0.28, metalness: 1 });
  const disc = new THREE.MeshStandardMaterial({ name: 'disc', color: 0x707274, roughness: 0.45, metalness: 1 });
  const caliper = new THREE.MeshStandardMaterial({ name: 'caliper', color: 0xc01818, roughness: 0.4, metalness: 0.2 });
  const add = (g, m, n) => { const mesh = new THREE.Mesh(g, m); mesh.name = n; scene.add(mesh); };
  add(tireGeometry(40), rubber, 'tire');
  add(tireGeometry(16), rubber, 'tire_lod1');
  for (let i = 0; i < 5; i++) add(rimGeometry(i, 40), rim, 'rim_' + i);
  add(rimGeometry(4, 14), rim, 'rim_lod1');
  const b = brakeGeometry();
  add(b.disc, disc, 'brake_disc');
  add(b.caliper, caliper, 'caliper');
  const bytes = await exportGLB(scene, 'wheels.glb');
  console.log(`wheels.glb  ${(bytes / 1024).toFixed(1)} KB`);
}

// keep real cars registered by tools/import-cars.mjs
try {
  const prev = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
  for (const [id, c] of Object.entries(prev.cars || {})) if (c.imported) manifest.cars[id] = c;
  for (const k of ['rider', 'humans']) if (prev[k]) manifest[k] = prev[k]; // tools/import-rider.mjs, tools/import-humans.mjs
} catch { /* first run */ }
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
stampModels(root); // cache-busting fingerprints for the game
console.log('manifest.json written');
