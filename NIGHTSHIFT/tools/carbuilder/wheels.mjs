// Wheel, tire, rim and brake geometry. Reference size: tire radius 0.34 m, width 0.25 m.
// Axis of rotation is +X; the "outer" face of the wheel points towards +X.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WHEEL_REF = { radius: 0.34, width: 0.25 };
const R = 0.34, TW = 0.25, RI = 0.232;

function lathe(points, seg) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X (y maps to +x)
  return g;
}

export function tireGeometry(seg = 40) {
  const h = TW / 2;
  const pts = [
    [RI - 0.005, -h + 0.02], [RI + 0.02, -h], [R - 0.05, -h - 0.004], [R - 0.02, -h + 0.012], [R - 0.004, -h + 0.04],
    [R, -h + 0.07], [R, h - 0.07], [R - 0.004, h - 0.04], [R - 0.02, h - 0.012], [R - 0.05, h + 0.004], [RI + 0.02, h], [RI - 0.005, h - 0.02],
  ];
  const g = lathe(pts, seg);
  return g;
}

function barrel(seg) {
  const h = TW / 2;
  // outer lip -> barrel inside -> back face
  const pts = [[RI - 0.035, h - 0.035], [RI + 0.004, h - 0.012], [RI + 0.012, h - 0.004], [RI + 0.006, h + 0.002], [RI - 0.012, h - 0.004], [RI - 0.02, h - 0.03], [RI - 0.02, -h + 0.03], [RI - 0.01, -h + 0.01], [RI - 0.05, -h + 0.02]];
  return lathe(pts, seg);
}

function hub(depth = 0.04) {
  const h = TW / 2;
  const g = lathe([[0.001, h - 0.02], [0.03, h - 0.02], [0.045, h - 0.03], [0.07, h - 0.045], [0.075, h - 0.03 - depth]], 24);
  const nuts = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    nuts.push(new THREE.CylinderGeometry(0.009, 0.01, 0.02, 6).rotateZ(Math.PI / 2).translate(h - 0.025, Math.cos(a) * 0.052, Math.sin(a) * 0.052));
  }
  return mergeGeometries([g.toNonIndexed(), ...nuts.map((n) => n.toNonIndexed())]);
}

function spoke(a, r0, r1, w0, w1, depth, x, twist = 0, dish = 0.02) {
  const s = new THREE.Shape();
  s.moveTo(r0, -w0 / 2);
  s.lineTo(r1, -w1 / 2);
  s.lineTo(r1, w1 / 2);
  s.lineTo(r0, w0 / 2);
  s.lineTo(r0, -w0 / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 1 });
  // shape in XY (x radial), extrude along +Z. Map: radial->Y/Z plane, extrusion->X axis
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const rx = p.getX(i), ry = p.getY(i), ez = p.getZ(i);
    const r = Math.hypot(rx, ry);
    const ang = a + Math.atan2(ry, rx) + twist * (r - r0) / (r1 - r0);
    const k = (r - r0) / (r1 - r0);
    const xx = x + ez - dish * k; // concave dish
    p.setXYZ(i, xx, Math.cos(ang) * r, Math.sin(ang) * r);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

export function rimGeometry(style, seg = 40) {
  const h = TW / 2;
  const parts = [barrel(seg).toNonIndexed()];
  const face = h - 0.05;
  if (style === 0) { // 5 twin (Y) spokes
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      parts.push(spoke(a - 0.1, 0.06, RI - 0.01, 0.034, 0.03, 0.028, face, 0.12, 0.03));
      parts.push(spoke(a + 0.1, 0.06, RI - 0.01, 0.034, 0.03, 0.028, face, -0.12, 0.03));
    }
  } else if (style === 1) { // 10 straight thin spokes
    for (let i = 0; i < 10; i++) parts.push(spoke((i / 10) * Math.PI * 2, 0.06, RI - 0.01, 0.026, 0.02, 0.03, face, 0, 0.012));
  } else if (style === 2) { // mesh / cross-lace
    for (let i = 0; i < 12; i++) {
      parts.push(spoke((i / 12) * Math.PI * 2, 0.06, RI - 0.01, 0.014, 0.012, 0.018, face, 0.45, 0.02));
      parts.push(spoke((i / 12) * Math.PI * 2, 0.06, RI - 0.01, 0.014, 0.012, 0.018, face - 0.012, -0.45, 0.02));
    }
  } else if (style === 3) { // turbine blades
    for (let i = 0; i < 16; i++) parts.push(spoke((i / 16) * Math.PI * 2, 0.07, RI - 0.01, 0.03, 0.05, 0.016, face, 0.55, 0.01));
    parts.push(lathe([[0.07, face + 0.01], [RI - 0.015, face - 0.02], [RI - 0.015, face - 0.035], [0.07, face - 0.005]], 32).toNonIndexed());
  } else { // 4: steel wheel with hubcap holes
    const s = new THREE.Shape();
    s.absarc(0, 0, RI - 0.005, 0, Math.PI * 2, false);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absellipse(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.03, 0.022, 0, Math.PI * 2, false, a);
      s.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false, curveSegments: 20 });
    g.rotateY(Math.PI / 2).translate(face - 0.01, 0, 0);
    parts.push(g.toNonIndexed());
  }
  parts.push(hub());
  for (const p of parts) { if (p.attributes.uv) p.deleteAttribute('uv'); }
  const g = mergeGeometries(parts);
  return g;
}

export function brakeGeometry() {
  const h = TW / 2;
  const disc = lathe([[0.09, h - 0.075], [0.19, h - 0.075], [0.19, h - 0.1], [0.09, h - 0.1], [0.09, h - 0.075]], 32);
  const cs = new THREE.Shape();
  cs.absarc(0, 0, 0.205, -0.5, 0.5, false);
  cs.absarc(0, 0, 0.15, 0.5, -0.5, true);
  const cal = new THREE.ExtrudeGeometry(cs, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 });
  cal.rotateY(Math.PI / 2).rotateX(Math.PI / 2 + 0.4).translate(h - 0.125, 0, 0);
  return { disc, caliper: cal };
}
