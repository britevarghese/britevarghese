// Builds client/assets/weapons/launcher.glb (+ launcher_tps.glb, a light LOD for other soldiers): a disposable
// 84 mm recoilless anti-armour launcher of the AT4 pattern, to real dimensions — 1.02 m glass-fibre tube in olive
// drab with rubber shock absorbers at both ends (the rear one round the venturi), firing mechanism on the top
// right (red trigger button, safety, cocking lever), pop-up iron sights on the top left (rear aperture, front post
// in its guard), shoulder stop and folding front grip underneath, sling swivels, the yellow HEAT band and a
// stencil panel. Procedural detail maps (glass-fibre weave, rubber), no external source.
// Sockets: rightGrip (on the firing mechanism), leftGrip (front grip), stock (where it rests on the shoulder),
// muzzle, back_blast (rear opening), optic_eye (eye behind the rear aperture, on the line of sight).
//   node scripts/build-launcher.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Parts, cbox as cbox0, tube, lin, fbm, stipple, normalMap, ormMap, webp, exportGLB, stats } from './weapon-kit.mjs';

// weapon space: -Z = muzzle, +Y = up, +X = right, metres; bore axis at y = 0
const R = 0.05, RI = 0.043, HALF = 0.445; // tube outer / inner radius, half-length of the body between the end caps
const SIGHT = { x: -0.047, y: 0.104 };     // line of sight (top left of the tube: the right eye on a right shoulder)
const PAINT = {
  od: [lin(0x4b5136), lin(0x6c7058)],      // olive drab glass fibre, scuffed lighter on edges
  rubber: [lin(0x1d1e1c), lin(0x2a2b28)],
  mech: [lin(0x23241f), lin(0x4c4d45)],    // black polymer / phosphated steel of the mechanism and sights
  red: [lin(0x8e1d16), lin(0xb33a2c)],
  yellow: [lin(0xb08f2a), lin(0xb08f2a)],
  stencil: [lin(0xb8b6a4), lin(0xb8b6a4)],
  dark: [lin(0x0a0a09), lin(0x0a0a09)],    // inside of the tube / venturi
};

// a part placed on the tube's surface at angle a (0 = top, + = to the right), radius r, centred at z
const onTube = (a, r) => ({ x: Math.sin(a) * r, y: Math.cos(a) * r, rz: -a });

function build(lod) {
  const hi = lod === 'fp', seg = hi ? 28 : 10;
  const cbox = (w, h, d, c) => (hi ? cbox0(w, h, d, c) : new THREE.BoxGeometry(w, h, d));
  const P = { body: new Parts(18), rubber: new Parts(30), mech: new Parts(40), dark: new Parts(20), red: new Parts(40), mark: new Parts(30) };
  // ---- tube + bands
  P.body.add(tube(R, HALF * 2, seg, RI), PAINT.od, { wear: 'none', smooth: true });
  for (const z of [-0.36, 0.33]) P.body.add(tube(R + 0.0018, 0.014, seg, R - 0.001), PAINT.od, { z, wear: 'none', smooth: true }); // swivel bands
  P.mark.add(tube(R + 0.0006, 0.03, seg, R - 0.001), PAINT.yellow, { z: -0.405, wear: 'none', smooth: true }); // HEAT band
  if (hi) P.mark.add(new THREE.CylinderGeometry(R + 0.0004, R + 0.0004, 0.16, 12, 1, true, Math.PI * 0.62, 0.55).rotateX(Math.PI / 2), PAINT.stencil, { z: 0.05, wear: 'none', smooth: true }); // stencil panel (right side)
  // ---- shock absorbers: front ring, rear ring flaring round the venturi
  P.rubber.add(tube(0.059, 0.065, seg, RI + 0.001), PAINT.rubber, { z: -HALF - 0.0325, wear: 'none', smooth: true });
  P.rubber.add(tube(0.061, 0.065, seg, RI + 0.003), PAINT.rubber, { z: HALF + 0.0325, wear: 'none', smooth: true });
  if (hi) for (const z of [-HALF - 0.012, HALF + 0.012]) P.rubber.add(tube(0.0605, 0.008, seg, 0.057), PAINT.rubber, { z, wear: 'none', smooth: true }); // grip ribs
  // the dark inside: the round's nose seen down the muzzle, the venturi cone at the back
  P.dark.add(new THREE.CylinderGeometry(RI - 0.0005, RI - 0.0005, 0.01, seg).rotateX(Math.PI / 2), PAINT.dark, { z: -0.33, wear: 'none', smooth: true });
  P.dark.add(new THREE.CylinderGeometry(RI - 0.0005, 0.02, 0.09, seg, 1, true).rotateX(Math.PI / 2), PAINT.dark, { z: HALF - 0.02, wear: 'none', smooth: true });
  // ---- firing mechanism on the top right, forward of the shoulder
  const fm = onTube(0.62, R + 0.012);
  P.mech.add(cbox(0.034, 0.026, 0.17, 0.003), PAINT.mech, { ...fm, z: -0.07 });
  P.mech.add(cbox(0.026, 0.014, 0.05, 0.002), PAINT.mech, { ...onTube(0.62, R + 0.03), z: -0.12 }); // trigger housing
  P.red.add(new THREE.CylinderGeometry(0.0065, 0.0065, 0.008, 14), PAINT.red, { ...onTube(0.62, R + 0.04), z: -0.125, wear: 'none', smooth: true }); // trigger button
  P.red.add(cbox(0.012, 0.006, 0.016, 0.0015), PAINT.red, { ...onTube(0.75, R + 0.03), z: -0.045 }); // safety catch
  // cocking lever: down the right side, its handle bent out at the back
  P.mech.add(cbox(0.006, 0.016, 0.12, 0.0015), PAINT.mech, { ...onTube(1.05, R + 0.008), z: 0.0 });
  P.mech.add(cbox(0.022, 0.016, 0.012, 0.002), PAINT.mech, { ...onTube(1.05, R + 0.018), z: 0.065 });
  // transport safety pin with its red tag (rear, right side)
  if (hi) { P.red.add(cbox(0.016, 0.026, 0.002, 0.0006), PAINT.red, { ...onTube(1.35, R + 0.012), z: 0.25 }); P.mech.add(new THREE.CylinderGeometry(0.0016, 0.0016, 0.03, 6), PAINT.mech, { ...onTube(1.2, R + 0.004), z: 0.25, wear: 'none', smooth: true }); }
  // ---- sights, top left: rear aperture leaf, front post in its guard (both popped up)
  const sa = Math.atan2(SIGHT.x, R); // angle of the sight base on the tube
  P.mech.add(cbox(0.03, 0.01, 0.05, 0.002), PAINT.mech, { ...onTube(sa, R + 0.004), z: 0.085 });
  // rear leaf: a plate standing up from its base with the peep drilled through it at the line of sight (a 4.5 mm
  // radius ghost ring: quick to find the post through, the blurred rim centres it)
  // (a narrow stem up from the base to a small plate round the peep: little of the view is hidden behind it)
  const leafB = Math.cos(sa) * R + 0.006, leafT = SIGHT.y + 0.008, leafW = 0.016, stem = 0.0045, plateB = SIGHT.y - 0.008;
  const leaf = new THREE.Shape().moveTo(-stem / 2, leafB).lineTo(stem / 2, leafB).lineTo(stem / 2, plateB).lineTo(leafW / 2, plateB)
    .lineTo(leafW / 2, leafT).lineTo(-leafW / 2, leafT).lineTo(-leafW / 2, plateB).lineTo(-stem / 2, plateB).closePath();
  leaf.holes.push(new THREE.Path().absarc(0, SIGHT.y, 0.0045, 0, Math.PI * 2, true));
  P.mech.add(new THREE.ExtrudeGeometry(leaf, { depth: 0.003, bevelEnabled: false, curveSegments: 16 }), PAINT.mech, { x: SIGHT.x, z: 0.0885, wear: 'none' });
  P.mech.add(cbox(0.03, 0.01, 0.04, 0.002), PAINT.mech, { ...onTube(sa, R + 0.004), z: -0.34 });
  const postH = SIGHT.y - Math.cos(sa) * R;
  P.mech.add(cbox(0.0028, postH, 0.003, 0.0006), PAINT.mech, { x: SIGHT.x, y: SIGHT.y - postH / 2, z: -0.345 }); // post, tip on the sight line
  for (const s of [-1, 1]) P.mech.add(cbox(0.003, postH + 0.01, 0.012, 0.0008), PAINT.mech, { x: SIGHT.x + s * 0.014, y: SIGHT.y - postH / 2 + 0.003, z: -0.345 }); // guard ears
  // ---- underneath: shoulder stop (rests on the shoulder), folding front grip, sling swivels
  P.mech.add(cbox(0.05, 0.03, 0.11, 0.006), PAINT.mech, { y: -R - 0.012, z: 0.16 });
  P.mech.add(cbox(0.04, 0.012, 0.05, 0.003), PAINT.mech, { y: -R - 0.004, z: -0.22 }); // grip hinge block
  P.mech.add(cbox(0.028, 0.11, 0.032, 0.006), PAINT.mech, { y: -R - 0.062, z: -0.225, rx: 0.12 }); // grip
  if (hi) for (const z of [-0.36, 0.33]) P.mech.add(new THREE.TorusGeometry(0.008, 0.0016, 6, 12), PAINT.mech, { y: -R - 0.008, z, ry: Math.PI / 2, wear: 'none', smooth: true });

  const MAT = (name, metalness, roughness) => new THREE.MeshStandardMaterial({ name, color: 0xffffff, vertexColors: true, metalness, roughness });
  const MATS = { body: MAT('launcher_fibre', 0, 0.74), rubber: MAT('launcher_rubber', 0, 0.9), mech: MAT('launcher_mech', 0.25, 0.62), dark: MAT('launcher_dark', 0, 0.95), red: MAT('launcher_red', 0.05, 0.55), mark: MAT('launcher_paint', 0, 0.7) };
  const root = new THREE.Group(); root.name = 'launcher';
  for (const [k, parts] of Object.entries(P)) { if (!parts.list.length) continue; const m = new THREE.Mesh(parts.merge(), MATS[k]); m.name = `launcher_${k}`; root.add(m); }
  // sockets: right hand round the firing mechanism (thumb on the trigger), left on the front grip, the shoulder
  // under the stop, muzzle / back blast at the tube ends, the eye 9 cm behind the rear aperture
  const sockets = { right_grip: [0.05, 0.012, -0.075], left_grip: [0, -0.1, -0.225], stock: [0, -0.075, 0.16], muzzle: [0, 0, -HALF - 0.065], back_blast: [0, 0, HALF + 0.065], optic_eye: [SIGHT.x, SIGHT.y, 0.18] };
  for (const [name, p] of Object.entries(sockets)) { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); root.add(o); }
  return root;
}

// detail maps: glass-fibre weave on the tube, rubber grain on the absorbers / grip
const N = 256;
const weave = fbm(N, { seed: 13, octaves: 4, base: 32, stretch: 3 }), grain = stipple(N, { seed: 5, count: 3200, rMin: 1, rMax: 2 }), wear = fbm(N, { seed: 8, octaves: 5, base: 5 });
const tubeNor = await webp(normalMap(weave, N, 0.9), N), tubeOrm = await webp(ormMap(wear, N, 0.82, 1.0, 0), N);
const rubNor = await webp(normalMap(grain, N, 1.6), N), rubOrm = await webp(ormMap(wear, N, 0.9, 1.0, 0), N);
const MAPS = {
  launcher_fibre: { normal: tubeNor, normalScale: 0.4, orm: tubeOrm },
  launcher_rubber: { normal: rubNor, normalScale: 0.6, orm: rubOrm },
  launcher_mech: { normal: rubNor, normalScale: 0.3, orm: tubeOrm },
};

for (const [lod, file, maps] of [['fp', 'launcher.glb', MAPS], ['tps', 'launcher_tps.glb', {}]]) {
  const root = build(lod);
  const glb = await exportGLB(new THREE.Scene().add(root), maps);
  const out = path.resolve('client/assets/weapons', file);
  fs.writeFileSync(out, glb);
  const s = stats(root);
  console.log(`wrote ${path.relative(process.cwd(), out)}  ${(glb.length / 1024).toFixed(1)} KB  length ${s.size.z.toFixed(3)} m  ${s.size.x.toFixed(3)} x ${s.size.y.toFixed(3)} m  tris ${s.tris}`);
}
