import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { materials, mesh, finishVehicle } from './kit.js';

// ---------------------------------------------------------------- trail motorcycle
// Military trail bike (KLR / WR-class enduro in olive drab or desert tan): 21" front / 18" rear spoked wheels with
// knobby tyres, long-travel upside-down forks on a 27° steering head, air-cooled single (finned barrel + head,
// crankcase, clutch cover), high pipe on the right, long flat seat, high fenders, tapered alloy swingarm with a
// linkage shock. Front end: body > rake (tilted by the rake angle at the head stock) > steer (turns about the
// steering axis = its own Y) > front wheel. Rear wheel group sits on the axle. Wheels spin about their local X.
// Local frame: nose toward -Z, +Y up, origin on the ground between the contact patches, metres.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();

// ---- geometry helpers (local: kit.js is shared with the other models)
function xf(g, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], order = 'XYZ') {
  _q.setFromEuler(_e.set(r[0], r[1], r[2], order));
  return g.applyMatrix4(_m.compose(V(...p), _q, V(...s)));
}
function merge(list) {
  return mergeGeometries(list.map((g) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.clearGroups();
    return g;
  }));
}
// cylinder from a to b (radius r at a, r2 at b)
function rod(a, b, r, seg = 6, r2 = r, open = false) {
  const va = V(...a), vb = V(...b), d = vb.clone().sub(va), L = d.length();
  const g = new THREE.CylinderGeometry(r2, r, L, seg, 1, open);
  g.applyQuaternion(_q.setFromUnitVectors(UP, d.normalize()));
  return g.translate((va.x + vb.x) / 2, (va.y + vb.y) / 2, (va.z + vb.z) / 2);
}
const pipe = (pts, r, seg = 24, radial = 6, tension = 0.4) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), false, 'catmullrom', tension), seg, r, radial, false);
// lathe about the X axis: profile [radius, x] (x increasing -> faces point outward)
const latheX = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, x]) => new THREE.Vector2(r, x)), seg).rotateZ(-Math.PI / 2);
// side profile [z, y] extruded across x, centred; rounded edges kept inside the outline
function side(pts, width, bevel = 0.01, segs = 2) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const b = Math.min(bevel, width / 2 - 0.0005);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, width - 2 * b), bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelOffset: -b, bevelSegments: segs, curveSegments: 6 });
  g.translate(0, 0, -(width - 2 * b) / 2); g.rotateY(Math.PI / 2);
  return g;
}
// reshape vertices: fn(x, y, z) -> scale factor for x (taper) and optional y offset
function taper(g, fx, fy = null) {
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = fx(y, z, x);
    p.setX(i, x * f);
    if (fy) p.setY(i, y + fy(x * f, y, z));
    if (n) { const nx = n.getX(i) / f, ny = n.getY(i), nz = n.getZ(i), l = Math.hypot(nx, ny, nz) || 1; n.setXYZ(i, nx / l, ny / l, nz / l); }
  }
  return g;
}
// thin strip following a centreline [z, y] (thickness t below the line)
function strip(line, t) {
  const top = line.map(([z, y]) => [z, y]);
  const bot = line.map(([z, y], i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy);
    return [z + (dy / l) * t, y - (dz / l) * t];
  });
  return [...top, ...bot.reverse()];
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;

// ---- materials (cached per team; the shared kit set covers frame / rubber / steel / exhaust)
const LM = {};
function bikeMats(team) {
  if (LM[team]) return LM[team];
  const M = materials(team);
  return (LM[team] = {
    M,
    plastic: new THREE.MeshStandardMaterial({ color: team === 1 ? 0x4c5232 : 0xb39f74, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide }),
    engine: new THREE.MeshStandardMaterial({ color: 0x3c3d3b, roughness: 0.55, metalness: 0.6 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xa3a6a2, roughness: 0.34, metalness: 0.85 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x1e1e1c, roughness: 0.86, metalness: 0 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x8a1208, emissive: 0x6a0a04, roughness: 0.3, metalness: 0.1 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xd8dccf, emissive: 0x2a2a24, roughness: 0.08, metalness: 0.6 }),
  });
}

// ---- spoked wheel with a knobby tyre (axis X, outer face either side); disc / sprocket optional
function wheel(B, parent, { R, rim, w, hubW, spokes = 36, disc = null, sprocket = null }) {
  const g = new THREE.Group(); parent.add(g);
  const M = B.M, rubber = [], alu = [], dark = [];
  const base = R - 0.016, h = base - rim;
  // carcass (rounded section) + knobs: centre blocks alternate with pairs of shoulder blocks
  rubber.push(latheX([[rim, -w * 0.36], [rim + h * 0.5, -w * 0.5], [base - 0.006, -w * 0.38], [base, 0], [base - 0.006, w * 0.38], [rim + h * 0.5, w * 0.5], [rim, w * 0.36]], 18));
  // knob: tapered block without its (buried) bottom face
  const knob = (ax, rad, circ) => {
    const k = new THREE.BoxGeometry(ax, rad, circ), p = k.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.78); p.setZ(i, p.getZ(i) * 0.75); }
    k.setIndex(Array.from(k.index.array).filter((_, i) => i < 18 || i >= 24));
    return k;
  };
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    if (i % 2 === 0) rubber.push(knob(w * 0.44, 0.024, 0.03).translate(0, base + 0.004, 0).rotateX(a));
    else for (const s of [-1, 1]) rubber.push(knob(w * 0.3, 0.024, 0.028).rotateZ(-s * 0.75).translate(s * w * 0.37, base - h * 0.17, 0).rotateX(a));
  }
  // rim (U channel), hub with flanges, laced spokes (crossed), axle nuts
  const rr = rim + 0.004;
  alu.push(latheX([[rr - 0.016, -0.017], [rr + 0.012, -0.02], [rr + 0.012, 0.02], [rr - 0.016, 0.017], [rr - 0.016, -0.017]], 20));
  const hw = hubW / 2;
  alu.push(latheX([[0.014, -hw - 0.01], [0.05, -hw], [0.026, -hw + 0.016], [0.026, hw - 0.016], [0.05, hw], [0.014, hw + 0.01]], 6));
  for (let i = 0; i < spokes; i++) {
    const s = i % 2 ? 1 : -1, a = (i / spokes) * Math.PI * 2, lead = Math.floor(i / 2) % 2 ? 1 : -1, b = a + lead * 0.95;
    alu.push(rod([s * (hw - 0.008), 0.046 * Math.cos(a), 0.046 * Math.sin(a)], [s * 0.007, (rr - 0.014) * Math.cos(b), (rr - 0.014) * Math.sin(b)], 0.0024, 3, 0.0024, true));
  }
  for (const s of [-1, 1]) dark.push(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 6).rotateZ(Math.PI / 2).translate(s * (hw + 0.02), 0, 0));
  // brake disc: wave (petal) outline + carrier
  if (disc) {
    const d = new THREE.CylinderGeometry(disc.r, disc.r, 0.004, 24), p = d.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z); if (r > 0.01) { const f = 1 + 0.045 * Math.sin(Math.atan2(z, x) * 12); p.setX(i, x * f); p.setZ(i, z * f); } }
    alu.push(d.rotateZ(Math.PI / 2).translate(disc.x, 0, 0));
    dark.push(new THREE.CylinderGeometry(disc.r * 0.55, disc.r * 0.55, 0.008, 6).rotateZ(Math.PI / 2).translate(disc.x - Math.sign(disc.x) * 0.002, 0, 0));
  }
  // sprocket with teeth (alternate rim vertices pushed out)
  if (sprocket) {
    const T = 26, sp = new THREE.CylinderGeometry(sprocket.r, sprocket.r, 0.005, T * 2), p = sp.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z);
      if (r > 0.01) { const k = Math.round(Math.atan2(z, x) / (Math.PI / T)), f = (k % 2 ? sprocket.r + 0.007 : sprocket.r - 0.003) / r; p.setX(i, x * f); p.setZ(i, z * f); }
    }
    dark.push(sp.rotateZ(Math.PI / 2).translate(sprocket.x, 0, 0));
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; dark.push(new THREE.CylinderGeometry(0.006, 0.006, 0.012, 4).rotateZ(Math.PI / 2).translate(sprocket.x, 0.06 * Math.cos(a), 0.06 * Math.sin(a))); }
  }
  mesh(merge(rubber), M.rubber, 0, 0, 0, g);
  mesh(merge(alu), B.alu, 0, 0, 0, g);
  mesh(merge(dark), M.dark, 0, 0, 0, g);
  return g;
}

// smooth shading for rounded solids (tank, seat): weld the extrusion and recompute normals
function smooth(g) {
  g.deleteAttribute('uv');
  const w = mergeVertices(g, 1e-4); w.computeVertexNormals();
  return w;
}

export function buildBike(team) {
  const B = bikeMats(team), M = B.M;
  const root = new THREE.Group(); root.name = 'bike';
  const body = new THREE.Group(); root.add(body);
  const add = (geo, mat, parent = body) => mesh(geo, mat, 0, 0, 0, parent);
  const P = { dark: [], engine: [], alu: [], plastic: [], seat: [], exhaust: [], rubber: [], tail: [] };

  // ---- geometry of the front end: 27° rake, fork offset, axle under the fork legs
  const RAKE = 0.47, OFF = 0.045, FR = 0.36, RR = 0.34, L = 0.74;
  const AF = V(0, FR, -0.73), AR = V(0, RR, 0.72);
  const axis = V(0, Math.cos(RAKE), Math.sin(RAKE)), perp = V(0, -Math.sin(RAKE), Math.cos(RAKE));
  const H = AF.clone().addScaledVector(axis, L).addScaledVector(perp, OFF); // top of the head tube on the steering axis
  const onAxis = (t, o = 0) => H.clone().addScaledVector(axis, t).addScaledVector(perp, o).toArray();
  const rake = new THREE.Group(); rake.position.copy(H); rake.rotation.x = RAKE; body.add(rake);
  const steer = new THREE.Group(); steer.name = 'steer'; rake.add(steer);
  rake.updateMatrix();
  const toSteer = (g) => g.applyMatrix4(rake.matrix.clone().invert()); // author in body coords, hang on the steer group
  const S = { dark: [], alu: [], plastic: [], rubber: [], lens: [] };

  // ---- wheels
  const fwPivot = new THREE.Group(); fwPivot.position.set(0, -L, -OFF); steer.add(fwPivot);
  const fw = wheel(B, fwPivot, { R: FR, rim: 0.268, w: 0.082, hubW: 0.1, spokes: 32, disc: { r: 0.125, x: -0.056 } });
  const rw = wheel(B, body, { R: RR, rim: 0.229, w: 0.118, hubW: 0.13, spokes: 32, disc: { r: 0.11, x: 0.068 }, sprocket: { r: 0.112, x: -0.074 } });
  rw.position.copy(AR);

  // ---- forks (upside-down: fat outer tubes in the clamps, slim stanchions + guards below), clamps, bars
  for (const s of [-1, 1]) {
    const x = s * 0.1;
    S.dark.push(rod([x, -0.41, -OFF], [x, 0.065, -OFF], 0.03, 10));
    S.dark.push(rod([x, -0.42, -OFF], [x, -0.39, -OFF], 0.033, 8)); // seal collar
    S.alu.push(rod([x, -L + 0.03, -OFF], [x, -0.41, -OFF], 0.022, 12));
    S.plastic.push(new THREE.CylinderGeometry(0.034, 0.036, 0.27, 10, 1, true, Math.PI / 2, Math.PI).translate(x, -0.565, -OFF));
    S.dark.push(new THREE.BoxGeometry(0.05, 0.1, 0.07).translate(x, -L + 0.015, -OFF + 0.006)); // axle lug
    S.dark.push(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 6).translate(x, 0.075, -OFF)); // fork cap
  }
  S.dark.push(rod([0, -L, -OFF].map((v, i) => (i === 0 ? -0.135 : v)), [0.135, -L, -OFF], 0.011, 8)); // axle
  S.dark.push(xf(side([[0.035, 0.0], [0.02, 0.016], [-0.08, 0.016], [-0.095, 0], [-0.08, -0.016], [0.02, -0.016]], 0.27, 0.006, 1), [0, 0.04, 0])); // top clamp
  S.dark.push(xf(side([[0.04, 0.0], [0.025, 0.022], [-0.085, 0.022], [-0.1, 0], [-0.085, -0.022], [0.025, -0.022]], 0.29, 0.008, 1), [0, -0.19, 0])); // bottom clamp
  // brake caliper behind the left leg, gripping the disc
  S.dark.push(xf(new THREE.BoxGeometry(0.032, 0.075, 0.05), [-0.066, -L + 0.07, -OFF + 0.088], [0.7, 0, 0]));
  // number plate / headlight shroud ahead of the fork tubes, curved, with the lamp and a slotted blackout cover
  {
    const sh = new THREE.Shape(), w = 0.115, top = 0.07, bot = -0.24;
    sh.moveTo(-w + 0.02, bot); sh.lineTo(w - 0.02, bot); sh.quadraticCurveTo(w, bot, w, bot + 0.03); sh.lineTo(w + 0.01, top - 0.04); sh.quadraticCurveTo(w + 0.01, top, w - 0.04, top);
    sh.lineTo(-w + 0.04, top); sh.quadraticCurveTo(-w - 0.01, top, -w - 0.01, top - 0.04); sh.lineTo(-w, bot + 0.03); sh.quadraticCurveTo(-w, bot, -w + 0.02, bot);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -0.004);
    const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + 4 * p.getX(i) ** 2); // wrap round the forks
    S.plastic.push(g.translate(0, 0, -OFF - 0.1));
    S.lens.push(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 14).rotateX(Math.PI / 2).translate(0, -0.085, -OFF - 0.106));
    S.dark.push(new THREE.TorusGeometry(0.05, 0.008, 3, 12).translate(0, -0.085, -OFF - 0.11));
    S.dark.push(xf(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 10, 1, true, -Math.PI / 2, Math.PI), [0, -0.06, -OFF - 0.125], [Math.PI / 2, 0, 0])); // visor
    S.dark.push(new THREE.BoxGeometry(0.11, 0.045, 0.035).translate(0, 0.085, -OFF + 0.0)); // instrument pod
  }
  // front fender: high, mounted under the bottom clamp (authored in body coords)
  {
    const g = side(strip([[-1.07, 0.748], [-0.98, 0.812], [-0.86, 0.847], [-0.72, 0.858], [-0.58, 0.85], [-0.47, 0.82], [-0.39, 0.785]], 0.007), 0.135, 0.002, 1);
    taper(g, (y, z) => lerp(0.7, 1, clamp01((z + 1.07) / 0.3)), (x) => -11 * x * x);
    S.plastic.push(toSteer(g));
  }
  // handlebar (tapered bar, sweeps up and back), crossbar pad, grips, levers + perches, hand guards
  {
    const bar = [[-0.41, 1.128, -0.236], [-0.29, 1.118, -0.252], [-0.16, 1.093, -0.276], [-0.05, 1.082, -0.284], [0.05, 1.082, -0.284], [0.16, 1.093, -0.276], [0.29, 1.118, -0.252], [0.41, 1.128, -0.236]];
    S.dark.push(toSteer(pipe(bar, 0.011, 14, 4)));
    S.dark.push(toSteer(new THREE.BoxGeometry(0.17, 0.035, 0.045).translate(0, 1.11, -0.29)));
    for (const s of [-1, 1]) {
      S.dark.push(toSteer(rod([s * 0.035, 1.03, -0.29], [s * 0.04, 1.085, -0.283], 0.014, 6)));
      S.rubber.push(toSteer(rod([s * 0.29, 1.118, -0.252], [s * 0.425, 1.129, -0.234], 0.0175, 10)));
      S.dark.push(toSteer(new THREE.BoxGeometry(0.04, 0.03, 0.035).translate(s * 0.215, 1.112, -0.262)));
      S.alu.push(toSteer(pipe([[s * 0.22, 1.105, -0.275], [s * 0.3, 1.103, -0.3], [s * 0.38, 1.108, -0.302], [s * 0.4, 1.11, -0.298]], 0.0055, 6, 3)));
      // hand guard: alloy backbone + plastic shield
      S.alu.push(toSteer(pipe([[s * 0.15, 1.09, -0.285], [s * 0.26, 1.115, -0.33], [s * 0.38, 1.125, -0.325], [s * 0.44, 1.13, -0.27], [s * 0.432, 1.129, -0.236]], 0.006, 8, 3)));
      S.plastic.push(toSteer(xf(new THREE.CylinderGeometry(0.085, 0.09, 0.062, 8, 1, true, s > 0 ? Math.PI / 2 : Math.PI - 0.45, Math.PI / 2 + 0.45), [s * 0.35, 1.132, -0.25], [0.12, 0, 0])));
    }
    // front brake hose: caliper up the left leg to the right-hand master cylinder
    const cal = new THREE.Vector3(-0.07, -L + 0.11, -OFF + 0.085).applyMatrix4(rake.matrix);
    const legTop = new THREE.Vector3(-0.07, -0.05, -OFF + 0.035).applyMatrix4(rake.matrix);
    S.rubber.push(toSteer(pipe([cal.toArray(), new THREE.Vector3(-0.072, -0.4, -OFF + 0.035).applyMatrix4(rake.matrix).toArray(), legTop.toArray(), [-0.02, 1.07, -0.37], [0.12, 1.1, -0.31], [0.21, 1.11, -0.27]], 0.0045, 12, 3)));
  }

  // ---- frame (semi-double cradle), head tube, subframe
  P.dark.push(rod(onAxis(-0.175), onAxis(0.012), 0.03, 8));
  P.dark.push(pipe([onAxis(-0.03, 0.03), [0, 0.95, -0.2], [0, 0.9, -0.02], [0, 0.875, 0.1]], 0.023, 8, 6));
  P.dark.push(pipe([onAxis(-0.16, 0.02), [0, 0.7, -0.375], [0, 0.48, -0.31]], 0.022, 8, 6));
  for (const s of [-1, 1]) {
    P.dark.push(pipe([[0, 0.49, -0.315], [s * 0.05, 0.38, -0.27], [s * 0.06, 0.29, -0.17], [s * 0.065, 0.282, 0.0], [s * 0.08, 0.34, 0.11], [s * 0.09, 0.47, 0.13]], 0.017, 8, 5));
    P.dark.push(pipe([[0, 0.875, 0.08], [s * 0.07, 0.83, 0.13], [s * 0.09, 0.6, 0.14]], 0.02, 8, 5));
    P.dark.push(pipe([[s * 0.06, 0.875, 0.1], [s * 0.075, 0.89, 0.42], [s * 0.065, 0.9, 0.74]], 0.014, 6, 5));
    P.dark.push(rod([s * 0.088, 0.6, 0.16], [s * 0.072, 0.885, 0.6], 0.012, 6));
    P.dark.push(new THREE.BoxGeometry(0.028, 0.17, 0.11).translate(s * 0.097, 0.52, 0.12)); // swingarm pivot plates
    P.dark.push(xf(new THREE.BoxGeometry(0.05, 0.022, 0.035), [s * 0.12, 0.47, 0.42])); // pillion pegs
  }
  P.dark.push(rod([-0.075, 0.9, 0.72], [0.075, 0.9, 0.72], 0.012, 6));

  // ---- engine: crankcase, clutch / magneto covers, finned barrel + head (15° forward), carb, airbox, skid plate
  P.engine.push(side([[-0.25, 0.42], [-0.22, 0.52], [-0.13, 0.585], [0.02, 0.585], [0.1, 0.53], [0.12, 0.42], [0.08, 0.32], [-0.05, 0.295], [-0.2, 0.31]], 0.2, 0.02, 2));
  P.engine.push(latheX([[0.03, 0.1], [0.085, 0.1], [0.088, 0.112], [0.08, 0.13], [0.05, 0.138], [0.04, 0.142], [0, 0.142]], 12).translate(0, 0.43, -0.06)); // clutch cover (right)
  P.engine.push(latheX([[0, -0.132], [0.045, -0.13], [0.065, -0.122], [0.072, -0.1]], 10).translate(0, 0.455, -0.13)); // magneto cover (left)
  P.engine.push(xf(new THREE.BoxGeometry(0.03, 0.09, 0.11), [-0.11, 0.44, 0.02])); // sprocket cover
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; P.alu.push(new THREE.CylinderGeometry(0.006, 0.006, 0.01, 4).rotateZ(Math.PI / 2).translate(0.142, 0.43 + 0.07 * Math.sin(a), -0.06 + 0.07 * Math.cos(a))); }
  {
    const c = V(0, Math.cos(0.26), -Math.sin(0.26)), C0 = V(0, 0.565, -0.115), at = (t) => C0.clone().addScaledVector(c, t);
    const q = new THREE.Quaternion().setFromUnitVectors(UP, c);
    P.engine.push(rod(at(-0.02).toArray(), at(0.27).toArray(), 0.05, 8));
    for (let i = 0; i < 10; i++) {
      const t = 0.024 + i * 0.025, big = i >= 6, r = big ? 0.096 : 0.084;
      const f = new THREE.CylinderGeometry(r, r, 0.0065, 8).rotateY(Math.PI / 8).scale(big ? 1.05 : 1, 1, big ? 1.12 : 1.04);
      P.engine.push(f.applyQuaternion(q).translate(...at(t).toArray()));
    }
    P.engine.push(xf(side([[-0.07, -0.03], [0.07, -0.03], [0.06, 0.02], [-0.06, 0.02]], 0.13, 0.012), at(0.29).toArray(), [-0.26, 0, 0])); // rocker cover
    P.rubber.push(rod(at(0.2).add(V(-0.09, 0, 0)).toArray(), at(0.21).add(V(-0.13, 0.04, 0.02)).toArray(), 0.011, 6)); // plug cap
    // carb + intake boot behind the head, airbox under the seat
    P.engine.push(rod(at(0.18).add(V(0, -0.01, 0.07)).toArray(), [0, 0.735, 0.03], 0.032, 10));
    P.rubber.push(rod([0, 0.735, 0.03], [0, 0.77, 0.13], 0.034, 10, 0.04));
    P.dark.push(new THREE.BoxGeometry(0.19, 0.17, 0.36).translate(0, 0.79, 0.31));
    // exhaust: header out of the front of the head, round the right side, rising to the silencer under the fender
    const port = at(0.215).add(V(0.0, 0.0, -0.07));
    P.exhaust.push(pipe([port.toArray(), [0.05, 0.735, -0.31], [0.11, 0.67, -0.32], [0.148, 0.6, -0.245], [0.163, 0.585, -0.12], [0.17, 0.605, 0.05], [0.175, 0.66, 0.22], [0.178, 0.725, 0.4], [0.18, 0.765, 0.5]], 0.019, 22, 5));
    P.dark.push(xf(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8, 1, true, -0.4, 1.9), [0.165, 0.615, 0.05], [Math.PI / 2 - 0.15, 0, 0])); // heat shield
  }
  // silencer (oval can) + end cap + tailpipe + bracket
  {
    const a = V(0.18, 0.765, 0.48), b = V(0.185, 0.845, 0.88), d = b.clone().sub(a), Ls = d.length();
    const can = new THREE.CylinderGeometry(0.044, 0.05, Ls, 12).scale(1, 1, 1.2).applyQuaternion(_q.setFromUnitVectors(UP, d.clone().normalize())).translate(...a.clone().add(b).multiplyScalar(0.5).toArray());
    P.dark.push(can);
    P.alu.push(rod(b.toArray(), b.clone().addScaledVector(d, 0.035 / Ls).toArray(), 0.044, 12, 0.036).scale(1, 1, 1));
    P.exhaust.push(rod(b.toArray(), b.clone().addScaledVector(d, 0.08 / Ls).toArray(), 0.015, 6));
    P.dark.push(rod([0.175, 0.815, 0.72], [0.075, 0.895, 0.66], 0.008, 4));
  }
  P.alu.push(side([[-0.33, 0.475], [-0.29, 0.335], [-0.22, 0.268], [0.08, 0.252], [0.105, 0.275], [0.09, 0.28], [-0.21, 0.288], [-0.275, 0.35], [-0.31, 0.48]], 0.22, 0.006, 1));

  // ---- swingarm (tapered alloy box arms), pivot, brace, chain slider, rear caliper, linkage + shock
  {
    const p0 = [0.12, 0.52], p1 = [0.765, 0.34], dz = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.hypot(dz, dy), nz = -dy / l, ny = dz / l;
    const h0 = 0.04, h1 = 0.026;
    const arm = side([[p0[0] - 0.03, p0[1] + h0 * 0.6], [p0[0] + nz * h0, p0[1] + ny * h0], [p1[0] + nz * h1, p1[1] + ny * h1], [p1[0] + 0.01, p1[1]], [p1[0] - nz * h1, p1[1] - ny * h1], [p0[0] - nz * h0, p0[1] - ny * h0], [p0[0] - 0.03, p0[1] - h0 * 0.6]], 0.034, 0.008, 1);
    for (const s of [-1, 1]) {
      P.alu.push(arm.clone().translate(s * 0.105, 0, 0));
      P.dark.push(new THREE.BoxGeometry(0.038, 0.03, 0.05).translate(s * 0.105, 0.34, 0.72)); // axle blocks / adjusters
    }
    P.alu.push(new THREE.BoxGeometry(0.19, 0.05, 0.06).translate(0, 0.468, 0.29));
    P.dark.push(new THREE.CylinderGeometry(0.03, 0.03, 0.24, 10).rotateZ(Math.PI / 2).translate(0, 0.52, 0.12));
    P.dark.push(xf(new THREE.BoxGeometry(0.04, 0.022, 0.24), [-0.105, 0.522, 0.27], [Math.atan2(dy, dz) * -1 + 0, 0, 0]));
    P.dark.push(rod([-0.135, RR, 0.72], [0.135, RR, 0.72], 0.011, 8));
    P.alu.push(xf(new THREE.BoxGeometry(0.026, 0.06, 0.075), [0.078, 0.255, 0.655], [0.5, 0, 0])); // rear caliper
    // chain: top + bottom runs between the sprockets, chain guide
    P.dark.push(rod([-0.08, 0.457, 0.03], [-0.076, 0.458, 0.72], 0.0065, 4));
    P.dark.push(rod([-0.08, 0.388, 0.04], [-0.076, 0.228, 0.71], 0.0065, 4));
    P.engine.push(new THREE.CylinderGeometry(0.037, 0.037, 0.012, 8).rotateZ(Math.PI / 2).translate(-0.082, 0.422, 0.033)); // front sprocket
    P.dark.push(xf(new THREE.BoxGeometry(0.03, 0.05, 0.1), [-0.08, 0.22, 0.6], [0.28, 0, 0]));
    // linkage + shock: frame cross-member under the seat down to the rocker under the swingarm
    const top = [0, 0.865, 0.17], bot = [0, 0.41, 0.3];
    P.alu.push(rod(top, [0, 0.69, 0.218], 0.024, 8));
    P.alu.push(rod([0, 0.69, 0.218], bot, 0.009, 6));
    P.alu.push(rod([0.04, 0.85, 0.15], [0.05, 0.74, 0.19], 0.02, 6)); // reservoir
    const sv = V(...bot).sub(V(...top)), sl = sv.length(), sq = new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), sv.clone().normalize()), pts = [];
    for (let i = 0; i <= 36; i++) { const t = i / 36, a = t * Math.PI * 2 * 6; pts.push(V(Math.cos(a) * 0.034, -0.08 - t * 0.27, Math.sin(a) * 0.034).applyQuaternion(sq).add(V(...top))); }
    P.dark.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.0055, 3, false));
    P.dark.push(rod([0, 0.4, 0.29], [0, 0.33, 0.18], 0.016, 6));
    P.dark.push(rod([0, 0.4, 0.3], [0, 0.45, 0.36], 0.014, 6));
  }

  // ---- bodywork: tank, shrouds / scoops, seat, side panels, rear fender + tail light, plate
  {
    const tank = side([[-0.335, 0.92], [-0.365, 0.975], [-0.34, 1.02], [-0.25, 1.044], [-0.1, 1.034], [0.0, 1.0], [0.055, 0.955], [0.06, 0.885], [-0.05, 0.86], [-0.25, 0.87]], 0.29, 0.055, 3);
    taper(tank, (y, z) => lerp(1, 0.62, clamp01((z + 0.12) / 0.18)) * lerp(1, 0.85, clamp01((y - 0.95) / 0.1)));
    P.plastic.push(smooth(tank));
    P.dark.push(new THREE.CylinderGeometry(0.033, 0.035, 0.016, 10).translate(0, 1.045, -0.2)); // filler cap
    for (const s of [-1, 1]) {
      const sh = side([[-0.465, 0.925], [-0.435, 0.982], [-0.32, 1.004], [-0.15, 0.99], [-0.075, 0.945], [-0.11, 0.865], [-0.26, 0.815], [-0.41, 0.835]], 0.012, 0.003, 1);
      P.plastic.push(xf(sh.translate(0, 0, 0.1), [s * 0.152, 0, -0.1], [0, -s * 0.13, 0]));
      P.dark.push(xf(new THREE.BoxGeometry(0.01, 0.12, 0.13), [s * 0.14, 0.9, -0.38], [0, -s * 0.5, 0])); // scoop louvre / oil cooler
      const sp = side([[0.08, 0.93], [0.56, 0.925], [0.62, 0.885], [0.47, 0.81], [0.24, 0.69], [0.1, 0.71]], 0.012, 0.003, 1);
      P.plastic.push(xf(sp, [s * 0.14, 0, 0], [0, -s * 0.03, 0]));
    }
    const seat = side([[-0.25, 0.97], [-0.19, 1.02], [-0.06, 1.018], [0.1, 0.985], [0.7, 0.978], [0.775, 0.968], [0.8, 0.935], [0.765, 0.905], [0.1, 0.9], [-0.05, 0.935], [-0.2, 0.952]], 0.25, 0.035, 3);
    taper(seat, (y, z) => lerp(0.66, 1, clamp01((z + 0.2) / 0.32)) * lerp(1, 0.86, clamp01((z - 0.55) / 0.25)));
    P.seat.push(smooth(seat));
    const rf = side(strip([[0.48, 0.905], [0.7, 0.906], [0.88, 0.918], [1.0, 0.932], [1.085, 0.945]], 0.009), 0.2, 0.002, 1);
    taper(rf, (y, z) => lerp(1, 0.68, clamp01((z - 0.7) / 0.38)), (x) => -2.2 * x * x);
    P.plastic.push(rf);
    P.dark.push(new THREE.BoxGeometry(0.1, 0.05, 0.065).translate(0, 0.883, 0.975));
    P.tail.push(new THREE.BoxGeometry(0.084, 0.036, 0.012).translate(0, 0.884, 1.009));
    P.dark.push(xf(new THREE.BoxGeometry(0.17, 0.11, 0.006), [0, 0.79, 1.0], [-0.12, 0, 0])); // number plate
    P.dark.push(rod([0, 0.86, 0.985], [0, 0.84, 0.995], 0.01, 4));
  }

  // ---- controls: footpegs, brake pedal, gear lever, kick-starter, side stand (folded)
  for (const s of [-1, 1]) {
    P.dark.push(new THREE.BoxGeometry(0.06, 0.04, 0.05).translate(s * 0.12, 0.395, 0.125));
    P.alu.push(new THREE.BoxGeometry(0.085, 0.022, 0.052).translate(s * 0.19, 0.392, 0.125));
    for (let k = 0; k < 2; k++) P.alu.push(new THREE.BoxGeometry(0.085, 0.008, 0.006).translate(s * 0.19, 0.406, 0.11 + k * 0.03));
  }
  P.dark.push(pipe([[0.12, 0.41, 0.085], [0.145, 0.395, -0.02], [0.165, 0.415, -0.1]], 0.009, 5, 4));
  P.dark.push(new THREE.BoxGeometry(0.04, 0.012, 0.03).translate(0.175, 0.422, -0.105));
  P.dark.push(pipe([[-0.115, 0.47, 0.0], [-0.14, 0.462, -0.07], [-0.175, 0.468, -0.13]], 0.008, 5, 4));
  P.dark.push(rod([-0.165, 0.468, -0.13], [-0.2, 0.468, -0.13], 0.009, 6));
  P.dark.push(pipe([[0.15, 0.55, -0.02], [0.165, 0.6, 0.09], [0.168, 0.63, 0.18]], 0.009, 5, 4));
  P.dark.push(pipe([[-0.1, 0.36, 0.08], [-0.13, 0.38, 0.22], [-0.135, 0.405, 0.4]], 0.012, 6, 4));
  P.dark.push(new THREE.BoxGeometry(0.045, 0.012, 0.05).translate(-0.135, 0.402, 0.42));

  // ---- one mesh per material per group (the kit merges again, this keeps the vertex count of the weathering pass low)
  const BODY = { dark: M.dark, engine: B.engine, alu: B.alu, plastic: B.plastic, seat: B.seat, exhaust: M.exhaust, rubber: M.rubber, tail: B.tail };
  for (const [k, list] of Object.entries(P)) if (list.length) add(merge(list), BODY[k]);
  const STEER = { dark: M.dark, alu: B.alu, plastic: B.plastic, rubber: M.rubber, lens: B.lens };
  for (const [k, list] of Object.entries(S)) if (list.length) add(merge(list), STEER[k], steer);

  root.userData = { type: 'bike', body, wheels: [rw, fw], front: [steer], wheelR: 0.35 };
  return finishVehicle(root);
}
