// Assembles a complete vehicle (body, glass, lights, trim, add-ons, interior) from a spec.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CarSurface, buildSurface, buildPatch, clamp01 } from './loft.mjs';

export const M = {
  paint: 0, glass: 1, trim: 2, under: 3, chrome: 4,
};

export function makeMaterials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ name: 'paint', color: 0xb01020, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04 }),
    glass: new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x0a0e12, metalness: 0.3, roughness: 0.03, transparent: true, opacity: 0.86 }),
    trim: new THREE.MeshStandardMaterial({ name: 'trim', color: 0x0d0e10, metalness: 0.1, roughness: 0.55 }),
    under: new THREE.MeshStandardMaterial({ name: 'under', color: 0x050506, metalness: 0.0, roughness: 0.95 }),
    chrome: new THREE.MeshStandardMaterial({ name: 'chrome', color: 0xdfe3e8, metalness: 1.0, roughness: 0.12 }),
    headlight: new THREE.MeshStandardMaterial({ name: 'headlight', color: 0xe8eef5, metalness: 0.3, roughness: 0.1, emissive: 0xfff4e0, emissiveIntensity: 1 }),
    taillight: new THREE.MeshStandardMaterial({ name: 'taillight', color: 0x3a0306, metalness: 0.2, roughness: 0.15, emissive: 0xff1020, emissiveIntensity: 1 }),
    lightbarRed: new THREE.MeshStandardMaterial({ name: 'lightbar_red', color: 0x400008, roughness: 0.2, emissive: 0xff0820, emissiveIntensity: 1 }),
    lightbarBlue: new THREE.MeshStandardMaterial({ name: 'lightbar_blue', color: 0x000a40, roughness: 0.2, emissive: 0x1040ff, emissiveIntensity: 1 }),
    interior: new THREE.MeshStandardMaterial({ name: 'interior', color: 0x151515, metalness: 0.0, roughness: 0.8 }),
    carbon: new THREE.MeshStandardMaterial({ name: 'carbon', color: 0x121314, metalness: 0.4, roughness: 0.35 }),
  };
}

// Panel lines, door/hood/trunk shut lines, handles and window trim in body UV space
// (u = t along the car, v = cross-section parameter / 10). Rendered at runtime into the paint map.
export function panelLayout(spec) {
  const S = new CarSurface(spec);
  const L = spec.length;
  const gk = spec.greenhouse;
  const firstFull = gk.find((k) => k[1] >= 1)?.[0] ?? 0.4;
  const lastFull = [...gk].reverse().find((k) => k[1] >= 1)?.[0] ?? 0.6;
  const slopeEnd = gk[gk.length - 1][1] === 0 ? gk[gk.length - 1][0] : 1;
  const slopeStart = (() => { const i = gk.findIndex((k) => k[1] > 0); return i > 0 ? gk[i - 1][0] : 0; })();
  const fw = spec.wheels.find((w) => w.id === 'FL'), rw = spec.wheels.find((w) => w.id === 'RL');
  const ft = fw.z / L + 0.5, rt = rw.z / L + 0.5;
  const lines = [], rects = [], trims = [];
  const V = (v) => v / 10;
  if (spec.cargo || spec.busWindows) {
    // commercial vehicles: cab door + panel seams
    const cabDoor = spec.cargo ? [spec.cargo[1] + 0.02, ft - (fw.r + 0.2) / L] : [0.9, 0.97];
    lines.push([cabDoor[0], V(3), cabDoor[0], V(7)], [cabDoor[1], V(3), cabDoor[1], V(7)]);
    if (spec.cargo) for (let k = 1; k < 5; k++) { const t = spec.cargo[0] + (spec.cargo[1] - spec.cargo[0]) * k / 5; lines.push([t, V(2.9), t, V(9.8)]); }
    return { lines, rects, trims, width: 1024, height: 512 };
  }
  const doorF = Math.min(ft - (fw.r + 0.22) / L, slopeEnd - 0.02);
  const doorR = spec.bPillar > 0 ? spec.bPillar : Math.max(firstFull, rt + (rw.r + 0.3) / L);
  const fourDoor = spec.class === 'traffic' || spec.class === 'police';
  // front door (and rear door on sedans/SUVs)
  lines.push([doorF, V(2.9), doorF, V(6.95)], [doorR, V(2.9), doorR, V(6.95)], [doorR, V(2.9), doorF, V(2.9)]);
  rects.push([doorR + 0.018, V(6.35), doorR + 0.045, V(6.55)]); // handle
  if (fourDoor) {
    const rearDoorR = Math.max(rt + (rw.r + 0.2) / L, firstFull - 0.02);
    lines.push([rearDoorR, V(2.9), rearDoorR, V(6.95)], [rearDoorR, V(2.9), doorR, V(2.9)]);
    rects.push([rearDoorR + 0.018, V(6.35), rearDoorR + 0.045, V(6.55)]);
  }
  // hood: shut line across the base of the windshield + along the fender tops
  const hoodBack = slopeEnd + 0.01;
  lines.push([hoodBack, V(7.15), hoodBack, V(10)], [hoodBack, V(7.15), 0.975, V(7.15)]);
  // trunk / hatch
  const trunkT = spec.fastback || spec.class === 'tuner' ? Math.max(0.03, slopeStart - 0.01) : Math.max(0.04, slopeStart);
  lines.push([trunkT, V(7.1), trunkT, V(10)], [0.02, V(7.1), trunkT, V(7.1)]);
  // front bumper / rear bumper seams
  lines.push([0.955, V(2.9), 0.955, V(5.0)], [0.045, V(2.9), 0.045, V(5.0)]);
  // fuel cap
  rects.push([rt + (rw.r + 0.15) / L, V(6.05), rt + (rw.r + 0.23) / L, V(6.4), 'round']);
  // black window surround (belt molding + roof rail) over the cabin
  trims.push([slopeStart, V(6.85), slopeEnd, V(7.0)]);
  if (lastFull - firstFull > 0.02) trims.push([firstFull, V(8.0), lastFull, V(8.2)]);
  void S;
  return { lines, rects, trims, width: 1024, height: 512 };
}

export function buildCar(spec, mats, lod = 0) {
  const S = new CarSurface(spec);
  const root = new THREE.Group();
  root.name = lod === 0 ? 'lod0' : 'lod1';

  // windshield/rear-window regions, derived from the greenhouse keyframes
  const gk = spec.greenhouse;
  const firstFull = gk.find((k) => k[1] >= 1)?.[0] ?? 0;
  const lastFull = [...gk].reverse().find((k) => k[1] >= 1)?.[0] ?? 1;
  const cabinMid = (firstFull + lastFull) / 2;

  const classify = (t, v) => {
    const g = clamp01(S.green(t));
    if (v < 1.9) return M.under;
    if (v < 2.8) return spec.boxy ? M.trim : M.trim;
    if (v < 7) return M.paint;
    if (spec.cargo && t >= spec.cargo[0] && t <= spec.cargo[1]) return M.paint;
    if (g < 0.04) return M.paint;
    const slope = g < 0.97;
    const front = t > cabinMid;
    if (spec.busWindows) {
      if (v < 8) return (Math.floor(t * 46) % 5 === 0) ? M.trim : M.glass;
      if (t > 0.992 && v >= 8) return M.glass;
      return M.paint;
    }
    if (slope) {
      if (!front && !spec.rearSideGlass && v < 8.3) return M.paint;
      if (!front && spec.cPillar && v < 8.34) return M.paint;
      if (v > 7.66 && v < 8.34) return M.trim; // A/C pillar in black
      if (!front && spec.engineCover && v >= 8.34) return M.trim; // louvred engine cover
      return M.glass;
    }
    // full-height cabin
    if (v < 8) {
      if (spec.sideGlassFrom !== undefined && t < spec.sideGlassFrom) return M.paint;
      if (spec.bPillar > 0 && Math.abs(t - spec.bPillar) < 0.014) return M.trim;
      return M.glass;
    }
    return M.paint;
  };

  const res = lod === 0 ? { nT: spec.length > 6 ? 90 : 64, vSub: 3 } : { nT: spec.length > 6 ? 40 : 26, vSub: 1 };
  // baked ambient occlusion: darker toward the sills/underside and inside the wheel arches
  const ao = (t, v, p) => {
    let a = 0.45 + 0.55 * Math.min(1, Math.max(0, (v - 1.6) / 2.6));
    for (const w of spec.wheels) {
      const d = Math.hypot(p.z - w.z, p.y - w.y);
      if (d < w.r + 0.35) a *= 0.55 + 0.45 * Math.min(1, Math.max(0, (d - w.r) / 0.35));
    }
    return Math.max(0.3, Math.min(1, a));
  };
  const { geo } = buildSurface(S, { ...res, classify, ao });
  const bodyMats = [mats.paint, mats.glass, mats.trim, mats.under, mats.chrome];
  const body = new THREE.Mesh(geo, bodyMats);
  body.name = 'body';
  root.add(body);

  // ---- lights (surface patches) ----
  const pd = lod === 0 ? { nT: 6, nV: 5 } : { nT: 2, nV: 2 };
  const head = new THREE.Mesh(buildPatch(S, { ...spec.head, ...pd, lift: 0.006 }), mats.headlight);
  head.name = 'headlights';
  root.add(head);
  const tail = new THREE.Mesh(buildPatch(S, { ...spec.tail, ...pd, lift: 0.006 }), mats.taillight);
  tail.name = 'taillights';
  root.add(tail);
  const grilleGeo = buildPatch(S, { ...spec.grille, nT: 3, nV: 4, lift: 0.004, side: 'right' });
  const grilleGeoL = buildPatch(S, { ...spec.grille, nT: 3, nV: 4, lift: 0.004, side: 'left' });
  const grille = new THREE.Mesh(mergeGeometries([grilleGeo, grilleGeoL]), mats.trim);
  grille.name = 'grille';
  root.add(grille);

  // ---- markers (empties) used by the game ----
  const marker = (name, x, y, z) => { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); root.add(o); return o; };
  for (const w of spec.wheels) {
    const sec = S.section(w.z / spec.length + 0.5);
    const halfW = sec[4][0];
    marker('wheel_' + w.id, w.side * (halfW - w.w / 2 - 0.015), w.y, w.z);
  }
  const hp = S.normal((spec.head.t0 + spec.head.t1) / 2, (spec.head.v0 + spec.head.v1) / 2, 1).p;
  marker('light_head_L', hp.x, hp.y, hp.z);
  marker('light_head_R', -hp.x, hp.y, hp.z);
  const tp = S.normal((spec.tail.t0 + spec.tail.t1) / 2, (spec.tail.v0 + spec.tail.v1) / 2, 1).p;
  marker('light_tail_L', tp.x, tp.y, tp.z);
  marker('light_tail_R', -tp.x, tp.y, tp.z);
  (spec.exhaust || []).forEach((e, i) => marker('exhaust_' + i, e.x, e.y, e.z));
  const roofT = (firstFull + lastFull) / 2;
  const roofY = S.point(roofT, 10).y;
  marker('roof', 0, roofY, S.z(roofT));
  marker('eye_cockpit', 0.36, spec.eyeY ?? roofY - 0.25, spec.seatZ ?? 0);
  marker('eye_hood', 0, S.point(0.8, 10).y + 0.28, spec.hoodEyeZ ?? spec.length * 0.2);
  marker('eye_bumper', 0, 0.55, spec.length / 2 + 0.05);

  if (lod === 0) {
    // exhaust tips
    const tipGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.14, 14, 1, true).rotateX(Math.PI / 2);
    const tips = (spec.exhaust || []).filter((e) => e.z < 0).map((e) => tipGeo.clone().translate(e.x, e.y, e.z + 0.05));
    if (tips.length) { const m = new THREE.Mesh(mergeGeometries(tips), mats.chrome); m.name = 'exhaust_tips'; root.add(m); }

    // mirrors
    if (spec.class !== 'traffic' || spec.name === 'Sedan' || spec.name === 'SUV' || spec.name === 'Van') {
      const tm = firstFull < 0.5 ? lastFull + 0.02 : lastFull;
      const sec = S.section(tm);
      const base = S.point(tm, 7);
      const mirror = [];
      for (const side of [1, -1]) {
        const g = new THREE.SphereGeometry(1, 12, 8);
        g.scale(0.085, 0.05, 0.035);
        g.translate(side * (base.x + 0.14), base.y + 0.06, base.z);
        mirror.push(g);
        const arm = new THREE.BoxGeometry(0.12, 0.02, 0.05).translate(side * (base.x + 0.05), base.y + 0.04, base.z);
        mirror.push(arm);
      }
      const m = new THREE.Mesh(mergeGeometries(mirror), mats.paint); m.name = 'mirrors'; root.add(m);
      void sec;
    }

    if (spec.class !== 'traffic') addInterior(root, S, spec, mats);
    if (['sports', 'muscle', 'exotic', 'tuner'].includes(spec.class)) addBodyKits(root, S, spec, mats);
    if (spec.lightbar) addLightbar(root, S, spec, mats, roofY, S.z(roofT));
    if (spec.pushBar) {
      const z = spec.length / 2 + 0.05;
      const parts = [
        new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(0.35, 0.55, z),
        new THREE.BoxGeometry(0.06, 0.45, 0.06).translate(-0.35, 0.55, z),
        new THREE.BoxGeometry(0.9, 0.06, 0.06).translate(0, 0.72, z + 0.02),
        new THREE.BoxGeometry(0.9, 0.06, 0.06).translate(0, 0.45, z + 0.02),
      ];
      const m = new THREE.Mesh(mergeGeometries(parts), mats.trim); m.name = 'pushbar'; root.add(m);
    }
    if (spec.cargo) {
      // ribbed cargo box rear doors & side rub rails
      const z0 = S.z(spec.cargo[0]);
      const parts = [];
      for (let i = 0; i < 3; i++) parts.push(new THREE.BoxGeometry(spec.width + 0.02, 0.05, 5.1).translate(0, 1.3 + i * 0.6, S.z((spec.cargo[0] + spec.cargo[1]) / 2)));
      parts.push(new THREE.BoxGeometry(spec.width - 0.1, 2.2, 0.03).translate(0, 1.95, z0 + 0.03));
      const m = new THREE.Mesh(mergeGeometries(parts), mats.chrome); m.name = 'cargo_trim'; root.add(m);
    }
  }
  // every mesh carries vertex colors (AO) so each material has a single vertex-color variant
  root.traverse((o) => {
    if (!o.isMesh || o.geometry.attributes.color) return;
    const n = o.geometry.attributes.position.count;
    o.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  });
  return root;
}

function addInterior(root, S, spec, mats) {
  const cab = (a, b) => a + b;
  void cab;
  const floorY = 0.3;
  const parts = [];
  const seatZ = spec.seatZ ?? 0;
  for (const x of [0.36, -0.36]) {
    const seat = new THREE.BoxGeometry(0.46, 0.12, 0.5).translate(x, floorY + 0.12, seatZ);
    const back = new THREE.BoxGeometry(0.46, 0.6, 0.12).rotateX(-0.25).translate(x, floorY + 0.45, seatZ - 0.3);
    parts.push(seat, back);
  }
  const dashZ = seatZ + 0.85;
  parts.push(new THREE.BoxGeometry(spec.width * 0.82, 0.22, 0.4).translate(0, (spec.eyeY ?? 1) - 0.32, dashZ));
  parts.push(new THREE.BoxGeometry(0.2, 0.25, 1.0).translate(0, floorY + 0.12, seatZ + 0.3));
  const m = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), mats.interior);
  m.name = 'interior';
  root.add(m);
  const wheel = new THREE.TorusGeometry(0.18, 0.022, 8, 24).rotateX(-0.35);
  wheel.translate(0.36, (spec.eyeY ?? 1) - 0.3, dashZ - 0.28);
  const sw = new THREE.Mesh(wheel, mats.trim); sw.name = 'steering_wheel'; root.add(sw);
}

function airfoil(chord, thick) {
  const s = new THREE.Shape();
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const x = i / n; // upper surface
    const y = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    if (i === 0) s.moveTo(x * chord, y * chord); else s.lineTo(x * chord, y * chord);
  }
  for (let i = n; i >= 0; i--) {
    const x = i / n;
    const y = -2.2 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    s.lineTo(x * chord, y * chord);
  }
  return s;
}

function addBodyKits(root, S, spec, mats) {
  const deckT = 0.035;
  const deck = S.point(deckT, 10);
  const deckZ = deck.z;
  const width = spec.width;
  // spoiler variants ----------------------------------------------------------------
  // 1: ducktail lip
  {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0); shape.lineTo(0.22, 0); shape.quadraticCurveTo(0.26, 0.02, 0.26, 0.06); shape.lineTo(0.0, 0.015); shape.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(shape, { depth: width * 0.78, bevelEnabled: false });
    g.translate(0, 0, -width * 0.39).rotateY(Math.PI / 2);
    g.translate(0, S.point(0.06, 10).y - 0.012, S.z(0.075));
    const m = new THREE.Mesh(g, mats.paint); m.name = 'spoiler_1'; root.add(m);
  }
  // 2: street wing; 3: GT wing
  for (const [id, h, chord, span, mat] of [[2, 0.14, 0.26, width * 0.84, mats.paint], [3, 0.34, 0.34, width * 0.98, mats.carbon]]) {
    const parts = [];
    const wing = new THREE.ExtrudeGeometry(airfoil(chord, 0.13), { depth: span, bevelEnabled: false, curveSegments: 4 });
    wing.translate(0, 0, -span / 2); // x = chord, y = thickness, z = span
    wing.rotateY(Math.PI / 2);        // x = span, z = -chord
    wing.rotateX(-0.08);
    const y = S.point(deckT + 0.03, 10).y + h;
    const z = deckZ + 0.16 + chord * 0.2;
    wing.translate(0, y, z);
    parts.push(wing.toNonIndexed());
    // uprights
    for (const x of [span * 0.32, -span * 0.32]) {
      const up = new THREE.BoxGeometry(0.025, h + 0.04, 0.16).translate(x, y - h / 2, z - 0.12);
      parts.push(up.toNonIndexed());
    }
    // end plates
    for (const x of [span / 2, -span / 2]) {
      const ep = new THREE.BoxGeometry(0.012, 0.13 + h * 0.2, chord + 0.06).translate(x, y + 0.01, z - chord / 2);
      parts.push(ep.toNonIndexed());
    }
    for (const p of parts) p.deleteAttribute('uv');
    const m = new THREE.Mesh(mergeGeometries(parts), mat); m.name = 'spoiler_' + id; root.add(m);
  }

  // hood variants ------------------------------------------------------------------
  // 1: power bulge scoop (surface patch lifted)
  {
    const g = buildPatch(S, { t0: 0.72, t1: 0.88, v0: 9.2, v1: 10, nT: 10, nV: 3, lift: 0.0, side: 'both' });
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i), x = p.getX(i);
      const tt = (z / spec.length + 0.5 - 0.72) / 0.16;
      const bump = Math.sin(Math.PI * Math.min(1, tt * 1.4)) * 0.06 * Math.max(0, 1 - Math.abs(x) / 0.4);
      p.setY(i, p.getY(i) + bump + 0.004);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats.paint); m.name = 'hood_1'; root.add(m);
    const intake = new THREE.BoxGeometry(0.42, 0.05, 0.03).translate(0, S.point(0.855, 10).y + 0.05, S.z(0.855));
    const mi = new THREE.Mesh(intake, mats.trim); mi.name = 'hood_1_intake'; root.add(mi);
  }
  // 2: twin heat-extractor vents
  {
    const vents = [];
    for (const side of [1, -1]) {
      const g = buildPatch(S, { t0: 0.74, t1: 0.8, v0: 9.0, v1: 9.6, nT: 2, nV: 2, lift: 0.005, side: side > 0 ? 'right' : 'left' });
      vents.push(g);
    }
    const m = new THREE.Mesh(mergeGeometries(vents), mats.carbon); m.name = 'hood_2'; root.add(m);
  }
  // 3: carbon hood (full hood patch)
  {
    const g = buildPatch(S, { t0: S.green ? 0.7 : 0.7, t1: 0.955, v0: 8.0, v1: 10, nT: 12, nV: 4, lift: 0.003, side: 'both' });
    const m = new THREE.Mesh(g, mats.carbon); m.name = 'hood_3'; root.add(m);
  }

  // aero bumper kit -----------------------------------------------------------------
  {
    const parts = [];
    const fz = spec.length / 2;
    const splitter = new THREE.ExtrudeGeometry((() => {
      const s = new THREE.Shape(); const w = width * 0.47;
      s.moveTo(-w, 0); s.lineTo(w, 0); s.lineTo(w * 0.94, 0.16); s.lineTo(-w * 0.94, 0.16); s.lineTo(-w, 0); return s;
    })(), { depth: 0.025, bevelEnabled: false });
    splitter.rotateX(Math.PI / 2).translate(0, S.floor(0.99) - 0.02, fz - 0.28);
    parts.push(splitter.toNonIndexed());
    // side skirts
    for (const side of [1, -1]) {
      const sec = S.section(0.5);
      const skirt = new THREE.BoxGeometry(0.05, 0.09, spec.wheels[0].z - spec.wheels[2].z - 0.9).translate(side * (sec[2][0] + 0.01), sec[2][1] + 0.03, (spec.wheels[0].z + spec.wheels[2].z) / 2);
      parts.push(skirt.toNonIndexed());
    }
    // diffuser fins
    for (let i = -2; i <= 2; i++) {
      const fin = new THREE.BoxGeometry(0.015, 0.14, 0.4).translate(i * 0.22, S.floor(0.02) - 0.02, -fz + 0.25);
      parts.push(fin.toNonIndexed());
    }
    const plate = new THREE.BoxGeometry(width * 0.62, 0.015, 0.45).rotateX(-0.2).translate(0, S.floor(0.02) + 0.02, -fz + 0.25);
    parts.push(plate.toNonIndexed());
    for (const p of parts) if (p.attributes.uv) p.deleteAttribute('uv');
    const m = new THREE.Mesh(mergeGeometries(parts), mats.carbon); m.name = 'bumper_1'; root.add(m);
  }
}

function addLightbar(root, S, spec, mats, roofY, roofZ) {
  const base = new THREE.BoxGeometry(1.25, 0.06, 0.28).translate(0, roofY + 0.05, roofZ + 0.2);
  const mb = new THREE.Mesh(base, mats.trim); mb.name = 'lightbar_base'; root.add(mb);
  const red = [], blue = [];
  for (let i = 0; i < 3; i++) {
    const x = 0.12 + i * 0.17;
    red.push(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8).rotateZ(Math.PI / 2).translate(x, roofY + 0.12, roofZ + 0.2));
    blue.push(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8).rotateZ(Math.PI / 2).translate(-x, roofY + 0.12, roofZ + 0.2));
  }
  const r = new THREE.Mesh(mergeGeometries(red), mats.lightbarRed); r.name = 'lightbar_red'; root.add(r);
  const b = new THREE.Mesh(mergeGeometries(blue), mats.lightbarBlue); b.name = 'lightbar_blue'; root.add(b);
  const o = new THREE.Object3D(); o.name = 'lightbar'; o.position.set(0, roofY + 0.14, roofZ + 0.2); root.add(o);
}
