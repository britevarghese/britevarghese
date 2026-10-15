// Truck models, built from code (no model files). The body is merged into one mesh per material; the axles, wheels,
// leaf springs, shocks, propshafts and steering wheel are separate so they can follow the physics.
//
// Everything is laid out in the design frame of physics/trucks.js (origin on the ground mid-wheelbase at stock
// height, +x left, +z forward). The body and everything bolted to the frame rises by the build's lift and tyre growth
// (spec.raise); the axles sit where the physics puts them. So a lift shows as longer springs and shocks and a gap over
// the tyres, bigger tyres fill the arches, and the rest of the build is on the truck: the tread pattern, beadlocks,
// snorkel, light bar, roof rack, rock sliders, skid plates, the winch and its rope, a hood scoop on the big-block.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GRAV = 9.81;
const IN = 0.0254;

// ---------------------------------------------------------------- geometry helpers
/** A box with rounded edges: w (x) by h (y) by d (z), edge bevel r, rounded corners cr in the x-y outline. */
export function rbox(w, h, d, r = 0.03, cr = 0) {
  r = Math.max(0.001, Math.min(r, w / 2 - 0.002, h / 2 - 0.002, d / 2 - 0.002));
  const iw = w - 2 * r, ih = h - 2 * r;
  const c = Math.max(0, Math.min(cr, iw / 2 - 0.001, ih / 2 - 0.001));
  const s = new THREE.Shape();
  const x0 = -iw / 2, y0 = -ih / 2, x1 = iw / 2, y1 = ih / 2;
  s.moveTo(x0 + c, y0);
  s.lineTo(x1 - c, y0); if (c) s.quadraticCurveTo(x1, y0, x1, y0 + c);
  s.lineTo(x1, y1 - c); if (c) s.quadraticCurveTo(x1, y1, x1 - c, y1);
  s.lineTo(x0 + c, y1); if (c) s.quadraticCurveTo(x0, y1, x0, y1 - c);
  s.lineTo(x0, y0 + c); if (c) s.quadraticCurveTo(x0, y0, x0 + c, y0);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

/** A side silhouette (a Shape drawn in z, y of the design frame) extruded across x, halfW each side of x = 0. */
function slab(shape, halfW, bevel = 0.02, curveSegments = 10) {
  const depth = Math.max(0.002, 2 * (halfW - bevel));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);                     // (z, y, x) -> design frame
  return g;
}

/** An arch over a wheel at (zc, yc), radius r, cut into an outline being drawn along its bottom from rear to front. */
function arch(s, zc, yc, r, yRear, yFront) {
  s.absarc(zc, yc, r, Math.PI - Math.asin(Math.min(1, (yRear - yc) / r)), Math.asin(Math.min(1, (yFront - yc) / r)), true);
}

function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}

const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _e4 = new THREE.Euler(), _s4 = new THREE.Vector3(1, 1, 1), _p4 = new THREE.Vector3();

class PartList {
  constructor() { this.byMat = new Map(); }
  /** geometry g placed at p = [x, y, z] with rotation rot = [rx, ry, rz]; mirror: also at -x (rotation mirrored). */
  add(mat, g, p = [0, 0, 0], rot = null, mirror = false) {
    const put = (x, flip) => {
      const gg = g.clone();
      _e4.set(...(rot || [0, 0, 0]));
      if (flip && rot) _e4.set(rot[0], -rot[1], -rot[2]);
      _q4.setFromEuler(_e4);
      _m4.compose(_p4.set(x, p[1], p[2]), _q4, _s4);
      gg.applyMatrix4(_m4);
      if (!this.byMat.has(mat)) this.byMat.set(mat, []);
      this.byMat.get(mat).push(clean(gg));
    };
    put(p[0], false);
    if (mirror) put(-p[0], true);
    g.dispose();
  }
  box(mat, size, p, opt = {}) { this.add(mat, opt.r === 0 ? new THREE.BoxGeometry(...size) : rbox(size[0], size[1], size[2], opt.r ?? 0.02, opt.cr ?? 0), p, opt.rot, opt.mirror); }
  cyl(mat, rt, rb, len, p, opt = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, len, opt.seg || 12, 1, !!opt.open);
    if (opt.axis === 'x') g.rotateZ(Math.PI / 2); else if (opt.axis === 'z') g.rotateX(Math.PI / 2);
    this.add(mat, g, p, opt.rot, opt.mirror);
  }
  /** A round tube from a to b (design points). */
  tube(mat, a, b, r, opt = {}) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r, r, len, opt.seg || 10, 1, !!opt.open);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
    const c = A.add(B).multiplyScalar(0.5);
    this.add(mat, g, [c.x, c.y, c.z], null, opt.mirror);
  }
  /** A tube along a polyline (bent tube: roll bars, sliders, rack rails). */
  path(mat, pts, r, opt = {}) { for (let i = 1; i < pts.length; i++) this.tube(mat, pts[i - 1], pts[i], r, opt); }
  build(group, shadows = true) {
    for (const [mat, list] of this.byMat) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = shadows && !mat.transparent; m.receiveShadow = !mat.transparent;
      group.add(m);
    }
  }
}

// ---------------------------------------------------------------- materials
function paintMaterial(hex, uniforms) {
  const mat = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.2, roughness: 0.42, clearcoat: 0.55, clearcoatRoughness: 0.3 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = uniforms.uDirt;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLocal;
uniform float uDirt;
float dh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float dn(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dh(i), dh(i + vec3(1,0,0)), f.x), mix(dh(i + vec3(0,1,0)), dh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dh(i + vec3(0,0,1)), dh(i + vec3(1,0,1)), f.x), mix(dh(i + vec3(0,1,1)), dh(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // mud thrown up by the tyres: thickest low down and at the ends, in splashes
  float lowness = 1.0 - smoothstep(0.55, 1.45, vLocal.y);
  float splash = dn(vLocal * 7.0) * 0.6 + dn(vLocal * 19.0) * 0.4;
  float m = clamp(uDirt * 1.6 * lowness - (1.0 - splash) * 0.6, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.06, 0.04), m * 0.92);
}`);
  };
  return mat;
}

const MATS = {};
function shared() {
  if (MATS.black) return MATS;
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  MATS.black = std(0x1d1d1c, 0.7, 0.2);
  MATS.satin = std(0x2a2a29, 0.5, 0.45);
  MATS.chrome = std(0xe2e2df, 0.18, 1.0);
  MATS.alu = std(0xb9bbb8, 0.35, 0.85);
  MATS.glass = std(0x1d2a30, 0.06, 0.3, { transparent: true, opacity: 0.42, depthWrite: false });
  MATS.tire = std(0x1c1b1a, 0.95, 0);
  MATS.steel = std(0xe9e6dc, 0.45, 0.35);            // white steel wheels
  MATS.bead = std(0x222222, 0.5, 0.5);               // black beadlock wheels
  MATS.under = std(0x2c2a27, 0.82, 0.35);
  MATS.rust = std(0x4a3828, 0.9, 0.2);
  MATS.tail = std(0x7a1610, 0.3, 0.1, { emissive: 0x2a0000 });
  MATS.amber = std(0xd88a1f, 0.3, 0.1, { emissive: 0x2a1500 });
  MATS.canvas = std(0x8f8467, 0.96, 0);
  MATS.seat = std(0x3a2d22, 0.75, 0.05);
  MATS.plate = std(0xe8dcb0, 0.6, 0.2);
  MATS.olive = std(0x4f5a34, 0.7, 0.2);
  MATS.red = std(0xa3261b, 0.55, 0.3);
  MATS.rubber = std(0x121212, 0.9, 0);
  MATS.wood = std(0x7a5a3a, 0.85, 0);
  MATS.synth = std(0xd0571e, 0.7, 0);
  MATS.cable = std(0x55534e, 0.45, 0.8);
  return MATS;
}

// ---------------------------------------------------------------- wheels (cached: shared by every wheel of that size)
const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) { const g = make(); g.userData.cached = true; geoCache.set(key, g); }
  return geoCache.get(key);
}

/** Tyre with its tread: 0 all-terrain (small blocks), 1 mud-terrain (big blocks, open voids), 2 bias mud (paddles). */
function tireGeometry(r, w, tread = 0) {
  return cached(`t${r.toFixed(3)}:${w.toFixed(3)}:${tread}`, () => {
    const hw = w / 2, rim = r * 0.58, depth = [0.011, 0.02, 0.032][tread];
    const rc = r - depth;                                    // carcass under the lugs
    const prof = [[rim, -hw * 0.9], [rc * 0.9, -hw], [rc * 0.985, -hw * 0.85], [rc, -hw * 0.55], [rc, hw * 0.55], [rc * 0.985, hw * 0.85], [rc * 0.9, hw], [rim, hw * 0.9]]
      .map(([a, b]) => new THREE.Vector2(a, b));
    const parts = [clean(new THREE.LatheGeometry(prof, 36))];
    const lug = (a, y, len, wid, tilt = 0) => {
      // a block on the tread at angle a, y across; len along the tread, wid across, depth radial
      const g = clean(new THREE.BoxGeometry(depth * 2, wid, len));
      if (tilt) g.rotateX(tilt);
      g.translate(rc + depth * 0.5, y, 0);
      g.rotateY(-a);
      parts.push(g);
    };
    const C = 2 * Math.PI * r;
    if (tread === 0) {
      const n = Math.round(C / 0.055);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        lug(a, -hw * 0.6, C / n * 0.62, w * 0.26);
        lug(a + Math.PI / n, 0, C / n * 0.62, w * 0.3);
        lug(a, hw * 0.6, C / n * 0.62, w * 0.26);
      }
    } else if (tread === 1) {
      const n = Math.round(C / 0.085);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        lug(a, -hw * 0.42, C / n * 0.55, w * 0.4);
        lug(a + Math.PI / n, hw * 0.42, C / n * 0.55, w * 0.4);
        // shoulder lugs wrapping onto the sidewall
        lug(a + Math.PI / n, -hw * 0.92, C / n * 0.42, w * 0.14);
        lug(a, hw * 0.92, C / n * 0.42, w * 0.14);
      }
    } else {
      const n = Math.round(C / 0.13);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        // paddles in a V, each half leaning back from the centre line
        lug(a, -hw * 0.45, 0.045, w * 0.56, 0.5);
        lug(a + Math.PI / n, hw * 0.45, 0.045, w * 0.56, -0.5);
      }
    }
    const g = mergeGeometries(parts);
    g.rotateZ(Math.PI / 2);                                  // axle along x
    return g;
  });
}

/** Steel wheel (white, dished, 5 lug nuts) or beadlock (black, a bolted outer ring); outer face toward +x. */
function rimGeometry(r, w, beadlock) {
  return cached(`r${r.toFixed(3)}:${w.toFixed(3)}:${beadlock ? 1 : 0}`, () => {
    const rr = r, hw = w * 0.42, parts = [];
    const shell = new THREE.CylinderGeometry(rr, rr, 2 * hw, 24, 1, true); shell.rotateZ(Math.PI / 2); parts.push(clean(shell));
    const dish = new THREE.CylinderGeometry(rr * 0.92, rr * 0.92, 0.02, 24); dish.rotateZ(Math.PI / 2); dish.translate(hw * 0.35, 0, 0); parts.push(clean(dish));
    const hub = new THREE.CylinderGeometry(rr * 0.3, rr * 0.36, 0.06, 14); hub.rotateZ(Math.PI / 2); hub.translate(hw * 0.5, 0, 0); parts.push(clean(hub));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const nut = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6); nut.rotateZ(Math.PI / 2);
      nut.translate(hw * 0.5 + 0.03, Math.cos(a) * rr * 0.22, Math.sin(a) * rr * 0.22); parts.push(clean(nut));
    }
    // vent holes read as dark bosses on a steel wheel; a beadlock has its ring and bolts
    const n = beadlock ? 20 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rad = beadlock ? rr * 1.05 : rr * 0.62;
      const b = new THREE.CylinderGeometry(beadlock ? 0.009 : 0.03, beadlock ? 0.009 : 0.03, beadlock ? 0.03 : 0.025, 6); b.rotateZ(Math.PI / 2);
      b.translate(hw + (beadlock ? 0.02 : -0.02), Math.cos(a) * rad, Math.sin(a) * rad); parts.push(clean(b));
    }
    if (beadlock) {
      const ring = new THREE.TorusGeometry(rr * 1.05, 0.03, 6, 32); ring.rotateY(Math.PI / 2); ring.translate(hw + 0.005, 0, 0); parts.push(clean(ring));
    } else {
      const lip = new THREE.TorusGeometry(rr, 0.012, 5, 28); lip.rotateY(Math.PI / 2); lip.translate(hw, 0, 0); parts.push(clean(lip));
    }
    return mergeGeometries(parts);
  });
}

// ---------------------------------------------------------------- bodies (design frame, stock height)
// Each draws the body in its paint, the top, glass, trim and interior, and returns where its lamps and fittings are.

function rangerBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.84, zF = 1.76, zB = -2.0, belt = 1.11, yc = 0.4, ar = 0.49;
  // tub, fenders and hood in one side silhouette with the wheel arches cut in
  const s = new THREE.Shape();
  s.moveTo(zF, 0.58);
  s.lineTo(zF, belt - 0.05); s.quadraticCurveTo(zF, belt, zF - 0.05, belt);
  s.lineTo(zB + 0.05, belt); s.quadraticCurveTo(zB, belt, zB, belt - 0.05);
  s.lineTo(zB, 0.52);
  arch(s, zr, yc, ar, 0.52, 0.48);
  arch(s, zf, yc, ar, 0.48, 0.58);
  s.lineTo(zF, 0.58);
  P.add(paint, slab(s, half + 0.025, 0.025));
  // wheel wells: liners behind the arches
  for (const z of [zf, zr]) {
    const g = new THREE.CylinderGeometry(ar - 0.01, ar - 0.01, 2 * half - 0.12, 20, 1, true, Math.PI / 2 - 1.25, 2.5); g.rotateZ(Math.PI / 2);
    P.add(M.under, g, [0, yc, z]);
  }
  // hood with its seams, cowl vent, a crease down each side
  P.box(paint, [1.46, 0.025, 1.18], [0, belt + 0.012, 1.15], { r: 0.01 });
  P.box(M.black, [0.008, 0.01, 1.18], [0.735, belt + 0.004, 1.15], { r: 0, mirror: true });
  P.box(M.black, [1.4, 0.01, 0.06], [0, belt + 0.006, 0.5], { r: 0 });
  P.box(paint, [0.014, 0.03, 3.6], [half + 0.032, 0.86, -0.14], { r: 0.004, mirror: true });
  // doors: seams, handles, mirrors
  for (const z of [0.4, -0.6]) P.box(M.black, [0.006, 0.52, 0.007], [half + 0.026, 0.83, z], { r: 0, mirror: true });
  P.box(M.black, [0.006, 0.007, 1.0], [half + 0.026, 0.57, -0.1], { r: 0, mirror: true });
  P.box(M.chrome, [0.025, 0.025, 0.12], [half + 0.035, 1.0, -0.48], { r: 0.008, mirror: true });
  P.tube(M.black, [half + 0.02, 1.22, 0.33], [half + 0.12, 1.3, 0.3], 0.012, { mirror: true });
  P.box(M.black, [0.03, 0.13, 0.17], [half + 0.13, 1.33, 0.3], { r: 0.015, mirror: true });
  // windscreen frame and glass, wipers
  const wsB = [0.47, belt], wsT = [0.4, 1.74], rake = Math.atan2(wsB[0] - wsT[0], wsT[1] - wsB[1]);
  const wsC = [(wsB[0] + wsT[0]) / 2, (wsB[1] + wsT[1]) / 2], wsL = Math.hypot(wsT[0] - wsB[0], wsT[1] - wsB[1]);
  P.box(paint, [0.05, wsL, 0.05], [0.785, wsC[1], wsC[0]], { r: 0.012, rot: [-rake, 0, 0], mirror: true });
  P.box(paint, [1.62, 0.05, 0.06], [0, wsT[1] - 0.02, wsT[0]], { r: 0.012 });
  P.box(M.glass, [1.52, wsL - 0.06, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
  P.box(M.black, [0.5, 0.012, 0.012], [0.22, belt + 0.06, 0.465], { r: 0, rot: [0, 0, 0.25] });
  P.box(M.black, [0.5, 0.012, 0.012], [-0.32, belt + 0.06, 0.465], { r: 0, rot: [0, 0, 0.25] });
  // the hardtop: roof, pillars, side and back glass
  P.box(top, [1.62, 0.07, 2.42], [0, 1.755, -0.8], { r: 0.035, cr: 0.03 });
  for (const z of [-0.62, -1.96]) P.box(top, [0.05, 0.62, 0.08], [0.79, 1.43, z], { r: 0.015, mirror: true });
  P.box(top, [0.06, 0.06, 2.42], [0.79, belt + 0.04, -0.8], { r: 0.015, mirror: true });
  P.box(top, [1.62, 0.62, 0.05], [0, 1.43, -2.0], { r: 0.02 });
  P.box(M.glass, [0.012, 0.5, 0.96], [0.8, 1.43, -0.11], { r: 0, mirror: true });
  P.box(M.glass, [0.012, 0.5, 1.26], [0.8, 1.43, -1.29], { r: 0, mirror: true });
  P.box(M.glass, [1.36, 0.44, 0.012], [0, 1.44, -2.03], { r: 0 });
  // grille panel: mesh insert, round headlamps, parking lamps
  P.box(M.black, [1.0, 0.27, 0.02], [0, 0.92, zF + 0.02], { r: 0.008 });
  for (const y of [0.83, 0.88, 0.93, 0.98]) P.box(paint, [0.98, 0.018, 0.02], [0, y, zF + 0.032], { r: 0.005 });
  P.box(M.amber, [0.1, 0.05, 0.02], [0.62, 0.79, zF + 0.025], { r: 0.008, mirror: true });
  // rear: tailgate seams, tail lamps, plate, CB aerial, mud flaps
  P.box(M.black, [0.006, 0.55, 0.006], [0.78, 0.83, zB - 0.026], { r: 0, mirror: true });
  P.box(M.plate, [0.3, 0.15, 0.012], [0, 0.78, zB - 0.03], { r: 0.005 });
  P.box(M.chrome, [0.16, 0.03, 0.03], [0, 1.0, zB - 0.03], { r: 0.01 });
  P.cyl(M.black, 0.006, 0.004, 1.3, [-0.8, 1.8 + 0.65, -1.9]);
  P.cyl(M.chrome, 0.02, 0.02, 0.04, [-0.8, 1.79, -1.9]);
  // interior: seats, rear bench, floor, dash with gauges
  P.box(M.black, [1.6, 0.03, 2.5], [0, 0.66, -0.75], { r: 0 });
  P.box(M.seat, [0.5, 0.12, 0.5], [0.38, 0.84, -0.35], { r: 0.04, mirror: true });
  P.box(M.seat, [0.5, 0.56, 0.1], [0.38, 1.14, -0.62], { r: 0.04, rot: [-0.14, 0, 0], mirror: true });
  P.box(M.seat, [1.4, 0.12, 0.5], [0, 0.84, -1.35], { r: 0.04 });
  P.box(M.seat, [1.4, 0.5, 0.1], [0, 1.1, -1.62], { r: 0.04, rot: [-0.12, 0, 0] });
  P.box(M.black, [1.56, 0.17, 0.24], [0, 1.03, 0.36], { r: 0.03 });
  for (const x of [0.3, 0.46]) P.cyl(M.chrome, 0.045, 0.045, 0.02, [x, 1.07, 0.23], { axis: 'z', seg: 14 });
  return {
    heads: [[0.6, 0.93, zF + 0.025, 0.088]],
    tails: [[0.79, 0.9, zB - 0.028, 0.07, 0.17]], reverse: [[0.79, 0.74, zB - 0.028, 0.07, 0.06]],
    bumperF: { z: zF + 0.1, y: 0.52, w: 1.78 }, bumperR: { z: zB - 0.08, y: 0.52, w: 1.72 },
    spare: { x: 0.36, z: zB - 0.04, mount: 'rear' },
    wheel: { x: 0.38, y: 1.2, z: 0.04, tilt: 0.42 },
    frame: { x: 0.42, y: 0.52, z0: zB + 0.05, z1: zF - 0.05 },
    flaps: true, sill: 0.47, half, roofY: 1.79, roofZ: [-2.0, 0.4],
  };
}

function haulerBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.98, zF = 2.44, zCab = -0.38, zBed0 = -0.46, zB = -2.84, belt = 1.19, yc = 0.44, ar = 0.53;
  // front clip and cab lower: one silhouette with the front arch
  const s = new THREE.Shape();
  s.moveTo(zF, 0.64);
  s.lineTo(zF, belt - 0.07); s.quadraticCurveTo(zF, belt - 0.02, zF - 0.06, belt - 0.02);
  s.lineTo(0.66, belt); s.lineTo(zCab + 0.04, belt); s.quadraticCurveTo(zCab, belt, zCab, belt - 0.04);
  s.lineTo(zCab, 0.56);
  arch(s, zf, yc, ar, 0.56, 0.64);
  s.lineTo(zF, 0.64);
  P.add(paint, slab(s, half + 0.02, 0.02));
  // bed sides with the rear arch
  const b = new THREE.Shape();
  b.moveTo(zBed0, 0.6);
  b.lineTo(zBed0, belt); b.lineTo(zB, belt); b.lineTo(zB, 0.62);
  arch(b, zr, yc, ar, 0.62, 0.6);
  b.lineTo(zBed0, 0.6);
  for (const sx of [1, -1]) { const g = slab(b, 0.04, 0.012); g.translate(sx * (half - 0.02), 0, 0); P.add(paint, g); }
  P.box(top, [0.012, 0.035, zBed0 - zB], [half + 0.02, belt - 0.02, (zBed0 + zB) / 2], { r: 0.005, mirror: true });   // bed rail caps
  P.box(M.rust, [1.86, 0.04, zBed0 - zB], [0, 0.94, (zBed0 + zB) / 2], { r: 0 });
  for (let i = 0; i < 6; i++) P.box(M.alu, [0.03, 0.012, zBed0 - zB - 0.1], [-0.75 + i * 0.3, 0.965, (zBed0 + zB) / 2], { r: 0 });
  P.box(paint, [1.92, 0.27, 0.05], [0, belt - 0.12, zBed0 + 0.01], { r: 0.015 });
  P.box(paint, [1.92, 0.56, 0.05], [0, 0.9, zB - 0.01], { r: 0.015 });
  P.box(M.chrome, [0.2, 0.04, 0.02], [0, 1.08, zB - 0.04], { r: 0.008 });
  P.box(M.under, [0.3, 0.32, 1.06], [0.79, 1.0, zr], { r: 0.04, mirror: true });
  // front wheel wells
  {
    const g = new THREE.CylinderGeometry(ar - 0.01, ar - 0.01, 2 * half - 0.14, 20, 1, true, Math.PI / 2 - 1.25, 2.5); g.rotateZ(Math.PI / 2);
    P.add(M.under, g, [0, yc, zf]);
  }
  // hood, two-tone side stripe, door seams and handles, west-coast mirrors
  P.box(paint, [1.62, 0.025, 1.76], [0, belt + 0.002, 1.56], { r: 0.01, rot: [0.012, 0, 0] });
  P.box(M.black, [0.008, 0.01, 1.76], [0.81, belt - 0.004, 1.56], { r: 0, mirror: true });
  P.box(top, [0.012, 0.1, 5.2], [half + 0.025, 0.9, -0.2], { r: 0.004, mirror: true });
  for (const z of [0.62, -0.33]) P.box(M.black, [0.006, 0.6, 0.007], [half + 0.026, 0.88, z], { r: 0, mirror: true });
  P.box(M.chrome, [0.025, 0.03, 0.14], [half + 0.035, 1.07, -0.24], { r: 0.008, mirror: true });
  P.tube(M.chrome, [half + 0.01, 1.3, 0.55], [half + 0.17, 1.42, 0.5], 0.01, { mirror: true });
  P.tube(M.chrome, [half + 0.01, 1.62, 0.5], [half + 0.17, 1.52, 0.48], 0.01, { mirror: true });
  P.box(M.black, [0.03, 0.26, 0.17], [half + 0.18, 1.47, 0.48], { r: 0.015, mirror: true });
  // cab: roof, pillars, back wall, glass
  const wsB = [0.64, belt + 0.01], wsT = [0.42, 1.82], rake = Math.atan2(wsB[0] - wsT[0], wsT[1] - wsB[1]);
  const wsC = [(wsB[0] + wsT[0]) / 2, (wsB[1] + wsT[1]) / 2], wsL = Math.hypot(wsT[0] - wsB[0], wsT[1] - wsB[1]);
  P.box(top, [1.68, 0.08, 0.86], [0, 1.845, 0.03], { r: 0.04, cr: 0.03 });
  P.box(paint, [0.06, wsL, 0.07], [0.82, wsC[1], wsC[0]], { r: 0.015, rot: [-rake, 0, 0], mirror: true });
  P.box(paint, [0.06, 0.64, 0.12], [0.82, 1.5, -0.32], { r: 0.015, mirror: true });
  P.box(paint, [1.68, 0.64, 0.06], [0, 1.5, zCab + 0.01], { r: 0.02 });
  P.box(M.glass, [1.56, wsL - 0.06, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
  P.box(M.glass, [0.012, 0.52, 0.8], [0.83, 1.48, 0.14], { r: 0, mirror: true });
  P.box(M.glass, [1.2, 0.36, 0.012], [0, 1.52, zCab - 0.025], { r: 0 });
  P.box(M.amber, [0.12, 0.04, 0.05], [0.4, 1.89, 0.42], { r: 0.01, mirror: true });
  // grille: chrome surround, egg-crate insert
  P.box(M.chrome, [1.66, 0.42, 0.04], [0, 0.93, zF + 0.02], { r: 0.015 });
  P.box(M.black, [1.1, 0.3, 0.03], [0, 0.93, zF + 0.035], { r: 0.008 });
  for (let i = -3; i <= 3; i++) P.box(M.chrome, [0.018, 0.3, 0.02], [i * 0.155, 0.93, zF + 0.045], { r: 0 });
  P.box(M.chrome, [1.1, 0.018, 0.02], [0, 0.93, zF + 0.045], { r: 0 });
  P.box(M.chrome, [0.3, 0.25, 0.03], [0.7, 0.95, zF + 0.04], { r: 0.012, mirror: true });
  P.box(M.amber, [0.16, 0.05, 0.02], [0.7, 0.8, zF + 0.04], { r: 0.008, mirror: true });
  P.box(M.plate, [0.3, 0.15, 0.012], [0, 0.72, zB - 0.04], { r: 0.005 });
  // interior: bench seat, dash
  P.box(M.black, [1.8, 0.03, 0.95], [0, 0.72, 0.12], { r: 0 });
  P.box(M.seat, [1.56, 0.13, 0.5], [0, 0.9, -0.06], { r: 0.04 });
  P.box(M.seat, [1.56, 0.56, 0.12], [0, 1.2, -0.3], { r: 0.04, rot: [-0.1, 0, 0] });
  P.box(M.black, [1.66, 0.2, 0.28], [0, 1.12, 0.5], { r: 0.035 });
  for (const x of [0.32, 0.5]) P.cyl(M.chrome, 0.05, 0.05, 0.02, [x, 1.16, 0.355], { axis: 'z', seg: 14 });
  return {
    heads: [[0.7, 0.97, zF + 0.05, 0.085]],
    tails: [[0.88, 0.99, zB - 0.035, 0.12, 0.24]], reverse: [[0.88, 0.82, zB - 0.035, 0.12, 0.07]],
    bumperF: { z: zF + 0.12, y: 0.56, w: 2.0, chrome: true }, bumperR: { z: zB - 0.1, y: 0.54, w: 2.0, chrome: true, step: true },
    spare: { x: 0, z: -2.35, mount: 'under' },
    wheel: { x: 0.42, y: 1.33, z: 0.24, tilt: 0.5 },
    frame: { x: 0.46, y: 0.56, z0: zB + 0.05, z1: zF - 0.1 },
    flaps: true, sill: 0.53, half, roofY: 1.88, roofZ: [zCab, 0.45],
  };
}

function muleBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.69, zFw = 0.3, zB = -1.82, belt = 1.0, yc = 0.39, ar = 0.47, fy = 0.9;
  // the tub, with its door openings and the rear arches
  const s = new THREE.Shape();
  s.moveTo(zFw, 0.5);
  s.lineTo(zFw, belt); s.lineTo(0.24, belt);
  s.quadraticCurveTo(0.2, 0.72, 0.05, 0.72); s.lineTo(-0.38, 0.72); s.quadraticCurveTo(-0.53, 0.72, -0.56, belt);
  s.lineTo(zB + 0.05, belt); s.quadraticCurveTo(zB, belt, zB, belt - 0.05);
  s.lineTo(zB, 0.5);
  arch(s, zr, yc, ar, 0.5, 0.48);
  s.lineTo(zFw, 0.5);
  P.add(paint, slab(s, half + 0.015, 0.015));
  {
    const g = new THREE.CylinderGeometry(ar - 0.01, ar - 0.01, 2 * half - 0.1, 20, 1, true, Math.PI / 2 - 1.25, 2.5); g.rotateZ(Math.PI / 2);
    P.add(M.under, g, [0, yc, zr]);
  }
  // engine bay sides and hood, between flat front fenders
  P.box(paint, [1.04, 0.36, 1.26], [0, 0.86, 0.93], { r: 0.015 });
  P.box(paint, [1.06, 0.04, 1.28], [0, 1.05, 0.93], { r: 0.015 });
  P.box(M.black, [0.03, 0.02, 0.04], [0.42, 1.075, 1.3], { r: 0.008, mirror: true });
  P.box(paint, [0.3, 0.03, 1.2], [0.67, fy, 0.94], { r: 0.01, mirror: true });
  P.box(paint, [0.3, 0.03, 0.22], [0.67, fy - 0.11, 0.25], { r: 0.01, rot: [0.75, 0, 0], mirror: true });
  P.box(paint, [0.3, 0.12, 0.03], [0.67, fy - 0.05, 1.53], { r: 0.008, mirror: true });
  P.box(M.under, [0.03, 0.42, 1.2], [0.52, 0.7, 0.94], { r: 0, mirror: true });
  P.box(M.amber, [0.07, 0.05, 0.05], [0.76, fy + 0.03, 1.45], { r: 0.01, mirror: true });
  // grille panel: a mesh insert, the lamps inboard of the fenders
  P.box(paint, [1.04, 0.44, 0.03], [0, 0.84, 1.58], { r: 0.01 });
  P.box(M.black, [0.5, 0.3, 0.02], [0, 0.82, 1.598], { r: 0.005 });
  for (let i = -5; i <= 5; i++) P.box(M.satin, [0.012, 0.3, 0.012], [i * 0.045, 0.82, 1.605], { r: 0 });
  P.box(M.plate, [0.3, 0.15, 0.012], [-0.36, 0.72, zB - 0.02], { r: 0.005 });
  // folding windscreen, canvas top on a roll bar
  const wsB = [zFw, belt + 0.02], wsT = [0.24, 1.62], rake = Math.atan2(wsB[0] - wsT[0], wsT[1] - wsB[1]);
  const wsC = [(wsB[0] + wsT[0]) / 2, (wsB[1] + wsT[1]) / 2], wsL = Math.hypot(wsT[0] - wsB[0], wsT[1] - wsB[1]);
  P.box(paint, [0.05, wsL, 0.05], [0.7, wsC[1], wsC[0]], { r: 0.012, rot: [-rake, 0, 0], mirror: true });
  P.box(paint, [1.44, 0.05, 0.05], [0, wsT[1], wsT[0]], { r: 0.012 });
  P.box(paint, [1.44, 0.06, 0.05], [0, wsB[1] + 0.02, wsB[0]], { r: 0.012 });
  P.box(M.glass, [1.34, wsL - 0.08, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
  P.box(M.black, [0.42, 0.012, 0.012], [0.2, wsT[1] - 0.04, wsT[0] + 0.02], { r: 0, rot: [0, 0, -0.2] });
  P.path(M.black, [[0.62, belt, -0.75], [0.62, 1.6, -0.75], [-0.62, 1.6, -0.75], [-0.62, belt, -0.75]], 0.025);
  P.box(top, [1.44, 0.04, 1.86], [0, 1.69, -0.68], { r: 0.015 });
  P.box(top, [0.015, 0.64, 1.52], [0.715, 1.36, -0.82], { r: 0, mirror: true });
  P.box(top, [1.42, 0.64, 0.015], [0, 1.36, -1.6], { r: 0 });
  P.box(M.glass, [0.02, 0.24, 0.62], [0.72, 1.42, -0.92], { r: 0, mirror: true });
  P.box(M.glass, [0.9, 0.22, 0.02], [0, 1.42, -1.61], { r: 0 });
  P.box(M.black, [0.03, 0.13, 0.1], [0.74, 1.24, 0.3], { r: 0.012, mirror: true });
  // interior: buckets, bench, floor, a flat dash
  P.box(M.black, [1.36, 0.03, 2.1], [0, 0.6, -0.75], { r: 0 });
  P.box(M.seat, [0.46, 0.12, 0.46], [0.32, 0.8, -0.36], { r: 0.04, mirror: true });
  P.box(M.seat, [0.46, 0.5, 0.1], [0.32, 1.06, -0.6], { r: 0.04, rot: [-0.14, 0, 0], mirror: true });
  P.box(M.seat, [1.2, 0.12, 0.42], [0, 0.8, -1.3], { r: 0.04 });
  P.box(M.black, [1.32, 0.14, 0.1], [0, 0.94, 0.25], { r: 0.02 });
  P.cyl(M.chrome, 0.045, 0.045, 0.02, [0.32, 0.95, 0.195], { axis: 'z', seg: 14 });
  return {
    heads: [[0.38, 0.92, 1.6, 0.082]],
    tails: [[0.6, 0.86, zB - 0.02, 0.08, 0.1]], reverse: [[0.6, 0.76, zB - 0.02, 0.05, 0.05]],
    bumperF: { z: 1.66, y: 0.5, w: 1.6 }, bumperR: { z: zB - 0.06, y: 0.5, w: 0.3, ettes: 0.56 },
    spare: { x: -0.32, z: zB - 0.03, mount: 'rear' },
    wheel: { x: 0.32, y: 1.1, z: 0.04, tilt: 0.55 },
    frame: { x: 0.38, y: 0.46, z0: zB + 0.04, z1: 1.52 },
    flaps: false, sill: 0.45, half: 0.8, roofY: 1.72, roofZ: [-1.62, 0.24],
  };
}

const BUILDERS = { ranger: rangerBody, hauler: haulerBody, mule: muleBody };

// ---------------------------------------------------------------- chassis, bumpers and the build's parts
function chassis(P, M, spec, x) {
  const f = x.frame, front = spec.axles[0].z, rear = spec.axles[1].z;
  // frame rails and crossmembers
  P.box(M.under, [0.07, 0.15, f.z1 - f.z0], [f.x, f.y + 0.075, (f.z0 + f.z1) / 2], { r: 0.01, mirror: true });
  for (const z of [f.z1 - 0.1, 0.6, -0.4, rear - 0.55, f.z0 + 0.1]) P.box(M.under, [2 * f.x, 0.1, 0.08], [0, f.y + 0.06, z], { r: 0.01 });
  // engine and oil pan, gearbox, transfer case (the lowest point of the belly), fuel tank
  P.box(M.satin, [0.58, 0.42, 0.78], [0, f.y + 0.32, front - 0.12], { r: 0.05 });
  P.box(M.under, [0.44, 0.14, 0.5], [0, f.y - 0.02, front - 0.05], { r: 0.03 });
  P.box(M.under, [0.3, 0.28, 0.72], [0, f.y + 0.06, front - 0.85], { r: 0.06 });
  const belly = spec.hull[1].c[1] - spec.hull[1].h[1] - (spec.raise || 0);
  P.box(M.under, [0.36, f.y + 0.1 - belly, 0.38], [0.08, (belly + f.y + 0.1) / 2, front - 1.35 > rear + 0.6 ? front - 1.35 : 0], { r: 0.04 });
  P.box(M.under, [0.75, 0.24, 0.6], [0.2, f.y + 0.06, rear + 0.48], { r: 0.04 });
  // exhaust down the passenger side, muffler, tailpipe
  const ex = -f.x - 0.12, tailZ = x.bumperR.z + 0.12;
  P.path(M.rust, [[-0.2, f.y + 0.12, front - 0.3], [ex, f.y - 0.02, front - 0.75], [ex, f.y - 0.02, rear + 0.25], [ex, f.y + 0.02, tailZ]], 0.028);
  P.box(M.rust, [0.22, 0.15, 0.62], [ex, f.y - 0.02, (front + rear) / 2 + 0.1], { r: 0.06 });
  // bump stops over the axles
  for (const a of spec.axles) P.box(M.rubber, [0.07, 0.07, 0.07], [a.springTrack / 2, f.y - 0.04, a.z], { r: 0.015, mirror: true });
  return belly;
}

function bumpers(P, M, spec, x, winch) {
  const bf = x.bumperF, br = x.bumperR, fl = spec.winch.fairlead;
  const fy = fl[1] - (spec.raise || 0), fz = fl[2];
  // front: a steel winch bumper, the winch on top in its cradle and the fairlead in the front face
  const top = bf.y + 0.17, face = Math.max(bf.z + 0.08, fz);
  P.box(M.black, [bf.w, 0.17, face - bf.z + 0.08], [0, bf.y + 0.085, (face + bf.z - 0.08) / 2], { r: 0.02 });
  P.box(M.black, [0.62, 0.04, 0.3], [0, top + 0.02, face - 0.15], { r: 0.01 });
  P.cyl(M.satin, 0.075, 0.075, 0.2, [0.33, top + 0.11, face - 0.17], { axis: 'x', seg: 14 });
  P.box(M.satin, [0.14, 0.15, 0.15], [-0.31, top + 0.11, face - 0.17], { r: 0.02 });
  P.cyl(winch.synthetic ? M.synth : M.cable, 0.07, 0.07, 0.42, [0, top + 0.11, face - 0.17], { axis: 'x', seg: 14 });
  P.cyl(M.satin, 0.085, 0.085, 0.02, [0.22, top + 0.11, face - 0.17], { axis: 'x', seg: 14, mirror: true });
  const fy2 = Math.min(fy, top - 0.06);
  if (winch.synthetic) {
    P.box(M.alu, [0.3, 0.11, 0.03], [0, fy2, face + 0.012], { r: 0.012 });
    P.box(M.black, [0.19, 0.035, 0.035], [0, fy2, face + 0.016], { r: 0.014 });
  } else {
    P.box(M.satin, [0.32, 0.14, 0.05], [0, fy2, face + 0.02], { r: 0.01 });
    P.cyl(M.chrome, 0.02, 0.02, 0.2, [0, fy2 + 0.035, face + 0.04], { axis: 'x' });
    P.cyl(M.chrome, 0.02, 0.02, 0.2, [0, fy2 - 0.035, face + 0.04], { axis: 'x' });
    P.cyl(M.chrome, 0.02, 0.02, 0.1, [0.075, fy2, face + 0.04], { mirror: true });
  }
  P.tube(winch.synthetic ? M.synth : M.cable, [0, top + 0.05, face - 0.13], [0, fy2, face], 0.01);
  P.box(M.red, [0.05, 0.08, 0.06], [0, fy2 - 0.06, face + 0.08], { r: 0.012 });
  P.box(M.red, [0.04, 0.09, 0.12], [bf.w / 2 - 0.25, bf.y - 0.02, face - 0.02], { r: 0.012, mirror: true });
  // rear bumper (or bumperettes), hitch receiver
  if (br.ettes) P.box(M.black, [0.28, 0.12, 0.12], [br.ettes, br.y + 0.06, br.z], { r: 0.02, mirror: true });
  else P.box(br.chrome ? M.chrome : M.black, [br.w, br.step ? 0.17 : 0.14, br.step ? 0.2 : 0.14], [0, br.y + 0.08, br.z], { r: br.chrome ? 0.04 : 0.02 });
  P.box(M.black, [0.07, 0.07, 0.2], [0, br.y + 0.02, br.z - 0.06], { r: 0.01 });
}

/** The build's add-ons (design frame, stock height: the body group is raised). */
function buildParts(P, M, spec, x, base, lightBar) {
  const b = spec.build || {}, raise = spec.raise || 0;
  // snorkel: up the windscreen pillar on the passenger side to a ram head at roof height
  if (spec.snorkel) {
    const [sx, sy0, sz] = spec.intake, sy = sy0 - raise, belt = spec.hull[0].c[1] + spec.hull[0].h[1] - raise;
    P.path(M.black, [[sx + 0.08, belt - 0.02, sz + 0.42], [sx, belt + 0.08, sz + 0.16], [sx, sy - 0.08, sz + 0.02]], 0.05, { seg: 12 });
    P.box(M.black, [0.15, 0.13, 0.22], [sx, sy, sz + 0.06], { r: 0.04 });
    P.box(M.satin, [0.11, 0.09, 0.02], [sx, sy, sz + 0.17], { r: 0.01 });
    P.box(M.satin, [0.03, 0.04, 0.08], [sx + 0.05, belt + 0.25, sz + 0.1], { r: 0.008 });
  }
  // roof rack: a tubular basket (a bed rack on the pickup), with fuel, water and a spare on the loaded one
  if (b.rack) {
    const roof = x.roofY, z0 = Math.max(x.roofZ[0] + 0.08, base.rackZ - 0.9), z1 = Math.min(x.roofZ[1] - 0.08, base.rackZ + 0.9);
    const bed = spec.style === 'hauler', hw = bed ? 0.86 : 0.7, y = bed ? roof + 0.02 : roof + 0.1, zc = bed ? base.rackZ : (z0 + z1) / 2;
    const zA = bed ? base.rackZ - 1.0 : z0, zB = bed ? base.rackZ + 1.0 : z1;
    P.path(M.black, [[hw, y, zA], [hw, y, zB], [-hw, y, zB], [-hw, y, zA], [hw, y, zA]], 0.018);
    P.path(M.black, [[hw, y + 0.1, zA], [hw, y + 0.1, zB], [-hw, y + 0.1, zB], [-hw, y + 0.1, zA], [hw, y + 0.1, zA]], 0.014);
    for (let i = 0; i <= 4; i++) { const z = zA + (zB - zA) * i / 4; P.tube(M.black, [hw, y, z], [-hw, y, z], 0.012); P.tube(M.black, [hw, y, z], [hw, y + 0.1, z], 0.01, { mirror: true }); }
    if (bed) for (const z of [zA, zB]) P.tube(M.black, [hw + 0.08, 1.2, z], [hw, y, z], 0.022, { mirror: true });
    else for (const z of [zA + 0.1, zB - 0.1]) P.box(M.black, [0.06, 0.1, 0.06], [hw - 0.02, roof + 0.04, z], { r: 0.01, mirror: true });
    if (b.rack === 2) {
      for (let i = 0; i < 3; i++) P.box(i === 2 ? M.red : M.olive, [0.17, 0.34, 0.46], [hw - 0.15 - i * 0.2, y + 0.18, zA + 0.3], { r: 0.02 });
      P.box(M.wood, [0.6, 0.26, 0.42], [-0.25, y + 0.14, zc + 0.15], { r: 0.015 });
      P.box(M.red, [0.08, 0.08, 1.2], [-hw + 0.1, y + 0.06, zc], { r: 0.01 });
      const t = spec.tyre, tg = tireGeometry(t.radius, t.width, t.tread).clone(); tg.rotateZ(Math.PI / 2);
      P.add(M.tire, tg, [0.25, y + t.width / 2 + 0.01, zB - t.radius - 0.05]);
    }
  }
  // light bar: four driving lamps on a bar across the front of the roof
  if (spec.lightBar) {
    const roof = x.roofY, z = x.roofZ[1] - 0.05, y = roof + 0.12;
    P.box(M.black, [1.3, 0.05, 0.06], [0, y, z], { r: 0.015 });
    for (const sx of [0.62, -0.62]) P.box(M.black, [0.04, 0.12, 0.05], [sx, y - 0.07, z - 0.04], { r: 0.01 });
    for (const lx of [0.45, 0.15, -0.15, -0.45]) {
      P.cyl(M.black, 0.075, 0.07, 0.08, [lx, y + 0.08, z + 0.02], { axis: 'z', seg: 16 });
      P.cyl(lightBar, 0.064, 0.064, 0.012, [lx, y + 0.08, z + 0.063], { axis: 'z', seg: 16 });
    }
  }
  // armour: skid plates under the engine, gearbox and tank; rock sliders along the sills
  if (b.armor) {
    const belly = spec.hull[1].c[1] - spec.hull[1].h[1] - raise;
    const front = spec.axles[0].z, rear = spec.axles[1].z;
    P.box(M.alu, [0.78, 0.012, front - 0.25 - (rear + 0.9)], [0, belly - 0.008, (front - 0.25 + rear + 0.9) / 2], { r: 0.004 });
    P.box(M.alu, [0.8, 0.012, 0.66], [0.2, x.frame.y - 0.08, rear + 0.48], { r: 0.004 });
  }
  if (spec.sliders) {
    const sl = spec.hull[spec.hull.length - 1], y = sl.c[1] - raise, xs = sl.h[0] - 0.02, z0 = sl.c[2] - sl.h[2], z1 = sl.c[2] + sl.h[2];
    P.path(M.satin, [[xs - 0.1, y + 0.02, z0 - 0.02], [xs, y, z0 + 0.12], [xs, y, z1 - 0.12], [xs - 0.1, y + 0.02, z1 + 0.02]], 0.035, { mirror: true });
    for (let i = 0; i < 3; i++) { const z = z0 + 0.2 + (z1 - z0 - 0.4) * i / 2; P.tube(M.satin, [xs, y, z], [x.frame.x + 0.04, x.frame.y + 0.05, z], 0.022, { mirror: true }); }
  }
  // the big-block swap gets a hood scoop; a tuned or swapped engine, dual exhaust tips
  const eng = spec.engine?.name || '';
  if (/big-block/.test(eng)) {
    const hy = spec.hull[0].c[1] + spec.hull[0].h[1] - raise;
    P.box(M.black, [0.5, 0.07, 0.62], [0, hy + 0.04, spec.axles[0].z + 0.1], { r: 0.03 });
    P.box(M.satin, [0.42, 0.04, 0.02], [0, hy + 0.045, spec.axles[0].z + 0.42], { r: 0.008 });
  }
  if (b.engine) P.cyl(M.chrome, 0.032, 0.032, 0.14, [-x.frame.x - 0.12, x.frame.y + 0.02, x.bumperR.z + 0.06], { axis: 'z', mirror: true });
  // onboard air: a tank on the frame
  if (spec.tyre.compressor) P.cyl(M.alu, 0.07, 0.07, 0.5, [x.frame.x + 0.12, x.frame.y + 0.04, 0.05], { axis: 'z', seg: 14 });
}

// ---------------------------------------------------------------- the model
const UP = new THREE.Vector3(0, 1, 0);

export class TruckModel {
  constructor(spec, paintHex = 0xb5532c) {
    const M = shared();
    this.spec = spec;
    this.uniforms = { uDirt: { value: 0 } };
    this.paint = paintMaterial(paintHex, this.uniforms);
    const canvasTop = spec.style === 'mule';
    this.top = new THREE.MeshStandardMaterial({ color: canvasTop ? 0x8f8467 : 0xece6d6, roughness: canvasTop ? 0.95 : 0.45, metalness: canvasTop ? 0 : 0.15 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.15, roughness: 0.15 });
    this.barMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.1, roughness: 0.15 });
    this.brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a1a12, emissive: 0xff2010, emissiveIntensity: 0.05, roughness: 0.3 });
    this.revMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 });
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const cgY = spec.cgHeight, cgZ = spec.cgZ || 0, raise = spec.raise || 0;
    this.body.position.set(0, raise - cgY, -cgZ);           // design frame (stock height) -> CG frame, lifted
    this.bodyOffset = this.body.position.clone();
    const t = spec.tyre, R = t.radius, Wt = t.width;
    const base = { rackZ: spec.rackZ ?? -0.8 };
    const rimR = (t.size >= 37 ? 17 : 15) * IN / 2 + 0.03;

    // ---- body, chassis, bumpers, build
    const P = new PartList();
    const x = BUILDERS[spec.style](P, M, this.paint, this.top, spec);
    this.layout = x;
    chassis(P, M, spec, x);
    bumpers(P, M, spec, x, spec.winch || {});
    buildParts(P, M, spec, x, base, this.barMat);
    for (const [hx, hy, hz, hr] of x.heads) {
      P.cyl(this.lightMat, hr, hr, 0.03, [hx, hy, hz], { axis: 'z', mirror: true, seg: 18 });
      const g = new THREE.TorusGeometry(hr + 0.008, 0.013, 6, 18); P.add(M.chrome, g, [hx, hy, hz + 0.012], null, true);
    }
    for (const [lx, ly, lz, lw, lh, side] of x.tails) P.box(this.brakeMat, side ? [0.02, lh, lw] : [lw, lh, 0.02], [lx, ly, lz], { r: 0.005, mirror: true });
    for (const [lx, ly, lz, lw, lh, side] of x.reverse) P.box(this.revMat, side ? [0.02, lh, lw] : [lw, lh, 0.02], [lx, ly, lz], { r: 0.005, mirror: true });
    // mud flaps behind the rear tyres
    if (x.flaps) P.box(M.rubber, [Wt + 0.04, 0.3, 0.012], [spec.axles[1].track / 2, x.sill - 0.08, spec.axles[1].z - 0.58], { r: 0, mirror: true });
    // the spare: on a swing-out carrier at the back, or under the bed
    if (x.spare) {
      const tg = tireGeometry(R, Wt, t.tread).clone(), rg = rimGeometry(rimR, Wt, t.beadlock).clone();
      let pos;
      if (x.spare.mount === 'under') { tg.rotateZ(Math.PI / 2); rg.rotateZ(Math.PI / 2); pos = [x.spare.x, x.frame.y - Wt / 2 + 0.06, x.spare.z]; } else {
        tg.rotateY(Math.PI / 2); rg.rotateY(Math.PI / 2);
        pos = [x.spare.x, Math.max(x.sill + R + 0.12, 0.98), x.spare.z - Wt / 2 - 0.05];
        P.box(M.black, [0.06, 0.4, 0.06], [x.spare.x, pos[1] - 0.12, x.spare.z - 0.02], { r: 0.01 });
      }
      P.add(M.tire, tg, pos); P.add(t.beadlock ? M.bead : M.steel, rg, pos);
    }
    P.build(this.body);

    // ---- steering wheel (turns with the front wheels)
    {
      const w = x.wheel, g = new THREE.Group();
      g.position.set(w.x, w.y, w.z);
      g.rotation.x = w.tilt;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 8, 24), M.black);
      const spokes = new THREE.Mesh(mergeGeometries([0, 2.1, 4.2].map((a) => clean(new THREE.BoxGeometry(0.17, 0.02, 0.012).translate(0.085, 0, 0).rotateZ(a + Math.PI / 2)))), M.satin);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.2), M.black);
      this.steeringWheel = new THREE.Group();
      this.steeringWheel.add(ring, spokes);
      g.add(this.steeringWheel, col);
      this.body.add(g);
    }

    // ---- axles and wheels (CG frame; the physics moves them)
    const rStatic = R - (spec.mass * GRAV / 4) / t.stiffness;
    this.axles = spec.axles.map((a, ai) => {
      const half = a.track / 2;
      const yStatic = rStatic - cgY, yDroop = yStatic - a.sag;
      const group = new THREE.Group();
      group.position.set(0, yStatic, a.z - cgZ);
      this.root.add(group);
      const heavy = a.mass > 110, tubeR = heavy ? 0.052 : 0.044, dd = a.diffDrop || 0.16, rp = dd * 0.82;
      const AP = new PartList();
      AP.cyl(M.under, tubeR, tubeR, a.track - Wt - 0.08, [0, 0, 0], { axis: 'x' });
      AP.add(M.under, new THREE.SphereGeometry(rp, 14, 10).scale(1.05, 1, 0.9), [a.diffX || 0, -(dd - rp), 0]);
      AP.cyl(M.satin, rp * 0.82, rp * 0.82, 0.03, [a.diffX || 0, -(dd - rp) + 0.005, ai === 0 ? rp * 0.8 : -rp * 0.8], { axis: 'z', seg: 16 });
      AP.cyl(M.under, 0.055, 0.07, 0.16, [a.diffX || 0, 0, ai === 0 ? -rp - 0.04 : rp + 0.04], { axis: 'z' });
      for (const sx of [1, -1]) {
        AP.box(M.under, [0.1, 0.03, 0.16], [sx * a.springTrack / 2, tubeR + 0.012, 0], { r: 0.005 });
        for (const dz of [-0.05, 0.05]) AP.cyl(M.satin, 0.009, 0.009, 0.16, [sx * a.springTrack / 2, 0.0, dz]);
        AP.box(M.under, [0.08, 0.025, 0.14], [sx * a.springTrack / 2, -tubeR - 0.02, 0], { r: 0.005 });
      }
      if (ai === 0) AP.cyl(M.satin, 0.018, 0.018, a.track - 0.5, [0, -0.02, -0.17], { axis: 'x' });
      AP.build(group);
      const wheels = [1, -1].map((side) => {
        const knuckle = new THREE.Group();
        knuckle.position.set(side * half, 0, 0);
        group.add(knuckle);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16).rotateZ(Math.PI / 2), M.under);
        drum.position.x = -side * 0.05;
        knuckle.add(drum);
        if (ai === 0) {
          const kp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 10), M.under);
          kp.position.x = -side * 0.14;
          knuckle.add(kp);
        }
        const spin = new THREE.Group();
        knuckle.add(spin);
        const tire = new THREE.Mesh(tireGeometry(R, Wt, t.tread), M.tire);
        const rim = new THREE.Mesh(rimGeometry(rimR, Wt, t.beadlock), t.beadlock ? M.bead : M.steel);
        if (side < 0) rim.rotation.y = Math.PI;              // outer face out on both sides
        tire.castShadow = true; rim.castShadow = true;
        spin.add(tire, rim);
        return { knuckle, spin };
      });
      return { group, wheels, yDroop, half, spec: a };
    });

    // ---- leaf springs (two halves per side), shocks (body and shaft), propshafts: placed every frame
    const nLeaf = 8, nShock = 4;
    this.leaves = new THREE.InstancedMesh(new THREE.BoxGeometry(0.065, 1, 0.055).translate(0, 0.5, 0), M.under, nLeaf);
    this.shockBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10).translate(0, 0.5, 0), b2m(spec, M), nShock);
    this.shockRod = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), M.chrome, nShock);
    for (const m of [this.leaves, this.shockBody, this.shockRod]) { m.castShadow = true; m.frustumCulled = false; this.root.add(m); }
    const f = x.frame, lt = spec.axles[0].travel > 0.3;
    this.mounts = spec.axles.map((a) => {
      const L = spec.style === 'hauler' ? 0.72 : 0.6;
      return {
        hanger: [a.springTrack / 2, f.y - 0.02, a.z + L], shackle: [a.springTrack / 2, f.y - 0.07, a.z - L],
        shockTop: [a.springTrack / 2 + 0.09, f.y + 0.3 + (lt ? 0.08 : 0), a.z + 0.16], shockLow: [a.springTrack / 2 + 0.09, -0.06, a.z > 0 ? -0.1 : 0.1],
      };
    });
    if (lt) {
      // long-travel kit: remote reservoirs beside the shock towers
      const RP = new PartList();
      for (const mt of this.mounts) RP.cyl(M.alu, 0.04, 0.04, 0.22, [mt.shockTop[0] + 0.08, mt.shockTop[1] - 0.05, mt.shockTop[2]], { mirror: true });
      RP.build(this.body);
    }
    this.tcase = new THREE.Vector3(0.08, f.y + 0.02 + raise - cgY, spec.axles[0].z - 1.35 - cgZ);
    this.shafts = this.axles.map(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), M.under);
      m.castShadow = true;
      this.root.add(m);
      return m;
    });
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3();
    this.dirt = 0;
    this.updateWheels(spec.axles.flatMap((a) => [[a.sag, 0, 0], [a.sag, 0, 0]]));
  }

  setPaint(hex) { this.paint.color.set(hex); }
  setLights(on) { this.lightMat.emissiveIntensity = on ? 3.5 : 0.15; this.barMat.emissiveIntensity = on ? 4 : 0.1; this.lightsOn = on; this.setBrake(this.braking); }
  setBrake(on) { this.braking = !!on; this.brakeMat.emissiveIntensity = on ? 2.4 : this.lightsOn ? 0.7 : 0.05; }
  setReverse(on) { this.revMat.emissiveIntensity = on ? 1.6 : 0; }

  /** A design-frame point on the body -> CG frame (into v). */
  bodyPoint(p, v, mirror = 1) { return v.set(p[0] * mirror, p[1], p[2]).add(this.bodyOffset); }

  /** wheels: [4] of [travel (from full droop), spin angle, steer angle] for FL, FR, RL, RR. */
  updateWheels(wheels) {
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai];
      const zL = wheels[ai * 2][0], zR = wheels[ai * 2 + 1][0];
      ax.group.position.y = ax.yDroop + (zL + zR) / 2;
      ax.group.rotation.z = Math.atan2(zL - zR, ax.spec.track);
      for (let s = 0; s < 2; s++) {
        const w = wheels[ai * 2 + s], wm = ax.wheels[s];
        wm.knuckle.rotation.y = w[2];
        wm.spin.rotation.x = w[1];
      }
      ax.group.updateMatrix();
    }
    if (this.steeringWheel) this.steeringWheel.rotation.z = -((wheels[0][2] + wheels[1][2]) / 2) * 14;
    // leaf springs: hanger -> seat on the axle -> shackle; shocks: frame mount -> axle mount
    const v = this._v, w = this._w;
    let li = 0, si = 0;
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], mt = this.mounts[ai], s = ax.spec.springTrack / 2;
      for (const side of [1, -1]) {
        const seat = w.set(side * s, 0.06, 0).applyMatrix4(ax.group.matrix);
        const seatC = seat.clone();
        this.bodyPoint(mt.hanger, v, side); this.segment(this.leaves, li++, v, seatC);
        this.bodyPoint(mt.shackle, v, side); this.segment(this.leaves, li++, seatC, v);
        const low = w.set(side * mt.shockLow[0], mt.shockLow[1], mt.shockLow[2]).applyMatrix4(ax.group.matrix);
        const top = this.bodyPoint(mt.shockTop, v, side);
        const len = top.distanceTo(low);
        this.segment(this.shockBody, si, top, low, Math.min(len, 0.34));
        this.segment(this.shockRod, si++, low, top, Math.max(0.05, len - 0.3));
      }
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    this.shockBody.instanceMatrix.needsUpdate = true;
    this.shockRod.instanceMatrix.needsUpdate = true;
    // propshafts: transfer case -> pinion
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], sh = this.shafts[ai], a = ax.spec, rp = (a.diffDrop || 0.16) * 0.82;
      const end = this._w.set((a.diffX || 0) * 0.9, 0, ai === 0 ? -rp - 0.1 : rp + 0.1).applyMatrix4(ax.group.matrix);
      const st = this.tcase, len = st.distanceTo(end);
      sh.position.copy(st).add(end).multiplyScalar(0.5);
      sh.scale.set(1, len, 1);
      sh.quaternion.setFromUnitVectors(UP, this._v.copy(end).sub(st).normalize());
    }
  }

  /** Instance i of mesh m: a unit part along +y from a toward b, `len` long (default: all the way). */
  segment(m, i, a, b, len) {
    const d = this._s.copy(b).sub(a), full = d.length();
    this._q.setFromUnitVectors(UP, d.multiplyScalar(1 / Math.max(full, 1e-6)));
    this._m.compose(a, this._q, this._s.set(1, len ?? full, 1));
    m.setMatrixAt(i, this._m);
  }

  setDirt(d) { this.dirt = d; this.uniforms.uDirt.value = d; }

  dispose() {
    this.root.traverse((o) => { if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose(); });
    for (const m of [this.paint, this.top, this.lightMat, this.barMat, this.brakeMat, this.revMat]) m.dispose();
  }
}

/** Shock body colour: the long-travel kit's remote-reservoir shocks are bright, stock ones black. */
function b2m(spec, M) {
  if (spec.axles[0].travel > 0.3) return MATS.lt || (MATS.lt = new THREE.MeshStandardMaterial({ color: 0xc8a020, roughness: 0.35, metalness: 0.6 }));
  return spec.raise > 0.04 ? (MATS.lift || (MATS.lift = new THREE.MeshStandardMaterial({ color: 0x2e5aa8, roughness: 0.4, metalness: 0.4 }))) : M.black;
}

/** Developer preview: the three trucks parked by the station, settled by the physics. */
export async function preview(world, r) {
  const { TRUCK_IDS, truckSpec } = await import('../physics/trucks.js');
  const { Vehicle } = await import('../physics/Vehicle.js');
  const paints = [0xb5532c, 0x3d6b8c, 0x6b7d3e];
  const q = new URLSearchParams(location.search);
  const list = TRUCK_IDS.map((id, i) => {
    const spec = truckSpec(id, q.get(id) || undefined);
    const v = new Vehicle(spec);
    v.place(world, -48 + i * 5.5, 452 - i * 1.5, 2.6 + i * 0.5);
    for (let n = 0; n < 480 * 2; n++) v.step({ throttle: 0, brake: 0, steer: i - 1, handbrake: 1 }, world);
    const m = new TruckModel(spec, paints[i]);
    m.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    m.root.quaternion.set(v.quat.x, v.quat.y, v.quat.z, v.quat.w);
    m.updateWheels([0, 1, 2, 3].map((k) => v.wheelState(k)));
    m.setDirt(i * 0.35);
    r.scene.add(m.root);
    return m;
  });
  return { list };
}
