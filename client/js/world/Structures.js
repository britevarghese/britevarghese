// Harbour structures from shared/map.js structureParts (gantry cranes, crane rails, moored ships): the same boxes the
// server collides with — painted steel, containers in their corrugated finish — plus the diagonal stays and hoist
// ropes, and the ship's shaped hull (red antifouling below the waterline, dark topsides, deck on top).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ACTIVE_MAP, SEA_LEVEL } from '/shared/map.js';
import { buildBoxGeometry } from '../render/Materials.js';

const PAINT = { crane: [0.74, 0.2, 0.1], crane_dark: [0.2, 0.2, 0.21], crane_white: [0.86, 0.86, 0.83], rail: [0.36, 0.33, 0.31], hull: [0.13, 0.17, 0.23], hatch: [0.32, 0.35, 0.34], superstructure: [0.88, 0.88, 0.85], glazing: [0.1, 0.13, 0.16], funnel: [0.55, 0.13, 0.1], funnel_top: [0.1, 0.1, 0.11], rope: [0.12, 0.12, 0.12] };
// the container tints of Props.js (same colour scheme on the quay and on the ship)
const TINTS = [[0.62, 0.22, 0.16], [0.2, 0.33, 0.45], [0.28, 0.36, 0.25], [0.55, 0.5, 0.42], [0.6, 0.42, 0.2]];

export function buildStructures(mats) {
  const group = new THREE.Group(); group.name = 'structures';
  const list = ACTIVE_MAP.STRUCTURES || [];
  if (!list.length) return group;
  const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.7 });
  const boxes = [], cont = [];
  for (const st of list) for (const p of st.parts) if (p.mat) (p.mat === 'container' ? cont : boxes).push(p);
  // painted steel: one draw for every crane, rail and the ship's superstructure
  const paint = (pt, part) => PAINT[part.mat] || PAINT.crane;
  for (const [, g] of buildBoxGeometry(boxes, { tile: 3, faceMat: () => 'steel', color: paint })) {
    const m = new THREE.Mesh(g, steel); m.castShadow = m.receiveShadow = true; m.name = 'structure_steel'; group.add(m);
  }
  const tint = (pt, part) => { const t = TINTS[Math.floor(Math.abs(part.min[0] * 7 + part.min[1] * 5 + part.min[2] * 3)) % TINTS.length]; return [t[0] * 1.6, t[1] * 1.6, t[2] * 1.6]; };
  for (const [m, g] of buildBoxGeometry(cont, { tile: 2.2, color: tint })) {
    const mesh = new THREE.Mesh(g, mats.building(m)); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'structure_containers'; group.add(mesh);
  }
  // stays, ropes, masts: thin prisms between two points
  const rods = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (const st of list) for (const [a, b, r, mat] of st.lines) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), L = d.length();
    const g = new THREE.CylinderGeometry(r, r, L, 6, 1, true);
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(up, d.normalize()), new THREE.Vector3(1, 1, 1)));
    const c = PAINT[mat] || PAINT.crane_dark, n = g.attributes.position.count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => c), 3));
    rods.push(g.index ? g.toNonIndexed() : g);
  }
  if (rods.length) { const m = new THREE.Mesh(mergeGeometries(rods), steel); m.castShadow = true; m.name = 'structure_rods'; group.add(m); }
  // ship hulls: plan outline (square stern, parallel body, bow tapering to a rounded stem) extruded in paint bands
  for (const st of list) {
    const h = st.hull; if (!h) continue;
    const zc = (h.zlo + h.zhi) / 2, hb = (h.zhi - h.zlo) / 2;
    const shape = new THREE.Shape();
    shape.moveTo(h.x1, -h.zlo); shape.lineTo(h.x1, -h.zhi); shape.lineTo(h.x0 + h.bow, -h.zhi);
    shape.bezierCurveTo(h.x0 + h.bow * 0.45, -h.zhi, h.x0, -(zc + hb * 0.35), h.x0, -zc);
    shape.bezierCurveTo(h.x0, -(zc - hb * 0.35), h.x0 + h.bow * 0.45, -h.zlo, h.x0 + h.bow, -h.zlo);
    shape.closePath();
    const band = (y0, y1, side, cap) => {
      const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 10 });
      g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
      const m = new THREE.Mesh(g, [cap, side]); m.castShadow = m.receiveShadow = true; m.name = 'ship_hull'; group.add(m);
    };
    const coat = (c, r = 0.55) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.15, envMapIntensity: 0.7 });
    const wl = SEA_LEVEL + 0.35;
    band(h.keel, wl, coat(0x6e2219, 0.7), coat(0x6e2219, 0.7));
    band(wl, wl + 0.3, coat(0xd9d6cc), coat(0xd9d6cc));               // boot-top line
    band(wl + 0.3, h.deck, coat(0x1f2a38), coat(0x5d625f, 0.85));       // topsides, deck
  }
  return group;
}
