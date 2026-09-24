// Procedural vehicle models (no CC0 armour / attack-helicopter meshes exist): a modern main battle tank
// (Leopard 2 / Abrams class proportions: 7.4 m hull, 3.6 m wide, wedge-armoured turret, 120 mm smoothbore with
// thermal sleeve and bore evacuator, hollow tracks with road wheels / sprocket / idler, side skirts, commander's
// cupola with roof MG, smoke dischargers, bustle rack) and a tandem-seat attack helicopter (Apache class: lofted
// fuselage, stepped cockpit glazing, turboshaft nacelles, stub wings with rocket pods, chin cannon turret,
// 4-blade main rotor with motion-blur disc, tail rotor, tail wheel). Painted with canvas camouflage (team 1
// woodland green, team 2 desert tan), panel lines and weathering.
// Local frame: nose toward -Z, +Y up, origin on the ground under the hull / fuselage centre.
import * as THREE from 'three';
import { loft, ring } from '../royale/TransportPlane.js';

const cache = {};

function camoTexture(team) {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  const pal = team === 1 ? ['#4b5234', '#3a3f28', '#5c5a3c', '#26281d'] : ['#a8956b', '#8f7a52', '#b9a67c', '#6f5e40'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, S, S);
  // disruptive blotches (wrapping so the texture tiles)
  for (let i = 0; i < 46; i++) {
    g.fillStyle = pal[1 + (i % 3)];
    const x = Math.random() * S, y = Math.random() * S, r = 20 + Math.random() * 55;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      g.beginPath();
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, rr = r * (0.55 + Math.random() * 0.6); g.lineTo(x + ox + Math.cos(a) * rr * 1.5, y + oy + Math.sin(a) * rr); }
      g.closePath(); g.fill();
    }
  }
  // dust / grime + panel lines + scratches
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '30,28,20' : '190,180,150'},${Math.random() * 0.08})`; g.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 6, 2 + Math.random() * 6); }
  g.strokeStyle = 'rgba(15,15,10,0.35)'; g.lineWidth = 1;
  for (let i = 0; i < 6; i++) { const y = (i + 0.5) * (S / 6); g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  for (let i = 0; i < 5; i++) { const x = (i + 0.3) * (S / 5); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, S); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

function trackTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2a27'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 4; i++) { g.fillStyle = '#4a4740'; g.fillRect(i * 16, 0, 9, 64); g.fillStyle = '#171614'; g.fillRect(i * 16 + 10, 0, 2, 64); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function blurTexture() {
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), gr = g.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(30,30,30,0.0)'); gr.addColorStop(0.1, 'rgba(30,30,30,0.28)'); gr.addColorStop(0.85, 'rgba(30,30,30,0.2)'); gr.addColorStop(0.97, 'rgba(60,60,60,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function materials(team) {
  const key = `m${team}`;
  if (cache[key]) return cache[key];
  const camo = camoTexture(team);
  const paint = new THREE.MeshStandardMaterial({ map: camo, roughness: 0.82, metalness: 0.25 });
  // extruded geometry has UVs in metres: one camo tile every 3.5 m
  const paintX = paint.clone(); paintX.map = camo.clone(); paintX.map.repeat.set(1 / 3.5, 1 / 3.5); paintX.map.needsUpdate = true;
  const m = cache[key] = {
    paint, paintX,
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2b27, roughness: 0.75, metalness: 0.45 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x55574f, roughness: 0.5, metalness: 0.75 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1b1b19, roughness: 0.95, metalness: 0 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1e2a30, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 }),
    exhaust: new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.9, metalness: 0.3 }),
    burnt: new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 1, metalness: 0.1 }),
    lightRed: new THREE.MeshBasicMaterial({ color: 0xff2a1a }),
    lightGreen: new THREE.MeshBasicMaterial({ color: 0x2aff4a }),
  };
  const tt = trackTexture(); tt.repeat.set(3, 1);
  m.track = new THREE.MeshStandardMaterial({ map: tt, roughness: 0.9, metalness: 0.5 });
  return m;
}

const mesh = (geo, mat, x = 0, y = 0, z = 0, parent = null) => {
  const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true;
  if (parent) parent.add(o);
  return o;
};

// side profile [z, y] (z forward = negative) extruded across the width, centred on x = 0
function sideExtrude(pts, width, bevel = 0.04) {
  const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

// top outline [x, z] extruded upwards by h
function topExtrude(pts, h, bevel = 0.05) {
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

function stadium(path, z0, z1, y0, y1) {
  const r = (y1 - y0) / 2, cy = y0 + r;
  path.moveTo(-(z0 + r), y0);
  path.lineTo(-(z1 - r), y0);
  path.absarc(-(z1 - r), cy, r, -Math.PI / 2, Math.PI / 2, false);
  path.lineTo(-(z0 + r), y1);
  path.absarc(-(z0 + r), cy, r, Math.PI / 2, Math.PI * 1.5, false);
  return path;
}

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
  return root;
}

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
  return root;
}

// destroyed: charred hull (the materials are swapped back when the vehicle respawns)
export function setWrecked(root, wrecked) {
  const burnt = cache.m1?.burnt || cache.m2?.burnt;
  root.traverse((o) => {
    if (!o.isMesh || o.material.transparent) return;
    if (wrecked) { if (!o.userData.mat) o.userData.mat = o.material; o.material = burnt; }
    else if (o.userData.mat) o.material = o.userData.mat;
  });
  const u = root.userData;
  if (u.disc) u.disc.visible = false;
}
