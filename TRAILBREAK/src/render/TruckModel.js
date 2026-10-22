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
import { geckoBody, trekkerBody, shepherdBody, droverBody, bruiserBody, rhinoBody, coupeBody, cabin } from './TruckBodies.js';
import { truckAsset } from './TruckAssets.js';
import { Driver } from './Driver.js';
import { Person } from './Person.js';
import { driverAssets } from './DriverAssets.js';
import { buildCockpit, sportsWheel, sportsColumn } from './Cockpit.js';
import { Mirror, Mirrors } from './Mirrors.js';

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
export function slab(shape, halfW, bevel = 0.02, curveSegments = 10) {
  const depth = Math.max(0.002, 2 * (halfW - bevel));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments });
  g.translate(0, 0, -depth / 2);
  g.rotateY(-Math.PI / 2);                     // (z, y, x) -> design frame
  return g;
}

/** An arch over a wheel at (zc, yc), radius r, cut into an outline being drawn along its bottom from rear to front. */
export function arch(s, zc, yc, r, yRear, yFront) {
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
/** The colour of the mud the tyres throw up the bodywork (linear RGB; a map sets its own: Kerala's is red). */
export const MUD_TINT = new THREE.Color(0.085, 0.06, 0.04);

function paintMaterial(hex, uniforms) {
  // solid enamel under a clear coat: the sky and the trees slide across it
  const mat = new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.05, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.07 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDirt = uniforms.uDirt;
    sh.uniforms.uMudTint = { value: MUD_TINT };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLocal;
uniform float uDirt;
uniform vec3 uMudTint;
float gMud = 0.0;
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
  diffuseColor.rgb = mix(diffuseColor.rgb, uMudTint, m * 0.92);
  gMud = m;
}`)
      // mud dulls the shine
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoat *= 1.0 - gMud;
material.roughness = mix(material.roughness, 0.95, gMud);`);
  };
  return mat;
}

/** Cracked safety glass: a web of cracks from a few impact points over the dark tint (alpha carries both). */
let CRACKS = null;
function crackTexture() {
  if (CRACKS) return CRACKS;
  const S = 512, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(26,38,43,0.38)';
  x.fillRect(0, 0, S, S);
  let seed = 3;
  const R = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  x.lineCap = 'round';
  for (let hit = 0; hit < 3; hit++) {
    const cx = S * (0.2 + 0.6 * R()), cy = S * (0.2 + 0.6 * R());
    // radial cracks wandering out from the hit
    for (let k = 0; k < 14; k++) {
      let a = (k / 14) * Math.PI * 2 + R() * 0.4, px = cx, py = cy;
      const len = S * (0.15 + 0.45 * R());
      x.strokeStyle = 'rgba(235,242,245,0.95)';
      x.lineWidth = 2.6;
      x.beginPath(); x.moveTo(px, py);
      for (let t = 0; t < len; t += 12) { a += (R() - 0.5) * 0.35; px += Math.cos(a) * 12; py += Math.sin(a) * 12; x.lineTo(px, py); }
      x.stroke();
    }
    // rings of the spider web
    for (let ring = 1; ring <= 4; ring++) {
      const rr = ring * S * (0.035 + 0.02 * R());
      x.strokeStyle = 'rgba(235,242,245,0.85)';
      x.lineWidth = 2;
      x.beginPath();
      for (let k = 0; k <= 28; k++) { const a = (k / 28) * Math.PI * 2, j = rr * (0.85 + 0.3 * R()); if (k) x.lineTo(cx + Math.cos(a) * j, cy + Math.sin(a) * j); else x.moveTo(cx + Math.cos(a) * j, cy + Math.sin(a) * j); }
      x.stroke();
    }
    // the crushed spot itself
    x.fillStyle = 'rgba(225,232,236,0.8)';
    x.beginPath(); x.arc(cx, cy, S * 0.012, 0, Math.PI * 2); x.fill();
  }
  CRACKS = new THREE.CanvasTexture(c);
  CRACKS.colorSpace = THREE.SRGBColorSpace;
  return CRACKS;
}

// a rim's barrel, for a model that draws only the rim's face: unit radius, along x
const RIM_BARREL = new THREE.CylinderGeometry(0.97, 0.97, 1, 28, 1, true).rotateZ(Math.PI / 2);
RIM_BARREL.userData.cached = true;

/** A flat tyre: the tyre squashed against the ground under its rim, the sidewalls bulging. drop: how far it sank. */
function flatTyre(src, R, drop) {
  const g = src.clone();
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y >= 0) continue;
    const t = Math.min(1, -y / R);
    const s = 1 - (drop / R) * t * t;
    p.setY(i, y * s);
    p.setX(i, p.getX(i) * (1 + 0.22 * t * t * (drop / R) * 3));
  }
  g.computeVertexNormals();
  return g;
}

const MATS = {};
function shared() {
  if (MATS.black) return MATS;
  const std = (color, roughness, metalness, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  MATS.black = std(0x1d1d1c, 0.7, 0.2);
  MATS.satin = std(0x2a2a29, 0.5, 0.45);
  MATS.chrome = std(0xe8e8e6, 0.08, 1.0);
  MATS.alu = std(0xb9bbb8, 0.35, 0.85);
  MATS.glass = new THREE.MeshPhysicalMaterial({ color: 0x1a262b, roughness: 0.03, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.38, depthWrite: false });
  MATS.screen = MATS.glass.clone();                  // the windscreen: laminated, it cracks instead of falling out
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
  MATS.alloy = std(0xc3c6c9, 0.24, 0.9);             // diamond-cut alloy faces
  MATS.alloyDark = std(0x3a3d41, 0.4, 0.7);           // their painted pockets
  return MATS;
}

// ---------------------------------------------------------------- wheels (cached: shared by every wheel of that size)
const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) { const g = make(); for (const x of [].concat(g)) x.userData.cached = true; geoCache.set(key, g); }   // (one or a few)
  return geoCache.get(key);
}

/**
 * Tyre with its tread: 0 all-terrain (small blocks), 1 mud-terrain (big blocks, open voids), 2 bias mud (paddles),
 * 3 summer performance (ribs between straight grooves, slanted shoulder blocks), 4 track semi-slick (a nearly smooth
 * face, two grooves on its inner side).
 */
function tireGeometry(r, w, tread = 0) {
  return cached(`t${r.toFixed(3)}:${w.toFixed(3)}:${tread}`, () => {
    const hw = w / 2, rim = r * 0.58, depth = [0.011, 0.02, 0.032, 0.008, 0.005][tread] ?? 0.011;
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
    } else if (tread === 3 || tread === 4) {
      // a road tyre's face: ribs round the tyre with straight grooves between them (each rib from y0 to y1 across, in
      // half widths), and on a summer tyre the shoulders cut into blocks by slanted grooves
      const ribs = tread === 3 ? [[-0.42, 0.04], [0.16, 0.56]] : [[-0.98, -0.62], [-0.5, -0.16], [-0.04, 0.98]];
      for (const [y0, y1] of ribs) {
        const ring = [[rc, y0 * hw], [r, y0 * hw + 0.002], [r, y1 * hw - 0.002], [rc, y1 * hw]];
        parts.push(clean(new THREE.LatheGeometry(ring.map(([a, b]) => new THREE.Vector2(a, b)), 72)));
      }
      if (tread === 3) {
        const n = Math.round(C / 0.032);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          lug(a, -hw * 0.75, C / n * 0.84, w * 0.23, 0.3);
          lug(a + Math.PI / n, hw * 0.82, C / n * 0.84, w * 0.16, -0.3);
        }
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

/**
 * Alloy wheel (the Thar's 18" diamond-cut five twin-spoke): the barrel, five pairs of machined spokes over a dark face,
 * the centre cap and five nuts; outer face toward +x. Two geometries: the bright face and the dark parts.
 */
function alloyGeometry(r, w) {
  return cached(`a${r.toFixed(3)}:${w.toFixed(3)}`, () => {
    const hw = w * 0.42, bright = [], dark = [];
    const barrel = new THREE.CylinderGeometry(r, r, 2 * hw, 32, 1, true); barrel.rotateZ(Math.PI / 2); dark.push(clean(barrel));
    const face = new THREE.CylinderGeometry(r * 0.94, r * 0.94, 0.02, 32); face.rotateZ(Math.PI / 2); face.translate(hw * 0.55, 0, 0); dark.push(clean(face));
    const lip = new THREE.TorusGeometry(r * 0.985, 0.014, 6, 36); lip.rotateY(Math.PI / 2); lip.translate(hw, 0, 0); bright.push(clean(lip));
    for (let i = 0; i < 5; i++) for (const d of [-0.11, 0.11]) {
      const a = (i / 5) * Math.PI * 2 + d;
      const sp = new THREE.BoxGeometry(0.03, r * 0.72, r * 0.11);
      sp.translate(hw * 0.78, r * 0.52, 0);
      sp.rotateX(a);
      bright.push(clean(sp));
    }
    const hub = new THREE.CylinderGeometry(r * 0.26, r * 0.3, 0.05, 20); hub.rotateZ(Math.PI / 2); hub.translate(hw * 0.8, 0, 0); bright.push(clean(hub));
    const cap = new THREE.CylinderGeometry(r * 0.12, r * 0.12, 0.02, 16); cap.rotateZ(Math.PI / 2); cap.translate(hw * 0.8 + 0.03, 0, 0); dark.push(clean(cap));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 5;
      const nut = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 6); nut.rotateZ(Math.PI / 2);
      nut.translate(hw * 0.8 + 0.025, Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2); bright.push(clean(nut));
    }
    return [mergeGeometries(bright), mergeGeometries(dark)];
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
  P.box(M.screen, [1.52, wsL - 0.06, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
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
  P.box(M.screen, [1.56, wsL - 0.06, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
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
  P.box(M.screen, [1.34, wsL - 0.08, 0.012], [0, wsC[1], wsC[0]], { r: 0, rot: [-rake, 0, 0] });
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

// (a truck with a model body, render/TruckAssets.js, stands in another's built-in body until its model is loaded)
const BUILDERS = { ranger: rangerBody, hauler: haulerBody, mule: muleBody, gecko: geckoBody, trekker: trekkerBody, shepherd: shepherdBody, drover: droverBody, bruiser: bruiserBody, rhino: rhinoBody, thar: rangerBody, roxx: rangerBody, wrangler: muleBody, bronco: droverBody, hummer: droverBody, hummerev: haulerBody, cybertruck: haulerBody };

/**
 * A body from a real model (render/TruckAssets.js): its meshes in the body group (own copies: they dent), the game's
 * paint, glass and lamps on those parts. Returns the layout the rest of the truck is built around: the converter's
 * measurements and the model config's entries (tools/cars/<id>.json).
 */
function modelBody(model, asset, M, P) {
  const L = asset.layout;
  if (L.cabin && !L.interior?.replace) cabin(P, M, { ...L.cabin, side: Math.sign(L.steering?.x || 1) });   // (a model with an empty cab: seats and a dash)
  // a model whose own cockpit was unfinished (TruckAssets took it out): one built for it, fitted to it
  let cockpit = null;
  if (L.interior?.replace && L.steering) {
    const extra = [];
    cockpit = buildCockpit(P, L.interior, L.steering, model.spec.eye, L.roofMap ? (x, z) => roofAt(L.roofMap, x, z) : null, extra, model.spec);
    for (const m of extra) model.body.add(m);
    model.gauges = cockpit.gauges;
    model.cockpitMirror = cockpit.mirror;
  }
  const mats = { paint: model.paint, glass: M.glass, screen: M.screen, head_l: model.lampMats[0], head_r: model.lampMats[1], tail: model.brakeMat, reverse: model.revMat, amber: M.amber };
  // a part the model draws double-sided gets the game's material drawn from both sides too (this truck's own paint
  // and lamps turned so; a shared one through its double-sided twin)
  const own = new Set([model.paint, ...model.lampMats, model.brakeMat, model.revMat]);
  const both = (m) => {
    if (m.side === THREE.DoubleSide) return m;
    if (own.has(m)) { m.side = THREE.DoubleSide; return m; }
    return (m.userData.both ||= Object.assign(m.clone(), { side: THREE.DoubleSide }));
  };
  const wheel = [];                                      // (the model's own steering wheel, in its own frame)
  // the head lamps: the model's own lenses, reflectors and bulbs, in this truck's own copies of their materials that
  // glow when its lights are on (each side's apart, so a broken lamp goes dark alone: setLights)
  const lit = new Map();
  const headMat = (m, side) => {
    const key = `${side}:${m.uuid}`;
    if (!lit.has(key)) {
      const c = m.clone();
      c.emissive?.set(0xfff2c8); c.emissiveIntensity = 0;
      c.userData = { glow: m.transparent ? 1.6 : 2.6 };
      lit.set(key, c); model.headMats[side].push(c);
    }
    return lit.get(key);
  };
  for (const part of asset.parts) {
    const g = part.geometry.clone();
    g.userData = {};
    const mat = part.role === 'head' ? headMat(part.material, part.side) : mats[part.role] ? (part.doubleSided ? both(mats[part.role]) : mats[part.role]) : part.material;
    const m = new THREE.Mesh(g, mat);
    m.userData.role = part.role;
    m.castShadow = !mat.transparent; m.receiveShadow = !mat.transparent;
    if (part.steer) wheel.push(m); else model.body.add(m);
  }
  return {
    heads: L.heads, tails: [], reverse: [], ownLamps: true, ownBumpers: true, ownChassis: !!L.ownChassis,
    bumperF: L.bumperF, bumperR: L.bumperR, spare: L.spare || null, wheel: L.steering || null, frame: L.frame,
    wheelParts: cockpit ? [sportsWheel(L.steering.r || 0.18, L.interior.style)] : wheel, wheelColumn: cockpit ? sportsColumn(L.interior.style) : null,
    flaps: !!L.flaps, sill: L.sill, half: L.half, roofY: L.roofY ?? L.bbox[1][1], coilY: L.coilY, bedZ: L.bedZ, ownSnorkel: !!L.ownSnorkel,
    roofMap: L.roofMap || null, bedRail: L.bedRail || null,
    // (the roof, for the rack and the light bar: if a layout leaves it out, from the tail to a metre short of the front
    // axle, roughly where a wagon's roof runs)
    roofZ: L.roofZ || [L.bbox[0][2] + 0.3, (L.axleZ ? L.axleZ[0] : L.bbox[1][2] - 1.2) - 1.0],
  };
}

/** A model body keeps its own bumpers: the winch hides behind the front one, its fairlead and rope showing. */
function fairlead(P, M, spec, x, winch) {
  const bf = x.bumperF, fl = spec.winch.fairlead, fy = fl[1] - (spec.raise || 0), fz = Math.max(fl[2], bf.z);
  if (winch.synthetic) {
    P.box(M.alu, [0.26, 0.09, 0.025], [0, fy, fz + 0.012], { r: 0.01 });
    P.box(M.black, [0.17, 0.03, 0.03], [0, fy, fz + 0.016], { r: 0.012 });
  } else {
    P.box(M.satin, [0.28, 0.12, 0.04], [0, fy, fz + 0.02], { r: 0.01 });
    P.cyl(M.chrome, 0.018, 0.018, 0.18, [0, fy + 0.03, fz + 0.04], { axis: 'x' });
    P.cyl(M.chrome, 0.018, 0.018, 0.18, [0, fy - 0.03, fz + 0.04], { axis: 'x' });
  }
  P.box(M.red, [0.05, 0.08, 0.06], [0, fy - 0.06, fz + 0.07], { r: 0.012 });
}

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
  for (const a of spec.axles) P.box(M.rubber, [0.07, 0.07, 0.07], [a.springTrack / 2, (x.coilY ?? f.y) - 0.04, a.z], { r: 0.015, mirror: true });
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
  // snorkel: up the windscreen pillar on the passenger side to a ram head at roof height (some bodies draw their own)
  if (spec.snorkel && !x.ownSnorkel) {
    const [sx, sy0, sz] = spec.intake, sy = sy0 - raise, belt = spec.hull[0].c[1] + spec.hull[0].h[1] - raise;
    P.path(M.black, [[sx + 0.08, belt - 0.02, sz + 0.42], [sx, belt + 0.08, sz + 0.16], [sx, sy - 0.08, sz + 0.02]], 0.05, { seg: 12 });
    P.box(M.black, [0.15, 0.13, 0.22], [sx, sy, sz + 0.06], { r: 0.04 });
    P.box(M.satin, [0.11, 0.09, 0.02], [sx, sy, sz + 0.17], { r: 0.01 });
    P.box(M.satin, [0.03, 0.04, 0.08], [sx + 0.05, belt + 0.25, sz + 0.1], { r: 0.008 });
  }
  // roof rack: a tubular basket (a bed rack on the pickup), with fuel, water and a spare on the loaded one. On a model
  // body its feet stand on the roof where the roof is (the layout's roofMap, measured by tools/racks.py), a bed rack's
  // legs on the bed rails (bedRail), the basket level with the cab roof
  if (b.rack) {
    const roof = x.roofY, z0 = Math.max(x.roofZ[0] + 0.08, base.rackZ - 0.9), z1 = Math.min(x.roofZ[1] - 0.08, base.rackZ + 0.9);
    const bed = !!spec.look?.bed, rail = bed && x.bedRail;
    const zA = bed ? (x.bedZ ? x.bedZ[0] + 0.05 : base.rackZ - 1.0) : z0, zB = bed ? (x.bedZ ? x.bedZ[1] - 0.05 : base.rackZ + 1.0) : z1, zc = (zA + zB) / 2;
    // the feet: on the roof, inside its edges at each end of the rack
    const feet = !bed && x.roofMap ? [zA + 0.1, zB - 0.1].map((z) => roofFoot(x.roofMap, z)) : null;
    const hw = rail ? rail[0] : feet ? Math.min(feet[0].x, feet[1].x) : bed ? x.half - 0.14 : Math.min(0.7, x.half - 0.08);
    const y = bed ? roof + 0.02 : feet ? Math.max(feet[0].y, feet[1].y) + 0.09 : roof + 0.1;
    P.path(M.black, [[hw, y, zA], [hw, y, zB], [-hw, y, zB], [-hw, y, zA], [hw, y, zA]], 0.018);
    P.path(M.black, [[hw, y + 0.1, zA], [hw, y + 0.1, zB], [-hw, y + 0.1, zB], [-hw, y + 0.1, zA], [hw, y + 0.1, zA]], 0.014);
    for (let i = 0; i <= 4; i++) { const z = zA + (zB - zA) * i / 4; P.tube(M.black, [hw, y, z], [-hw, y, z], 0.012); P.tube(M.black, [hw, y, z], [hw, y + 0.1, z], 0.01, { mirror: true }); }
    if (rail) {
      // legs straight up from clamps on the rails
      for (const z of [zA + 0.06, zc, zB - 0.06]) {
        P.tube(M.black, [hw, rail[1], z], [hw, y, z], 0.022, { mirror: true });
        P.box(M.black, [0.07, 0.05, 0.1], [hw, rail[1] + 0.02, z], { r: 0.01, mirror: true });
      }
    } else if (bed) for (const z of [zA, zB]) P.tube(M.black, [hw + 0.08, spec.hull[0].c[1] + spec.hull[0].h[1] - raise, z], [hw, y, z], 0.022, { mirror: true });
    else if (feet) {
      // towers from the roof up to the basket, a pad under each
      for (const f of feet) for (const sx of [1, -1]) {
        const fy = roofAt(x.roofMap, sx * hw, f.z) ?? f.y;
        P.box(M.black, [0.05, y - fy, 0.05], [sx * hw, (y + fy) / 2, f.z], { r: 0.008 });
        P.box(M.rubber, [0.09, 0.02, 0.12], [sx * hw, fy + 0.01, f.z], { r: 0.006 });
      }
    } else for (const z of [zA + 0.1, zB - 0.1]) P.box(M.black, [0.06, 0.1, 0.06], [hw - 0.02, roof + 0.04, z], { r: 0.01, mirror: true });
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
    // (on a model body, its brackets stand on the roof where the roof is: a curved roof falls away at the sides)
    const z = x.roofZ[1] - 0.05, feet = [0.62, -0.62].map((sx) => (x.roofMap && roofAt(x.roofMap, sx, z - 0.04)) ?? x.roofY - 0.01);
    const y = Math.max(...feet) + 0.13;
    P.box(M.black, [1.3, 0.05, 0.06], [0, y, z], { r: 0.015 });
    [0.62, -0.62].forEach((sx, i) => P.box(M.black, [0.04, y - feet[i], 0.05], [sx, (y + feet[i]) / 2, z - 0.04], { r: 0.01 }));
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

/** The roof's height (m) at (x, z) from a layout's roofMap (tools/racks.py), or null off the roof. */
function roofAt(map, x, z) {
  map.rows ||= map.h.map((r) => r.split(' ').map((v) => (v === '-' ? null : v / 100)));
  const fx = (x - map.x0) / map.d, fz = (z - map.z0) / map.d, ix = Math.floor(fx), iz = Math.floor(fz);
  let s = 0, w = 0;
  for (const [i, k, wt] of [[ix, iz, (1 - fx + ix) * (1 - fz + iz)], [ix + 1, iz, (fx - ix) * (1 - fz + iz)], [ix, iz + 1, (1 - fx + ix) * (fz - iz)], [ix + 1, iz + 1, (fx - ix) * (fz - iz)]]) {
    const v = map.rows[k]?.[i];
    if (v != null && wt > 0) { s += v * wt; w += wt; }
  }
  return w > 0.05 ? s / w : null;
}

/** Where a roof rack's foot goes at one end: inside the roof's edges there (no wider than a rack is), on the roof. */
function roofFoot(map, z) {
  map.rows ||= map.h.map((r) => r.split(' ').map((v) => (v === '-' ? null : v / 100)));
  const row = map.rows[Math.min(map.nz - 1, Math.max(0, Math.round((z - map.z0) / map.d)))] || [];
  let edge = Infinity;
  for (const dir of [1, -1]) {
    let out = 0;
    row.forEach((v, i) => { const xx = map.x0 + i * map.d; if (v != null && xx * dir > out) out = xx * dir; });
    edge = Math.min(edge, out);
  }
  const x = Math.max(0.3, Math.min(0.7, edge - 0.1));
  return { x, z, y: Math.max(roofAt(map, x, z) ?? 0, roofAt(map, -x, z) ?? 0) };
}

// ---------------------------------------------------------------- the model
const UP = new THREE.Vector3(0, 1, 0);

export class TruckModel {
  /** opts.driver: false for no one in the driver's seat (the garage). */
  constructor(spec, paintHex = 0xb5532c, opts = {}) {
    const M = shared();
    this.spec = spec;
    this.uniforms = { uDirt: { value: 0 } };
    this.paint = paintMaterial(paintHex, this.uniforms);
    const look = spec.look || {}, canvasTop = look.top === 'canvas';
    this.top = look.top === 'paint' ? this.paint : look.top === 'black'
      ? new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.4, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.2 })
      : new THREE.MeshStandardMaterial({ color: canvasTop ? 0x8f8467 : 0xece6d6, roughness: canvasTop ? 0.95 : 0.45, metalness: canvasTop ? 0 : 0.15 });
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
    const rimR = (t.rim || (t.size >= 37 ? 17 : 15)) * IN / 2 + 0.03;
    const alloy = !!look.alloy && !t.beadlock;                      // the truck's alloys (beadlocks replace them)
    const rimModel = !t.beadlock && truckAsset(spec.style)?.rim.length ? truckAsset(spec.style) : null;
    // the model's own rim (unit radius, face to +x), to the rim's size: a whole rim (barrel and face) across the tyre's
    // bead, centred; a rim's face alone (the spokes, as some models draw it) as modelled, out at the tyre's outer bead,
    // with a barrel behind it (stretched across the bead, a face stood out from the tyre like a spacer)
    const modelRim = () => {
      const g = new THREE.Group(), [x0, x1] = rimModel.rimX, bead = Wt * 0.42;
      for (const r of rimModel.rim) { const m = new THREE.Mesh(r.geometry, r.material); m.castShadow = true; g.add(m); }
      if ((x1 - x0) * rimR < bead) {
        g.scale.setScalar(rimR);
        g.position.x = bead - x1 * rimR;
        const barrel = new THREE.Mesh(RIM_BARREL, M.alloyDark.userData.both ||= Object.assign(M.alloyDark.clone(), { side: THREE.DoubleSide }));
        barrel.scale.x = 2 * bead / rimR;
        barrel.position.x = -g.position.x / rimR;
        g.add(barrel);
      } else {
        const sx = 2 * bead / (x1 - x0);
        g.scale.set(sx, rimR, rimR);
        g.position.x = -(x0 + x1) / 2 * sx;
      }
      // (in a group of its own: turned to face out on the right, or stood up as the spare, it keeps its offset)
      return new THREE.Group().add(g);
    };

    // ---- body, chassis, bumpers, build
    const P = new PartList();
    this.lampMats = [this.lightMat, this.lightMat.clone()];           // left (+x), right
    this.headMats = [[], []];                                         // a model body's own head lamps, left and right
    const asset = truckAsset(spec.style);
    this.modelBody = !!asset;
    // (a body of its own until the model comes: a road car's a generic coupe, another truck's a wagon)
    const x = asset ? modelBody(this, asset, M, P) : (BUILDERS[spec.style] || (spec.road ? coupeBody : droverBody))(P, M, this.paint, this.top, spec);
    this.layout = x;
    if (!x.ownChassis) chassis(P, M, spec, x);
    // (a road car's recovery rope goes on its tow eye: no winch bumper, no fairlead)
    if (!spec.road) { if (x.ownBumpers) fairlead(P, M, spec, x, spec.winch || {}); else bumpers(P, M, spec, x, spec.winch || {}); }
    buildParts(P, M, spec, x, base, this.barMat);
    this.lamps = [];
    for (const [hx, hy, hz, hr] of x.ownLamps ? [] : x.heads) {
      [1, -1].forEach((sx, side) => {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(hr, hr, 0.03, 18).rotateX(Math.PI / 2), this.lampMats[side]);
        lamp.position.set(sx * hx, hy, hz);
        this.lamps.push(lamp);
      });
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
      if (x.spare.mount === 'under') { tg.rotateZ(Math.PI / 2); rg.rotateZ(Math.PI / 2); pos = [x.spare.x, x.frame.y - Wt / 2 + 0.06, x.spare.z]; } else if (x.spare.mount === 'bed') {
        tg.rotateZ(Math.PI / 2); rg.rotateZ(Math.PI / 2); pos = [x.spare.x, x.spare.y + Wt / 2, x.spare.z];
      } else {
        tg.rotateY(Math.PI / 2); rg.rotateY(Math.PI / 2);
        pos = [x.spare.x, x.spare.y ?? Math.max(x.sill + R + 0.12, 0.98), x.spare.z - Wt / 2 - 0.05];
        P.box(M.black, [0.06, 0.4, 0.06], [x.spare.x, pos[1] - 0.12, x.spare.z - 0.02], { r: 0.01 });
      }
      P.add(M.tire, tg, pos);
      if (rimModel) {
        const sg = modelRim();
        if (x.spare.mount === 'under' || x.spare.mount === 'bed') sg.rotation.z = Math.PI / 2; else sg.rotation.y = Math.PI / 2;      // (face out the back)
        sg.position.set(...pos);
        this.spareRim = sg;
        rg.dispose();
      } else if (alloy) { const [ab, ad] = alloyGeometry(rimR, Wt); const b2 = ab.clone(), d2 = ad.clone(); for (const g of [b2, d2]) g.rotateY(Math.PI / 2); P.add(M.alloy, b2, pos); P.add(M.alloyDark, d2, pos); rg.dispose(); } else P.add(t.beadlock ? M.bead : M.steel, rg, pos);
    }
    P.build(this.body);
    for (const l of this.lamps) this.body.add(l);
    if (this.spareRim) this.body.add(this.spareRim);
    // this truck's own glass, so it can crack and shatter
    // this truck's own glass: the windscreen (laminated: it crazes) and the side and back windows (toughened: they burst)
    const screens = this.body.children.filter((m) => m.material === M.screen || m.material === M.screen.userData.both);
    if (screens.length) {
      this.screen = M.screen.clone();
      if (screens.some((m) => m.material.side === THREE.DoubleSide)) this.screen.side = THREE.DoubleSide;
      for (const sm of screens) {
        sm.material = this.screen;
        // the parts lose their texture coordinates when merged: map the cracks across the pane, flat on from the front
        const g = sm.geometry, p = g.attributes.position;
        g.computeBoundingBox();
        const b = g.boundingBox, uv = new Float32Array(p.count * 2);
        for (let i = 0; i < p.count; i++) {
          uv[i * 2] = (p.getX(i) - b.min.x) / (b.max.x - b.min.x || 1);
          uv[i * 2 + 1] = (p.getY(i) - b.min.y) / (b.max.y - b.min.y || 1);
        }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      }
    }
    this.glassMeshes = this.body.children.filter((m) => m.material === M.glass || m.material === M.glass.userData.both);
    this.dentMeshes = this.body.children.filter((m) => m.isMesh && !m.material.transparent);
    this.rimR = rimR;

    // ---- steering wheel (turns with the front wheels): the model's own, cut out of its dash (render/TruckAssets.js),
    // or one built here for a model with an empty cab
    if (x.wheel) {
      const w = x.wheel, g = new THREE.Group();
      g.position.set(w.x, w.y, w.z);
      g.rotation.set(w.tilt, w.yaw || 0, 0, 'YXZ');
      this.steeringWheel = new THREE.Group();
      if (x.wheelParts?.length) { this.steeringWheel.add(...x.wheelParts); if (x.wheelColumn) g.add(x.wheelColumn); }
      else {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.016, 8, 24), M.black);
        const spokes = new THREE.Mesh(mergeGeometries([0, 2.1, 4.2].map((a) => clean(new THREE.BoxGeometry(0.17, 0.02, 0.012).translate(0.085, 0, 0).rotateZ(a + Math.PI / 2)))), M.satin);
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.4, 8).rotateX(Math.PI / 2).translate(0, 0, 0.2), M.black);
        this.steeringWheel.add(ring, spokes);
        g.add(col);
      }
      g.add(this.steeringWheel);
      this.body.add(g);
      // the driver, hands on it: a real person once the models are here (render/Person.js), drawn until then
      if (spec.eye && opts.driver !== false) {
        const A = driverAssets();
        // (his hips where the seat has them: a model's own, measured, spec.hip; the game's, 28 cm ahead of his eyes)
        const hip = spec.hip ?? spec.eye[2] + 0.28;
        this.driver = A ? new Person(A, g, w.r || 0.19, spec.eye, hip) : new Driver(g, w.r || 0.19, spec.eye, hip);
        this.body.add(this.driver.group);
      }
    }

    // ---- the mirrors, on the player's own car
    if (opts.mirrors && asset?.layout.interior && spec.eye) this.buildMirrors(asset.layout.interior, spec);

    // ---- axles and wheels (CG frame; the physics moves them)
    const rStatic = R - (spec.mass * GRAV / 4) / t.stiffness;
    const coilR = spec.mass > 4000 ? 0.12 : 0.085, coilWire = spec.mass > 4000 ? 0.02 : 0.013;
    this.axles = spec.axles.map((a, ai) => {
      const half = a.track / 2;
      const yStatic = rStatic - cgY, yDroop = yStatic - a.sag;
      const group = new THREE.Group();
      group.position.set(0, yStatic, a.z - cgZ);
      this.root.add(group);
      // the beam: tube, diff and pinion; on portal axles they ride above the hubs, and a gear drop at each wheel
      // brings the drive down to the hub
      const heavy = a.mass > 110, tubeR = a.mass > 300 ? 0.075 : heavy ? 0.052 : 0.044, dd = a.diffDrop ?? 0.16;
      const portal = !!look.portal, up = this.tubeUp = portal ? 0.21 : 0, rp = portal ? 0.16 : dd * 0.82, dy = rp - dd;
      const AP = new PartList();
      if (!a.ifs) {
      AP.cyl(M.under, tubeR, tubeR, a.track - Wt - (portal ? 0.36 : 0.08), [0, up, 0], { axis: 'x' });
      AP.add(M.under, new THREE.SphereGeometry(rp, 14, 10).scale(1.05, 1, 0.9), [a.diffX || 0, dy, 0]);
      AP.cyl(M.satin, rp * 0.82, rp * 0.82, 0.03, [a.diffX || 0, dy + 0.005, ai === 0 ? rp * 0.8 : -rp * 0.8], { axis: 'z', seg: 16 });
      AP.cyl(M.under, 0.055, 0.07, 0.16, [a.diffX || 0, up, ai === 0 ? -rp - 0.04 : rp + 0.04], { axis: 'z' });
      if (portal) for (const sx of [1, -1]) AP.box(M.under, [0.17, up + 0.26, 0.34], [sx * (a.track / 2 - Wt / 2 - 0.13), up / 2 - 0.02, 0], { r: 0.05 });
      for (const sx of [1, -1]) {
        if (look.coils) {
          AP.cyl(M.under, 0.1, 0.1, 0.03, [sx * a.springTrack / 2, up + tubeR + 0.015, 0], { seg: 16 });       // coil seat
          AP.box(M.under, [0.06, 0.06, 0.5], [sx * (a.springTrack / 2 - 0.12), up - tubeR - 0.02, ai === 0 ? -0.25 : 0.25], { r: 0.01 });   // link
          AP.box(M.under, [0.05, 0.05, coilR + 0.1], [sx * a.springTrack / 2, up - 0.04, (ai === 0 ? -1 : 1) * (coilR + 0.1) / 2], { r: 0.01 });   // shock mount
        } else {
          AP.box(M.under, [0.1, 0.03, 0.16], [sx * a.springTrack / 2, tubeR + 0.012, 0], { r: 0.005 });
          for (const dz of [-0.05, 0.05]) AP.cyl(M.satin, 0.009, 0.009, 0.16, [sx * a.springTrack / 2, 0.0, dz]);
          AP.box(M.under, [0.08, 0.025, 0.14], [sx * a.springTrack / 2, -tubeR - 0.02, 0], { r: 0.005 });
        }
      }
      if (ai === 0) AP.cyl(M.satin, 0.018, 0.018, a.track - 0.5, [0, up - 0.02, -0.17], { axis: 'x' });
      } else {
        // independent: the diff bolted to the frame (at ride height: this group stays at full droop), a crossmember
        AP.add(M.under, new THREE.SphereGeometry(0.12, 14, 10).scale(1.15, 0.95, 1), [0, a.sag, 0.02]);
        AP.box(M.under, [a.track - Wt - 0.7, 0.07, 0.09], [0, a.sag + 0.2, -0.12], { r: 0.012 });
      }
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
        let rim;
        if (rimModel) rim = modelRim();
        else if (alloy) {
          const [ab, ad] = alloyGeometry(rimR, Wt);
          rim = new THREE.Group();
          rim.add(new THREE.Mesh(ab, M.alloy), new THREE.Mesh(ad, M.alloyDark));
          rim.children.forEach((m) => { m.castShadow = true; });
        } else rim = new THREE.Mesh(rimGeometry(rimR, Wt, t.beadlock), t.beadlock ? M.bead : M.steel);
        if (side < 0) rim.rotation.y = Math.PI;              // outer face out on both sides
        tire.castShadow = true; rim.castShadow = true;
        spin.add(tire, rim);
        return { knuckle, spin, tire, tireGeo: tire.geometry };
      });
      return { group, wheels, yDroop, half, spec: a, ifs: !!a.ifs };
    });
    // independent suspension (front, or both ends): wishbones (upper and lower each side) and the drive shafts from the
    // diff on the frame, placed every frame between the frame and the knuckles
    this.ifsAxles = this.axles.filter((ax) => ax.ifs);
    if (this.ifsAxles.length) {
      this.arms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 8).translate(0, 0.5, 0), M.under, 6 * this.ifsAxles.length);
      this.arms.castShadow = true; this.arms.frustumCulled = false;
      this.root.add(this.arms);
    }

    // ---- leaf springs (two halves per side) or coils, shocks (body and shaft), propshafts: placed every frame
    const nLeaf = look.coils ? 4 : 8, nShock = 4;
    this.coils = !!look.coils;
    this.leaves = new THREE.InstancedMesh(look.coils ? coilGeometry(coilR, coilWire) : new THREE.BoxGeometry(0.065, 1, 0.055).translate(0, 0.5, 0), look.coils ? M.satin : M.under, nLeaf);
    this.shockBody = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 10).translate(0, 0.5, 0), b2m(spec, M), nShock);
    this.shockRod = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), M.chrome, nShock);
    for (const m of [this.leaves, this.shockBody, this.shockRod]) { m.castShadow = true; m.frustumCulled = false; this.root.add(m); }
    const f = x.frame, lt = spec.axles[0].travel > 0.3;
    this.mounts = spec.axles.map((a) => {
      const L = look.leaf ?? 0.6, up = this.tubeUp || 0, s = a.springTrack / 2, ins = a.z > 0 ? -1 : 1;
      // coils: the spring on the axle up to a seat under the frame (or a tower beside it), the shock just inboard of it
      // toward the middle of the truck; leaves: the shock beside the spring
      return {
        hanger: [s, f.y - 0.02, a.z + L], shackle: [s, f.y - 0.07, a.z - L],
        coilTop: [s, x.coilY ?? f.y + 0.04, a.z],
        shockTop: look.coils ? [s, f.y + 0.3 + (lt ? 0.08 : 0), a.z + ins * (coilR + 0.13)] : [s + 0.09, f.y + 0.3 + (lt ? 0.08 : 0), a.z + 0.16],
        shockLow: look.coils ? [s, up - 0.04, ins * (coilR + 0.1)] : [s + 0.09, up - 0.06, a.z > 0 ? -0.1 : 0.1],
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
  setLights(on) {
    this.lampMats.forEach((m, i) => { m.emissiveIntensity = this.broken?.[i] ? 0 : on ? 3.5 : 0.15; });
    this.headMats.forEach((list, i) => { for (const m of list) m.emissiveIntensity = this.broken?.[i] || !on ? 0 : m.userData.glow; });
    this.barMat.emissiveIntensity = on ? 4 : 0.1; this.lightsOn = on; this.setBrake(this.braking);
  }

  // ---------------------------------------------------------------- damage (physics/Damage.js)
  /**
   * Press dents into the body: each { p, d, depth, r } with p the point hit and d the push (CG frame). Vertices within r
   * move along d by depth times a smooth bowl (crumpled a little), and their normals tilt into the bowl so it
   * catches the light.
   */
  applyDents(dents) {
    const o = this.bodyOffset;
    for (const dent of dents) {
      const px = dent.p[0] - o.x, py = dent.p[1] - o.y, pz = dent.p[2] - o.z;
      const [dx, dy, dz] = dent.d, R = dent.r, depth = dent.depth;
      for (const m of this.dentMeshes) {
        const g = m.geometry, bs = g.boundingSphere || (g.computeBoundingSphere(), g.boundingSphere);
        if (Math.hypot(bs.center.x - px, bs.center.y - py, bs.center.z - pz) > bs.radius + R) continue;
        const pos = g.attributes.position, nor = g.attributes.normal;
        let moved = false;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i) - px, y = pos.getY(i) - py, z = pos.getZ(i) - pz;
          const d2 = x * x + y * y + z * z;
          if (d2 >= R * R) continue;
          const rho = Math.sqrt(d2) / R, f = (1 - rho * rho) ** 2;
          const h = Math.sin(i * 12.9898) * 43758.5453, crumple = 0.75 + 0.5 * (h - Math.floor(h));
          const k = depth * f * crumple;
          pos.setXYZ(i, pos.getX(i) + dx * k, pos.getY(i) + dy * k, pos.getZ(i) + dz * k);
          if (nor) {
            const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
            const along = x * nx + y * ny + z * nz;
            let tx = x - nx * along, ty = y - ny * along, tz = z - nz * along;
            const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
            const tilt = (dx * nx + dy * ny + dz * nz) * depth * 4 * rho * (1 - rho * rho) / R * crumple;
            const ax = nx + tilt * tx, ay = ny + tilt * ty, az = nz + tilt * tz, al = Math.hypot(ax, ay, az) || 1;
            nor.setXYZ(i, ax / al, ay / al, az / al);
          }
          moved = true;
        }
        if (moved) { pos.needsUpdate = true; if (nor) nor.needsUpdate = true; g.computeBoundingSphere(); }
      }
    }
  }

  /**
   * The rest of the damage: glass (0 whole, 0.35+ cracked, 2 shattered), headlamps [left, right] (1 working), flat
   * tyres [4], the tie rod's toe (rad: the steering wheel stays where the driver holds it).
   */
  setDamage(glass, lights, flat, toe) {
    this.toe = toe || 0;
    if (this.screen) {
      const crack = glass >= 0.35;
      if (crack && !this.screen.map) {
        this.screen.map = crackTexture();
        this.screen.color.set(0xffffff);
        this.screen.opacity = 1;
        this.screen.needsUpdate = true;
      } else if (!crack && this.screen.map) {
        this.screen.map = null; this.screen.color.set(0x1a262b); this.screen.opacity = 0.38; this.screen.needsUpdate = true;
      }
    }
    for (const gm of this.glassMeshes) gm.visible = glass < 2;
    this.broken = [!lights[0], !lights[1]];
    this.lampMats.forEach((m, i) => { m.color.set(this.broken[i] ? 0x2a2a28 : 0xfff6dc); });
    this.setLights(this.lightsOn);
    // a flat tyre: squashed under the rim, and it no longer spins with it (the rim turns inside)
    this.axles.forEach((ax, ai) => ax.wheels.forEach((wm, s) => {
      const i = ai * 2 + s, isFlat = !!flat[i];
      if (isFlat === !!wm.flat) return;
      wm.flat = isFlat;
      const tire = wm.tire;
      if (isFlat) {
        tire.geometry = flatTyre(tire.geometry, this.spec.tyre.radius, this.spec.tyre.radius - this.rimR - 0.05);
        wm.knuckle.add(tire);
      } else {
        tire.geometry.dispose();
        tire.geometry = wm.tireGeo;
        wm.spin.add(tire);
      }
    }));
  }
  setBrake(on) { this.braking = !!on; this.brakeMat.emissiveIntensity = on ? 2.4 : this.lightsOn ? 0.7 : 0.05; }
  setReverse(on) { this.revMat.emissiveIntensity = on ? 1.6 : 0; }

  /** A design-frame point on the body -> CG frame (into v). */
  bodyPoint(p, v, mirror = 1) { return v.set(p[0] * mirror, p[1], p[2]).add(this.bodyOffset); }

  /**
   * The mirrors, for the player's own car (render/Mirrors.js): the door mirrors' glass where the model has it (I:
   * layout.interior), and the rear-view mirror (a built cockpit's, in a housing of its own, or the model's), each set
   * as a driver would set it: between the eye and straight back (a door mirror a little out from the car's side).
   */
  buildMirrors(I, spec) {
    const list = [], eye = new THREE.Vector3(...spec.eye);
    const back = MATS.mirrorBack ||= new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.6, emissive: 0x2a2a2c, emissiveIntensity: 0.6 });
    // a glass (g: its middle c, size w x h, round), and for a model without that mirror (g.arm: the point on the body
    // it is bolted to) its housing too, on an arm or a stalk from there
    const add = (g, look, res, housing) => {
      const m = new Mirror(g.w, g.h, res, g.round);
      m.aim(new THREE.Vector3(...g.c), eye, look);
      if (housing || g.arm) {
        const deep = g.arm && g.c[0] ? 0.06 : 0.032;
        const h = new THREE.Mesh(new THREE.BoxGeometry(g.w + 0.024, g.h + 0.02, deep), back);
        h.position.z = -0.004 - deep / 2;
        m.mesh.add(h);
      }
      if (g.arm) {
        const a = new THREE.Vector3(...g.arm), d = new THREE.Vector3(...g.c).sub(a), len = d.length();
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, len), back);
        arm.position.copy(a).addScaledVector(d, 0.5);
        arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.divideScalar(len));
        this.body.add(arm);
      }
      this.body.add(m.mesh);
      list.push(m);
    };
    // the door mirrors: each given as the left one, the right its mirror image (but `one`: that one alone)
    const side = (p, s) => p && [s * p[0], p[1], p[2]];
    for (const g of I.mirrors || []) if (g) for (const s of g.one ? [1] : [1, -1]) add({ ...g, c: side(g.c, s), arm: side(g.arm, s) }, new THREE.Vector3(s * 0.15, 0, -1), [160, 120]);
    const cm = this.cockpitMirror, rv = cm ? { c: cm.position.toArray(), w: cm.w, h: cm.h } : I.rearView;
    if (rv) add(rv, new THREE.Vector3(0, 0.02, -1), [288, 80], !!cm);
    this.mirrors = list.length ? new Mirrors(list) : null;
  }

  /** The cockpit's instruments (a built one's: render/Cockpit.js), to the revs, the speed and the gear. */
  updateGauges(rpm, kmh, gear) { this.gauges?.draw(rpm, kmh, gear); }

  /**
   * In the driver's-seat view, the driver's head is where the camera is: hidden. A sports car's (or a built cockpit's) body from inside is
   * trim, not paint (the paint's inside faces drawn dark), and its glass is clear from inside (out there, at the
   * angles the cab sees it, it caught the sky white).
   */
  setSeatView(on) {
    this.driver?.setSeatView(on);
    if ((!this.spec.road && !this.gauges) || this.seatView === on) return;       // (a sports car, or one with a cockpit built for it)
    this.seatView = on;
    if (!this.insideTrim) {
      const trim = MATS.insideTrim ||= new THREE.MeshStandardMaterial({ color: 0x3a3a3d, roughness: 0.9, side: THREE.BackSide, emissive: 0x3a3a3d, emissiveIntensity: 0.9 });
      this.insideTrim = this.body.children.filter((m) => m.isMesh && m.userData.role === 'paint').map((m) => {
        const t = new THREE.Mesh(m.geometry, trim);
        t.position.copy(m.position); t.quaternion.copy(m.quaternion); t.scale.copy(m.scale);
        t.visible = false; t.castShadow = false;
        this.body.add(t);
        return t;
      });
      this.paintSide = this.paint.side;
      // (the windscreen keeps its own: it shows its cracks)
      this.glassAll = this.body.children.filter((m) => m.isMesh && m.userData.role === 'glass');
      this.glassOut = this.glassAll.map((m) => m.material);
      const clear = (g) => (g.userData.inside ||= Object.assign(g.clone(), { opacity: 0.14, clearcoat: 0, envMapIntensity: 0.15, side: THREE.DoubleSide }));
      this.glassIn = this.glassOut.map(clear);
    }
    for (const t of this.insideTrim) t.visible = on;
    this.paint.side = on ? THREE.FrontSide : this.paintSide;
    this.paint.needsUpdate = true;
    this.glassAll.forEach((m, i) => { m.material = on ? this.glassIn[i] : this.glassOut[i]; });
  }

  /** wheels: [4] of [travel (from full droop), spin angle, steer angle] for FL, FR, RL, RR; dt: s since the last. */
  updateWheels(wheels, dt = 1 / 60) {
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai];
      const zL = wheels[ai * 2][0], zR = wheels[ai * 2 + 1][0];
      if (ax.ifs) {
        // each knuckle on its own wishbones: the group stays at full droop, square to the body
        ax.group.position.y = ax.yDroop; ax.group.rotation.z = 0;
        ax.wheels[0].knuckle.position.y = zL; ax.wheels[1].knuckle.position.y = zR;
      } else {
        ax.group.position.y = ax.yDroop + (zL + zR) / 2;
        ax.group.rotation.z = Math.atan2(zL - zR, ax.spec.track);
      }
      for (let s = 0; s < 2; s++) {
        const w = wheels[ai * 2 + s], wm = ax.wheels[s];
        wm.knuckle.rotation.y = w[2];
        wm.spin.rotation.x = w[1];
      }
      ax.group.updateMatrix();
    }
    // the steering wheel: as far as the player's own steering wheel turns (handWheel: radians), else as a car's does,
    // 14 times the front wheels' angle
    if (this.steeringWheel) this.steeringWheel.rotation.z = this.handWheel ?? -((wheels[0][2] + wheels[1][2]) / 2 - (this.toe || 0)) * 14;
    if (this.driver?.group.visible) this.driver.update(this.steeringWheel.rotation.z, dt);
    // leaf springs: hanger -> seat on the axle -> shackle; shocks: frame mount -> axle mount
    const v = this._v, w = this._w;
    let li = 0, si = 0;
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], mt = this.mounts[ai], s = ax.spec.springTrack / 2;
      for (const side of [1, -1]) {
        const ky = ax.ifs ? ax.wheels[side > 0 ? 0 : 1].knuckle.position.y : 0;      // (independent: on that wheel's arm)
        if (this.coils) {
          const seat = w.set(side * s, (this.tubeUp || 0) + 0.1 + ky, 0).applyMatrix4(ax.group.matrix).clone();
          this.bodyPoint(mt.coilTop, v, side); this.segment(this.leaves, li++, seat, v);
        } else {
          const seatC = w.set(side * s, 0.06, 0).applyMatrix4(ax.group.matrix).clone();
          this.bodyPoint(mt.hanger, v, side); this.segment(this.leaves, li++, v, seatC);
          this.bodyPoint(mt.shackle, v, side); this.segment(this.leaves, li++, seatC, v);
        }
        const low = w.set(side * mt.shockLow[0], mt.shockLow[1] + ky, mt.shockLow[2]).applyMatrix4(ax.group.matrix);
        const top = this.bodyPoint(mt.shockTop, v, side);
        const len = top.distanceTo(low);
        this.segment(this.shockBody, si, top, low, Math.min(len, 0.34));
        this.segment(this.shockRod, si++, low, top, Math.max(0.05, len - 0.3));
      }
    }
    // the wishbones and drive shafts of independent suspension: frame -> knuckle, diff -> hub
    let k = 0;
    for (const ax of this.ifsAxles || []) {
      const G = ax.group.matrix, h = ax.half, ys = ax.spec.sag;
      for (let si2 = 0; si2 < 2; si2++) {
        const side = si2 === 0 ? 1 : -1, yk = ax.wheels[si2].knuckle.position.y;
        for (const [a, b] of [[[h - 0.5, ys + 0.17, 0], [h - 0.17, yk + 0.15, 0]], [[h - 0.56, ys - 0.1, 0], [h - 0.13, yk - 0.13, 0]], [[0.13, ys, 0.04], [h - 0.09, yk, 0]]]) {
          this.segment(this.arms, k++, v.set(side * a[0], a[1], a[2]).applyMatrix4(G), w.set(side * b[0], b[1], b[2]).applyMatrix4(G));
        }
      }
      this.arms.instanceMatrix.needsUpdate = true;
    }
    this.leaves.instanceMatrix.needsUpdate = true;
    this.shockBody.instanceMatrix.needsUpdate = true;
    this.shockRod.instanceMatrix.needsUpdate = true;
    // propshafts: transfer case -> pinion
    for (let ai = 0; ai < 2; ai++) {
      const ax = this.axles[ai], sh = this.shafts[ai], a = ax.spec, rp = this.tubeUp ? 0.16 : (a.diffDrop ?? 0.16) * 0.82;
      const end = this._w.set((a.diffX || 0) * 0.9, ax.ifs ? a.sag : this.tubeUp || 0, ai === 0 ? -rp - 0.1 : rp + 0.1).applyMatrix4(ax.group.matrix);
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
    this.mirrors?.dispose();
    this.root.traverse((o) => { if (o.geometry && !o.geometry.userData.cached) o.geometry.dispose(); });
    for (const m of [this.paint, this.top, ...this.lampMats, ...this.headMats.flat(), this.barMat, this.brakeMat, this.revMat, this.screen]) m?.dispose();
  }
}

/** A coil spring, unit height along +y (scaled to the gap between its seats). */
function coilGeometry(r, wire, turns = 7) {
  const pts = [];
  for (let i = 0; i <= turns * 14; i++) { const t = i / (turns * 14), a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, t, Math.sin(a) * r)); }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 14, wire, 5, false);
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
