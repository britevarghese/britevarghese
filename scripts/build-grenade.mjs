// Builds client/assets/weapons/grenade.glb: an M67 fragmentation grenade to real dimensions — 63.5 mm steel
// sphere in olive-drab paint with the yellow high-explosive band, M213 fuze, safety lever (spoon) down one
// side, safety pin with its pull ring on the other. Pin + ring and the spoon are their own nodes (m67_pin,
// m67_spoon): a thrown grenade has neither (the spoon flies off as it leaves the hand). Detail maps are
// generated here (paint orange-peel / roughness), no external source.   node scripts/build-grenade.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Parts, lin, fbm, normalMap, ormMap, webp, exportGLB, stats } from './weapon-kit.mjs';

const R = 0.03175; // body radius (2.5 in sphere)
const PAINT = {
  od: [lin(0x454a30), lin(0x6b6b5a)],      // olive drab paint
  fuze: [lin(0x5a5e45), lin(0x8a8b80)],
  yellow: [lin(0xb39328), lin(0xb39328)],
  steel: [lin(0x9a9a96), lin(0xc4c4c0)],
};
const body = new Parts(40), fuze = new Parts(40), band = new Parts(40), spoon = new Parts(40), pin = new Parts(40);
// body: the sphere, a little fuller at the top where the fuze threads in
body.add(new THREE.SphereGeometry(R, 28, 20), PAINT.od, { wear: 'none', smooth: true });
fuze.add(new THREE.CylinderGeometry(0.0115, 0.0125, 0.006, 20), PAINT.od, { y: R - 0.0005, wear: 'none', smooth: true }); // fuze well collar
// yellow band around the shoulder (high explosive)
const bandLat = 0.62, bandH = 0.0045, by = R * Math.sin(bandLat), br = R * Math.cos(bandLat) + 0.0003;
band.add(new THREE.CylinderGeometry(br - bandH * Math.tan(bandLat) / 2, br + bandH * Math.tan(bandLat) / 2, bandH, 28, 1, true), PAINT.yellow, { y: by, wear: 'none', smooth: true });
// M213 fuze: threaded neck, body, striker housing with the lever ears
fuze.add(new THREE.CylinderGeometry(0.0098, 0.0098, 0.01, 18), PAINT.fuze, { y: R + 0.006, wear: 'none', smooth: true });
fuze.add(new THREE.CylinderGeometry(0.0108, 0.0108, 0.007, 18), PAINT.fuze, { y: R + 0.0135, wear: 'none', smooth: true });
fuze.add(new THREE.SphereGeometry(0.0108, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), PAINT.fuze, { y: R + 0.017, wear: 'none', smooth: true, sy: 0.6 });
for (const sz of [-1, 1]) fuze.add(new THREE.BoxGeometry(0.008, 0.012, 0.0022), PAINT.fuze, { x: -0.006, y: R + 0.016, z: sz * 0.0085 }); // lever ears
// spoon: a 13 mm strip hooked under the ears, over the fuze head and down the side of the body
const sp = [];
sp.push(new THREE.Vector3(0.006, R + 0.0255, 0), new THREE.Vector3(-0.004, R + 0.0265, 0), new THREE.Vector3(-0.012, R + 0.022, 0), new THREE.Vector3(-0.0135, R + 0.012, 0));
for (let a = 1.22; a > -0.25; a -= 0.15) sp.push(new THREE.Vector3(-(R + 0.0022) * Math.cos(a), (R + 0.0022) * Math.sin(a), 0));
const strip = new THREE.Shape().moveTo(-0.0065, -0.0008).lineTo(0.0065, -0.0008).lineTo(0.0065, 0.0008).lineTo(-0.0065, 0.0008).closePath(); // (13 mm across, 1.6 mm sheet)
spoon.add(new THREE.ExtrudeGeometry(strip, { steps: 40, extrudePath: new THREE.CatmullRomCurve3(sp), bevelEnabled: false }), PAINT.fuze, { wear: 'none' });
// safety pin across the ears and the pull ring hanging on the far side
pin.add(new THREE.CylinderGeometry(0.0011, 0.0011, 0.03, 8), PAINT.steel, { x: -0.006, y: R + 0.019, z: 0.002, rx: Math.PI / 2, wear: 'none', smooth: true });
pin.add(new THREE.TorusGeometry(0.0115, 0.0012, 8, 28), PAINT.steel, { x: 0.004, y: R + 0.008, z: 0.019, ry: 0.5, rx: 0.25, wear: 'none', smooth: true });
pin.add(new THREE.TorusGeometry(0.0028, 0.0009, 6, 12), PAINT.steel, { x: -0.006, y: R + 0.019, z: 0.016, wear: 'none', smooth: true }); // pin eye

const MAT = (name, metalness, roughness) => new THREE.MeshStandardMaterial({ name, color: 0xffffff, vertexColors: true, metalness, roughness });
const mats = { body: MAT('m67_paint', 0.15, 0.72), fuze: MAT('m67_fuze', 0.35, 0.6), band: MAT('m67_band', 0.1, 0.7), spoon: MAT('m67_fuze', 0.35, 0.6), pin: MAT('m67_steel', 0.9, 0.35) };
mats.spoon = mats.fuze;
const root = new THREE.Group(); root.name = 'm67';
for (const [k, parts] of Object.entries({ body, fuze, band })) { const m = new THREE.Mesh(parts.merge(), mats[k]); m.name = `m67_${k}`; root.add(m); }
const spoonMesh = new THREE.Mesh(spoon.merge(), mats.spoon); spoonMesh.name = 'm67_spoon'; root.add(spoonMesh);
const pinMesh = new THREE.Mesh(pin.merge(), mats.pin); pinMesh.name = 'm67_pin'; root.add(pinMesh);

const N = 128;
const peel = fbm(N, { seed: 21, octaves: 4, base: 8 }), chips = fbm(N, { seed: 9, octaves: 5, base: 6 });
const paintNor = await webp(normalMap(peel, N, 1.4), N), paintOrm = await webp(ormMap(chips, N, 0.8, 1.0), N);
const glb = await exportGLB(new THREE.Scene().add(root), {
  m67_paint: { normal: paintNor, normalScale: 0.5, orm: paintOrm },
  m67_fuze: { normal: paintNor, normalScale: 0.4, orm: paintOrm },
  m67_band: { normal: paintNor, normalScale: 0.4, orm: paintOrm },
});
const out = path.resolve('client/assets/weapons/grenade.glb');
fs.writeFileSync(out, glb);
const s = stats(root);
console.log(`wrote ${path.relative(process.cwd(), out)}  ${(glb.length / 1024).toFixed(1)} KB  ${s.size.x.toFixed(4)} x ${s.size.y.toFixed(4)} x ${s.size.z.toFixed(4)} m  tris ${s.tris}`);
