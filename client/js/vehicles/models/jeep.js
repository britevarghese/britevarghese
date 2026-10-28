import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, mesh, finishVehicle } from './kit.js';

// ---------------------------------------------------------------- light utility vehicle (M1151 HMMWV class)
// 4.9 m long, 2.2 m wide, 1.9 m to the roof, 3.3 m wheelbase, 1.81 m track, 37" tyres (0.94 m) on beadlock rims.
// Sloped one-piece hood with the vertical-slot grille and headlights in the grille panel, wide fenders with
// flared square arches, flat armoured doors with thick windows, split armoured windscreen (wipers on top), boxy cab,
// roof ring with an O-GPK style faceted gunner's shield (armoured glass) around an M2 .50 cal, rear deck with
// tie-downs, tail-light clusters, bumpers with shackles and a subtle stencilled bumper code, double-wishbone
// suspension underneath. The shield traverses with the gun but cancels its elevation (only the M2 pitches).
// Local frame: nose toward -Z, +Y up, origin on the ground under the hull centre, metres.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

// ---- geometry helpers (local: kit.js is shared with the other models)
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], order = 'XYZ') {
  _q.setFromEuler(_e.set(r[0], r[1], r[2], order));
  return g.applyMatrix4(_m.compose(V(...p), _q, V(...s)));
}
const box = (w, h, d, p, r) => xf(new THREE.BoxGeometry(w, h, d), p, r);
function merge(list) {
  return mergeGeometries(list.map((g) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    return g;
  }));
}
function rod(a, b, r, seg = 6, r2 = r, open = false) {
  const va = V(...a), vb = V(...b), d = vb.clone().sub(va), L = d.length();
  const g = new THREE.CylinderGeometry(r2, r, L, seg, 1, open);
  g.applyQuaternion(_q.setFromUnitVectors(UP, d.normalize()));
  return g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
}
// lathe about the X axis: profile [radius, x] (x increasing -> faces point outward)
const latheX = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, x]) => new THREE.Vector2(r, x)), seg).rotateZ(-Math.PI / 2);
// lathe about the Y axis: profile [radius, y]
const latheY = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// side profile [z, y] extruded across x (centred); bevel kept inside the outline
function side(pts, width, bevel = 0.02, segs = 1) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const b = Math.min(bevel, width / 2 - 0.0005);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, width - 2 * b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelOffset: -b, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -(width - 2 * b) / 2); g.rotateY(Math.PI / 2);
  return g;
}
// camouflage UVs in metres projected along each triangle's dominant axis (patterns line up across parts)
function planarUV(g) {
  const p = g.attributes.position, uv = g.attributes.uv, a = V(0, 0, 0), b = V(0, 0, 0), c = V(0, 0, 0), n = V(0, 0, 0);
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(a.clone().sub(b));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      if (ax >= ay && ax >= az) uv.setXY(i + k, z + 0.37, y); else if (ay >= az) uv.setXY(i + k, x + 1.3, z); else uv.setXY(i + k, x, y + 0.71);
    }
  }
  return g;
}

// ---- materials (cached per team)
const LM = {};
function codeTexture(team) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 64);
  g.fillStyle = '#d9d3bd'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 30px "DejaVu Sans Condensed", "Arial Narrow", Arial, sans-serif';
  const [unit, num] = team === 1 ? ['1-64 AR', 'B-23'] : ['3-7 IN', 'A-14'];
  g.fillText(unit, 128, 17); g.fillText(num, 128, 49);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function jeepMats(team) {
  if (LM[team]) return LM[team];
  const M = materials(team);
  return (LM[team] = {
    M,
    carc: new THREE.MeshStandardMaterial({ color: team === 1 ? 0x454b2e : 0xa8946a, roughness: 0.8, metalness: 0.2 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xcfd3c8, emissive: 0x3a3a32, roughness: 0.1, metalness: 0.5 }),
    red: new THREE.MeshStandardMaterial({ color: 0x8a1208, emissive: 0x5a0804, roughness: 0.3, metalness: 0.1 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xb06a10, emissive: 0x4a2a04, roughness: 0.3, metalness: 0.1 }),
    armourGlass: new THREE.MeshStandardMaterial({ color: 0x8fa3a0, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32, depthWrite: false }),
    code: new THREE.MeshStandardMaterial({ map: codeTexture(team), alphaTest: 0.45, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  });
}

// ---- 37" tyre with chunky staggered lugs on a beadlock rim (outer face toward +X, mirrored for the left side)
const WR = 0.472;
function jeepWheel(J, parent, s) {
  const g = new THREE.Group(); parent.add(g);
  const rubber = [], rim = [];
  rubber.push(latheX([[0.262, -0.13], [0.33, -0.158], [0.4, -0.166], [0.43, -0.155], [0.445, -0.12], [0.447, 0], [0.445, 0.12], [0.43, 0.155], [0.4, 0.166], [0.33, 0.158], [0.262, 0.13]], 24));
  const lug = () => {
    const k = new THREE.BoxGeometry(0.135, 0.05, 0.078), p = k.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.9); p.setZ(i, p.getZ(i) * 0.8); }
    k.setIndex(Array.from(k.index.array).filter((_, i) => i < 18 || i >= 24)); // drop the buried bottom face
    return k;
  };
  const N = 22;
  for (let i = 0; i < N; i++) for (const sd of [-1, 1]) {
    const a = ((i + (sd > 0 ? 0 : 0.5)) / N) * Math.PI * 2;
    rubber.push(lug().rotateY(sd * 0.22).translate(sd * 0.084, 0.447, 0).rotateX(a));
  }
  // rim face: beadlock ring, dish, hub boss + cap (painted)
  rim.push(latheX([[0.262, 0.125], [0.266, 0.15], [0.214, 0.155], [0.205, 0.14], [0.19, 0.1], [0.12, 0.092], [0.1, 0.1], [0.1, 0.125], [0.06, 0.13], [0, 0.13]], 20));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; rim.push(new THREE.BoxGeometry(0.014, 0.022, 0.022).translate(0.158, 0.24 * Math.cos(a), 0.24 * Math.sin(a))); }
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; rim.push(new THREE.CylinderGeometry(0.014, 0.014, 0.022, 6).rotateZ(Math.PI / 2).translate(0.1, 0.145 * Math.cos(a), 0.145 * Math.sin(a))); }
  rim.push(new THREE.CylinderGeometry(0.035, 0.045, 0.03, 8).rotateZ(Math.PI / 2).translate(0.143, 0, 0));
  rim.push(new THREE.CylinderGeometry(0.262, 0.262, 0.02, 14).rotateZ(Math.PI / 2).translate(-0.11, 0, 0)); // inner side / hub
  const tg = merge(rubber), rg = merge(rim);
  if (s < 0) { tg.rotateY(Math.PI); rg.rotateY(Math.PI); }
  mesh(tg, J.M.rubber, 0, 0, 0, g);
  mesh(rg, J.carc, 0, 0, 0, g);
  return g;
}

export function buildJeep(team) {
  const J = jeepMats(team), M = J.M;
  const root = new THREE.Group(); root.name = 'jeep';
  const body = new THREE.Group(); root.add(body);
  const B = { paint: [], carc: [], dark: [], steel: [], rubber: [], glass: [], lens: [], red: [], amber: [], code: [] };
  const sides = [-1, 1];
  const arch = (zc) => [[zc + 0.62, 0.64], [zc + 0.59, 0.84], [zc + 0.47, 1.0], [zc + 0.31, 1.07], [zc - 0.31, 1.07], [zc - 0.47, 1.0], [zc - 0.59, 0.84], [zc - 0.62, 0.64]];

  // ---- hull: hood + front fenders (arch cut-outs), cab, rear body; dark engine bay / wheel wells behind the arches
  B.paint.push(side([[-2.36, 0.64], [-2.36, 1.12], [-2.31, 1.19], [-2.2, 1.218], [-0.74, 1.335], [-0.7, 1.335], [-0.7, 0.64], ...arch(-1.65)], 2.16, 0.03));
  B.paint.push(side([[-2.15, 1.2], [-2.09, 1.25], [-0.84, 1.362], [-0.78, 1.33]], 1.24, 0.015)); // raised hood centre
  B.paint.push(side([[-0.72, 0.6], [-0.72, 1.34], [-0.63, 1.86], [-0.585, 1.9], [1.1, 1.9], [1.14, 1.86], [1.14, 0.6]], 1.98, 0.03));
  B.paint.push(side([[1.0, 1.34], [1.14, 1.34], [1.17, 1.25], [2.38, 1.222], [2.43, 1.17], [2.43, 0.64], ...arch(1.65), [1.0, 0.64]], 2.16, 0.03));
  B.dark.push(side([[-2.3, 0.55], [-2.3, 1.18], [-0.75, 1.3], [-0.75, 0.55]], 1.1, 0.0));
  B.dark.push(side([[1.02, 0.56], [1.02, 1.2], [2.38, 1.18], [2.38, 0.56]], 1.42, 0.0));
  B.dark.push(box(1.96, 0.05, 1.86, [0, 0.585, 0.21])); // belly armour under the cab
  // flared arch lips
  for (const zc of [-1.65, 1.65]) {
    const pts = arch(zc);
    for (let i = 0; i < pts.length - 1; i++) {
      const [z0, y0] = pts[i], [z1, y1] = pts[i + 1], L = Math.hypot(z1 - z0, y1 - y0), ang = Math.atan2(y1 - y0, z1 - z0);
      const mz = (z0 + z1) / 2, my = (y0 + y1) / 2, oz = mz - zc, oy = my - 0.47, ol = Math.hypot(oz, oy);
      for (const s of sides) B.paint.push(box(0.05, 0.075, L + 0.05, [s * 1.087, my + (oy / ol) * 0.03, mz + (oz / ol) * 0.03], [-ang, 0, 0]));
    }
  }

  // ---- front: grille panel (vertical slots), headlights in the grille surround, marker lights, hood latches
  B.dark.push(box(0.98, 0.36, 0.02, [0, 0.93, -2.365]));
  for (let i = 0; i < 16; i++) B.paint.push(box(0.026, 0.36, 0.045, [-0.465 + i * 0.062, 0.93, -2.38]));
  B.paint.push(box(1.0, 0.035, 0.05, [0, 1.125, -2.38])); B.paint.push(box(1.0, 0.035, 0.05, [0, 0.735, -2.38]));
  for (const s of sides) {
    B.dark.push(rod([s * 0.68, 0.96, -2.36], [s * 0.68, 0.96, -2.4], 0.105, 14));
    B.lens.push(rod([s * 0.68, 0.96, -2.395], [s * 0.68, 0.96, -2.408], 0.085, 14));
    B.amber.push(box(0.1, 0.06, 0.02, [s * 0.93, 1.06, -2.368]));
    B.dark.push(box(0.12, 0.08, 0.02, [s * 0.93, 1.06, -2.362]));
    B.dark.push(box(0.1, 0.07, 0.03, [s * 0.93, 0.86, -2.37])); B.red.push(box(0.06, 0.012, 0.01, [s * 0.93, 0.87, -2.386])); // blackout marker
    B.rubber.push(box(0.05, 0.03, 0.14, [s * 0.86, 1.215, -2.15], [0.08, 0, 0])); B.rubber.push(box(0.05, 0.1, 0.03, [s * 0.86, 1.17, -2.24])); // hood latches
  }
  // raised air intake on the right of the cowl (louvred face toward the windscreen side)
  B.paint.push(box(0.36, 0.09, 0.26, [0.6, 1.365, -0.86], [-0.08, 0, 0]));
  for (let i = 0; i < 5; i++) B.dark.push(box(0.3, 0.008, 0.02, [0.6, 1.335 + i * 0.016, -1.0 + i * 0.001], [-0.5, 0, 0]));
  for (const s of sides) B.dark.push(box(0.06, 0.012, 0.012, [s * 0.35, 1.334, -0.76])); // washer jets / hood hinge
  // front bumper, shackles, bumper code
  B.dark.push(side([[-2.36, 0.58], [-2.53, 0.6], [-2.53, 0.76], [-2.36, 0.77]], 2.08, 0.015));
  for (const s of sides) {
    B.dark.push(box(0.05, 0.14, 0.16, [s * 0.62, 0.62, -2.58]));
    B.steel.push(xf(new THREE.TorusGeometry(0.05, 0.013, 5, 8, Math.PI), [s * 0.62, 0.6, -2.6], [-Math.PI / 2 - 0.5, 0, 0]));
  }
  {
    const plate = (x, z, top, ry) => { const p = new THREE.PlaneGeometry(0.42, 0.065), uv = p.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setY(i, (top ? 0.5 : 0) + uv.getY(i) * 0.5); return xf(p, [x, 0.68, z], [0, ry, 0]); };
    B.code.push(plate(0.45, -2.533, true, Math.PI), plate(-0.45, -2.533, false, Math.PI));
    B.code.push(plate(-0.45, 2.553, true, 0), plate(0.45, 2.553, false, 0));
  }

  // ---- windscreen: two armoured panes in a heavy frame (raked 10°), wipers parked on the top rail
  {
    const ws = (g) => xf(g, [0, 1.6, -0.675], [0.1716, 0, 0]);
    B.paint.push(ws(box(1.98, 0.075, 0.06, [0, 0.226, -0.03])), ws(box(1.98, 0.075, 0.06, [0, -0.226, -0.03])));
    for (const x of [-0.955, 0, 0.955]) B.paint.push(ws(box(x ? 0.07 : 0.09, 0.45, 0.06, [x, 0, -0.03])));
    for (const s of sides) {
      // dark seal border round the pane (no backing: the glass is single-sided, so occupants see out)
      for (const yy of [-1, 1]) B.dark.push(ws(box(0.84, 0.024, 0.016, [s * 0.4725, yy * 0.183, -0.016])));
      for (const xx of [-1, 1]) B.dark.push(ws(box(0.024, 0.39, 0.016, [s * 0.4725 + xx * 0.408, 0, -0.016])));
      B.glass.push(ws(new THREE.PlaneGeometry(0.8, 0.35).rotateY(Math.PI).translate(s * 0.4725, 0, -0.02)));
      B.dark.push(ws(box(0.014, 0.34, 0.012, [s * 0.47 + 0.03, 0.03, -0.034], [0, 0, s * 0.18])));
      B.dark.push(ws(box(0.03, 0.04, 0.03, [s * 0.47, 0.19, -0.05])));
    }
  }

  // ---- armoured doors: flat slabs, heavy window frames, thick dark glass recessed, exposed hinges, lever handles
  for (const s of sides) {
    const x = s * 1.0275;
    for (const [z0, z1, w0, w1] of [[-0.64, 0.29, -0.54, 0.19], [0.35, 0.98, 0.44, 0.89]]) {
      const zc = (z0 + z1) / 2, L = z1 - z0;
      B.paint.push(box(0.075, 0.74, L, [x, 1.03, zc]));
      B.paint.push(box(0.075, 0.075, L, [x, 1.8225, zc]));
      B.paint.push(box(0.075, 0.385, w0 - z0, [x, 1.5925, (z0 + w0) / 2]), box(0.075, 0.385, z1 - w1, [x, 1.5925, (z1 + w1) / 2]));
      for (const yy of [1.415, 1.773]) B.dark.push(box(0.03, 0.032, w1 - w0, [s * 1.035, yy, (w0 + w1) / 2]));
      for (const zz of [w0 + 0.016, w1 - 0.016]) B.dark.push(box(0.03, 0.385, 0.032, [s * 1.035, 1.5925, zz]));
      B.glass.push(xf(new THREE.PlaneGeometry(w1 - w0 - 0.06, 0.33), [s * 1.046, 1.595, (w0 + w1) / 2], [0, s * Math.PI / 2, 0]));
      for (const y of [0.92, 1.6]) B.dark.push(box(0.05, 0.13, 0.05, [s * 1.08, y, z0 + 0.03]));
      B.dark.push(box(0.035, 0.035, 0.15, [s * 1.075, 1.3, z1 - 0.13]));
      B.dark.push(box(0.03, 0.06, 0.04, [s * 1.07, 1.3, z1 - 0.06]));
    }
    // mirror on two arms off the A-pillar
    B.dark.push(rod([s * 1.06, 1.68, -0.6], [s * 1.2, 1.66, -0.64], 0.012, 5), rod([s * 1.06, 1.46, -0.6], [s * 1.2, 1.5, -0.64], 0.012, 5));
    B.dark.push(box(0.18, 0.28, 0.05, [s * 1.22, 1.58, -0.64]));
    B.glass.push(xf(new THREE.PlaneGeometry(0.15, 0.25), [s * 1.22, 1.58, -0.61]));
  }
  // rear window in the cab's back wall
  for (const yy of [-1, 1]) B.dark.push(box(1.0, 0.03, 0.03, [0, 1.6 + yy * 0.165, 1.15]));
  for (const xx of [-1, 1]) B.dark.push(box(0.03, 0.36, 0.03, [xx * 0.485, 1.6, 1.15]));
  B.glass.push(new THREE.PlaneGeometry(0.94, 0.3).translate(0, 1.6, 1.162));

  // headliner + floor seen from the cab (the hull shell is single-sided)
  B.dark.push(new THREE.PlaneGeometry(1.94, 1.66).rotateX(Math.PI / 2).translate(0, 1.87, 0.27));
  // ---- roof: drip rails, fixed turret ring
  for (const s of sides) B.paint.push(box(0.04, 0.03, 1.7, [s * 0.97, 1.915, 0.26]));
  B.dark.push(latheY([[0.6, 1.9], [0.74, 1.9], [0.74, 1.96], [0.6, 1.96], [0.6, 1.9]], 28).translate(0, 0, 0.55));
  B.rubber.push(new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2).translate(0, 1.903, 0.55)); // open hatch (dark cab below)

  // ---- rear: deck with hatch seams + tie-downs, tail-light clusters, bumper, pintle, shackles, jerry can, antennas
  B.dark.push(box(1.7, 0.008, 0.012, [0, 1.229, 1.32]), box(1.7, 0.008, 0.012, [0, 1.224, 2.3]));
  for (const s of sides) {
    B.dark.push(box(0.012, 0.008, 0.98, [s * 0.85, 1.228, 1.81]));
    for (const z of [1.35, 1.85, 2.3]) B.steel.push(xf(new THREE.TorusGeometry(0.03, 0.007, 4, 8), [s * 1.02, 1.235, z], [Math.PI / 2, 0, 0]));
    B.dark.push(box(0.17, 0.24, 0.05, [s * 0.9, 0.98, 2.445]));
    B.red.push(box(0.12, 0.06, 0.012, [s * 0.9, 1.05, 2.472]));
    B.amber.push(box(0.12, 0.05, 0.012, [s * 0.9, 0.975, 2.472]));
    B.red.push(box(0.05, 0.03, 0.012, [s * 0.9, 0.905, 2.472]));
    B.dark.push(box(0.05, 0.13, 0.15, [s * 0.68, 0.6, 2.56]));
    B.steel.push(xf(new THREE.TorusGeometry(0.045, 0.012, 5, 8, Math.PI), [s * 0.68, 0.58, 2.62], [Math.PI / 2 + 0.5, 0, 0]));
  }
  B.dark.push(side([[2.42, 0.58], [2.55, 0.6], [2.55, 0.75], [2.42, 0.76]], 1.96, 0.015));
  for (const s of sides) { B.rubber.push(box(0.34, 0.36, 0.012, [s * 0.9, 0.46, 2.3], [0.05, 0, 0])); B.dark.push(box(0.36, 0.03, 0.03, [s * 0.9, 0.645, 2.3])); }
  B.dark.push(box(0.12, 0.1, 0.12, [0, 0.62, 2.6])); B.steel.push(xf(new THREE.TorusGeometry(0.045, 0.016, 5, 8, Math.PI * 1.4), [0, 0.6, 2.68], [0, Math.PI / 2, 0]));
  {
    // 20 l jerry can in a bracket on the rear panel (pressed X ribs, triple handle, spout)
    const cx = 0.4, cz = 2.53;
    B.carc.push(box(0.34, 0.47, 0.165, [cx, 1.0, cz]));
    for (const a of [0.94, -0.94]) B.carc.push(box(0.4, 0.03, 0.012, [cx, 1.0, cz + 0.086], [0, 0, a]));
    for (const dx of [-0.07, 0, 0.07]) B.carc.push(box(0.025, 0.05, 0.03, [cx + dx, 1.25, cz]));
    B.carc.push(box(0.18, 0.02, 0.03, [cx, 1.27, cz]));
    B.dark.push(rod([cx + 0.13, 1.235, cz], [cx + 0.16, 1.28, cz], 0.02, 6));
    B.dark.push(box(0.38, 0.04, 0.19, [cx, 0.77, cz]), box(0.38, 0.03, 0.17, [cx, 1.12, cz + 0.006]));
  }
  for (const [s, top] of [[-1, 3.45], [1, 2.75]]) {
    B.dark.push(box(0.12, 0.1, 0.12, [s * 0.88, 1.28, 1.3]));
    B.rubber.push(rod([s * 0.88, 1.33, 1.3], [s * 0.88, 1.47, 1.3], 0.022, 8));
    B.dark.push(rod([s * 0.88, 1.47, 1.3], [s * 0.88, top, 1.3 + (top - 1.47) * 0.12], 0.007, 4, 0.003));
  }

  // ---- running gear: frame rails, diffs, transfer case, double wishbones, half-shafts, coil-over shocks
  for (const s of sides) B.dark.push(box(0.08, 0.16, 4.7, [s * 0.44, 0.5, 0]));
  for (const z of [-1.65, 1.65]) {
    B.dark.push(box(0.36, 0.26, 0.3, [0, 0.47, z]));
    for (const s of sides) {
      B.dark.push(rod([s * 0.47, 0.4, z - 0.24], [s * 0.74, 0.35, z], 0.028, 6), rod([s * 0.47, 0.4, z + 0.24], [s * 0.74, 0.35, z], 0.028, 6));
      B.dark.push(rod([s * 0.47, 0.64, z - 0.2], [s * 0.72, 0.62, z], 0.024, 6), rod([s * 0.47, 0.64, z + 0.2], [s * 0.72, 0.62, z], 0.024, 6));
      B.dark.push(rod([s * 0.18, 0.47, z], [s * 0.7, 0.47, z], 0.03, 6));
      B.rubber.push(rod([s * 0.62, 0.47, z], [s * 0.7, 0.47, z], 0.045, 8, 0.035));
      B.steel.push(rod([s * 0.62, 0.37, z + 0.12], [s * 0.55, 0.78, z + 0.16], 0.04, 8));
      B.carc.push(box(0.12, 0.26, 0.12, [s * 0.75, 0.47, z]));
    }
  }
  B.dark.push(box(0.42, 0.3, 0.9, [0, 0.52, -0.55]));
  B.dark.push(box(0.6, 0.24, 0.55, [0.52, 0.5, 0.85]));
  B.dark.push(rod([0.3, 0.45, -0.4], [0.32, 0.45, 2.2], 0.035, 6));

  // ---- wheels (front pair steers on its pivot)
  const wheels = [], front = [];
  for (const [x, z] of [[-0.905, -1.65], [0.905, -1.65], [-0.905, 1.65], [0.905, 1.65]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, WR, z); body.add(pivot);
    wheels.push(jeepWheel(J, pivot, Math.sign(x)));
    if (z < 0) front.push(pivot);
  }

  // ---- .50 cal (pivots at the ring centre, 0.3 m above the ring) inside the O-GPK shield
  const mg = new THREE.Group(); mg.name = 'mg'; mg.position.set(0, 2.25, 0.55); body.add(mg);
  const shield = new THREE.Group(); shield.name = 'shield'; mg.add(shield);
  // the shield traverses with the gun but stays upright: cancel the gun's elevation every frame
  shield.updateMatrix = function () { this.rotation.x = -mg.rotation.x; THREE.Object3D.prototype.updateMatrix.call(this); };
  {
    const G = { dark: [], rubber: [], carc: [], steel: [] }, gy = -0.16;
    G.dark.push(box(0.15, 0.13, 0.58, [0, gy - 0.005, -0.6]));                 // receiver
    G.dark.push(box(0.13, 0.022, 0.42, [0, gy + 0.07, -0.55]));                // top cover
    G.dark.push(box(0.17, 0.03, 0.5, [0, gy - 0.055, -0.6]));                  // side plate rails
    G.dark.push(box(0.15, 0.14, 0.03, [0, gy - 0.01, -0.3]));                  // back plate
    G.dark.push(box(0.03, 0.016, 0.05, [0, gy + 0.088, -0.36]));               // rear sight (folded)
    for (const s of [-1, 1]) {
      G.dark.push(rod([s * 0.05, gy - 0.03, -0.3], [s * 0.07, gy - 0.03, -0.235], 0.012, 6));
      G.rubber.push(rod([s * 0.072, gy - 0.1, -0.24], [s * 0.078, gy + 0.03, -0.225], 0.017, 8));
    }
    G.dark.push(box(0.06, 0.035, 0.02, [0, gy - 0.03, -0.25]));                // butterfly trigger
    G.dark.push(rod([0.075, gy, -0.56], [0.14, gy, -0.56], 0.01, 5), rod([0.14, gy, -0.5], [0.14, gy, -0.62], 0.012, 6)); // charging handle
    // perforated barrel support, barrel, carrying handle, flash hider, front sight
    G.dark.push(rod([0, gy, -0.89], [0, gy, -1.1], 0.043, 12));
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + r * 0.5;
      G.rubber.push(box(0.016, 0.016, 0.03, [0.044 * Math.sin(a), gy + 0.044 * Math.cos(a), -0.93 - r * 0.06], [0, 0, -a]));
    }
    G.dark.push(rod([0, gy, -1.1], [0, gy, -1.9], 0.024, 10));
    G.dark.push(rod([0, gy, -1.9], [0, gy, -1.99], 0.03, 10, 0.034));
    G.dark.push(rod([0, gy, -1.16], [-0.06, gy + 0.08, -1.16], 0.01, 5), rod([-0.06, gy + 0.08, -1.08], [-0.06, gy + 0.08, -1.26], 0.014, 6));
    G.dark.push(box(0.012, 0.04, 0.02, [0, gy + 0.055, -1.06]));
    // ammo can on the left feeding the belt, cradle + pintle under the receiver
    G.carc.push(box(0.12, 0.19, 0.3, [-0.17, gy - 0.06, -0.62]));
    G.carc.push(box(0.13, 0.02, 0.31, [-0.17, gy + 0.045, -0.62]));
    G.steel.push(box(0.1, 0.015, 0.12, [-0.115, gy + 0.05, -0.62], [0, 0, 0.45]));
    G.dark.push(box(0.1, 0.05, 0.3, [0, gy - 0.095, -0.62]));
    G.dark.push(rod([0, gy - 0.115, -0.66], [0, -0.27, -0.66], 0.03, 8));
    const mats = { dark: M.dark, rubber: M.rubber, carc: J.carc, steel: M.steel };
    for (const [k, list] of Object.entries(G)) if (list.length) mesh(merge(list), mats[k], 0, 0, 0, mg);
  }
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(0, -0.16, -1.99); mg.add(mgMuzzle);
  {
    // O-GPK: rotating ring + 7 faceted armour plates (open at the back), armoured glass windows, gun slot.
    // Authored in body coordinates around the ring centre (0, *, 0.55), then moved into the shield frame.
    const S = { paint: [], dark: [], glass: [] }, c = V(0, 0, 0.55), R0 = 0.95, y0 = 1.985;
    S.dark.push(latheY([[0.62, 1.96], [0.96, 1.96], [0.96, y0], [0.62, y0], [0.62, 1.96]], 28).translate(c.x, 0, c.z));
    const facets = [[0, 0.72, 'gun'], [-0.7, 0.66, 'win'], [0.7, 0.66, 'win'], [-1.4, 0.5, ''], [1.4, 0.5, ''], [-2.1, 0.38, ''], [2.1, 0.38, '']];
    const W = 2 * R0 * Math.tan(0.35) + 0.03, T = 0.03;
    for (const [ang, h, kind] of facets) {
      // facet frame: local x along the plate, z outward (forward = -z at ang 0)
      const put = (g) => xf(g, [c.x - Math.sin(ang) * R0, 0, c.z - Math.cos(ang) * R0], [0, ang, 0]);
      const plate = (w, hh, x, y) => S.paint.push(put(box(w, hh, T, [x, y, 0])));
      if (kind === 'gun') {
        const sw = 0.17, gl = 2.16, gt = 2.56;
        plate((W - sw) / 2, gl - y0, -(W + sw) / 4, (y0 + gl) / 2); plate((W - sw) / 2, gl - y0, (W + sw) / 4, (y0 + gl) / 2);
        plate(W, y0 + h - gt, 0, (gt + y0 + h) / 2);
        plate(0.06, gt - gl, -W / 2 + 0.03, (gl + gt) / 2); plate(0.06, gt - gl, W / 2 - 0.03, (gl + gt) / 2);
        S.glass.push(put(box(W - 0.12, gt - gl, 0.05, [0, (gl + gt) / 2, 0.01])));
        for (const yy of [gl, gt]) S.dark.push(put(box(W - 0.1, 0.025, 0.045, [0, yy, -0.012])));
        for (const xx of [-1, 1]) S.dark.push(put(box(0.025, gt - gl, 0.045, [xx * (W / 2 - 0.06), (gl + gt) / 2, -0.012])));
      } else if (kind === 'win') {
        const wl = 2.26, wt = 2.54, ww = 0.34;
        plate(W, wl - y0, 0, (y0 + wl) / 2); plate(W, y0 + h - wt, 0, (wt + y0 + h) / 2);
        plate((W - ww) / 2, wt - wl, -(W + ww) / 4, (wl + wt) / 2); plate((W - ww) / 2, wt - wl, (W + ww) / 4, (wl + wt) / 2);
        S.glass.push(put(box(ww, wt - wl, 0.05, [0, (wl + wt) / 2, 0.01])));
        for (const yy of [wl, wt]) S.dark.push(put(box(ww + 0.03, 0.022, 0.045, [0, yy, -0.012])));
        for (const xx of [-1, 1]) S.dark.push(put(box(0.022, wt - wl, 0.045, [xx * ww / 2, (wl + wt) / 2, -0.012])));
      } else plate(W, h, 0, y0 + h / 2);
      // stiffening lip along the top edge + mounting post down to the ring
      S.dark.push(put(box(W, 0.03, 0.06, [0, y0 + h - 0.015, 0.01])));
      S.dark.push(put(box(0.05, 0.12, 0.08, [0, y0 + 0.06, 0.05])));
    }
    const off = mg.position;
    const mats = { paint: M.paintX, dark: M.dark };
    for (const [k, list] of Object.entries(S)) {
      let g = merge(list);
      if (k === 'paint') planarUV(g);
      g.translate(-off.x, -off.y, -off.z);
      const m = mesh(g, k === 'glass' ? J.armourGlass : mats[k], 0, 0, 0, shield);
      if (k === 'glass') { m.castShadow = false; m.renderOrder = 2; }
    }
  }

  // ---- one mesh per material in the body group (camo UVs projected in vehicle space)
  const BODY = { paint: M.paintX, carc: J.carc, dark: M.dark, steel: M.steel, rubber: M.rubber, glass: M.glass, lens: J.lens, red: J.red, amber: J.amber, code: J.code };
  for (const [k, list] of Object.entries(B)) {
    if (!list.length) continue;
    const g = merge(list);
    if (k === 'paint') planarUV(g);
    const m = mesh(g, BODY[k], 0, 0, 0, body);
    if (k === 'code') m.castShadow = false;
  }

  root.userData = { type: 'jeep', body, wheels, front, wheelR: WR, mg, mgMuzzle };
  return finishVehicle(root);
}
