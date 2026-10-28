import * as THREE from 'three';
import { materials, mesh, sideExtrude, topExtrude, stadium, tube, blurTexture, finishVehicle, cache } from './kit.js';

// ---------------------------------------------------------------- trail motorcycle
export function buildBike(team) {
  const M = materials(team);
  const root = new THREE.Group(); root.name = 'bike';
  const body = new THREE.Group(); root.add(body);
  const frameMat = new THREE.MeshStandardMaterial({ color: team === 1 ? 0x3d5a3a : 0x8a6a3a, roughness: 0.45, metalness: 0.4 });
  const tube = (a, b, r, mat = M.steel) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), L = va.distanceTo(vb);
    const m = mesh(new THREE.CylinderGeometry(r, r, L, 8), mat, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, body);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    return m;
  };
  // wheels: knobbly tyres + spoked-look rims (front one steers)
  const tyreG = new THREE.TorusGeometry(0.31, 0.09, 8, 20).rotateY(Math.PI / 2), rimG = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16).rotateZ(Math.PI / 2);
  const mkWheel = (parent) => { const w = new THREE.Group(); parent.add(w); mesh(tyreG, M.rubber, 0, 0, 0, w); mesh(rimG, M.steel, 0, 0, 0, w); return w; };
  const rear = new THREE.Group(); rear.position.set(0, 0.4, 0.72); body.add(rear); const rw = mkWheel(rear);
  const fork = new THREE.Group(); fork.position.set(0, 0.4, -0.74); body.add(fork); const fw = mkWheel(fork);
  // front forks + handlebars (steer with the fork), headlight number plate
  const steer = new THREE.Group(); steer.position.set(0, 1.12, -0.5); body.add(steer);
  for (const x of [-0.1, 0.1]) { const f = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), M.steel, x, -0.38, -0.12, steer); f.rotation.x = 0.35; }
  mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.75, 6).rotateZ(Math.PI / 2), M.dark, 0, 0.08, 0.05, steer);
  mesh(new THREE.BoxGeometry(0.22, 0.26, 0.05), frameMat, 0, -0.1, -0.22, steer);
  // frame, engine block, exhaust, tank, seat, fenders, swingarm
  tube([0, 1.08, -0.52], [0, 0.55, 0.05], 0.035);
  tube([0, 1.0, -0.45], [0, 0.95, 0.35], 0.035);
  tube([0, 0.55, 0.05], [0, 0.45, 0.7], 0.03);
  tube([0.12, 0.42, 0.05], [0.12, 0.4, 0.72], 0.025, M.dark);
  tube([-0.12, 0.42, 0.05], [-0.12, 0.4, 0.72], 0.025, M.dark);
  mesh(new THREE.BoxGeometry(0.26, 0.3, 0.38), M.dark, 0, 0.55, -0.1, body);
  tube([0.16, 0.55, -0.25], [0.18, 0.75, 0.6], 0.035, M.exhaust);
  const tankM = mesh(new THREE.SphereGeometry(0.2, 12, 8), frameMat, 0, 1.0, -0.25, body); tankM.scale.set(1, 0.75, 1.5);
  mesh(new THREE.BoxGeometry(0.24, 0.08, 0.75), M.rubber, 0, 1.0, 0.3, body);
  const ff = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.5), frameMat, 0, 0.82, -0.8, body); ff.rotation.x = 0.25;
  const rf = mesh(new THREE.BoxGeometry(0.2, 0.03, 0.55), frameMat, 0, 0.95, 0.8, body); rf.rotation.x = -0.25;
  root.userData = { type: 'bike', body, wheels: [rw, fw], front: [fork, steer], wheelR: 0.4 };
  return finishVehicle(root);
}
