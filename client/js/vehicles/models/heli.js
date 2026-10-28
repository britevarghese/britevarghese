import * as THREE from 'three';
import { materials, mesh, sideExtrude, topExtrude, stadium, tube, blurTexture, finishVehicle, cache } from './kit.js';
import { loft, ring } from '../../royale/TransportPlane.js';

// ---------------------------------------------------------------- attack helicopter
export function buildHeli(team) {
  const M = materials(team);
  const root = new THREE.Group(); root.name = 'heli';
  const body = new THREE.Group(); root.add(body); // pitch / roll / attitude
  // fuselage loft: nose sensor turret -> gunner -> raised pilot -> engine bay -> tail boom
  const S = [
    ring(0, 1.02, -5.35, 0.22, 0.24, 0.22, 20),
    ring(0, 1.05, -4.85, 0.46, 0.46, 0.44, 20),
    ring(0, 1.25, -3.8, 0.58, 0.66, 0.62, 20),
    ring(0, 1.42, -2.3, 0.64, 0.8, 0.74, 20),
    ring(0, 1.55, -0.8, 0.88, 0.95, 0.8, 20),
    ring(0, 1.6, 0.8, 0.84, 0.9, 0.74, 20),
    ring(0, 1.78, 2.1, 0.44, 0.46, 0.38, 20),
    ring(0, 1.95, 4.4, 0.26, 0.3, 0.24, 20),
    ring(0, 2.02, 5.7, 0.17, 0.22, 0.16, 20),
  ];
  mesh(loft(S, { uScale: 2 }), M.paint, 0, 0, 0, body);
  // stepped tandem canopy: gunner in front, pilot behind and higher
  const canopy = (z, y, l, w, h) => { const c = mesh(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, 0, y, z, body); c.scale.set(w, h, l); return c; };
  canopy(-3.75, 1.78, 0.95, 0.5, 0.5);
  canopy(-2.35, 2.08, 1.0, 0.56, 0.52);
  mesh(new THREE.BoxGeometry(0.04, 0.5, 2.3), M.dark, 0, 2.05, -3.0, body);                         // canopy frame spine
  // nose sensor turret (TADS-like) + chin cannon turret (aims with the gunner)
  mesh(new THREE.SphereGeometry(0.34, 14, 10), M.dark, 0, 0.98, -5.25, body);
  mesh(new THREE.BoxGeometry(0.36, 0.2, 0.04), M.glass, 0, 1.0, -5.58, body);
  const chin = new THREE.Group(); chin.name = 'chin'; chin.position.set(0, 0.55, -3.6); body.add(chin);
  mesh(new THREE.SphereGeometry(0.24, 12, 8), M.dark, 0, 0, 0, chin);
  const cannon = new THREE.Group(); chin.add(cannon);
  mesh(new THREE.CylinderGeometry(0.045, 0.06, 1.7, 8).rotateX(Math.PI / 2), M.dark, 0, -0.05, -0.85, cannon);
  mesh(new THREE.BoxGeometry(0.18, 0.18, 0.5), M.dark, 0, -0.03, -0.2, cannon);
  const cannonMuzzle = new THREE.Object3D(); cannonMuzzle.position.set(0, -0.05, -1.75); cannon.add(cannonMuzzle);
  // engine nacelles with exhaust suppressors, intake fronts
  for (const side of [-1, 1]) {
    const n = mesh(new THREE.CylinderGeometry(0.36, 0.38, 2.0, 16).rotateX(Math.PI / 2), M.paint, side * 0.95, 2.0, -0.1, body);
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14).rotateX(Math.PI / 2), M.dark, 0, 0, -1.01, n);
    const ex = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.7), M.exhaust, side * 1.05, 2.02, 1.2, body); ex.rotation.y = side * 0.35;
  }
  // stub wings + pylons + 19-tube rocket pods (inner) and missile rails (outer)
  const wingG = new THREE.BoxGeometry(1.7, 0.1, 1.0);
  for (const side of [-1, 1]) {
    const w = mesh(wingG, M.paint, side * 1.55, 1.35, -0.6, body); w.rotation.z = side * -0.06;
    mesh(new THREE.BoxGeometry(0.1, 0.35, 0.5), M.dark, side * 1.25, 1.14, -0.6, body);
    mesh(new THREE.BoxGeometry(0.1, 0.35, 0.5), M.dark, side * 2.05, 1.12, -0.6, body);
    const pod = mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.65, 14).rotateX(Math.PI / 2), M.paint, side * 1.25, 0.85, -0.65, body);
    mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14).rotateX(Math.PI / 2), M.dark, 0, 0, -0.83, pod);
    for (let i = 0; i < 4; i++) mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8).rotateX(Math.PI / 2), M.dark, side * 2.05 + (i % 2 ? 0.1 : -0.1), 0.86 + (i > 1 ? -0.17 : 0), -0.55, body);
    // navigation light on each wing tip
    mesh(new THREE.SphereGeometry(0.05, 6, 4), side < 0 ? M.lightRed : M.lightGreen, side * 2.4, 1.36, -0.6, body).castShadow = false;
  }
  // landing gear: main wheels on trailing arms + tail wheel
  for (const side of [-1, 1]) {
    const arm = mesh(new THREE.BoxGeometry(0.1, 0.9, 0.12), M.dark, side * 1.0, 0.65, -2.0, body); arm.rotation.z = side * 0.35;
    mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 14).rotateZ(Math.PI / 2), M.rubber, side * 1.2, 0.3, -2.0, body);
  }
  mesh(new THREE.BoxGeometry(0.08, 0.6, 0.1), M.dark, 0, 1.3, 5.2, body);
  mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 12).rotateZ(Math.PI / 2), M.rubber, 0, 0.95, 5.2, body);
  // tail: vertical fin, horizontal stabiliser, tail rotor
  const fin = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1.1, 0), new THREE.Vector2(0.7, 1.7), new THREE.Vector2(0.2, 1.7)].map((p) => new THREE.Vector2(p.x, p.y)));
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.1, bevelEnabled: false }); finG.translate(0, 0, -0.05); finG.rotateY(-Math.PI / 2);
  mesh(finG, M.paint, 0, 1.95, 5.05, body);
  mesh(new THREE.BoxGeometry(1.9, 0.06, 0.6), M.paint, 0, 2.0, 5.3, body);
  const tailRotor = new THREE.Group(); tailRotor.name = 'tailRotor'; tailRotor.position.set(0.18, 3.15, 5.65); body.add(tailRotor);
  for (let i = 0; i < 4; i++) { const b = mesh(new THREE.BoxGeometry(0.03, 1.4, 0.16), M.dark, 0, 0, 0, tailRotor); b.rotation.x = (i * Math.PI) / 2; b.geometry.translate(0, 0.7, 0); }
  // main rotor: mast, hub, 4 blades; motion-blur disc when spinning
  mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 10), M.dark, 0, 2.7, -0.4, body);
  const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 3.2, -0.4); body.add(rotor);
  mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.22, 12), M.dark, 0, 0, 0, rotor);
  const bladeG = new THREE.BoxGeometry(7.1, 0.05, 0.5); bladeG.translate(3.75, 0, 0);
  const blades = [];
  for (let i = 0; i < 4; i++) { const b = mesh(bladeG, M.dark, 0, 0, 0, rotor); b.rotation.y = (i * Math.PI) / 2; blades.push(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7.3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: cache.blur || (cache.blur = blurTexture()), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(0, 3.22, -0.4); disc.visible = false; body.add(disc);
  // anti-collision beacon
  mesh(new THREE.SphereGeometry(0.07, 6, 4), M.lightRed, 0, 2.45, 1.4, body).castShadow = false;
  // team chevrons on the tail boom
  const chevron = new THREE.MeshBasicMaterial({ color: team === 1 ? 0x2e6fd8 : 0xd84a3a });
  for (const side of [-1, 1]) { const c = mesh(new THREE.PlaneGeometry(0.5, 0.22), chevron, side * 0.3, 1.9, 3.3, body); c.rotation.y = side * Math.PI / 2; c.castShadow = false; }
  root.userData = { type: 'heli', body, rotor, blades, disc, tailRotor, chin, cannon, cannonMuzzle, rocketPods: [new THREE.Vector3(-1.25, 0.85, -1.5), new THREE.Vector3(1.25, 0.85, -1.5)] };
  return finishVehicle(root);
}
