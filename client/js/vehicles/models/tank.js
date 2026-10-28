import * as THREE from 'three';
import { materials, mesh, sideExtrude, topExtrude, stadium, tube, blurTexture, finishVehicle, cache } from './kit.js';

// ---------------------------------------------------------------- tank
export function buildTank(team) {
  const M = materials(team);
  const root = new THREE.Group(); root.name = 'tank';
  const body = new THREE.Group(); root.add(body); // pitches / rolls with the terrain
  // lower hull between the tracks + glacis
  mesh(sideExtrude([[3.35, 0.42], [3.6, 0.8], [3.6, 1.45], [3.45, 1.55], [-2.25, 1.58], [-3.68, 1.02], [-3.55, 0.55], [-3.05, 0.38]], 2.5), M.paintX, 0, 0, 0, body);
  // upper hull / sponsons over the tracks (the deck is wider than the belly)
  mesh(sideExtrude([[3.5, 1.08], [3.6, 1.45], [3.45, 1.56], [-2.2, 1.58], [-3.55, 1.12]], 3.62, 0.03), M.paintX, 0, 0, 0, body);
  // engine deck grilles + exhaust louvres at the rear
  for (const x of [-0.8, 0.8]) mesh(new THREE.BoxGeometry(1.1, 0.04, 1.6), M.dark, x, 1.6, 2.5, body);
  mesh(new THREE.BoxGeometry(2.6, 0.35, 0.08), M.exhaust, 0, 1.2, 3.62, body);
  // driver's hatch + periscopes on the glacis
  mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 14), M.dark, -0.55, 1.6, -2.35, body);
  for (const x of [-0.8, -0.55, -0.3]) mesh(new THREE.BoxGeometry(0.16, 0.08, 0.1), M.glass, x, 1.63, -2.62, body);
  // headlights, tow hooks, spare track links on the glacis
  for (const x of [-1.5, 1.5]) { mesh(new THREE.BoxGeometry(0.2, 0.14, 0.12), M.dark, x, 1.5, -3.5, body); mesh(new THREE.BoxGeometry(0.14, 0.1, 0.03), M.glass, x, 1.5, -3.57, body); }
  for (const x of [-1.1, 1.1]) mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), M.steel, x, 0.62, -3.62, body);
  // tracks (hollow belt so the road wheels show), wheels, sprockets, idlers, skirts
  for (const side of [-1, 1]) {
    const outer = stadium(new THREE.Shape(), -3.6, 3.55, 0.0, 1.02);
    outer.holes.push(stadium(new THREE.Path(), -3.48, 3.43, 0.1, 0.92));
    const tg = new THREE.ExtrudeGeometry(outer, { depth: 0.62, bevelEnabled: false, curveSegments: 10 });
    tg.translate(0, 0, -0.31); tg.rotateY(Math.PI / 2);
    // UVs in metres: stretch the link texture along the belt
    mesh(tg, M.track, side * 1.5, 0, 0, body);
    const wheelG = new THREE.CylinderGeometry(0.36, 0.36, 0.5, 18).rotateZ(Math.PI / 2);
    const hubG = new THREE.CylinderGeometry(0.14, 0.14, 0.54, 10).rotateZ(Math.PI / 2);
    for (let i = 0; i < 7; i++) { const z = -2.65 + i * 0.88; mesh(wheelG, M.rubber, side * 1.5, 0.4, z, body); mesh(hubG, M.steel, side * 1.5, 0.4, z, body); }
    const sp = mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 12).rotateZ(Math.PI / 2), M.steel, side * 1.5, 0.56, 3.1, body); sp.name = 'sprocket';
    mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 16).rotateZ(Math.PI / 2), M.steel, side * 1.5, 0.56, -3.15, body);
    for (const z of [-1.6, 0.2, 2.0]) mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 8).rotateZ(Math.PI / 2), M.steel, side * 1.5, 0.84, z, body);
    // armoured side skirts covering the upper run
    mesh(sideExtrude([[3.2, 0.62], [3.4, 1.08], [-3.3, 1.08], [-3.55, 0.7], [-2.9, 0.58]], 0.07, 0.01), M.paintX, side * 1.84, 0, 0, body);
    // stowage boxes on the fenders
    mesh(new THREE.BoxGeometry(0.5, 0.3, 1.2), M.paint, side * 1.45, 1.73, 1.7, body);
  }
  // turret (traverses) + gun (elevates)
  const turret = new THREE.Group(); turret.name = 'turret'; turret.position.set(0, 1.58, 0); body.add(turret);
  mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.12, 24), M.dark, 0, 0.02, 0, turret);
  mesh(topExtrude([[-0.42, -2.12], [0.42, -2.12], [1.62, -1.05], [1.78, 1.1], [1.55, 1.95], [-1.55, 1.95], [-1.78, 1.1], [-1.62, -1.05]], 0.74), M.paintX, 0, 0.06, 0, turret);
  // turret bustle rack + smoke dischargers + sights + cupola + roof MG + antennas
  const rack = new THREE.Group(); rack.position.set(0, 0.35, 2.2); turret.add(rack);
  mesh(new THREE.BoxGeometry(2.8, 0.05, 0.6), M.dark, 0, -0.2, 0, rack);
  for (const x of [-1.4, 1.4]) mesh(new THREE.BoxGeometry(0.04, 0.4, 0.6), M.dark, x, 0, 0, rack);
  mesh(new THREE.BoxGeometry(2.6, 0.32, 0.5), M.paint, 0, -0.02, 0, rack).scale.set(1, 1, 0.9);
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const t = mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), M.dark, side * (1.55 - i * 0.05), 0.62, -0.7 + i * 0.16, turret);
    t.rotation.set(-0.5, 0, side * 0.9);
  }
  mesh(new THREE.BoxGeometry(0.45, 0.35, 0.55), M.paint, -0.9, 0.95, -1.0, turret);                 // gunner's primary sight
  mesh(new THREE.BoxGeometry(0.34, 0.2, 0.04), M.glass, -0.9, 0.98, -1.28, turret);
  const cupola = mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.3, 16), M.paint, 0.75, 0.93, 0.35, turret);
  mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), M.dark, 0, 0.18, 0, cupola);
  const peri = mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12), M.paint, 0.9, 1.0, -0.5, turret); // commander's periscope
  mesh(new THREE.BoxGeometry(0.18, 0.12, 0.05), M.glass, 0, 0.12, -0.15, peri);
  const mg = new THREE.Group(); mg.name = 'mg'; mg.position.set(0.75, 1.3, 0.3); turret.add(mg);
  mesh(new THREE.BoxGeometry(0.1, 0.14, 0.7), M.dark, 0, 0, -0.15, mg);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8).rotateX(Math.PI / 2), M.dark, 0, 0.02, -0.85, mg);
  mesh(new THREE.BoxGeometry(0.04, 0.3, 0.04), M.dark, 0, -0.18, 0.1, mg);
  mesh(new THREE.BoxGeometry(0.5, 0.35, 0.03), M.paint, 0, 0.05, -0.35, mg);                       // gun shield
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(0, 0.02, -1.25); mg.add(mgMuzzle);
  for (const x of [-1.2, 1.3]) { const a = mesh(new THREE.CylinderGeometry(0.012, 0.02, 2.6, 5), M.dark, x, 2.0, 1.7, turret); a.rotation.x = 0.12; }
  // 120 mm gun: mantlet, barrel with thermal sleeve, bore evacuator, muzzle reference sensor
  const gun = new THREE.Group(); gun.name = 'gun'; gun.position.set(0, 0.4, -1.9); turret.add(gun);
  mesh(new THREE.BoxGeometry(0.85, 0.62, 0.55), M.paint, 0, 0, -0.1, gun);
  const barrel = (r0, r1, z0, z1, mat) => mesh(new THREE.CylinderGeometry(r1, r0, z1 - z0, 16).rotateX(-Math.PI / 2), mat, 0, 0, -(z0 + z1) / 2, gun);
  barrel(0.13, 0.12, 0.3, 2.6, M.paint);
  barrel(0.12, 0.11, 2.6, 5.2, M.paint);
  barrel(0.17, 0.17, 2.9, 3.5, M.paint);
  barrel(0.125, 0.125, 5.0, 5.25, M.dark);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -5.3); gun.add(muzzle);
  // team identification: small chevrons on the turret sides
  const chevron = new THREE.MeshBasicMaterial({ color: team === 1 ? 0x2e6fd8 : 0xd84a3a });
  for (const side of [-1, 1]) { const c = mesh(new THREE.PlaneGeometry(0.4, 0.25), chevron, side * 1.72, 0.42, 0.3, turret); c.rotation.y = side * Math.PI / 2 + side * 0.1; c.castShadow = false; }
  root.userData = { type: 'tank', body, turret, gun, muzzle, mgMuzzle, mg };
  return finishVehicle(root);
}
