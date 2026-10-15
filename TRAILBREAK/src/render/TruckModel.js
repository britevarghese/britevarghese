// Truck models, built from code (no model files): the body is merged into one mesh per material; axles, wheels and
// propshafts are separate so they can follow the physics. The body is laid out in the design frame of
// physics/trucks.js (origin on the ground mid-wheelbase, +x left, +z forward) and shifted to the CG frame.
//
// Each frame `update()` places each beam axle at its height and roll, turns the front wheels on their kingpins,
// spins the wheels, points the propshafts from the transfer case to each axle, and dirties the paint in mud.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GRAV = 9.81;

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

function clean(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
}

class PartList {
  constructor() { this.byMat = new Map(); this._m = new THREE.Matrix4(); this._e = new THREE.Euler(); this._q = new THREE.Quaternion(); }
  /** geometry g placed at p = [x, y, z] with rotation rot = [rx, ry, rz]; mirror: also at -x. */
  add(mat, g, p = [0, 0, 0], rot = null, mirror = false) {
    const put = (x) => {
      const gg = g.clone();
      this._e.set(...(rot || [0, 0, 0]));
      if (mirror && x < 0 && rot) this._e.set(rot[0], -rot[1], -rot[2]);
      this._q.setFromEuler(this._e);
      this._m.compose(new THREE.Vector3(x, p[1], p[2]), this._q, new THREE.Vector3(1, 1, 1));
      gg.applyMatrix4(this._m);
      if (!this.byMat.has(mat)) this.byMat.set(mat, []);
      this.byMat.get(mat).push(clean(gg));
    };
    put(p[0]);
    if (mirror) put(-p[0]);
    g.dispose();
  }
  box(mat, size, p, opt = {}) { this.add(mat, rbox(size[0], size[1], size[2], opt.r ?? 0.025, opt.cr ?? 0), p, opt.rot, opt.mirror); }
  cyl(mat, rt, rb, len, p, opt = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, len, opt.seg || 14);
    if (opt.axis === 'x') g.rotateZ(Math.PI / 2); else if (opt.axis === 'z') g.rotateX(Math.PI / 2);
    this.add(mat, g, p, opt.rot, opt.mirror);
  }
  build(group) {
    for (const [mat, list] of this.byMat) {
      const m = new THREE.Mesh(mergeGeometries(list), mat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
  }
}

// ---------------------------------------------------------------- materials
function paintMaterial(hex, uniforms) {
  const mat = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.25, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 });
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
  MATS.black = new THREE.MeshStandardMaterial({ color: 0x1d1d1c, roughness: 0.72, metalness: 0.15 });
  MATS.chrome = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.2, metalness: 1.0 });
  MATS.glass = new THREE.MeshStandardMaterial({ color: 0x1a262c, roughness: 0.05, metalness: 0.4 });
  MATS.tire = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.96, metalness: 0 });
  MATS.rim = new THREE.MeshStandardMaterial({ color: 0xc9c6bd, roughness: 0.42, metalness: 0.55 });
  MATS.under = new THREE.MeshStandardMaterial({ color: 0x2b2a27, roughness: 0.8, metalness: 0.3 });
  MATS.tail = new THREE.MeshStandardMaterial({ color: 0x8a1c14, emissive: 0x330000, roughness: 0.3 });
  MATS.amber = new THREE.MeshStandardMaterial({ color: 0xd88a1f, emissive: 0x2a1500, roughness: 0.3 });
  MATS.canvas = new THREE.MeshStandardMaterial({ color: 0xa69a78, roughness: 0.95 });
  MATS.wood = new THREE.MeshStandardMaterial({ color: 0x6e5238, roughness: 0.9 });
  return MATS;
}

// ---------------------------------------------------------------- wheels
function tireGeometry(r, w) {
  const hw = w / 2, rim = r * 0.6;
  const prof = [[rim, -hw * 0.86], [r * 0.9, -hw], [r * 0.985, -hw * 0.82], [r, -hw * 0.5], [r, hw * 0.5], [r * 0.985, hw * 0.82], [r * 0.9, hw], [rim, hw * 0.86]]
    .map(([a, b]) => new THREE.Vector2(a, b));
  const parts = [clean(new THREE.LatheGeometry(prof, 30))];
  // chunky mud-terrain lugs, staggered in two rows
  const lugs = 22;
  for (let i = 0; i < lugs; i++) {
    for (const row of [-1, 1]) {
      const a = (i + (row > 0 ? 0.5 : 0)) / lugs * Math.PI * 2;
      // tangential length x, along the axle y, radial thickness z -> turned so the thickness is radial (x at a = 0)
      const g = clean(rbox(0.11 * r / 0.4, w * 0.42, 0.028, 0.008));
      const m = new THREE.Matrix4().makeRotationY(-a).setPosition(Math.cos(a) * (r + 0.006), row * w * 0.21, Math.sin(a) * (r + 0.006));
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2));
      g.applyMatrix4(m);
      parts.push(g);
    }
  }
  const g = mergeGeometries(parts);
  g.rotateZ(Math.PI / 2);                               // axle along x
  return g;
}

function rimGeometry(r, w) {
  const parts = [];
  const disc = new THREE.CylinderGeometry(r * 0.6, r * 0.6, w * 0.62, 18); disc.rotateZ(Math.PI / 2); parts.push(clean(disc));
  const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.24, w * 0.74, 10); hub.rotateZ(Math.PI / 2); parts.push(clean(hub));
  // stamped holes ring (little bosses) so the spin reads
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    const b = new THREE.CylinderGeometry(r * 0.07, r * 0.07, w * 0.66, 6); b.rotateZ(Math.PI / 2);
    b.translate(0, Math.cos(a) * r * 0.38, Math.sin(a) * r * 0.38);
    parts.push(clean(b));
  }
  return mergeGeometries(parts);
}

// ---------------------------------------------------------------- bodies (design frame)
function rangerBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z, R = spec.tyre.radius;
  const W = 1.74, by = 0.6, belt = 1.17, arch = R + 0.13;
  // body sides and tub: between the wheels, ahead of and behind them, and fenders over them
  P.box(paint, [W, belt - by, (zf - arch) - (zr + arch)], [0, (by + belt) / 2, (zf + zr) / 2], { r: 0.04 });
  P.box(paint, [W, belt - 1.0, 2 * arch], [0, (1.0 + belt) / 2, zf], { r: 0.03 });
  P.box(paint, [W, belt - 1.0, 2 * arch], [0, (1.0 + belt) / 2, zr], { r: 0.03 });
  P.box(paint, [W, belt - 0.64, 1.98 - (zf + arch)], [0, (0.64 + belt) / 2, (1.98 + zf + arch) / 2], { r: 0.05 });
  P.box(paint, [W, belt - 0.64, (zr - arch) + 1.98], [0, (0.64 + belt) / 2, (zr - arch - 1.98) / 2], { r: 0.05 });
  // hood with a raised centre
  P.box(paint, [1.46, 0.07, 1.42], [0, belt + 0.03, 1.25], { r: 0.03 });
  // inner wheel wells (stop the eye going through the arches)
  P.box(M.under, [0.04, 0.5, 2 * arch], [0.56, 0.86, zf], { mirror: true });
  P.box(M.under, [0.04, 0.5, 2 * arch], [0.56, 0.86, zr], { mirror: true });
  // flares
  for (const z of [zf, zr]) {
    const g = new THREE.TorusGeometry(arch + 0.02, 0.045, 6, 18, Math.PI); g.rotateY(Math.PI / 2);
    P.add(M.black, g, [W / 2 + 0.02, R + 0.12, z], null, true);
  }
  // grille, lights, bumpers, winch
  P.box(M.black, [1.16, 0.34, 0.03], [0, 0.92, 1.985], { r: 0.01 });
  for (const y of [0.83, 0.92, 1.01]) P.box(M.chrome, [1.1, 0.025, 0.02], [0, y, 2.0], { r: 0.008 });
  P.box(M.black, [1.9, 0.16, 0.2], [0, 0.6, 2.06], { r: 0.02 });
  P.cyl(M.black, 0.09, 0.09, 0.56, [0, 0.69, 2.05], { axis: 'x' });
  P.box(M.chrome, [0.24, 0.06, 0.05], [0, 0.66, 2.16], { r: 0.01 });
  P.box(M.black, [1.84, 0.14, 0.16], [0, 0.62, -2.04], { r: 0.02 });
  P.box(M.tail, [0.07, 0.17, 0.03], [0.78, 0.94, -1.995], { mirror: true });
  P.box(M.amber, [0.1, 0.05, 0.03], [0.62, 0.74, 1.995], { mirror: true });
  // windscreen and top
  P.box(paint, [1.6, 0.5, 0.05], [0, belt + 0.25, 0.5], { r: 0.015, rot: [-0.22, 0, 0] });
  P.box(M.glass, [1.48, 0.42, 0.03], [0, belt + 0.25, 0.525], { r: 0.01, rot: [-0.22, 0, 0] });
  P.box(top, [1.66, 0.62, 2.26], [0, belt + 0.34, -0.69], { r: 0.07, cr: 0.06 });
  P.box(M.glass, [0.02, 0.36, 0.42], [0.835, belt + 0.36, 0.17], { mirror: true });
  P.box(M.glass, [0.02, 0.36, 1.3], [0.835, belt + 0.36, -0.95], { mirror: true });
  P.box(M.glass, [1.3, 0.36, 0.02], [0, belt + 0.36, -1.825]);
  // roof rack, mirrors, spare, underbody
  P.box(M.black, [0.04, 0.04, 2.0], [0.7, belt + 0.68, -0.7], { mirror: true });
  for (const z of [-1.5, -0.7, 0.1]) P.box(M.black, [1.4, 0.03, 0.04], [0, belt + 0.7, z]);
  P.box(M.black, [0.1, 0.08, 0.04], [0.93, belt + 0.18, 0.42], { mirror: true });
  P.box(M.black, [0.03, 0.03, 0.18], [0.89, belt + 0.12, 0.42], { mirror: true, rot: [0, 0.5, 0] });
  P.box(M.under, [0.12, 0.14, 3.8], [0.42, 0.5, 0], { mirror: true });
  P.box(M.under, [0.6, 0.18, 0.8], [0, 0.46, 0.05]);
  P.box(M.under, [0.9, 0.2, 0.55], [0, 0.52, -1.55]);
  P.cyl(M.under, 0.03, 0.03, 0.4, [-0.6, 0.48, -2.06], { axis: 'z' });
  return { lights: [[0.62, 0.95, 1.99, 0.1]], spare: [0, 1.0, -2.2] };
}

function haulerBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z, R = spec.tyre.radius;
  const W = 1.94, by = 0.64, belt = 1.26, arch = R + 0.14, fend = R + 0.62;
  // front clip: nose, fenders, hood
  P.box(paint, [W, belt - by, 2.7 - (zf + arch)], [0, (by + belt) / 2, (2.7 + zf + arch) / 2], { r: 0.05 });
  P.box(paint, [W, belt - fend, 2 * arch], [0, (fend + belt) / 2, zf], { r: 0.03 });
  P.box(paint, [W, belt - by, (zf - arch) + 0.2], [0, (by + belt) / 2, (zf - arch - 0.2) / 2], { r: 0.04 });
  P.box(paint, [1.62, 0.08, 1.75], [0, belt + 0.035, 1.78], { r: 0.035 });
  // cab
  P.box(paint, [1.86, 0.66, 1.18], [0, belt + 0.33, 0.33], { r: 0.07, cr: 0.08 });
  P.box(M.glass, [1.62, 0.42, 0.03], [0, belt + 0.34, 0.93], { r: 0.01, rot: [-0.25, 0, 0] });
  P.box(M.glass, [0.02, 0.4, 0.62], [0.935, belt + 0.36, 0.42], { mirror: true });
  P.box(M.glass, [1.4, 0.34, 0.02], [0, belt + 0.38, -0.265]);
  // two-tone stripe
  P.box(top, [W + 0.01, 0.12, 2.7 + 0.2], [0, belt - 0.2, (2.7 - 0.2) / 2 - 0.02], { r: 0.01 });
  // bed: floor, sides over the rear wheels, front wall, tailgate
  const b0 = -0.3, b1 = -2.68;
  P.box(M.under, [1.7, 0.06, b0 - b1], [0, 0.98, (b0 + b1) / 2]);
  P.box(paint, [0.07, belt - by, (zr - arch) - b1], [0.935, (by + belt) / 2, (zr - arch + b1) / 2], { mirror: true, r: 0.02 });
  P.box(paint, [0.07, belt - by, b0 - (zr + arch)], [0.935, (by + belt) / 2, (b0 + zr + arch) / 2], { mirror: true, r: 0.02 });
  P.box(paint, [0.07, belt - fend, 2 * arch], [0.935, (fend + belt) / 2, zr], { mirror: true, r: 0.02 });
  P.box(paint, [W, belt - 0.95, 0.06], [0, (0.95 + belt) / 2, b0], { r: 0.02 });
  P.box(paint, [W, belt - 0.7, 0.06], [0, (0.7 + belt) / 2, b1], { r: 0.02 });
  P.box(M.under, [0.04, 0.48, 2 * arch], [0.62, 0.95, zf], { mirror: true });
  P.box(M.under, [0.04, 0.48, 2 * arch], [0.8, 0.95, zr], { mirror: true });
  for (const z of [zf, zr]) {
    const g = new THREE.TorusGeometry(arch + 0.02, 0.04, 6, 18, Math.PI); g.rotateY(Math.PI / 2);
    P.add(M.black, g, [W / 2 + 0.015, R + 0.14, z], null, true);
  }
  // chrome grille and bumpers, square headlights
  P.box(M.chrome, [1.5, 0.4, 0.05], [0, 0.99, 2.71], { r: 0.015 });
  P.box(M.black, [1.3, 0.3, 0.03], [0, 0.99, 2.73], { r: 0.008 });
  for (const y of [0.9, 0.99, 1.08]) P.box(M.chrome, [1.28, 0.02, 0.02], [0, y, 2.745], { r: 0.006 });
  P.box(M.chrome, [2.0, 0.18, 0.18], [0, 0.66, 2.8], { r: 0.04 });
  P.cyl(M.black, 0.09, 0.09, 0.6, [0, 0.74, 2.86], { axis: 'x' });
  P.box(M.chrome, [1.94, 0.15, 0.15], [0, 0.66, -2.74], { r: 0.035 });
  P.box(M.tail, [0.06, 0.24, 0.04], [0.92, 1.0, -2.705], { mirror: true });
  // roll bar with lights, mirrors, underbody
  P.cyl(M.black, 0.035, 0.035, 0.62, [0.8, belt + 0.3, -0.55], { mirror: true });
  P.cyl(M.black, 0.035, 0.035, 1.64, [0, belt + 0.6, -0.55], { axis: 'x' });
  for (const x of [-0.6, -0.2, 0.2, 0.6]) P.cyl(M.chrome, 0.07, 0.07, 0.08, [x, belt + 0.71, -0.52], { axis: 'z', seg: 12 });
  P.box(M.chrome, [0.12, 0.1, 0.03], [1.03, belt + 0.3, 0.75], { mirror: true });
  P.box(M.under, [0.13, 0.16, 5.0], [0.46, 0.55, 0], { mirror: true });
  P.box(M.under, [0.7, 0.2, 0.9], [0, 0.5, 0.4]);
  return { lights: [[0.6, 1.0, 2.73, 0.085], [0.42, 1.0, 2.73, 0.085]] };
}

function muleBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z, R = spec.tyre.radius;
  const W = 1.58, by = 0.58, belt = 1.1, arch = R + 0.12, fendY = 0.98;
  // tub between and behind the wheels
  P.box(paint, [W, belt - by, (zf - arch) - (zr + arch)], [0, (by + belt) / 2, (zf + zr) / 2], { r: 0.02 });
  P.box(paint, [W, belt - by, (zr - arch) + 1.72], [0, (by + belt) / 2, (zr - arch - 1.72) / 2], { r: 0.02 });
  P.box(paint, [W, belt - fendY, 2 * arch], [0, (fendY + belt) / 2, zr], { r: 0.015 });
  // flat front fenders standing proud of the bonnet, a narrow bonnet between them
  P.box(paint, [0.3, 0.05, 1.18], [0.66, fendY, zf + 0.12], { mirror: true, r: 0.012 });
  P.box(paint, [0.03, 0.34, 0.5], [0.8, fendY - 0.15, zf + 0.52], { mirror: true, r: 0.01 });
  P.box(paint, [1.02, 0.42, 1.2], [0, 0.9, zf + 0.1], { r: 0.02 });
  P.box(paint, [1.04, 0.05, 1.22], [0, 1.13, zf + 0.1], { r: 0.015 });
  // slatted grille panel with the lamps in the fenders
  P.box(M.black, [1.0, 0.44, 0.03], [0, 0.88, zf + 0.71], { r: 0.008 });
  for (let i = -4; i <= 4; i++) P.box(paint, [0.035, 0.42, 0.04], [i * 0.1, 0.88, zf + 0.725], { r: 0.006 });
  P.box(M.under, [0.04, 0.42, 2 * arch], [0.5, 0.84, zf], { mirror: true });
  P.box(M.under, [0.04, 0.42, 2 * arch], [0.55, 0.84, zr], { mirror: true });
  // bumpers, folding windscreen, canvas top
  P.box(M.black, [1.62, 0.14, 0.12], [0, 0.6, zf + 0.84], { r: 0.02 });
  P.cyl(M.black, 0.08, 0.08, 0.48, [0, 0.67, zf + 0.82], { axis: 'x' });
  P.box(M.black, [1.6, 0.12, 0.12], [0, 0.62, -1.76], { r: 0.02 });
  P.box(M.tail, [0.06, 0.1, 0.03], [0.68, 0.92, -1.725], { mirror: true });
  P.box(paint, [1.5, 0.48, 0.05], [0, belt + 0.26, 0.42], { r: 0.012, rot: [-0.12, 0, 0] });
  P.box(M.glass, [1.38, 0.4, 0.03], [0, belt + 0.26, 0.445], { r: 0.008, rot: [-0.12, 0, 0] });
  P.box(top, [1.56, 0.06, 1.95], [0, belt + 0.62, -0.55], { r: 0.03 });
  P.box(top, [0.02, 0.58, 1.6], [0.775, belt + 0.31, -0.72], { mirror: true });
  P.box(top, [1.52, 0.58, 0.02], [0, belt + 0.31, -1.52]);
  P.box(M.glass, [0.025, 0.24, 0.5], [0.78, belt + 0.38, -0.6], { mirror: true });
  P.cyl(M.black, 0.02, 0.02, 0.56, [0.76, belt + 0.31, 0.25], { mirror: true });
  // spare on the bonnet side, jerrycan, underbody
  P.box(M.under, [0.12, 0.13, 3.2], [0.38, 0.5, -0.05], { mirror: true });
  P.box(M.under, [0.5, 0.16, 0.6], [0, 0.46, 0.15]);
  P.box(M.black, [0.16, 0.34, 0.24], [0.62, belt + 0.02, -1.62]);
  return { lights: [[0.66, 0.86, zf + 0.62, 0.085]], spare: [0, 1.15, zf + 0.12], spareFlat: true };
}

const BUILDERS = { ranger: rangerBody, hauler: haulerBody, mule: muleBody };

// ---------------------------------------------------------------- the model
export class TruckModel {
  constructor(spec, paintHex = 0xb5532c) {
    const M = shared();
    this.spec = spec;
    this.uniforms = { uDirt: { value: 0 } };
    this.paint = paintMaterial(paintHex, this.uniforms);
    this.top = new THREE.MeshStandardMaterial({ color: spec.style === 'mule' ? 0xa69a78 : 0xece6d6, roughness: spec.style === 'mule' ? 0.95 : 0.5, metalness: spec.style === 'mule' ? 0 : 0.15 });
    this.lightMat = new THREE.MeshStandardMaterial({ color: 0xfff6dc, emissive: 0xfff2c8, emissiveIntensity: 0.15, roughness: 0.2 });
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const cgY = spec.cgHeight, cgZ = spec.cgZ || 0;
    this.body.position.set(0, -cgY, -cgZ);
    const R = spec.tyre.radius, Wt = spec.tyre.width;

    const P = new PartList();
    const extra = BUILDERS[spec.style](P, M, this.paint, this.top, spec);
    // headlights (round lens + chrome bezel)
    for (const [x, y, z, r] of extra.lights) {
      P.cyl(this.lightMat, r, r, 0.04, [x, y, z], { axis: 'z', mirror: true, seg: 16 });
      const g = new THREE.TorusGeometry(r + 0.01, 0.014, 6, 16); P.add(M.chrome, g, [x, y, z + 0.015], null, true);
    }
    if (extra.spare) {
      const tg = tireGeometry(R, Wt);
      tg.rotateY(Math.PI / 2);                        // facing back (axis along z)
      if (extra.spareFlat) tg.rotateX(Math.PI / 2);
      P.add(M.tire, tg, extra.spare);
      const rg = rimGeometry(R, Wt); rg.rotateY(Math.PI / 2); if (extra.spareFlat) rg.rotateX(Math.PI / 2);
      P.add(M.rim, rg, extra.spare);
    }
    P.build(this.body);

    // axles and wheels (CG frame)
    const rStatic = R - (spec.mass * GRAV / 4) / spec.tyre.stiffness;
    this.axles = spec.axles.map((a, ai) => {
      const half = a.track / 2;
      const yStatic = rStatic - cgY, yDroop = yStatic - a.sag;
      const group = new THREE.Group();
      group.position.set(0, yStatic, a.z - cgZ);
      this.root.add(group);
      // beam, differential, spring perches / leaves
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, a.track - Wt * 0.6, 10).rotateZ(Math.PI / 2), M.under);
      const diff = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), M.under);
      diff.scale.set(1, 0.9, 1.1);
      diff.position.set(ai === 0 ? -0.18 : 0, 0, ai === 0 ? -0.04 : 0.04);
      group.add(beam, diff);
      for (const sx of [1, -1]) {
        const leaf = new THREE.Mesh(rbox(0.07, 0.06, 1.1, 0.012), M.under);
        leaf.position.set(sx * a.springTrack / 2, 0.08, 0);
        group.add(leaf);
      }
      group.children.forEach((c) => { c.castShadow = true; });
      const wheels = [1, -1].map((side) => {
        const knuckle = new THREE.Group();
        knuckle.position.set(side * half, 0, 0);
        group.add(knuckle);
        const spin = new THREE.Group();
        knuckle.add(spin);
        const tire = new THREE.Mesh(tireGeometry(R, Wt), M.tire);
        const rim = new THREE.Mesh(rimGeometry(R, Wt), M.rim);
        rim.position.x = side * 0.01;
        tire.castShadow = true; rim.castShadow = true;
        spin.add(tire, rim);
        return { knuckle, spin };
      });
      return { group, wheels, yDroop, half, spec: a };
    });
    // propshafts from the transfer case to each axle
    this.tcase = new THREE.Vector3(0.05, 0.48 - cgY, 0.05 - cgZ);
    this.shafts = this.axles.map(() => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), M.under);
      this.root.add(m);
      return m;
    });
    this._v = new THREE.Vector3(); this._u = new THREE.Vector3(0, 1, 0);
    this.dirt = 0;
  }

  setPaint(hex) { this.paint.color.set(hex); }
  setLights(on) { this.lightMat.emissiveIntensity = on ? 3.5 : 0.15; }

  /**
   * wheels: [4] of [travel (from full droop), spin angle, steer angle] for FL, FR, RL, RR.
   */
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
    }
    // propshafts
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], sh = this.shafts[ai];
      const diff = ax.group.children[1];
      const end = this._v.set(diff.position.x * 0.9, 0.0, 0).applyEuler(ax.group.rotation).add(ax.group.position);
      const a = this.tcase, len = a.distanceTo(end);
      sh.position.copy(a).add(end).multiplyScalar(0.5);
      sh.scale.set(1, len, 1);
      sh.quaternion.setFromUnitVectors(this._u, end.clone().sub(a).normalize());
    }
  }

  setDirt(d) { this.dirt = d; this.uniforms.uDirt.value = d; }

  dispose() {
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.paint.dispose(); this.top.dispose(); this.lightMat.dispose();
  }
}

/** Developer preview: the three trucks parked by the station, settled by the physics. */
export async function preview(world, r) {
  const { TRUCKS } = await import('../physics/trucks.js');
  const { Vehicle, PHYS_DT } = await import('../physics/Vehicle.js');
  const ids = Object.keys(TRUCKS), paints = [0xb5532c, 0x3d6b8c, 0x6b7d3e];
  const list = ids.map((id, i) => {
    const v = new Vehicle(TRUCKS[id]);
    v.place(world, -48 + i * 5.5, 452 - i * 1.5, 2.6 + i * 0.5);
    for (let n = 0; n < 480 * 2; n++) v.step({ throttle: 0, brake: 0, steer: i - 1, handbrake: 1 }, world);
    const m = new TruckModel(TRUCKS[id], paints[i]);
    m.root.position.set(v.pos.x, v.pos.y, v.pos.z);
    m.root.quaternion.set(v.quat.x, v.quat.y, v.quat.z, v.quat.w);
    m.updateWheels([0, 1, 2, 3].map((k) => v.wheelState(k)));
    m.setDirt(i * 0.35);
    r.scene.add(m.root);
    return m;
  });
  return { list };
}
