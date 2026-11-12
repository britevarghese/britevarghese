// Builds the class weapons (+ a light LOD of each for other soldiers), modelled to real proportions with the same
// kit and node layout as the carbine (scripts/build-carbine.mjs), so the viewmodel's "rifle" action, the hand IK and
// the reload animations work unchanged:
//   client/assets/weapons/lmg.glb  — Support: a 5.56 mm belt-fed light machine gun of the M249 pattern: heavy 465 mm
//     barrel with flash hider, front sight and carry handle, folded bipod under the gas block, boxy steel receiver with
//     the feed cover on top (rail + red dot), ribbed polymer handguard, 100-round box under the receiver, fixed
//     skeleton stock, charging handle on the right.
//   client/assets/weapons/smg.glb  — Medic: a 9 mm roller-delayed submachine gun of the MP5 pattern: short barrel with
//     the three-lug muzzle, ringed front sight, slim tapered handguard, stamped receiver with the cocking tube above
//     the barrel (handle at its front left), deeply curved 30-round magazine, polymer trigger group, retractable stock
//     (collapsed), red dot on a claw mount.
// Moving parts are their own nodes (<id>_mag, <id>_charge, <id>_cover, <id>_carrier). Sockets: rightGrip, leftGrip,
// stock, muzzle, eject_port, charge_grip (+ reddot_lens / reddot_sight for the optic).
//   node scripts/build-classweapons.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Parts, cbox as cbox0, profile, tube, lin, fbm, stipple, normalMap, ormMap, webp, exportGLB, stats } from './weapon-kit.mjs';

// weapon space: -Z = muzzle, +Y = up, +X = right, metres; bore axis at y = 0
const PAINT = {
  alu: [lin(0x2d2e30), lin(0x6b6c70)],
  steel: [lin(0x2a2b29), lin(0x5a5b53)],
  poly: [lin(0x232325), lin(0x3a3a3c)],
  rubber: [lin(0x1c1c1d), lin(0x262627)],
  od: [lin(0x4a4a36), lin(0x6a6a50)],     // olive drab box / pouch
  black: [lin(0x161617), lin(0x2e2e30)], // polymer magazine
  dark: [lin(0x0b0b0b), lin(0x0b0b0b)],
};

const MATS = () => ({
  alu: new THREE.MeshStandardMaterial({ name: 'anodized_aluminium', color: 0xffffff, vertexColors: true, metalness: 0.18, roughness: 0.58 }),
  steel: new THREE.MeshStandardMaterial({ name: 'phosphate_steel', color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.62 }),
  poly: new THREE.MeshStandardMaterial({ name: 'polymer', color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.78 }),
  dark: new THREE.MeshStandardMaterial({ name: 'port_dark', color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.8 }),
  mag: new THREE.MeshStandardMaterial({ name: 'magazine_polymer', color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.82 }),
});

// a compact red dot (tube sight), axis at (0, sy, sz): the body into the aluminium parts; its lens and the sight
// point (the eye's place when aiming) as nodes once the gun is assembled (sightNodes)
function redDot(A, sy, sz, seg) {
  A(tube(0.0172, 0.07, seg + 4, 0.014), { y: sy, z: sz });
  A(tube(0.0192, 0.011, seg + 4, 0.014), { y: sy, z: sz - 0.037 });
  A(tube(0.0192, 0.011, seg + 4, 0.014), { y: sy, z: sz + 0.037 });
  A(new THREE.CylinderGeometry(0.007, 0.007, 0.011, 14), { y: sy + 0.021, z: sz, wear: 'none', smooth: true });
  A(new THREE.CylinderGeometry(0.007, 0.007, 0.011, 14), { x: 0.021, y: sy, z: sz, rz: Math.PI / 2, wear: 'none', smooth: true });
}
function sightNodes(root, sy, sz) {
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0142, 0.0142, 0.002, 24).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ name: 'reddot_glass', color: 0x9fb8c0, transparent: true, opacity: 0.3, roughness: 0.05 }));
  lens.name = 'reddot_lens'; lens.position.set(0, sy, sz + 0.028); root.add(lens);
  const sight = new THREE.Object3D(); sight.name = 'reddot_sight'; sight.position.set(0, sy, sz); root.add(sight);
}

function assemble(id, P, nodes, nodePos, sockets, mats) {
  const root = new THREE.Group(); root.name = id;
  for (const [k, parts] of Object.entries(P)) if (parts.list.length) { const m = new THREE.Mesh(parts.merge(), mats[k]); m.name = `${id}_${k}`; root.add(m); }
  for (const [k, parts] of Object.entries(nodes)) {
    const m = new THREE.Mesh(parts.merge(), k === 'mag' ? mats.mag : k === 'cover' || k === 'carrier' ? mats.steel : mats.alu);
    m.name = `${id}_${k}`; m.position.set(...(nodePos[k] || [0, 0, 0])); root.add(m);
  }
  for (const [name, p] of Object.entries(sockets)) { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); root.add(o); }
  return root;
}

// ------------------------------------------------------------------ light machine gun
function buildLMG(lod) {
  const hi = lod === 'fp', seg = hi ? 20 : 8;
  const cbox = (w, h, d, c) => (hi ? cbox0(w, h, d, c) : new THREE.BoxGeometry(w, h, d));
  const P = { alu: new Parts(6), steel: new Parts(6), poly: new Parts(30), dark: new Parts(6) };
  const nodes = { mag: new Parts(20), charge: new Parts(6), cover: new Parts(6), carrier: new Parts(6) };
  const A = (g, o) => P.alu.add(g, PAINT.alu, o), S = (g, o) => P.steel.add(g, PAINT.steel, o), Y = (g, o) => P.poly.add(g, PAINT.poly, o), D = (g, o) => P.dark.add(g, PAINT.dark, o);

  // ---- heavy barrel z -0.09 .. -0.565, flash hider to the muzzle at -0.605
  S(tube(0.0118, 0.475, seg), { z: -0.327, wear: 'none', smooth: true });
  S(tube(0.0125, 0.04, seg), { z: -0.585, wear: 'none', smooth: true });
  if (hi) for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; D(cbox(0.003, 0.003, 0.028, 0.0005), { x: Math.cos(a) * 0.0122, y: Math.sin(a) * 0.0122, z: -0.588, rz: a, wear: 'none' }); }
  D(tube(0.0058, 0.03, 10), { z: -0.592, wear: 'none' });
  // front sight post on its base, near the muzzle
  S(cbox(0.016, 0.034, 0.02, 0.0015), { y: 0.022, z: -0.54 });
  S(cbox(0.003, 0.022, 0.003, 0.0004), { y: 0.048, z: -0.54 });
  // gas block + gas cylinder under the barrel
  S(cbox(0.03, 0.04, 0.034, 0.002), { y: -0.016, z: -0.385 });
  S(tube(0.0095, 0.3, seg), { y: -0.03, z: -0.235, wear: 'none', smooth: true });
  // carry handle over the barrel (folded upright), on its clamp
  S(tube(0.0165, 0.03, seg), { z: -0.24, wear: 'none', smooth: true });
  Y(profile([[-0.29, 0.03], [-0.27, 0.065], [-0.21, 0.065], [-0.19, 0.03], [-0.2, 0.026], [-0.215, 0.054], [-0.265, 0.054], [-0.28, 0.026]], 0.014, 0.002, 2), { wear: 'bevel', uv: 30 });
  // folded bipod: legs swung back along the gas tube, the yoke under the gas block
  S(cbox(0.034, 0.012, 0.02, 0.0015), { y: -0.042, z: -0.39 });
  for (const sx of [-1, 1]) {
    S(cbox(0.0065, 0.0065, 0.26, 0.001), { x: sx * 0.014, y: -0.05, z: -0.255 });
    S(cbox(0.009, 0.009, 0.016, 0.0012), { x: sx * 0.014, y: -0.05, z: -0.125 }); // feet
  }
  // ribbed polymer handguard under the barrel z -0.1 .. -0.33
  Y(cbox(0.058, 0.034, 0.23, 0.004), { y: -0.034, z: -0.215 });
  if (hi) for (let z = -0.31; z < -0.11; z += 0.02) for (const sx of [-1, 1]) Y(cbox(0.003, 0.026, 0.008, 0.001), { x: sx * 0.03, y: -0.034, z });

  // ---- receiver: steel box z -0.095 .. 0.135 (ejection on the right, the feed tray inside the cover)
  S(cbox(0.05, 0.072, 0.23, 0.003), { x: -0.003, y: 0.002, z: 0.02 });
  D(cbox(0.004, 0.02, 0.06, 0.0005), { x: 0.0225, y: -0.008, z: 0.03, wear: 'none' }); // port shadow
  // feed cover on top (hinged at its front), with its rail and the rear sight
  S(cbox(0.054, 0.02, 0.17, 0.003), { y: 0.047, z: 0.035 });
  A(cbox(0.022, 0.006, 0.15, 0.0012), { y: 0.06, z: 0.035 });
  if (hi) for (let z = -0.035; z < 0.105; z += 0.01) A(new THREE.BoxGeometry(0.022, 0.0035, 0.0053), { y: 0.0645, z });
  S(cbox(0.03, 0.012, 0.016, 0.002), { y: 0.045, z: 0.123 });                        // cover latch
  // feed tray / belt entry on the left with a stub of linked rounds
  S(cbox(0.016, 0.03, 0.05, 0.002), { x: -0.032, y: 0.02, z: 0.0 });
  if (hi) for (let i = 0; i < 4; i++) S(tube(0.0048, 0.05, 8), { x: -0.045 - i * 0.004, y: 0.018 - i * 0.012, z: 0.0, ry: Math.PI / 2, wear: 'none', smooth: true });
  // trigger group + guard, pistol grip
  A(cbox(0.03, 0.022, 0.07, 0.002), { y: -0.044, z: 0.1 });
  A(cbox(0.022, 0.005, 0.064, 0.0012), { y: -0.082, z: 0.1 });
  A(cbox(0.022, 0.03, 0.005, 0.0012), { y: -0.068, z: 0.07 });
  S(cbox(0.0045, 0.022, 0.005, 0.0008), { y: -0.064, z: 0.094, rx: -0.28 });
  Y(profile([[0.114, -0.054], [0.12, -0.074], [0.116, -0.086], [0.124, -0.098], [0.139, -0.144], [0.149, -0.153], [0.172, -0.147], [0.162, -0.106], [0.152, -0.07], [0.155, -0.054]], 0.028, 0.004, 2), { wear: 'bevel', uv: 30 });
  // fixed skeleton stock with the butt pad
  Y(profile([[0.13, 0.03], [0.24, 0.028], [0.42, 0.024], [0.44, 0.03], [0.448, 0.03], [0.448, -0.1], [0.436, -0.106], [0.33, -0.07], [0.2, -0.038], [0.13, -0.036]], 0.042, 0.004, 2), { wear: 'bevel', uv: 30 });
  if (hi) D(profile([[0.25, 0.012], [0.4, 0.008], [0.4, -0.05], [0.32, -0.036], [0.25, -0.018]], 0.046, 0, 1), { wear: 'none' }); // the skeleton's window
  P.poly.add(cbox(0.046, 0.134, 0.014, 0.003), PAINT.rubber, { y: -0.035, z: 0.456 });
  if (hi) Y(cbox(0.012, 0.02, 0.06, 0.003), { y: -0.09, z: 0.39 });                  // shoulder rest / monopod housing

  // ---- red dot on the feed cover rail
  const SY = 0.098, SZ = 0.035;
  A(cbox(0.03, 0.02, 0.044, 0.002), { y: 0.073, z: SZ });
  redDot(A, SY, SZ, seg);

  // ---- moving parts
  // 100-round box under the receiver (olive drab, a belt window on its side)
  nodes.mag.add(cbox(0.066, 0.12, 0.11, 0.006), PAINT.od, { x: -0.006, y: -0.1, z: 0.0 });
  nodes.mag.add(cbox(0.07, 0.012, 0.114, 0.003), PAINT.od, { x: -0.006, y: -0.038, z: 0.0 });        // lid / latch rim
  if (hi) nodes.mag.add(cbox(0.003, 0.05, 0.07, 0.001), PAINT.black, { x: -0.04, y: -0.1, z: 0.0, wear: 'none' }); // window
  // charging handle on the right, ahead of the trigger group
  nodes.charge.add(cbox(0.03, 0.012, 0.016, 0.002), PAINT.steel, { x: 0.038, y: -0.012, z: -0.06 });
  nodes.charge.add(cbox(0.012, 0.022, 0.012, 0.002), PAINT.steel, { x: 0.052, y: -0.012, z: -0.06 });
  // ejection port cover (right side), hinged on its lower edge
  nodes.cover.add(cbox(0.0018, 0.021, 0.062, 0.0005), PAINT.steel, { y: 0.0105 });
  // bolt seen through the port
  nodes.carrier.add(tube(0.012, 0.13, 14), PAINT.steel, { z: 0.03, wear: 'none', smooth: true });

  const mats = MATS();
  const root = assemble('lmg', P, nodes, { cover: [0.0255, -0.019, 0.03], carrier: [0.002, -0.004, 0] }, {
    rightGrip: [0, -0.086, 0.131], leftGrip: [0, -0.06, -0.24], stock: [0, -0.02, 0.462], muzzle: [0, 0, -0.605],
    eject_port: [0.027, -0.006, 0.03], charge_grip: [0.055, -0.012, -0.06],
  }, mats);
  sightNodes(root, SY, SZ);
  return root;
}

// ------------------------------------------------------------------ submachine gun
function buildSMG(lod) {
  const hi = lod === 'fp', seg = hi ? 20 : 8;
  const cbox = (w, h, d, c) => (hi ? cbox0(w, h, d, c) : new THREE.BoxGeometry(w, h, d));
  const P = { alu: new Parts(6), steel: new Parts(6), poly: new Parts(30), dark: new Parts(6) };
  const nodes = { mag: new Parts(30), charge: new Parts(6), cover: new Parts(6), carrier: new Parts(6) };
  const A = (g, o) => P.alu.add(g, PAINT.alu, o), S = (g, o) => P.steel.add(g, PAINT.steel, o), Y = (g, o) => P.poly.add(g, PAINT.poly, o), D = (g, o) => P.dark.add(g, PAINT.dark, o);

  // ---- short barrel with the three-lug muzzle (to -0.225)
  S(tube(0.0085, 0.16, seg), { z: -0.13, wear: 'none', smooth: true });
  S(tube(0.0098, 0.022, seg), { z: -0.212, wear: 'none', smooth: true });
  for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + (i * Math.PI * 2) / 3; S(cbox(0.005, 0.004, 0.012, 0.0006), { x: Math.cos(a) * 0.0108, y: Math.sin(a) * 0.0108, z: -0.205, rz: a }); }
  D(tube(0.0048, 0.024, 10), { z: -0.214, wear: 'none' });
  // ringed front sight on the cocking tube's end
  S(cbox(0.022, 0.022, 0.018, 0.002), { y: 0.03, z: -0.19 });
  S(new THREE.TorusGeometry(0.0115, 0.0022, 6, 18), { y: 0.05, z: -0.19, wear: 'none' });
  S(cbox(0.0026, 0.016, 0.0026, 0.0004), { y: 0.047, z: -0.19 });
  // cocking tube over the barrel, stamped receiver behind it
  S(tube(0.0118, 0.19, seg), { y: 0.028, z: -0.09, wear: 'none', smooth: true });
  S(cbox(0.034, 0.056, 0.27, 0.003), { y: 0.004, z: 0.085 });
  if (hi) for (const sx of [-1, 1]) S(cbox(0.002, 0.03, 0.2, 0.0006), { x: sx * 0.0175, y: 0.004, z: 0.09 }); // pressed ribs
  D(cbox(0.003, 0.014, 0.04, 0.0005), { x: 0.0165, y: 0.012, z: 0.05, wear: 'none' }); // ejection port
  // drum rear sight
  S(new THREE.CylinderGeometry(0.012, 0.012, 0.016, 14).rotateZ(Math.PI / 2), { y: 0.042, z: 0.2, wear: 'none', smooth: true });
  // slim tapered polymer handguard
  Y(profile([[-0.175, 0.012], [-0.03, 0.016], [-0.03, -0.04], [-0.06, -0.044], [-0.165, -0.034], [-0.178, -0.022]], 0.046, 0.005, 2), { wear: 'bevel', uv: 30 });
  if (hi) for (let z = -0.16; z < -0.05; z += 0.018) for (const sx of [-1, 1]) Y(cbox(0.003, 0.02, 0.006, 0.001), { x: sx * 0.0235, y: -0.014, z });
  // magwell (curved), polymer trigger group with the guard, pistol grip
  S(cbox(0.03, 0.036, 0.05, 0.002), { y: -0.04, z: 0.03, rx: -0.12 });
  Y(cbox(0.03, 0.026, 0.11, 0.003), { y: -0.034, z: 0.15 });
  Y(cbox(0.022, 0.005, 0.06, 0.0012), { y: -0.072, z: 0.145 });
  Y(cbox(0.022, 0.026, 0.005, 0.0012), { y: -0.06, z: 0.116 });
  S(cbox(0.004, 0.02, 0.005, 0.0008), { y: -0.058, z: 0.138, rx: -0.25 });
  Y(profile([[0.16, -0.046], [0.166, -0.066], [0.162, -0.078], [0.17, -0.09], [0.183, -0.13], [0.192, -0.139], [0.214, -0.133], [0.205, -0.094], [0.196, -0.062], [0.2, -0.046]], 0.027, 0.004, 2), { wear: 'bevel', uv: 30 });
  S(cbox(0.003, 0.008, 0.02, 0.0006), { x: -0.0165, y: -0.03, z: 0.13 });            // selector
  // retractable stock, collapsed: two rods along the receiver and the butt plate behind it
  for (const sx of [-1, 1]) S(tube(0.0045, 0.17, 10), { x: sx * 0.021, y: -0.005, z: 0.28, wear: 'none', smooth: true });
  S(cbox(0.05, 0.09, 0.012, 0.003), { y: -0.02, z: 0.362 });
  P.poly.add(cbox(0.048, 0.1, 0.012, 0.003), PAINT.rubber, { y: -0.02, z: 0.373 });
  S(cbox(0.012, 0.012, 0.03, 0.002), { y: 0.026, z: 0.348 });                        // rod yoke

  // ---- red dot on a claw mount over the receiver
  const SY = 0.07, SZ = 0.085;
  A(cbox(0.028, 0.018, 0.05, 0.002), { y: 0.039, z: SZ });
  A(cbox(0.02, 0.012, 0.03, 0.002), { y: 0.052, z: SZ });
  redDot(A, SY, SZ, seg);

  // ---- moving parts
  // deeply curved 30-round 9 mm magazine, top in the magwell at y = -0.02
  nodes.mag.add(profile([[0.052, -0.022], [0.05, -0.08], [0.036, -0.13], [0.016, -0.175], [0.006, -0.188], [-0.024, -0.178], [-0.012, -0.16], [0.008, -0.12], [0.018, -0.07], [0.018, -0.022]], 0.022, 0.0016), PAINT.black, { wear: 'bevel' });
  nodes.mag.add(cbox(0.025, 0.008, 0.034, 0.002), PAINT.black, { y: -0.185, z: -0.008, rx: -0.6 });
  // cocking handle at the front left of the tube
  nodes.charge.add(cbox(0.022, 0.009, 0.012, 0.002), PAINT.steel, { x: -0.022, y: 0.028, z: -0.14 });
  nodes.charge.add(cbox(0.009, 0.014, 0.014, 0.002), PAINT.steel, { x: -0.034, y: 0.028, z: -0.14 });
  // (no dust cover on this pattern: a sliver for the shared action)
  nodes.cover.add(cbox(0.0012, 0.004, 0.04, 0.0004), PAINT.steel, { y: 0.002 });
  nodes.carrier.add(tube(0.0095, 0.09, 14), PAINT.steel, { z: 0.06, wear: 'none', smooth: true });

  const mats = MATS();
  const root = assemble('smg', P, nodes, { cover: [0.0172, 0.0, 0.05], carrier: [0.001, 0.008, 0] }, {
    rightGrip: [0, -0.076, 0.18], leftGrip: [0, -0.04, -0.11], stock: [0, -0.015, 0.378], muzzle: [0, 0, -0.225],
    eject_port: [0.019, 0.012, 0.05], charge_grip: [-0.036, 0.028, -0.14],
  }, mats);
  sightNodes(root, SY, SZ);
  return root;
}

// ------------------------------------------------------------------ detail maps + export
const N = 256;
const grain = fbm(N, { seed: 3, octaves: 5, base: 16 }), stip = stipple(N, { seed: 11 }), scuff = fbm(N, { seed: 5, octaves: 4, base: 4 });
const metalNor = await webp(normalMap(grain, N, 1.2), N), metalOrm = await webp(ormMap(scuff, N, 0.75, 1.0), N);
const polyNor = await webp(normalMap(stip, N, 2.2), N), polyOrm = await webp(ormMap(grain, N, 0.85, 1.0, 0), N);
const MAPS = {
  anodized_aluminium: { normal: metalNor, normalScale: 0.35, orm: metalOrm },
  phosphate_steel: { normal: metalNor, normalScale: 0.5, orm: metalOrm },
  polymer: { normal: polyNor, normalScale: 0.6, orm: polyOrm },
  magazine_polymer: { normal: polyNor, normalScale: 0.35, orm: polyOrm },
};

for (const [id, build] of [['lmg', buildLMG], ['smg', buildSMG]]) {
  for (const [lod, file, maps] of [['fp', `${id}.glb`, MAPS], ['tps', `${id}_tps.glb`, {}]]) {
    const root = build(lod);
    const scene = new THREE.Scene(); scene.add(root);
    const glb = await exportGLB(scene, maps);
    const out = path.resolve('client/assets/weapons', file);
    fs.writeFileSync(out, glb);
    const s = stats(root);
    console.log(`wrote ${path.relative(process.cwd(), out)}  ${(glb.length / 1024).toFixed(1)} KB  length ${s.size.z.toFixed(3)} m  height ${s.size.y.toFixed(3)} m  tris ${s.tris}`);
  }
}
