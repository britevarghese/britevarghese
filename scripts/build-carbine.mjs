// Builds client/assets/weapons/carbine.glb (+ carbine_tps.glb, a light LOD for other soldiers): a 5.56 mm
// M4A1-pattern carbine — 14.5" barrel with A2 birdcage flash hider, front sight base, quad-rail handguard, flat-top
// upper with ejection port / forward assist / brass deflector, lower with flared magwell, A2 grip, 6-position
// stock on the buffer tube, 30-round polymer magazine (FDE), Aimpoint-style red dot on a riser — modelled to
// real dimensions. Anodised aluminium, phosphated steel and stippled polymer: chamfered edges with the wear on
// them (vertex colour), procedural micro-normal / roughness maps (generated here, no external source).
// Moving parts are their own nodes (WeaponModel "action"): carbine_mag, carbine_charge (charging handle),
// carbine_cover (ejection-port dust cover, hinged at its lower edge), carbine_carrier (bolt carrier seen in the
// port). Sockets: rightGrip, leftGrip, stock, muzzle (+ reddot_lens / reddot_sight for the optic).
//   node scripts/build-carbine.mjs
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { Parts, cbox as cbox0, profile, tube, lin, fbm, stipple, normalMap, ormMap, webp, exportGLB, stats } from './weapon-kit.mjs';

// weapon space: -Z = muzzle, +Y = up, +X = right, metres; bore axis at y = 0
const PAINT = {
  alu: [lin(0x2d2e30), lin(0x6b6c70)],    // black hard-anodised aluminium, bare alloy on worn edges
  steel: [lin(0x2b2c2a), lin(0x56574f)],  // manganese-phosphated steel
  poly: [lin(0x252527), lin(0x38383a)],   // black glass-filled polymer, edges scuffed lighter
  rubber: [lin(0x1c1c1d), lin(0x262627)],
  fde: [lin(0x9b8462), lin(0xb4a07e)],    // flat dark earth polymer magazine
  dark: [lin(0x0b0b0b), lin(0x0b0b0b)],   // bore, port interior
};

function build(lod) {
  const hi = lod === 'fp';
  const seg = hi ? 20 : 8;
  // (the LOD for other soldiers: plain boxes, fewer facets, no small parts)
  const cbox = (w, h, d, c) => (hi ? cbox0(w, h, d, c) : new THREE.BoxGeometry(w, h, d));
  const P = { alu: new Parts(6), steel: new Parts(6), poly: new Parts(30), dark: new Parts(6) };
  const nodes = { mag: new Parts(34), charge: new Parts(6), cover: new Parts(6), carrier: new Parts(6) };
  const A = (g, o) => P.alu.add(g, PAINT.alu, o), S = (g, o) => P.steel.add(g, PAINT.steel, o), Y = (g, o) => P.poly.add(g, PAINT.poly, o);
  const D = (g, o) => P.dark.add(g, PAINT.dark, o);

  // ---- barrel group: muzzle at z = -0.506
  // A2 birdcage: solid rear, front ring, slots between the prongs, closed bottom (no dust kick-up when prone)
  S(tube(0.0105, 0.02, seg), { z: -0.462, wear: 'none', smooth: true });
  S(tube(0.0108, 0.008, seg, 0.0058), { z: -0.502 });
  const prongs = hi ? 6 : 3;
  for (let i = 0; i < prongs; i++) {
    const a = Math.PI / 2 + (i - (prongs - 1) / 2) * (Math.PI * 1.25 / (prongs - 1 || 1));
    S(cbox(0.0042, 0.0032, 0.03, 0.0006), { x: Math.cos(a) * 0.0091, y: Math.sin(a) * 0.0091, z: -0.483, rz: a + Math.PI / 2 });
  }
  S(new THREE.CylinderGeometry(0.0098, 0.0098, 0.03, seg, 1, true, Math.PI * 0.75, Math.PI * 0.5).rotateX(Math.PI / 2), { z: -0.483, wear: 'none', smooth: true }); // closed bottom
  D(tube(0.0058, 0.05, 10), { z: -0.48, wear: 'none' });                               // bore / inside of the cage
  S(tube(0.0079, 0.09, seg), { z: -0.407, wear: 'none', smooth: true });              // M4 profile, ahead of the FSB
  S(tube(0.0095, 0.3, seg), { z: -0.205, wear: 'none', smooth: true });               // under the handguard
  // front sight base (A-frame) with the gas block, bayonet lug and sling swivel
  S(cbox(0.026, 0.026, 0.034, 0.002), { y: 0.002, z: -0.355 });
  S(cbox(0.016, 0.012, 0.02, 0.0015), { y: -0.019, z: -0.36 });                       // bayonet lug
  for (const sx of [-1, 1]) S(cbox(0.006, 0.05, 0.016, 0.001), { x: sx * 0.0085, y: 0.034, z: -0.355, rz: sx * 0.16 });
  S(cbox(0.026, 0.006, 0.016, 0.001), { y: 0.058, z: -0.355 });                       // A-frame top (sight hood)
  S(cbox(0.0028, 0.022, 0.0028, 0.0004), { y: 0.05, z: -0.355 });                     // front sight post
  S(new THREE.TorusGeometry(0.008, 0.0015, 6, 14), { y: -0.03, z: -0.345, ry: Math.PI / 2, wear: 'none' });

  // ---- quad-rail handguard z -0.335 .. -0.075: octagonal core, four Picatinny rails
  A(new THREE.CylinderGeometry(0.0225, 0.0225, 0.26, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8), { z: -0.205 });
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2, cx = Math.sin(a), cy = Math.cos(a);
    A(cbox(0.0212, 0.006, 0.26, 0.0012), { x: cx * 0.0245, y: cy * 0.0245, z: -0.205, rz: -a });
    if (hi) for (let z = -0.33; z < -0.08; z += 0.01) A(new THREE.BoxGeometry(0.0212, 0.0035, 0.0053), { x: cx * 0.0292, y: cy * 0.0292, z, rz: -a });
  }
  A(cbox(0.06, 0.006, 0.012, 0.002), { y: 0, z: -0.33 });                             // rail end cap
  // delta ring + barrel nut
  A(tube(0.0285, 0.014, seg), { z: -0.068, wear: 'none', smooth: true });
  S(tube(0.0175, 0.02, seg), { z: -0.052, wear: 'none', smooth: true });

  // ---- upper receiver z -0.05 .. 0.12; ejection port on the right z -0.005 .. 0.05, y -0.007 .. 0.012
  A(cbox(0.024, 0.036, 0.17, 0.0016), { x: -0.003, y: 0.006, z: 0.035 });              // body (left part)
  A(cbox(0.007, 0.012, 0.17, 0.0012), { x: 0.0115, y: 0.018, z: 0.035 });              // right wall above the port
  A(cbox(0.007, 0.012, 0.17, 0.0012), { x: 0.0115, y: -0.0065, z: 0.035 }, 0);          // below the port
  A(cbox(0.007, 0.03, 0.045, 0.0012), { x: 0.0115, y: 0.006, z: -0.028 });              // ahead of the port
  A(cbox(0.007, 0.03, 0.07, 0.0012), { x: 0.0115, y: 0.006, z: 0.085 });               // behind the port
  D(cbox(0.004, 0.019, 0.056, 0.0004), { x: 0.0095, y: 0.0025, z: 0.0225, wear: 'none' }); // port shadow
  A(cbox(0.009, 0.016, 0.013, 0.002), { x: 0.0165, y: 0.012, z: 0.058 });              // brass deflector
  A(tube(0.0072, 0.022, 12), { x: 0.0175, y: 0.004, z: 0.094, ry: 0.55 });               // forward assist housing
  S(tube(0.0058, 0.008, 12), { x: 0.0255, y: 0.004, z: 0.1, ry: 0.55 });                // its button
  // flat-top rail
  A(cbox(0.0212, 0.006, 0.168, 0.0012), { y: 0.027, z: 0.034 });
  if (hi) for (let z = -0.044; z < 0.118; z += 0.01) A(new THREE.BoxGeometry(0.0212, 0.0035, 0.0053), { y: 0.0315, z });
  // folded back-up iron sight at the rear of the rail
  A(cbox(0.02, 0.009, 0.026, 0.0015), { y: 0.0355, z: 0.104 });

  // ---- lower receiver: side profile with the flared magwell and the buffer tower
  A(profile([[-0.036, -0.012], [0.12, -0.012], [0.12, 0.016], [0.142, 0.016], [0.142, -0.03], [0.124, -0.048], [0.046, -0.048], [0.046, -0.076], [-0.036, -0.076]], 0.03, 0.0012, 2), { wear: 'bevel' });
  A(cbox(0.034, 0.009, 0.086, 0.002), { y: -0.0725, z: 0.005 });                      // magwell flare
  S(tube(0.0042, 0.004, 10), { x: 0.0165, y: -0.038, z: 0.003, ry: Math.PI / 2 });      // magazine release
  S(cbox(0.003, 0.008, 0.02, 0.0006), { x: -0.0165, y: -0.026, z: 0.03 });             // bolt catch paddle
  S(cbox(0.003, 0.006, 0.022, 0.0006), { x: -0.0165, y: -0.022, z: 0.096, rx: -0.5 });  // safety selector
  if (hi) for (const z of [-0.028, 0.108]) for (const sx of [-1, 1]) S(tube(0.0032, 0.002, 8), { x: sx * 0.0158, y: -0.02, z, ry: Math.PI / 2 }); // takedown / pivot pins
  A(cbox(0.022, 0.0045, 0.058, 0.0012), { y: -0.0705, z: 0.074 });                     // trigger guard
  A(cbox(0.022, 0.024, 0.005, 0.0012), { y: -0.059, z: 0.047 });
  S(cbox(0.0042, 0.021, 0.005, 0.0008), { y: -0.057, z: 0.068, rx: -0.28 });          // trigger

  // ---- A2 pistol grip (raked ~22 deg, finger nub), stippled polymer
  Y(profile([[0.091, -0.048], [0.097, -0.068], [0.093, -0.08], [0.101, -0.092], [0.116, -0.138], [0.126, -0.147], [0.149, -0.141], [0.139, -0.1], [0.129, -0.064], [0.132, -0.048]], 0.026, 0.004, 2), { wear: 'bevel', uv: 30 });

  // ---- buffer tube + castle nut + 6-position stock with rubber butt pad
  A(tube(0.0146, 0.2, seg), { y: -0.002, z: 0.24, wear: 'none', smooth: true });
  S(tube(0.0175, 0.008, seg), { y: -0.002, z: 0.146, wear: 'none', smooth: true });
  Y(profile([[0.205, 0.0175], [0.335, 0.022], [0.352, 0.03], [0.358, 0.03], [0.358, -0.09], [0.346, -0.096], [0.3, -0.058], [0.245, -0.034], [0.205, -0.026]], 0.04, 0.0035, 2), { wear: 'bevel', uv: 30 });
  P.poly.add(cbox(0.043, 0.126, 0.012, 0.003), PAINT.rubber, { y: -0.032, z: 0.364 });  // butt pad
  Y(cbox(0.014, 0.008, 0.05, 0.002), { y: -0.034, z: 0.235 });                          // adjustment lever
  for (let i = 0; i < (hi ? 4 : 0); i++) Y(cbox(0.042, 0.004, 0.008, 0.0012), { y: -0.04 - i * 0.012, z: 0.335 - i * 0.008 }); // grip ribs on the toe
  // the stock's sides are not flat slabs: a raised spine along the tube and two recessed-looking ribs across
  if (hi) for (const sx of [-1, 1]) {
    Y(cbox(0.003, 0.012, 0.12, 0.001), { x: sx * 0.0205, y: 0.008, z: 0.275 });
    for (const [y, z, l] of [[-0.022, 0.29, 0.07], [-0.048, 0.318, 0.045]]) Y(cbox(0.003, 0.005, l, 0.0012), { x: sx * 0.0205, y, z, rx: 0.42 });
  }
  if (hi) Y(new THREE.TorusGeometry(0.009, 0.0018, 6, 14), { y: -0.07, z: 0.352, ry: Math.PI / 2, wear: 'none' }); // sling loop

  // ---- red dot (CompM4-style tube) on a riser mount: sight axis 0.072 above the bore
  const SIGHT_Y = 0.072, SIGHT_Z = 0.045;
  A(cbox(0.03, 0.022, 0.044, 0.002), { y: 0.0405, z: SIGHT_Z });                       // riser
  A(cbox(0.022, 0.012, 0.03, 0.002), { y: 0.057, z: SIGHT_Z });
  A(cbox(0.006, 0.01, 0.018, 0.0015), { x: -0.018, y: 0.04, z: SIGHT_Z });              // throw lever
  A(tube(0.0178, 0.075, seg + 4, 0.0146), { y: SIGHT_Y, z: SIGHT_Z });                   // body
  A(tube(0.0198, 0.012, seg + 4, 0.0146), { y: SIGHT_Y, z: SIGHT_Z - 0.04 });            // lens rings
  A(tube(0.0198, 0.012, seg + 4, 0.0146), { y: SIGHT_Y, z: SIGHT_Z + 0.04 });
  A(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 14), { y: SIGHT_Y + 0.022, z: SIGHT_Z, wear: 'none', smooth: true }); // elevation turret
  A(new THREE.CylinderGeometry(0.0075, 0.0075, 0.012, 14), { x: 0.022, y: SIGHT_Y, z: SIGHT_Z, rz: Math.PI / 2, wear: 'none', smooth: true });
  A(tube(0.0085, 0.03, 14), { x: 0.0215, y: SIGHT_Y - 0.009, z: SIGHT_Z + 0.012, wear: 'none', smooth: true }); // battery housing

  // ---- moving parts (own nodes)
  // 30-round polymer magazine (curved), top inside the magwell at y = -0.02
  nodes.mag.add(profile([[0.04, -0.02], [0.04, -0.08], [0.036, -0.12], [0.026, -0.168], [0.011, -0.212], [0.005, -0.224], [-0.055, -0.209], [-0.06, -0.198], [-0.047, -0.15], [-0.036, -0.1], [-0.032, -0.062], [-0.032, -0.02]], 0.0235, 0.0018), PAINT.fde, { wear: 'bevel' });
  nodes.mag.add(cbox(0.027, 0.009, 0.068, 0.002), PAINT.fde, { y: -0.221, z: -0.025, rx: -0.24 }); // floor plate
  if (hi) for (let i = 0; i < 3; i++) nodes.mag.add(cbox(0.0255, 0.003, 0.05, 0.001), PAINT.fde, { y: -0.155 - i * 0.012, z: -0.008 - i * 0.004, rx: -0.2, wear: 'none' }); // grip ribs
  // charging handle (T latch at the rear of the upper)
  nodes.charge.add(cbox(0.036, 0.008, 0.012, 0.0018), PAINT.alu, { y: 0.0215, z: 0.137 });
  nodes.charge.add(cbox(0.012, 0.007, 0.03, 0.0012), PAINT.alu, { y: 0.021, z: 0.12 });
  nodes.charge.add(cbox(0.006, 0.006, 0.012, 0.001), PAINT.alu, { x: -0.016, y: 0.024, z: 0.134 }); // latch
  // dust cover: hinged on its lower edge (node origin), swings down and out
  nodes.cover.add(cbox(0.0016, 0.0195, 0.057, 0.0005), PAINT.steel, { x: 0, y: 0.0098, z: 0 });
  // bolt carrier seen through the port
  nodes.carrier.add(tube(0.0118, 0.12, 14), PAINT.steel, { z: 0.035, wear: 'none', smooth: true });
  nodes.carrier.add(cbox(0.006, 0.008, 0.012, 0.001), PAINT.steel, { x: 0.006, y: 0.005, z: -0.006 }); // extractor

  const MATS = {
    alu: new THREE.MeshStandardMaterial({ name: 'anodized_aluminium', color: 0xffffff, vertexColors: true, metalness: 0.18, roughness: 0.58 }),
    steel: new THREE.MeshStandardMaterial({ name: 'phosphate_steel', color: 0xffffff, vertexColors: true, metalness: 0.45, roughness: 0.62 }),
    poly: new THREE.MeshStandardMaterial({ name: 'polymer', color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.78 }),
    dark: new THREE.MeshStandardMaterial({ name: 'port_dark', color: 0xffffff, vertexColors: true, metalness: 0.3, roughness: 0.8 }),
    mag: new THREE.MeshStandardMaterial({ name: 'magazine_polymer', color: 0xffffff, vertexColors: true, metalness: 0, roughness: 0.82 }),
  };
  const root = new THREE.Group(); root.name = 'carbine';
  for (const [k, parts] of Object.entries(P)) { const m = new THREE.Mesh(parts.merge(), MATS[k]); m.name = `carbine_${k}`; root.add(m); }
  const node = (name, parts, mat, pos = [0, 0, 0]) => { const m = new THREE.Mesh(parts.merge(), mat); m.name = name; m.position.set(...pos); root.add(m); return m; };
  node('carbine_mag', nodes.mag, MATS.mag);
  node('carbine_charge', nodes.charge, MATS.alu);
  node('carbine_cover', nodes.cover, MATS.steel, [0.0152, -0.0072, 0.0225]);
  node('carbine_carrier', nodes.carrier, MATS.steel, [0.0015, 0.003, 0]);
  const lensMat = new THREE.MeshStandardMaterial({ name: 'reddot_glass', color: 0x9fb8c0, transparent: true, opacity: 0.3, roughness: 0.05 });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.0148, 0.0148, 0.002, 24).rotateX(Math.PI / 2), lensMat);
  lens.name = 'reddot_lens'; lens.position.set(0, SIGHT_Y, SIGHT_Z + 0.03); root.add(lens);
  const sight = new THREE.Object3D(); sight.name = 'reddot_sight'; sight.position.set(0, SIGHT_Y, SIGHT_Z); root.add(sight);
  // sockets — hands on the pistol grip and under the handguard, shoulder on the butt pad
  // (+ action sockets: ejection port, where the support hand hooks the charging handle)
  const sockets = { rightGrip: [0, -0.078, 0.108], leftGrip: [0, -0.024, -0.215], stock: [0, -0.02, 0.37], muzzle: [0, 0, -0.506], eject_port: [0.019, 0.003, 0.022], charge_grip: [-0.008, 0.027, 0.141] };
  for (const [name, p] of Object.entries(sockets)) { const o = new THREE.Object3D(); o.name = name; o.position.set(...p); root.add(o); }
  return root;
}

// detail maps: fine grain on the metal (micro-normal + roughness variation), stipple on the polymer
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

for (const [lod, file, maps] of [['fp', 'carbine.glb', MAPS], ['tps', 'carbine_tps.glb', {}]]) {
  const root = build(lod);
  const scene = new THREE.Scene(); scene.add(root);
  const glb = await exportGLB(scene, maps);
  const out = path.resolve('client/assets/weapons', file);
  fs.writeFileSync(out, glb);
  const s = stats(root);
  console.log(`wrote ${path.relative(process.cwd(), out)}  ${(glb.length / 1024).toFixed(1)} KB  length ${s.size.z.toFixed(3)} m  height ${s.size.y.toFixed(3)} m  tris ${s.tris}`);
}
