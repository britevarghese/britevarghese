// Builds client/assets/weapons/carbine.glb: a 5.56 mm M4-pattern carbine (14.5" barrel, collapsible stock,
// rail handguard, curved 30-round magazine, red dot) modelled to real dimensions, with named socket nodes
// (rightGrip, leftGrip, stock, muzzle) that WeaponModel picks up. No Poly Haven / CC0 source exists for an
// assault rifle, so this one is modelled here.   node scripts/build-carbine.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// the exporter reads Blobs through FileReader (browser API)
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`; this.onloadend?.(); }); }
};

// weapon space: -Z = muzzle, +Y = up, metres; bore axis at y = 0
const MATS = {
  alu: new THREE.MeshStandardMaterial({ name: 'anodized_aluminium', color: 0x1d1e20, metalness: 0.55, roughness: 0.48 }),
  steel: new THREE.MeshStandardMaterial({ name: 'phosphate_steel', color: 0x26262a, metalness: 0.75, roughness: 0.38 }),
  poly: new THREE.MeshStandardMaterial({ name: 'polymer', color: 0x18181a, metalness: 0.0, roughness: 0.72 }),
};
const parts = { alu: [], steel: [], poly: [] };
const add = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z);
  parts[mat].push(geo.index ? geo.toNonIndexed() : geo);
};
const box = (mat, w, h, d, x, y, z, rx = 0) => add(mat, new THREE.BoxGeometry(w, h, d), x, y, z, rx);
// cylinder along Z
const tube = (mat, r, len, x, y, z, seg = 16, r2 = r) => add(mat, new THREE.CylinderGeometry(r2, r, len, seg), x, y, z, Math.PI / 2);

// ---- barrel group (front): muzzle at z = -0.505
tube('steel', 0.0105, 0.055, 0, 0, -0.478, 12);                      // A2 flash hider
for (let i = 0; i < 3; i++) box('steel', 0.004, 0.022, 0.03, Math.cos(i * 2.1) * 0.008, Math.sin(i * 2.1) * 0.008, -0.49);
tube('steel', 0.0085, 0.38, 0, 0, -0.27, 14);                        // 14.5" barrel
box('steel', 0.026, 0.024, 0.03, 0, 0.004, -0.355);                  // gas block / front sight base
box('steel', 0.02, 0.05, 0.016, 0, 0.038, -0.355);                   // A-frame front sight
box('steel', 0.004, 0.018, 0.004, 0, 0.068, -0.355);                 // front sight post
tube('steel', 0.004, 0.25, 0, 0.012, -0.21, 6);                      // gas tube (inside the handguard)

// ---- handguard: octagonal free-float tube with a top rail, z -0.335 .. -0.07
add('alu', new THREE.CylinderGeometry(0.023, 0.023, 0.265, 8), 0, 0.006, -0.2, Math.PI / 2, 0, Math.PI / 8);
for (let z = -0.325; z < -0.08; z += 0.026) {                        // vent slots read as rails along the sides
  box('alu', 0.05, 0.006, 0.012, 0, 0.006, z);
  box('alu', 0.012, 0.006, 0.012, 0, -0.018, z);
}
box('alu', 0.022, 0.006, 0.265, 0, 0.032, -0.2);                     // top rail
for (let z = -0.325; z < -0.07; z += 0.01) box('alu', 0.024, 0.004, 0.005, 0, 0.037, z);
box('alu', 0.03, 0.03, 0.02, 0, 0.004, -0.06);                       // delta ring / barrel nut

// ---- upper receiver z -0.05 .. 0.135
box('alu', 0.034, 0.042, 0.185, 0, 0.004, 0.042);
box('alu', 0.022, 0.006, 0.17, 0, 0.028, 0.042);                     // flat-top rail
for (let z = -0.04; z < 0.125; z += 0.01) box('alu', 0.024, 0.004, 0.005, 0, 0.033, z);
box('steel', 0.002, 0.016, 0.055, 0.0175, 0.006, 0.03);              // ejection port cover
add('alu', new THREE.CylinderGeometry(0.008, 0.008, 0.02, 10), 0.019, 0.008, 0.095, 0, 0, Math.PI / 2 - 0.4); // forward assist
box('alu', 0.028, 0.008, 0.02, 0, 0.022, 0.145);                     // charging handle latch
box('alu', 0.012, 0.006, 0.02, 0, 0.022, 0.131);

// ---- lower receiver z -0.03 .. 0.115
box('alu', 0.03, 0.036, 0.145, 0, -0.035, 0.043);
box('alu', 0.03, 0.04, 0.085, 0, -0.06, 0.012);                      // magazine well
box('alu', 0.022, 0.004, 0.06, 0, -0.065, 0.07);                     // trigger guard
box('alu', 0.022, 0.025, 0.004, 0, -0.054, 0.04);
box('steel', 0.004, 0.018, 0.005, 0, -0.058, 0.065);                 // trigger
box('steel', 0.003, 0.012, 0.022, 0.016, -0.03, 0.09);               // selector

// ---- pistol grip (A2): leans back ~22°
box('poly', 0.028, 0.095, 0.034, 0, -0.098, 0.112, -0.38);
box('poly', 0.03, 0.012, 0.04, 0, -0.142, 0.13, -0.38);

// ---- curved 30-rd STANAG magazine: one side profile (z, y) extruded across the width, sweeping forward
{
  const back = [[0.034, -0.07], [0.032, -0.12], [0.022, -0.18], [0.0, -0.235]];
  const front = [[-0.062, -0.225], [-0.044, -0.17], [-0.032, -0.12], [-0.028, -0.07]];
  const sh = new THREE.Shape(); sh.moveTo(...back[0]);
  for (const p of [...back.slice(1), ...front]) sh.lineTo(...p);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.022, bevelEnabled: false });
  g.rotateY(-Math.PI / 2); g.translate(0.011, 0, 0);
  parts.poly.push(g.index ? g.toNonIndexed() : g);
  box('poly', 0.026, 0.01, 0.068, 0, -0.233, -0.031, 0.16);            // floor plate
}

// ---- buffer tube + collapsible stock (straight-line design: stock on the bore axis)
tube('alu', 0.0145, 0.2, 0, -0.002, 0.225, 16);
box('poly', 0.036, 0.04, 0.17, 0, -0.012, 0.265);                    // stock body
box('poly', 0.04, 0.115, 0.022, 0, -0.03, 0.344);                    // butt plate
box('poly', 0.03, 0.05, 0.1, 0, -0.06, 0.29, 0.32);                 // lower brace
box('poly', 0.026, 0.026, 0.08, 0, 0.012, 0.27);                     // cheek riser

// ---- red dot (Aimpoint-style tube on a riser): sight axis 0.072 above the bore
const SIGHT_Y = 0.072, SIGHT_Z = 0.045;
box('alu', 0.026, 0.03, 0.04, 0, 0.046, SIGHT_Z);                    // riser mount
// hollow tubes (you look through the sight): an annulus extruded along the bore axis
const ring = (ro, ri, len, z) => {
  const sh = new THREE.Shape().absarc(0, 0, ro, 0, Math.PI * 2, false);
  sh.holes.push(new THREE.Path().absarc(0, 0, ri, 0, Math.PI * 2, true));
  const g = new THREE.ExtrudeGeometry(sh, { depth: len, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, SIGHT_Y, z - len / 2);
  parts.alu.push(g.index ? g.toNonIndexed() : g);
};
ring(0.0175, 0.0145, 0.075, SIGHT_Z);                                 // body
ring(0.0195, 0.0145, 0.012, SIGHT_Z - 0.04);                          // front lens ring
ring(0.0195, 0.0145, 0.012, SIGHT_Z + 0.04);                          // rear lens ring
add('alu', new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), 0, SIGHT_Y + 0.022, SIGHT_Z);           // elevation turret
add('alu', new THREE.CylinderGeometry(0.007, 0.007, 0.012, 10), 0.022, SIGHT_Y, SIGHT_Z, 0, 0, Math.PI / 2); // windage turret

const root = new THREE.Group(); root.name = 'carbine';
for (const [k, list] of Object.entries(parts)) {
  const m = new THREE.Mesh(mergeGeometries(list), MATS[k]);
  m.name = `carbine_${k}`;
  m.geometry.computeVertexNormals();
  root.add(m);
}
const lensMat = new THREE.MeshStandardMaterial({ name: 'reddot_glass', color: 0x9fb8c0, transparent: true, opacity: 0.3, roughness: 0.05 });
const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.002, 24).rotateX(Math.PI / 2), lensMat);
lens.name = 'reddot_lens'; lens.position.set(0, SIGHT_Y, SIGHT_Z + 0.03); root.add(lens);
const sight = new THREE.Object3D(); sight.name = 'reddot_sight'; sight.position.set(0, SIGHT_Y, SIGHT_Z); root.add(sight);

// sockets (weapon space) — hands on the pistol grip and the handguard, shoulder on the butt plate
const sockets = { rightGrip: [0, -0.078, 0.104], leftGrip: [0, -0.02, -0.215], stock: [0, -0.02, 0.355], muzzle: [0, 0, -0.506] };
for (const [name, p] of Object.entries(sockets)) { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); root.add(o); }

const scene = new THREE.Scene(); scene.add(root);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
const out = path.resolve('client/assets/weapons/carbine.glb');
fs.writeFileSync(out, Buffer.from(glb));
const b = new THREE.Box3().setFromObject(root), s = b.getSize(new THREE.Vector3());
console.log(`wrote ${path.relative(process.cwd(), out)}  ${(fs.statSync(out).size / 1024).toFixed(1)} KB  length ${s.z.toFixed(3)} m  height ${s.y.toFixed(3)} m  tris ${root.children.reduce((n, m) => n + (m.geometry ? m.geometry.attributes.position.count / 3 : 0), 0)}`);
