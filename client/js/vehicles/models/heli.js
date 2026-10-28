import * as THREE from 'three';
import { materials, mesh, blurTexture, finishVehicle, cache, noiseField, sampleField, projectUV, facetLoft, merged } from './kit.js';
import { loft, ring } from '../../royale/TransportPlane.js';

// ---------------------------------------------------------------- attack helicopter (AH-64D Apache class)
// Slab-sided fuselage with avionics "cheek" bays, stepped tandem canopy of flat glazed panels in frames (gunner in
// front / lower, pilot behind / higher), TADS / PNVS nose sensor turret, wire strike cutters, T700-style engine
// nacelles with intakes and "black hole" exhaust suppressors, mast-mounted radar, IR jammer, antennas; stub wings
// with an inner 19-tube rocket pod and an outer 4-rail Hellfire launcher per side; M230 chain gun in the chin
// turret; trailing-arm main gear with strut fairings and a long tail-wheel leg. Rotor: articulated hub with pitch
// horns / links and swashplate, 4 twisted / tapered blades with swept tips and erosion strips (0.53 m chord),
// "scissor" 4-blade tail rotor. Matte olive drab (team 1) / desert tan (team 2) with panel lines, rivets, grime.

const TILE = 2.5;               // metres per skin texture tile
const local = {};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// matte paint: slight mottling / touch-up panels, panel lines with rivet rows, access hatches, grime and streaks
function skinTexture(team) {
  // per-pixel paint at 512 (upscaled smoothly), crisp panel lines / rivets drawn at 1024
  const S = 1024, P = 512, N = 256, c = document.createElement('canvas'), base = document.createElement('canvas');
  c.width = c.height = S; base.width = base.height = P;
  const bg = base.getContext('2d'), img = bg.createImageData(P, P), d = img.data;
  const mot = noiseField(N, 3, 4, 3 + team), grime = noiseField(N, 4, 4, 13), dust = noiseField(N, 3, 4, 23), fine = noiseField(N, 64, 2, 31);
  const B = hex(team === 1 ? 0x444c37 : 0x8f7b58), DU = hex(team === 1 ? 0x6e6a58 : 0xa89878);
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const u = x / P, v = y / P, i = (y * P + x) * 4;
    const m = 1 + (sampleField(mot, N, u, v) - 0.5) * 0.22;
    const gr = 1 - smooth(0.52, 0.8, sampleField(grime, N, u, v)) * 0.25;
    const du = smooth(0.55, 0.85, sampleField(dust, N, u, v)) * 0.16;
    const fn = 1 + (sampleField(fine, N, u, v) - 0.5) * 0.08 + (Math.random() - 0.5) * 0.04;
    for (let k = 0; k < 3; k++) d[i + k] = (B[k] * m + (DU[k] - B[k] * m) * du) * gr * fn;
    d[i + 3] = 255;
  }
  bg.putImageData(img, 0, 0);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(base, 0, 0, S, S);
  const wrap = (fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // touch-up paint panels (slightly different shade)
  for (let i = 0; i < 12; i++) {
    const x = Math.random() * S, y = Math.random() * S, w = 80 + Math.random() * 220, h = 60 + Math.random() * 160, l = Math.random() < 0.5;
    wrap(() => { g.fillStyle = l ? 'rgba(255,250,230,0.045)' : 'rgba(10,12,6,0.06)'; g.fillRect(x, y, w, h); });
  }
  // panel lines: longerons (horizontal, full width) + frames between them, rivet rows along both
  const rows = [0, 170, 330, 530, 700, 860];
  const line = (x0, y0, x1, y1) => wrap(() => {
    g.strokeStyle = 'rgba(12,14,8,0.5)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(255,255,240,0.07)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x0 + 1.5, y0 + 1.5); g.lineTo(x1 + 1.5, y1 + 1.5); g.stroke();
    const L = Math.hypot(x1 - x0, y1 - y0), nx = (y1 - y0) / L, ny = -(x1 - x0) / L;
    g.fillStyle = 'rgba(10,10,6,0.32)';
    for (let t = 6; t < L; t += 11) { const px = x0 + ((x1 - x0) * t) / L + nx * 5, py = y0 + ((y1 - y0) * t) / L + ny * 5; g.fillRect(px - 0.8, py - 0.8, 1.7, 1.7); }
  });
  for (const y of rows) line(0, y, S, y);
  for (let j = 0; j < rows.length; j++) {
    const y0 = rows[j], y1 = rows[j + 1] ?? S;
    for (let x = Math.random() * 120; x < S; x += 140 + Math.random() * 160) line(x, y0, x, y1);
  }
  // access hatches with fasteners
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * S, y = Math.random() * S, w = 34 + Math.random() * 80, h = 26 + Math.random() * 60;
    wrap(() => {
      g.strokeStyle = 'rgba(12,14,8,0.5)'; g.lineWidth = 1.4; g.strokeRect(x, y, w, h);
      g.fillStyle = 'rgba(12,12,8,0.45)';
      for (const [px, py] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4], [x + w / 2, y + 4], [x + w / 2, y + h - 4]]) { g.beginPath(); g.arc(px, py, 1.6, 0, Math.PI * 2); g.fill(); }
    });
  }
  // grime streaks running down from the seams + exhaust soot smudges + scuffs
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * S, y = rows[Math.floor(Math.random() * rows.length)] + 2, L = 25 + Math.random() * 110;
    wrap(() => { const gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, 'rgba(18,16,10,0.16)'); gr.addColorStop(1, 'rgba(18,16,10,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + Math.random() * 3, L); });
  }
  g.strokeStyle = 'rgba(180,175,150,0.12)'; g.lineWidth = 0.8;
  for (let i = 0; i < 70; i++) { const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.3, L = 5 + Math.random() * 25; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// main rotor blade: u around the airfoil (0 / 1 = leading edge), v root -> tip: erosion strip, tip cap, root cuff
function bladeTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3e4143'; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,20,20' : '120,120,115'},0.05)`; g.fillRect(Math.random() * 64, Math.random() * 256, 2 + Math.random() * 10, 8 + Math.random() * 40); }
  g.fillStyle = '#7b7d78'; g.fillRect(0, 0, 4, 256); g.fillRect(60, 0, 4, 256);           // leading-edge erosion strip
  g.fillStyle = '#2b2d2e'; g.fillRect(0, 0, 64, 10);                                        // swept tip cap (v = 1 -> top)
  g.fillStyle = '#56585a'; g.fillRect(0, 10, 64, 2);
  g.fillStyle = '#303233'; g.fillRect(0, 246, 64, 10);                                      // root
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(31, 0, 2, 256);                              // trailing edge
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// front / rear face of a 19-tube rocket pod
function podTexture(team) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = team === 1 ? '#3a4030' : '#857254'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.beginPath(); g.arc(64, 64, 61, 0, Math.PI * 2); g.stroke();
  const holes = [[0, 0]];
  for (let k = 0; k < 6; k++) holes.push([Math.cos((k * Math.PI) / 3) * 0.37, Math.sin((k * Math.PI) / 3) * 0.37]);
  for (let k = 0; k < 12; k++) { const r = k % 2 ? 0.64 : 0.74, a = (k * Math.PI) / 6; holes.push([Math.cos(a) * r, Math.sin(a) * r]); }
  for (const [x, y] of holes) {
    g.fillStyle = '#0d0e0c'; g.beginPath(); g.arc(64 + x * 58, 64 + y * 58, 10.5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a4c44'; g.beginPath(); g.arc(64 + x * 58, 64 + y * 58, 4.5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function heliMaterials(team) {
  if (local[team]) return local[team];
  const M = materials(team);
  return local[team] = {
    ...M,
    skin: new THREE.MeshStandardMaterial({ map: skinTexture(team), roughness: 0.82, metalness: 0.15 }),
    canopy: new THREE.MeshStandardMaterial({ color: 0x111715, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.0, transparent: true, opacity: 0.88 }),
    sensor: new THREE.MeshStandardMaterial({ color: 0x2a2416, roughness: 0.08, metalness: 0.85, envMapIntensity: 1.5 }),
    blade: new THREE.MeshStandardMaterial({ map: local.bladeTex || (local.bladeTex = bladeTexture()), roughness: 0.68, metalness: 0.2, envMapIntensity: 0.6 }),
    pod: new THREE.MeshStandardMaterial({ map: podTexture(team), roughness: 0.85, metalness: 0.1 }),
    band: new THREE.MeshStandardMaterial({ color: 0xb39324, roughness: 0.7, metalness: 0.1 }),
    mark: new THREE.MeshStandardMaterial({ color: team === 1 ? 0x2e6fd8 : 0xd84a3a, emissive: team === 1 ? 0x0b1c38 : 0x38120e, roughness: 0.8, metalness: 0 }),
  };
}

// ---------------------------------------------------------------- geometry helpers
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => geo.clone().applyMatrix4(_m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz))).translate(x, y, z);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, s = 10, open = false) => new THREE.CylinderGeometry(r1, r0, h, s, 1, open);
const group = (list, mat, parent) => mesh(merged(list), mat, 0, 0, 0, parent);
// a bar of square section `w` from a to b (frames, struts, rods)
function bar(a, b, w, round = false) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), L = va.distanceTo(vb);
  const g = round ? cyl(w, w, L, 6) : box(w, L, w);
  _q.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
  return g.applyMatrix4(_m.compose(va.add(vb).multiplyScalar(0.5), _q, new THREE.Vector3(1, 1, 1)));
}
const mirror = (pts) => pts.map(([x, y, z]) => [-x, y, z]);

// rotor blade along +X (leading edge toward -Z = direction of travel), twisted, coned, tapered swept tip
function bladeGeometry() {
  const af = [[0, 0], [0.03, 0.5], [0.13, 0.9], [0.32, 1], [0.62, 0.72], [1, 0.08], [0.62, -0.5], [0.32, -0.7], [0.13, -0.66], [0.03, -0.42]];
  const secs = [];
  for (const r of [0.55, 0.95, 2.4, 4.6, 6.6, 6.95, 7.16, 7.3]) {
    const tip = smooth(6.9, 7.3, r), chord = r < 0.95 ? 0.36 + ((r - 0.55) / 0.4) * 0.17 : 0.53 * (1 - 0.5 * tip);
    const zLE = -0.25 * 0.53 + tip * 0.24, th = (r < 0.95 ? 0.14 : 0.085 - 0.03 * tip) * chord * 0.5;
    const tw = 0.1 - (r / 7.3) * 0.16, cs = Math.cos(tw), sn = Math.sin(tw), cone = r * 0.052;
    secs.push(af.map(([cc, t]) => { const z = zLE + cc * chord, y = t * th; return [r, y * cs - z * sn + cone, y * sn + z * cs]; }));
  }
  return loft(secs, { uScale: 1 });
}

// ---------------------------------------------------------------- attack helicopter
export function buildHeli(team) {
  const M = heliMaterials(team);
  const root = new THREE.Group(); root.name = 'heli';
  const body = new THREE.Group(); root.add(body); // pitch / roll / attitude
  const podFaces = [], skin = [], dark = [], black = [], steel = [], rubber = [], sensor = [], red = [], green = [], band = [], mark = [];

  // ---- fuselage: slab-sided superellipse sections, nose -> cockpits -> transmission / engine bay -> tail boom
  const F = [
    [-5.42, 1.04, 0.2, 0.18, 0.2], [-5.18, 1.07, 0.37, 0.29, 0.31], [-4.75, 1.08, 0.47, 0.32, 0.36], [-4.2, 1.1, 0.52, 0.36, 0.38],
    [-3.4, 1.14, 0.55, 0.37, 0.4], [-2.6, 1.18, 0.57, 0.42, 0.42], [-1.8, 1.24, 0.6, 0.46, 0.45], [-1.2, 1.38, 0.62, 0.62, 0.55],
    [-0.4, 1.45, 0.62, 0.8, 0.6], [0.6, 1.48, 0.6, 0.72, 0.58], [1.4, 1.58, 0.46, 0.52, 0.44], [2.3, 1.74, 0.3, 0.3, 0.27],
    [4.6, 1.92, 0.21, 0.23, 0.19], [5.75, 2.0, 0.16, 0.18, 0.15], [6.02, 2.02, 0.1, 0.12, 0.1],
  ];
  mesh(loft(F.map(([z, cy, hw, t, b]) => ring(0, cy, z, hw, t, b, 24, 4))), M.skin, 0, 0, 0, body);
  // avionics "cheek" bays along the lower sides (flat panels), faired into the nose and the wing roots
  for (const s of [1, -1]) {
    const sec = (z, x0, x1, y0, y1) => [[x0, y0, z], [x1 - 0.05, y0, z], [x1, y0 + 0.08, z], [x1, y1 - 0.1, z], [x1 - 0.07, y1, z], [x0, y1, z]];
    const rings = [sec(-4.35, 0.4, 0.5, 0.86, 1.1), sec(-3.85, 0.4, 0.71, 0.8, 1.24), sec(-1.3, 0.42, 0.73, 0.8, 1.26), sec(-0.75, 0.45, 0.62, 0.92, 1.2)];
    skin.push(facetLoft(s > 0 ? rings : rings.map(mirror)));
  }
  // belly antennas + RWR sensors on the nose / tail, blade antennas on the boom
  skin.push(at(box(0.02, 0.2, 0.22), 0, 0.68, -1.5, 0.4), at(box(0.02, 0.22, 0.2), 0, 2.2, 3.4, -0.45), at(box(0.02, 0.16, 0.16), 0, 1.66, 4.8, Math.PI + 0.45));
  for (const s of [-1, 1]) { sensor.push(new THREE.SphereGeometry(0.05, 8, 5).translate(s * 0.44, 1.18, -4.75)); sensor.push(new THREE.SphereGeometry(0.04, 8, 5).translate(s * 0.12, 2.08, 5.95)); }

  // ---- stepped tandem canopy: flat glazed panels (gunner front / low, pilot behind / high) + frames
  const C = [
    { z: -4.8, ys: 1.25, yt: 1.27, hw: 0.44 }, { z: -4.32, ys: 1.3, yt: 1.95, hw: 0.49 }, { z: -3.45, ys: 1.36, yt: 1.99, hw: 0.53 },
    { z: -3.1, ys: 1.4, yt: 2.36, hw: 0.54 }, { z: -2.05, ys: 1.48, yt: 2.4, hw: 0.56 },
  ];
  const sect = ({ z, ys, yt, hw }) => { const ym = ys + (yt - ys) * 0.5; return [[-hw, ys, z], [-hw * 0.97, ym, z], [-hw * 0.56, yt, z], [hw * 0.56, yt, z], [hw * 0.97, ym, z], [hw, ys, z]]; };
  const CS = C.map(sect);
  mesh(facetLoft(CS, { caps: false }), M.canopy, 0, 0, 0, body);
  // opaque fairing behind the pilot, sloping into the spine
  skin.push(facetLoft([CS[4], sect({ z: -1.6, ys: 1.56, yt: 2.16, hw: 0.57 }), sect({ z: -1.1, ys: 1.66, yt: 2.02, hw: 0.56 })]));
  const fw = 0.045, frame = (a, b) => skin.push(bar(a, b, fw));
  for (const k of [1, 2, 3, 4]) for (let i = 0; i < 5; i++) frame(CS[k][i], CS[k][i + 1]);
  for (const i of [0, 1, 2, 3, 4, 5]) { frame(CS[0][i], CS[1][i]); frame(CS[1][i], CS[2][i]); frame(CS[3][i], CS[4][i]); }
  for (const i of [1, 2, 3, 4]) frame(CS[2][i], CS[3][i]);
  // door frames splitting each side window (sill -> mid rail -> roof)
  const mid = (k0, k1, i, t) => CS[k0][i].map((v, j) => v + (CS[k1][i][j] - v) * t);
  for (const [k0, k1, t] of [[1, 2, 0.48], [3, 4, 0.45]]) for (const [i0, i1, i2] of [[0, 1, 2], [5, 4, 3]]) { frame(mid(k0, k1, i0, t), mid(k0, k1, i1, t)); frame(mid(k0, k1, i1, t), mid(k0, k1, i2, t)); }
  // instrument coamings + seats faintly visible through the tint
  dark.push(at(box(0.7, 0.14, 0.3), 0, 1.38, -4.45), at(box(0.8, 0.16, 0.3), 0, 1.55, -3.05));
  for (const [z, y] of [[-3.6, 1.3], [-2.25, 1.5]]) dark.push(at(box(0.5, 0.75, 0.12), 0, y + 0.3, z + 0.12, -0.15), at(box(0.3, 0.2, 0.1), 0, y + 0.78, z + 0.18, -0.15));
  // wire strike cutters: canopy roof (pilot) + under the nose; windscreen deflector
  steel.push(at(box(0.025, 0.32, 0.1), 0, 2.53, -3.1, -0.45), at(box(0.06, 0.06, 0.3), 0, 2.42, -2.98));
  steel.push(at(box(0.025, 0.3, 0.12), 0, 0.68, -4.95, 0.5), at(box(0.06, 0.05, 0.3), 0, 0.78, -4.85));
  steel.push(bar([0, 1.98, -4.3], [0, 2.38, -3.12], 0.02, true));

  // ---- TADS (turret with two sensor shrouds) + PNVS (on top of the nose)
  const lat = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  skin.push(lat([[0.001, 0.73], [0.17, 0.745], [0.24, 0.8], [0.25, 0.86], [0.25, 1.1], [0.2, 1.17], [0.001, 1.18]], 16).translate(0, 0, -5.56));
  const oct = (z, x, y, w, h, c) => [[x - w + c, y - h, z], [x + w - c, y - h, z], [x + w, y - h + c, z], [x + w, y + h - c, z], [x + w - c, y + h, z], [x - w + c, y + h, z], [x - w, y + h - c, z], [x - w, y - h + c, z]];
  for (const s of [-1, 1]) {
    const x = s * 0.28;
    skin.push(facetLoft([oct(-5.42, x, 0.95, 0.085, 0.19, 0.04), oct(-5.78, x, 0.95, 0.085, 0.19, 0.045), oct(-5.86, x, 0.95, 0.07, 0.16, 0.04)]));
    if (s < 0) sensor.push(at(box(0.1, 0.1, 0.02), x, 1.02, -5.865), at(box(0.07, 0.06, 0.02), x, 0.87, -5.865));
    else sensor.push(at(box(0.11, 0.2, 0.02), x, 0.95, -5.865));
  }
  sensor.push(at(box(0.16, 0.07, 0.02), 0, 0.95, -5.805));
  dark.push(cyl(0.12, 0.12, 0.05, 12).translate(0, 0.72, -5.56));
  skin.push(cyl(0.14, 0.13, 0.12, 12).translate(0, 1.36, -5.15), lat([[0.12, 1.42], [0.125, 1.5], [0.09, 1.56], [0.001, 1.57]], 12).translate(0, 0, -5.15));
  sensor.push(at(box(0.1, 0.07, 0.03), 0, 1.47, -5.27));

  // ---- engine nacelles (intakes, particle separator hub) + black-hole IR exhaust suppressors
  for (const s of [-1, 1]) {
    const x = s * 0.83, N = [[-1.28, 0.2, 0.22], [-1.1, 0.29, 0.32], [0.3, 0.32, 0.35], [0.9, 0.28, 0.3], [1.12, 0.22, 0.24]];
    skin.push(loft(N.map(([z, hw, h]) => ring(x, 2.04, z, hw, h, h, 18, 3))));
    black.push(new THREE.CircleGeometry(0.2, 16).scale(0.9, 1, 1).rotateY(Math.PI).translate(x, 2.04, -1.285));
    skin.push(cyl(0.09, 0.02, 0.14, 10).rotateX(-Math.PI / 2).translate(x, 2.04, -1.33));
    // "black hole" IR suppressor: chamfered duct turning outboard / aft, louvred outlet
    const ex = [[x, 2.05, 0.92, 0.2, 0.2, 0], [x + s * 0.1, 2.06, 1.35, 0.21, 0.19, s * 0.25], [x + s * 0.28, 2.08, 1.7, 0.2, 0.17, s * 0.55]];
    const yawRing = ([cx, cy, cz, w, h, a]) => oct(cz, cx, cy, w, h, 0.06).map(([px, py]) => [cx + (px - cx) * Math.cos(a), py, cz - (px - cx) * Math.sin(a)]);
    black.push(facetLoft(ex.map(yawRing)));
    const [ox, oy, oz, , , a] = ex[2], nx = Math.sin(a), nz = Math.cos(a);
    steel.push(box(0.3, 0.26, 0.02).rotateY(a).translate(ox + nx * 0.004, oy, oz + nz * 0.004));
    for (let k = 0; k < 4; k++) dark.push(box(0.36, 0.022, 0.05).rotateX(-0.5).rotateY(a).translate(ox + nx * 0.02, oy - 0.12 + k * 0.08, oz + nz * 0.02));
    // pylon fairing joining nacelle and fuselage
    skin.push(at(box(0.32, 0.3, 1.6), s * 0.55, 1.98, -0.25));
  }
  // transmission fairing top, mast, stationary swashplate + servo rods, IR jammer, beacon
  skin.push(at(box(0.55, 0.16, 1.1), 0, 2.27, -0.35));
  dark.push(cyl(0.12, 0.11, 0.85, 10).translate(0, 2.75, -0.4), cyl(0.36, 0.36, 0.06, 16).translate(0, 2.665, -0.4), cyl(0.2, 0.26, 0.12, 12).translate(0, 2.4, -0.4));
  for (const a of [0.6, 2.6, 4.4]) steel.push(bar([Math.cos(a) * 0.3, 2.38, -0.4 + Math.sin(a) * 0.3], [Math.cos(a) * 0.32, 2.64, -0.4 + Math.sin(a) * 0.32], 0.025, true));
  dark.push(cyl(0.12, 0.13, 0.08, 10).translate(0, 2.21, 1.0), cyl(0.06, 0.06, 0.06, 8).translate(0, 2.45, 1.0));
  sensor.push(cyl(0.11, 0.11, 0.18, 8).translate(0, 2.33, 1.0));
  // mast-mounted radar (Longbow) on a standpipe above the hub
  dark.push(cyl(0.07, 0.07, 0.32, 8).translate(0, 3.42, -0.4));
  skin.push(new THREE.LatheGeometry([[0.001, 3.5], [0.36, 3.52], [0.47, 3.6], [0.48, 3.72], [0.4, 3.83], [0.001, 3.85]].map(([r, y]) => new THREE.Vector2(r, y)), 16).translate(0, 0, -0.4));

  // ---- stub wings: 2 pylons each, 19-tube rocket pod (inner) + 4-rail Hellfire launcher (outer)
  const af = [[0, 0], [0.06, 0.5], [0.3, 1], [0.7, 0.6], [1, 0.05], [0.7, -0.4], [0.3, -0.7], [0.06, -0.4]];
  const wingSec = (x, zLE, ch, th, y) => af.map(([c, t]) => [x, y + t * th, zLE + c * ch]);
  for (const s of [-1, 1]) {
    const w = [wingSec(s * 0.5, -1.02, 1.0, 0.075, 1.42), wingSec(s * 2.42, -0.98, 0.84, 0.055, 1.41)];
    skin.push(facetLoft(w));
    skin.push(at(box(0.12, 0.13, 0.78), s * 2.47, 1.41, -0.58));                         // wingtip fairing (dispensers)
    (s < 0 ? red : green).push(new THREE.SphereGeometry(0.045, 6, 4).translate(s * 2.53, 1.43, -0.92));
    dark.push(at(box(0.012, 0.03, 0.18), s * 1.7, 1.45, -0.1));                             // flap hinge
    for (const px of [1.25, 2.05]) { skin.push(at(box(0.1, 0.24, 0.66), s * px, 1.25, -0.52)); dark.push(at(box(0.07, 0.06, 0.4), s * px, 1.11, -0.55)); }
    // rocket pod
    const pod = new THREE.LatheGeometry([[0.001, -0.81], [0.19, -0.81], [0.21, -0.78], [0.21, 0.78], [0.19, 0.81], [0.001, 0.81]].map(([r, h]) => new THREE.Vector2(r, h)), 16).rotateX(Math.PI / 2);
    skin.push(pod.translate(s * 1.25, 0.86, -0.65));
    podFaces.push(new THREE.CircleGeometry(0.19, 16).rotateY(Math.PI).translate(s * 1.25, 0.86, -1.462), new THREE.CircleGeometry(0.19, 16).translate(s * 1.25, 0.86, 0.162));
    for (const z of [-0.45, 0.25]) dark.push(cyl(0.215, 0.215, 0.04, 16).rotateX(Math.PI / 2).translate(s * 1.25, 0.86, -0.65 + z));
    // Hellfire launcher: beam, rails, 2 x 2 missiles (laser seeker dome, wings, fins, warhead band)
    const lx = s * 2.05;
    dark.push(at(box(0.12, 0.08, 1.12), lx, 1.05, -0.5), at(box(0.04, 0.32, 0.9), lx, 0.82, -0.5), at(box(0.42, 0.04, 0.12), lx, 1.0, -0.85), at(box(0.42, 0.04, 0.12), lx, 1.0, -0.15));
    for (const [dx, y] of [[-0.13, 0.9], [0.13, 0.9], [-0.13, 0.66], [0.13, 0.66]]) {
      const mx = lx + dx;
      dark.push(at(box(0.05, 0.025, 0.95), mx, y + 0.1, -0.5));
      skin.push(cyl(0.088, 0.088, 1.42, 10, true).rotateX(Math.PI / 2).translate(mx, y, -0.5));
      sensor.push(new THREE.SphereGeometry(0.088, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 1, 1.3).translate(mx, y, -1.21));
      band.push(cyl(0.09, 0.09, 0.05, 10, true).rotateX(Math.PI / 2).translate(mx, y, -0.95));
      dark.push(new THREE.CircleGeometry(0.088, 10).translate(mx, y, 0.21));
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        dark.push(at(box(0.006, 0.07, 0.12), mx + Math.cos(a) * 0.12, y + Math.sin(a) * 0.12, -0.8, 0, 0, a + Math.PI / 2));
        dark.push(at(box(0.006, 0.08, 0.16), mx + Math.cos(a) * 0.125, y + Math.sin(a) * 0.125, 0.1, 0, 0, a + Math.PI / 2));
      }
    }
  }

  // ---- landing gear: trailing-arm main legs with strut fairings, wheels; long tail-wheel leg
  const tyre = new THREE.LatheGeometry([[0.2, -0.1], [0.27, -0.1], [0.31, -0.07], [0.31, 0.07], [0.27, 0.1], [0.2, 0.1]].map(([r, h]) => new THREE.Vector2(r, h)), 16).rotateZ(Math.PI / 2);
  const hub = cyl(0.17, 0.17, 0.16, 12).rotateZ(Math.PI / 2);
  for (const s of [-1, 1]) {
    const ax = [s * 1.0, 0.31, -2.05];
    rubber.push(tyre.clone().translate(...ax)); steel.push(hub.clone().translate(...ax));
    skin.push(bar([s * 0.6, 1.0, -2.45], [s * 0.94, 0.42, -2.1], 0.07));                 // faired shock strut
    skin.push(at(box(0.05, 0.62, 0.22), s * 0.79, 0.73, -2.3, 0.35, 0, s * 0.52));
    dark.push(bar([s * 0.62, 0.9, -1.7], [s * 0.93, 0.36, -2.0], 0.03, true), bar([s * 0.88, 0.31, -2.05], [s * 1.12, 0.31, -2.05], 0.04, true));
  }
  const tw = [0, 0.17, 5.42];
  rubber.push(new THREE.LatheGeometry([[0.08, -0.06], [0.15, -0.06], [0.17, -0.03], [0.17, 0.03], [0.15, 0.06], [0.08, 0.06]].map(([r, h]) => new THREE.Vector2(r, h)), 12).rotateZ(Math.PI / 2).translate(...tw));
  steel.push(cyl(0.09, 0.09, 0.1, 10).rotateZ(Math.PI / 2).translate(...tw));
  skin.push(bar([0, 1.82, 5.0], [0, 0.42, 5.35], 0.08));
  dark.push(bar([-0.08, 0.45, 5.33], [-0.08, 0.17, 5.42], 0.025, true), bar([0.08, 0.45, 5.33], [0.08, 0.17, 5.42], 0.025, true), bar([0, 1.6, 4.6], [0, 0.95, 5.15], 0.025, true));

  // ---- tail: swept vertical fin, stabilator under the boom end, tail rotor gearbox fairing
  const finSec = (y, zLE, ch, th) => af.map(([c, t]) => [t * th, y, zLE + c * ch]);
  skin.push(facetLoft([finSec(1.95, 4.82, 1.2, 0.075), finSec(3.2, 5.55, 0.5, 0.05)]));
  const stab = (x, zLE, ch, th) => af.map(([c, t]) => [x, 1.66 + t * th, zLE + c * ch]);
  skin.push(facetLoft([stab(-1.15, 5.58, 0.55, 0.03), stab(0, 5.48, 0.66, 0.035), stab(1.15, 5.58, 0.55, 0.03)]));
  skin.push(at(box(0.08, 0.32, 0.4), 0, 1.82, 5.78));
  skin.push(cyl(0.12, 0.1, 0.3, 10).rotateZ(Math.PI / 2).translate(-0.12, 2.6, 5.72));
  red.push(new THREE.SphereGeometry(0.06, 6, 4).translate(0, 3.15, 5.84), new THREE.SphereGeometry(0.06, 6, 4).translate(0, 2.09, 1.8));
  // team chevrons on the boom
  for (const s of [-1, 1]) {
    const ch = new THREE.Shape([new THREE.Vector2(-0.24, -0.06), new THREE.Vector2(0, 0.1), new THREE.Vector2(0.24, -0.06), new THREE.Vector2(0.24, -0.14), new THREE.Vector2(0, 0.02), new THREE.Vector2(-0.24, -0.14)]);
    mark.push(new THREE.ShapeGeometry(ch).rotateY(s * Math.PI / 2).translate(s * 0.28, 1.84, 3.2));
  }

  // ---- chin turret (aims with the gunner): yoke + M230 chain gun with feed chute
  const chin = new THREE.Group(); chin.name = 'chin'; chin.position.set(0, 0.55, -3.6); body.add(chin);
  group([cyl(0.26, 0.24, 0.12, 14).translate(0, 0.14, 0), cyl(0.12, 0.12, 0.16, 10).translate(0, 0.04, 0)], M.dark, chin);
  const cannon = new THREE.Group(); chin.add(cannon);
  group([
    box(0.08, 0.2, 0.16).translate(-0.12, 0, 0.0), box(0.08, 0.2, 0.16).translate(0.12, 0, 0.0),
    box(0.16, 0.18, 0.62).translate(0, -0.03, -0.12), box(0.12, 0.05, 0.4).translate(0, 0.08, -0.1),
    cyl(0.07, 0.07, 0.3, 12).rotateX(Math.PI / 2).translate(0, -0.03, -0.55),
    cyl(0.032, 0.036, 1.05, 10).rotateX(Math.PI / 2).translate(0, -0.03, -1.17),
    cyl(0.05, 0.05, 0.12, 10).rotateX(Math.PI / 2).translate(0, -0.03, -1.69),
  ], M.dark, cannon);
  group([...[0, 1, 2, 3].map((k) => cyl(0.048, 0.048, 0.02, 10).rotateX(Math.PI / 2).translate(0, -0.03, -0.75 - k * 0.05)),
    new THREE.TorusGeometry(0.22, 0.04, 5, 10, Math.PI * 0.6).rotateY(Math.PI / 2).translate(0, 0.12, 0.12)], M.steel, cannon);
  const cannonMuzzle = new THREE.Object3D(); cannonMuzzle.position.set(0, -0.03, -1.75); cannon.add(cannonMuzzle);

  // ---- tail rotor: two 2-blade rotors stacked as a 4-blade "scissor" (55° / 125°)
  const tailRotor = new THREE.Group(); tailRotor.name = 'tailRotor'; tailRotor.position.set(-0.3, 2.6, 5.72); body.add(tailRotor);
  const tb = box(0.03, 0.78, 0.2).translate(0, 0.47, 0);
  const tbl = [];
  for (const [x, a0] of [[0, 0], [-0.06, 0.96]]) for (const a of [a0, a0 + Math.PI]) tbl.push(tb.clone().rotateX(a).translate(x, 0, 0));
  group(tbl, M.blade, tailRotor);
  group([cyl(0.08, 0.08, 0.16, 10).rotateZ(Math.PI / 2).translate(-0.03, 0, 0), cyl(0.05, 0.02, 0.08, 8).rotateZ(Math.PI / 2).translate(-0.15, 0, 0)], M.dark, tailRotor);

  // ---- main rotor: hub, pitch housings, pitch horns + links, rotating swashplate, 4 blades; blur disc
  const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 3.2, -0.4); body.add(rotor);
  const hubParts = [cyl(0.24, 0.2, 0.26, 12), cyl(0.37, 0.37, 0.05, 16).translate(0, -0.47, 0)];
  const steelParts = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2, rot = (g) => g.rotateY(a);
    hubParts.push(rot(box(0.6, 0.11, 0.17).translate(0.48, 0, 0)), rot(box(0.36, 0.1, 0.3).translate(0.85, 0.01, 0.02)), rot(box(0.07, 0.05, 0.2).translate(0.42, 0.01, -0.18)));
    steelParts.push(rot(bar([0.42, -0.02, -0.26], [0.34, -0.45, -0.26], 0.018, true)));
  }
  group(hubParts, M.dark, rotor); group(steelParts, M.steel, rotor);
  const bladeG = bladeGeometry();
  const blades = [];
  for (let i = 0; i < 4; i++) { const b = mesh(bladeG, M.blade, 0, 0, 0, rotor); b.rotation.y = (i * Math.PI) / 2; blades.push(b); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(7.3, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: cache.blur || (cache.blur = blurTexture()), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.set(0, 3.22, -0.4); disc.visible = false; body.add(disc);

  // ---- merge the static detail per material
  for (const g of skin) mesh(g, M.skin, 0, 0, 0, body);
  group(dark, M.dark, body); group(black, M.exhaust, body); group(steel, M.steel, body); group(rubber, M.rubber, body);
  group(sensor, M.sensor, body); group(band, M.band, body); group(mark, M.mark, body); group(podFaces, M.pod, body);
  for (const [list, mat] of [[red, M.lightRed], [green, M.lightGreen]]) mesh(merged(list), mat, 0, 0, 0, body).castShadow = false;

  root.userData = { type: 'heli', body, rotor, blades, disc, tailRotor, chin, cannon, cannonMuzzle, rocketPods: [new THREE.Vector3(-1.25, 0.86, -1.5), new THREE.Vector3(1.25, 0.86, -1.5)] };
  projectUV(root, new Set([M.skin]), TILE);
  return finishVehicle(root);
}
