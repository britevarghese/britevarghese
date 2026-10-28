import * as THREE from 'three';
import { materials, mesh, sideExtrude, topExtrude, stadium, tube, blurTexture, finishVehicle, cache } from './kit.js';

// ---------------------------------------------------------------- light utility vehicle (Humvee class)
export function buildJeep(team) {
  const M = materials(team);
  const root = new THREE.Group(); root.name = 'jeep';
  const body = new THREE.Group(); root.add(body);
  // chassis tub + bonnet sloping to the grille, flat cab roof, rear cargo bed
  mesh(sideExtrude([[2.45, 0.62], [2.45, 1.28], [1.0, 1.32], [1.0, 1.92], [-0.55, 1.92], [-0.9, 1.35], [-2.35, 1.22], [-2.45, 0.95], [-2.3, 0.62]], 2.1, 0.05), M.paintX, 0, 0, 0, body);
  // wheel arches / fenders wider than the body
  for (const z of [-1.62, 1.62]) mesh(new THREE.BoxGeometry(2.3, 0.12, 1.2), M.paint, 0, 1.18, z, body);
  // windscreen (split), side windows, door lines
  for (const x of [-0.5, 0.5]) { const w = mesh(new THREE.BoxGeometry(0.85, 0.5, 0.04), M.glass, x, 1.62, -0.72, body); w.rotation.x = -0.35; }
  for (const side of [-1, 1]) {
    mesh(new THREE.BoxGeometry(0.03, 0.34, 1.2), M.glass, side * 1.06, 1.62, 0.2, body);
    mesh(new THREE.BoxGeometry(0.02, 0.9, 0.02), M.dark, side * 1.06, 1.12, 0.3, body);
    mesh(new THREE.BoxGeometry(0.1, 0.1, 0.25), M.dark, side * 1.12, 1.55, -0.62, body); // mirrors
  }
  // grille, headlights, bumper, tow hooks
  mesh(new THREE.BoxGeometry(1.4, 0.38, 0.05), M.dark, 0, 1.0, -2.46, body);
  for (const x of [-0.8, 0.8]) mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.05, 10).rotateX(Math.PI / 2), M.glass, x, 1.1, -2.47, body);
  mesh(new THREE.BoxGeometry(2.2, 0.16, 0.18), M.steel, 0, 0.66, -2.5, body);
  // cargo bed contents + spare wheel
  mesh(new THREE.BoxGeometry(1.6, 0.35, 0.8), M.paint, 0, 1.45, 1.8, body);
  // wheels (steerable front pair)
  const wheels = [], front = [];
  const tyreG = new THREE.CylinderGeometry(0.46, 0.46, 0.36, 18).rotateZ(Math.PI / 2), hubG = new THREE.CylinderGeometry(0.22, 0.22, 0.38, 10).rotateZ(Math.PI / 2);
  for (const [x, z] of [[-0.98, -1.62], [0.98, -1.62], [-0.98, 1.62], [0.98, 1.62]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.46, z); body.add(pivot);
    const w = new THREE.Group(); pivot.add(w);
    mesh(tyreG, M.rubber, 0, 0, 0, w); mesh(hubG, M.steel, 0, 0, 0, w);
    wheels.push(w); if (z < 0) front.push(pivot);
  }
  // roof ring mount + .50 cal with gun shield (traverses with the gunner)
  mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16), M.dark, 0, 1.97, 0.55, body);
  const mg = new THREE.Group(); mg.name = 'mg'; mg.position.set(0, 2.25, 0.55); body.add(mg);
  mesh(new THREE.BoxGeometry(1.0, 0.5, 0.05), M.paint, 0, 0.05, -0.45, mg);
  mesh(new THREE.BoxGeometry(0.14, 0.18, 0.9), M.dark, 0, 0.05, -0.3, mg);
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8).rotateX(Math.PI / 2), M.dark, 0, 0.08, -1.2, mg);
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(0, 0.08, -1.78); mg.add(mgMuzzle);
  // antenna + team chevrons on the doors
  const ant = mesh(new THREE.CylinderGeometry(0.01, 0.015, 2.2, 5), M.dark, -0.9, 2.9, 1.9, body); ant.rotation.x = 0.15;
  const chevron = new THREE.MeshBasicMaterial({ color: team === 1 ? 0x2e6fd8 : 0xd84a3a });
  for (const side of [-1, 1]) { const c = mesh(new THREE.PlaneGeometry(0.35, 0.2), chevron, side * 1.08, 1.05, -0.3, body); c.rotation.y = side * Math.PI / 2; c.castShadow = false; }
  root.userData = { type: 'jeep', body, wheels, front, wheelR: 0.46, mg, mgMuzzle };
  return finishVehicle(root);
}
