import * as THREE from 'three';
import { materials, mesh, sideExtrude, finishVehicle, noiseField, sampleField, projectUV, facetLoft, merged } from './kit.js';

// ---------------------------------------------------------------- main battle tank (Leopard 2A6 / M1 class)
// Running gear: 7 dual road wheels with rubber tyres per side, rear drive sprocket with teeth, front idler, 4 support
// rollers and a link-by-link track (pads, guide horns) wrapped around them; armoured skirt panels with bolts and
// rubber flaps. Hull: lower nose plate with tow shackles, shallow glacis with the driver's periscopes, headlight
// clusters in guards, engine deck louvres, rear exhaust grilles / tail lights / tow cables. Turret: sloped sides,
// wedge add-on armour, undercut bustle with side bins and a stowage basket, gunner's sight and commander's
// periscope with glass, cupola + roof MG, loader's hatch, smoke dischargers, antennas; 120 mm gun with mantlet,
// thermal sleeve bands, bore evacuator and muzzle reference sensor. Paint: NATO three-colour (team 1) or desert tan
// (team 2) on a box-projected canvas texture (one scale everywhere) + the kit's weathering.

const TILE = 6;                 // metres per camouflage texture tile
const local = {};
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const quantile = (f, q) => { const s = Float32Array.from(f).sort(); return s[Math.floor(q * (s.length - 1))]; };
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

// camouflage: NATO green / brown / black with sprayed (slightly soft) edges, or a single-colour desert tan; grime,
// dust, fine grain, paint chips and faint rain streaks on top
function camoTexture(team) {
  // per-pixel paint at 512 (upscaled smoothly), crisp details drawn at 1024
  const S = 1024, P = 512, N = 256, c = document.createElement('canvas'), base = document.createElement('canvas');
  c.width = c.height = S; base.width = base.height = P;
  const bg = base.getContext('2d'), img = bg.createImageData(P, P), d = img.data;
  const f1 = noiseField(N, 5, 4, 5 + team), f2 = noiseField(N, 6, 4, 17 + team);
  const grime = noiseField(N, 4, 4, 29), dust = noiseField(N, 3, 5, 41), fine = noiseField(N, 48, 2, 53);
  const t1 = quantile(f1, 0.62), t2 = quantile(f2, 0.82), w = 0.004;
  const G = hex(team === 1 ? 0x48512f : 0x968260), BR = hex(team === 1 ? 0x4a3929 : 0x8a7656), BK = hex(0x1d1e1b), DU = hex(team === 1 ? 0x7d7360 : 0xa99a7c);
  for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
    const u = x / P, v = y / P;
    let r, gg, b;
    if (team === 1) {
      const a = smooth(t1 - w, t1 + w, sampleField(f1, N, u, v)), k = smooth(t2 - w, t2 + w, sampleField(f2, N, u, v));
      r = G[0] + (BR[0] - G[0]) * a; gg = G[1] + (BR[1] - G[1]) * a; b = G[2] + (BR[2] - G[2]) * a;
      r += (BK[0] - r) * k; gg += (BK[1] - gg) * k; b += (BK[2] - b) * k;
    } else {
      const m = (sampleField(f1, N, u, v) - 0.5) * 0.9, k = smooth(t2 - 0.03, t2 + 0.03, sampleField(f2, N, u, v)) * 0.35;
      r = G[0] * (1 + m * 0.25) + (BR[0] - G[0]) * k; gg = G[1] * (1 + m * 0.25) + (BR[1] - G[1]) * k; b = G[2] * (1 + m * 0.25) + (BR[2] - G[2]) * k;
    }
    const gr = 1 - smooth(0.5, 0.8, sampleField(grime, N, u, v)) * 0.24;
    const du = smooth(0.5, 0.82, sampleField(dust, N, u, v)) * (team === 1 ? 0.2 : 0.14);
    const fn = 1 + (sampleField(fine, N, u, v) - 0.5) * 0.14 + (Math.random() - 0.5) * 0.06;
    const i = (y * P + x) * 4;
    d[i] = (r + (DU[0] - r) * du) * gr * fn; d[i + 1] = (gg + (DU[1] - gg) * du) * gr * fn; d[i + 2] = (b + (DU[2] - b) * du) * gr * fn; d[i + 3] = 255;
  }
  bg.putImageData(img, 0, 0);
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high'; g.drawImage(base, 0, 0, S, S);
  // rain / dirt streaks (run down the side faces: v = height there)
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * S, y = Math.random() * S, L = 30 + Math.random() * 120;
    const gr = g.createLinearGradient(0, y, 0, y + L);
    gr.addColorStop(0, 'rgba(25,22,16,0.10)'); gr.addColorStop(1, 'rgba(25,22,16,0)');
    g.fillStyle = gr; g.fillRect(x, y, 1 + Math.random() * 2.5, L);
  }
  // paint chips (dark primer / bare metal) and light scratches
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 0.5 + Math.random() * 1.3;
    g.fillStyle = Math.random() < 0.7 ? 'rgba(28,26,22,0.3)' : 'rgba(150,145,130,0.22)';
    g.beginPath(); g.ellipse(x, y, r * (1 + Math.random()), r, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(170,160,135,0.12)'; g.lineWidth = 0.8;
  for (let i = 0; i < 90; i++) { const x = Math.random() * S, y = Math.random() * S, a = Math.random() * 6.3, L = 6 + Math.random() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// track link atlas: u 0..0.75 = pad faces (steel edges / connectors, rubber pads, centre guide), u 0.75..1 = link end
function linkTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#4b4a45'; g.fillRect(0, 0, 128, 64);
  for (const [x0, x1] of [[7, 42], [54, 89]]) { g.fillStyle = '#1c1c1a'; g.fillRect(x0, 9, x1 - x0, 46); g.fillStyle = '#2a2a27'; g.fillRect(x0 + 2, 30, x1 - x0 - 4, 3); }
  g.fillStyle = '#5c5b55'; g.fillRect(0, 0, 96, 6); g.fillRect(0, 58, 96, 6);
  g.fillStyle = '#34332f'; g.fillRect(45, 0, 6, 64);
  g.fillStyle = '#5a5953'; g.fillRect(96, 0, 32, 64);
  g.fillStyle = '#2b2a27'; g.fillRect(96, 0, 32, 4); g.fillRect(96, 60, 32, 4);
  g.fillStyle = '#3a3935'; g.beginPath(); g.arc(112, 32, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#6d6b64'; g.beginPath(); g.arc(112, 32, 4, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tankMaterials(team) {
  if (local[team]) return local[team];
  const M = materials(team);
  return local[team] = {
    ...M,
    paint: new THREE.MeshStandardMaterial({ map: camoTexture(team), roughness: 0.86, metalness: 0.12 }),
    track: new THREE.MeshStandardMaterial({ map: local.linkTex || (local.linkTex = linkTexture()), roughness: 0.82, metalness: 0.45 }),
    fabric: new THREE.MeshStandardMaterial({ color: team === 1 ? 0x4a4935 : 0x6f6448, roughness: 1, metalness: 0 }),
    lens: new THREE.MeshStandardMaterial({ color: 0xcfd2c8, emissive: 0x2a2a22, roughness: 0.12, metalness: 0.4 }),
    mark: new THREE.MeshStandardMaterial({ color: team === 1 ? 0x2e6fd8 : 0xd84a3a, emissive: team === 1 ? 0x0b1c38 : 0x38120e, roughness: 0.8, metalness: 0 }),
  };
}

// ---------------------------------------------------------------- geometry helpers
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
// copy of geo with its local +Y turned to direction n, placed at p
function along(geo, p, n, spin = 0) {
  const dir = new THREE.Vector3(...n).normalize();
  _q.setFromUnitVectors(UP, dir);
  if (spin) _q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
  return geo.clone().applyMatrix4(_m.compose(new THREE.Vector3(...p), _q, new THREE.Vector3(1, 1, 1)));
}
const at = (geo, x, y, z, rx = 0, ry = 0, rz = 0) => geo.clone().applyMatrix4(_m.makeRotationFromEuler(new THREE.Euler(rx, ry, rz))).translate(x, y, z);
const group = (list, mat, parent) => mesh(merged(list), mat, 0, 0, 0, parent);
// lathe around the X axis (profile [radius, x]); for the left side the part is turned 180° about Y
const lathe = (pts, seg) => new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), seg).rotateZ(-Math.PI / 2);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const EYE = new THREE.TorusGeometry(0.05, 0.016, 4, 8);
const BOLT = merged([new THREE.CylinderGeometry(0.02, 0.025, 0.024, 5, 1, true), new THREE.CircleGeometry(0.02, 5).rotateX(-Math.PI / 2).translate(0, 0.012, 0)]);

// 2D convex hull (monotone chain, CCW) of [z, y] points
function hull2(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// track belt: inner surface = convex hull of the wheels it wraps; links every `pitch` metres -> [z, y, nz, ny]
function beltLinks(circles, pitch) {
  const pts = [];
  for (const [z, y, r] of circles) for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push([z + Math.cos(a) * r, y + Math.sin(a) * r]); }
  const H = hull2(pts), segs = [];
  let tot = 0;
  for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); segs.push([a, b, L, tot]); tot += L; }
  const n = Math.round(tot / pitch), step = tot / n, out = [];
  let si = 0;
  for (let k = 0; k < n; k++) {
    const s = k * step;
    while (si < segs.length - 1 && segs[si][3] + segs[si][2] < s) si++;
    const [a, b, L, s0] = segs[si], t = (s - s0) / L, dz = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, dy, -dz]);
  }
  return out;
}

// Running gear animation (CPU, only while the tank moves and is near the camera): track links travel round the
// belt — the bottom run stays planted on the ground, the top run moves forward — and the wheel / sprocket bolts and
// sprocket teeth turn. Each part keeps its rest geometry; update(offsetLeft, offsetRight) re-places the vertices.
//   links: [{ x, s0, side }] link rest frames on the belt (arc length s0); spinners: [{ start, count, yc, zc, r, side }]
function runningGear(trackMesh, links, path, spinMeshes) {
  // (geometries are read on every call: finishVehicle swaps in its own copies after the model is built)
  const per = trackMesh.geometry.attributes.position.count / links.length;
  const rest = trackMesh.geometry.attributes.position.array.slice(), restN = trackMesh.geometry.attributes.normal.array.slice();
  const L = path.length, n = path.table.length / 4;
  const sample = (s) => { const t = (((s % L) + L) % L) / L * n, i = Math.floor(t) % n, j = (i + 1) % n, f = t - Math.floor(t), T = path.table;
    return [T[i * 4] + (T[j * 4] - T[i * 4]) * f, T[i * 4 + 1] + (T[j * 4 + 1] - T[i * 4 + 1]) * f, T[i * 4 + 2] + (T[j * 4 + 2] - T[i * 4 + 2]) * f, T[i * 4 + 3] + (T[j * 4 + 3] - T[i * 4 + 3]) * f]; };
  const spinRest = spinMeshes.map(({ mesh }) => ({ p: mesh.geometry.attributes.position.array.slice(), n: mesh.geometry.attributes.normal.array.slice() }));
  return (offL, offR) => {
    const P = trackMesh.geometry.attributes.position, N = trackMesh.geometry.attributes.normal;
    // links: rest vertices are in the link's frame at s0; move them to s0 + offset (rotate (z, y) by the change of the belt direction)
    for (let k = 0; k < links.length; k++) {
      const lk = links[k], off = lk.side < 0 ? offL : offR;
      const [z1, y1, nz1, ny1] = sample(lk.s0 + off), { z0, y0, nz0, ny0 } = lk;
      const c = nz0 * nz1 + ny0 * ny1, sn = nz0 * ny1 - ny0 * nz1; // rotation from the rest normal to the new one
      for (let v = k * per; v < (k + 1) * per; v++) {
        const dz = rest[v * 3 + 2] - z0, dy = rest[v * 3 + 1] - y0;
        P.array[v * 3 + 2] = z1 + dz * c - dy * sn; P.array[v * 3 + 1] = y1 + dz * sn + dy * c;
        const mz = restN[v * 3 + 2], my = restN[v * 3 + 1];
        N.array[v * 3 + 2] = mz * c - my * sn; N.array[v * 3 + 1] = mz * sn + my * c;
      }
    }
    P.needsUpdate = N.needsUpdate = true;
    // wheels / sprockets: turn about their axle (CCW in the z-y plane as the tank rolls forward)
    spinMeshes.forEach(({ mesh, parts }, m) => {
      const A = mesh.geometry.attributes.position, B = mesh.geometry.attributes.normal, R = spinRest[m];
      for (const pt of parts) {
        const a = (pt.side < 0 ? offL : offR) / pt.r, c = Math.cos(a), sn = Math.sin(a);
        for (let v = pt.start; v < pt.start + pt.count; v++) {
          const dz = R.p[v * 3 + 2] - pt.zc, dy = R.p[v * 3 + 1] - pt.yc;
          A.array[v * 3 + 2] = pt.zc + dz * c - dy * sn; A.array[v * 3 + 1] = pt.yc + dz * sn + dy * c;
          const mz = R.n[v * 3 + 2], my = R.n[v * 3 + 1];
          B.array[v * 3 + 2] = mz * c - my * sn; B.array[v * 3 + 1] = mz * sn + my * c;
        }
      }
      A.needsUpdate = B.needsUpdate = true;
    });
  };
}

// one track link: body (pads / connectors from the atlas) + centre guide horn on the inner side
function linkGeometry(W, T, Lk) {
  const body = box(W, T, Lk), uv = body.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, i < 8 ? 0.75 + uv.getX(i) * 0.25 : uv.getX(i) * 0.75);
  const horn = new THREE.CylinderGeometry(0.022, 0.04, 0.1, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, 1.6).translate(0, -T / 2 - 0.05, 0);
  const huv = horn.attributes.uv; for (let i = 0; i < huv.count; i++) huv.setXY(i, 0.8 + huv.getX(i) * 0.1, huv.getY(i));
  return merged([body, horn]);
}

// sprocket ring: Z teeth, extruded across X
function gearRing(rRoot, rTip, teeth, thick) {
  const s = new THREE.Shape(), D = (Math.PI * 2) / teeth;
  for (let k = 0; k < teeth; k++) {
    const a = k * D, P = (r, t) => [Math.cos(a + t * D) * r, Math.sin(a + t * D) * r];
    const pts = [P(rRoot, -0.32), P(rTip, -0.13), P(rTip, 0.13), P(rRoot, 0.32), P(rRoot * 0.985, 0.5)];
    pts.forEach(([x, y], i) => (k === 0 && i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, rRoot * 0.62, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -thick / 2); g.rotateY(Math.PI / 2);
  return g;
}

// ---------------------------------------------------------------- tank
export function buildTank(team) {
  const M = tankMaterials(team);
  const root = new THREE.Group(); root.name = 'tank';
  const body = new THREE.Group(); root.add(body); // pitches / rolls with the terrain

  // ---- hull: belly between the tracks (lower nose plate) + full-width upper hull (sponsons, glacis, deck, rear plate)
  mesh(sideExtrude([[-3.25, 0.4], [-3.72, 1.02], [-3.7, 1.14], [3.62, 1.14], [3.66, 0.66], [3.3, 0.4]], 2.46), M.paint, 0, 0, 0, body);
  mesh(sideExtrude([[-3.7, 1.02], [-3.76, 1.1], [-2.2, 1.58], [2.9, 1.6], [3.6, 1.52], [3.68, 1.47], [3.68, 1.1], [-3.55, 1.1]], 3.56, 0.025), M.paint, 0, 0, 0, body);
  const glacisY = (z) => 1.1 + ((-3.76 - z) / (-3.76 + 2.2)) * 0.48; // upper glacis height at z (z in -3.76..-2.2)
  const glacisA = Math.atan2(0.48, 1.56);
  const bolts = [], steel = [], dark = [], paintBits = [], glass = [], rubber = [], red = [], lens = [];
  // glacis / deck seams + bolt rows (welded plates)
  dark.push(at(box(3.5, 0.012, 0.025), 0, 1.583, -2.19));
  for (let i = 0; i < 13; i++) bolts.push(along(BOLT, [-1.5 + i * 0.25, glacisY(-3.62) + 0.012, -3.62], [0, Math.cos(glacisA), -Math.sin(glacisA)]));
  // driver's hatch (right front) + 3 periscopes on the glacis under armoured hoods
  paintBits.push(at(box(0.56, 0.04, 0.54), 0.55, 1.615, -1.93), at(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 8).rotateZ(Math.PI / 2), 0.55, 1.62, -1.64));
  steel.push(at(box(0.04, 0.03, 0.16), 0.75, 1.65, -1.95), at(box(0.04, 0.03, 0.16), 0.35, 1.65, -1.95));
  for (const x of [0.3, 0.55, 0.8]) {
    paintBits.push(at(box(0.19, 0.035, 0.16), x, glacisY(-2.4) + 0.075, -2.4, glacisA));
    glass.push(at(box(0.15, 0.055, 0.02), x, glacisY(-2.47) + 0.04, -2.47, glacisA * 0.4));
  }
  // headlight clusters (headlamp + convoy lamp) on the glacis corners, in wire guards
  for (const s of [-1, 1]) {
    const x = s * 1.39, z = -3.42, y = glacisY(z);
    paintBits.push(at(box(0.36, 0.17, 0.16), x, y + 0.085, z + 0.02));
    for (const [dx, r] of [[-0.08, 0.055], [0.09, 0.04]]) lens.push(at(new THREE.CylinderGeometry(r, r, 0.03, 12).rotateX(Math.PI / 2), x + dx * s, y + 0.09, z - 0.065));
    const gy = y + 0.22, gz = z - 0.14;
    steel.push(at(box(0.44, 0.022, 0.022), x, gy, gz), at(box(0.022, 0.22, 0.022), x - 0.21, y + 0.11, gz), at(box(0.022, 0.22, 0.022), x + 0.21, y + 0.11, gz));
    steel.push(at(box(0.022, 0.022, 0.18), x - 0.21, gy, gz + 0.09), at(box(0.022, 0.022, 0.18), x + 0.21, gy, gz + 0.09), at(box(0.022, 0.18, 0.022), x, y + 0.11, gz));
  }
  // tow eyes + shackles on the lower nose plate and the rear
  const shackle = new THREE.TorusGeometry(0.075, 0.02, 6, 12, Math.PI * 1.25).rotateZ(-Math.PI * 0.125);
  for (const s of [-1, 1]) {
    const noseA = Math.atan2(0.47, 0.62);
    steel.push(at(box(0.16, 0.18, 0.1), s * 0.95, 0.72, -3.43, -noseA), at(shackle, s * 0.95, 0.62, -3.52, 0, Math.PI / 2, 0), at(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6).rotateZ(Math.PI / 2), s * 0.95, 0.7, -3.5));
    steel.push(at(box(0.16, 0.16, 0.1), s * 0.95, 0.82, 3.69), at(shackle, s * 0.95, 0.72, 3.76, 0, Math.PI / 2, 0), at(new THREE.CylinderGeometry(0.022, 0.022, 0.2, 6).rotateZ(Math.PI / 2), s * 0.95, 0.8, 3.75));
    // lifting eyes on the hull corners
    steel.push(at(EYE, s * 1.6, 1.64, -1.95, 0, Math.PI / 2, 0), at(EYE, s * 1.6, 1.64, 2.95, 0, Math.PI / 2, 0));
  }
  // engine deck: two intake grilles (partly under the bustle) + full-width cooling louvres on the rear slope
  const deckA = Math.atan2(0.08, 0.7);
  for (const s of [-1, 1]) {
    dark.push(at(box(0.98, 0.02, 1.22), s * 0.62, 1.605, 2.15));
    for (let i = 0; i < 14; i++) paintBits.push(at(box(0.94, 0.012, 0.075), s * 0.62, 1.625, 1.6 + i * 0.085, 0.55));
    paintBits.push(at(box(1.04, 0.035, 0.04), s * 0.62, 1.62, 1.52), at(box(1.04, 0.035, 0.04), s * 0.62, 1.62, 2.78), at(box(0.04, 0.035, 1.3), s * 0.62 - 0.5, 1.62, 2.15), at(box(0.04, 0.035, 1.3), s * 0.62 + 0.5, 1.62, 2.15));
  }
  dark.push(at(box(2.8, 0.02, 0.56), 0, 1.565, 3.25, deckA));
  for (let i = 0; i < 7; i++) paintBits.push(at(box(2.76, 0.012, 0.07), 0, 1.592 - i * 0.0105, 3.0 + i * 0.075, deckA + 0.55));
  for (const x of [-0.7, 0.7]) paintBits.push(at(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 10), x, 1.62, 0.95)); // filler caps
  // rear plate: two louvred exhaust grilles, tail light clusters, tow cables crossing on the lower plate
  for (const s of [-1, 1]) {
    dark.push(at(box(1.08, 0.3, 0.03), s * 0.74, 1.29, 3.685));
    for (let i = 0; i < 6; i++) paintBits.push(at(box(1.04, 0.012, 0.07), s * 0.74, 1.17 + i * 0.048, 3.7, 0.7));
    paintBits.push(at(box(1.12, 0.03, 0.05), s * 0.74, 1.455, 3.7), at(box(1.12, 0.03, 0.05), s * 0.74, 1.125, 3.7));
    paintBits.push(at(box(0.22, 0.12, 0.06), s * 1.5, 1.36, 3.7));
    red.push(at(box(0.08, 0.07, 0.02), s * 1.45, 1.36, 3.735), at(box(0.06, 0.07, 0.02), s * 1.56, 1.36, 3.735));
  }
  const cable = (pts) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 24, 0.022, 5, false);
  steel.push(cable([[-0.95, 0.82, 3.74], [-0.5, 0.9, 3.7], [0.3, 1.0, 3.69], [0.85, 1.05, 3.7], [1.05, 0.98, 3.71]]));
  steel.push(cable([[0.95, 0.82, 3.74], [0.5, 0.88, 3.7], [-0.3, 0.98, 3.69], [-0.85, 1.04, 3.7], [-1.05, 0.96, 3.71]]));
  // sponson fender line (skirt hanger rail) along each side
  for (const s of [-1, 1]) paintBits.push(at(box(0.04, 0.05, 7.0), s * 1.8, 1.385, -0.1));

  // ---- running gear (per side): wheels / sprocket / idler / rollers / track / skirts
  const RW = 0.35, WY = 0.41, wheelZ = [0, 1, 2, 3, 4, 5, 6].map((i) => -2.52 + i * 0.84);
  const IDL = [-3.22, 0.66, 0.3], SPR = [3.2, 0.68, 0.33], rollerZ = [-1.85, -0.6, 0.65, 1.9], RR = [0.885, 0.09];
  const tyreG = merged([lathe([[0.29, 0.06], [0.345, 0.065], [0.35, 0.09], [0.35, 0.23], [0.34, 0.25], [0.29, 0.25]], 13), lathe([[0.3, -0.25], [0.35, -0.24], [0.35, -0.07], [0.29, -0.06]], 13)]);
  const discG = lathe([[0.295, 0.245], [0.262, 0.236], [0.2, 0.214], [0.13, 0.214], [0.1, 0.24], [0.06, 0.246]], 13);
  const hubG = lathe([[0.061, 0.246], [0.05, 0.262], [0.0, 0.266]], 8);
  const idlerRim = merged([lathe([[0.25, 0.06], [0.3, 0.06], [0.3, 0.23], [0.27, 0.25]], 14), lathe([[0.3, -0.24], [0.3, -0.06], [0.25, -0.06]], 14)]);
  const idlerDisc = lathe([[0.27, 0.25], [0.2, 0.23], [0.14, 0.23], [0.12, 0.25], [0.06, 0.27], [0, 0.275]], 14);
  const gear = gearRing(0.315, 0.385, 12, 0.055);
  const sprHub = lathe([[0.23, -0.1], [0.23, 0.15], [0.2, 0.2], [0.12, 0.215], [0.1, 0.26], [0.0, 0.265]], 14);
  const linkG = linkGeometry(0.62, 0.06, 0.15);
  const beltWheels = [...wheelZ.map((z) => [z, WY, RW]), IDL, SPR, ...rollerZ.map((z) => [z, RR[0], RR[1]])];
  const links = beltLinks(beltWheels, 0.165);
  // dense copy of the belt for the animation (1 cm steps), its length = links x pitch
  const dense = beltLinks(beltWheels, 0.01), table = new Float32Array(dense.length * 4);
  dense.forEach(([z, y, nz, ny], i) => table.set([z, y, nz, ny], i * 4));
  let beltLen = 0;
  for (let i = 0; i < dense.length; i++) { const a = dense[i], b = dense[(i + 1) % dense.length]; beltLen += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  const path = { table, length: beltLen };
  const linkRest = [], trackGeos = [], spinBolts = [], spinGear = [], spinBoltParts = [], spinGearParts = [];
  // (merged() de-indexes, so a part's vertex count is its index count when it has one)
  const addSpin = (list, parts, geo, side, yc, zc, r) => { list.push(geo); parts.push({ count: geo.index ? geo.index.count : geo.attributes.position.count, side, yc, zc, r }); };
  const _b = new THREE.Matrix4(), X = new THREE.Vector3(1, 0, 0), Yv = new THREE.Vector3(), Zv = new THREE.Vector3();
  for (const s of [-1, 1]) {
    const xc = s * 1.47, ry = s < 0 ? Math.PI : 0;
    const part = (geo, mat, z, y) => { const m = mesh(geo, mat, xc, y, z, body); m.rotation.y = ry; return m; };
    for (const z of wheelZ) { part(tyreG, M.rubber, z, WY); part(discG, M.paint, z, WY); part(hubG, M.steel, z, WY); }
    for (const z of wheelZ) for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; addSpin(spinBolts, spinBoltParts, at(BOLT, xc + s * 0.226, WY + Math.sin(a) * 0.16, z + Math.cos(a) * 0.16, 0, 0, -s * Math.PI / 2), s, WY, z, RW); }
    part(idlerRim, M.steel, IDL[0], IDL[1]); part(idlerDisc, M.paint, IDL[0], IDL[1]);
    for (const dx of [-0.13, 0.13]) addSpin(spinGear, spinGearParts, gear.clone().applyMatrix4(new THREE.Matrix4().makeRotationY(ry)).translate(xc + dx, SPR[1], SPR[0]), s, SPR[1], SPR[0], SPR[2]);
    part(sprHub, M.paint, SPR[0], SPR[1]);
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; addSpin(spinBolts, spinBoltParts, at(BOLT, xc + s * 0.208, SPR[1] + Math.sin(a) * 0.15, SPR[0] + Math.cos(a) * 0.15, 0, 0, -s * Math.PI / 2), s, SPR[1], SPR[0], SPR[2]); }
    dark.push(at(new THREE.CylinderGeometry(0.2, 0.22, 0.2, 12).rotateZ(Math.PI / 2), s * 1.28, SPR[1], SPR[0]), at(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 8).rotateZ(Math.PI / 2), s * 1.28, IDL[1], IDL[0]));
    for (const z of rollerZ) for (const dx of [-0.15, 0.15]) rubber.push(at(new THREE.CylinderGeometry(RR[1], RR[1], 0.15, 10).rotateZ(Math.PI / 2), xc + dx, RR[0], z));
    // suspension arms (trailing, from the hull side to each wheel hub) + bump stops
    for (const z of wheelZ) dark.push(at(box(0.12, 0.1, 0.42), s * 1.25, WY + 0.08, z - 0.18, -0.35));
    // track
    links.forEach(([z, y, nz, ny], i) => {
      Yv.set(0, ny, nz); Zv.crossVectors(X, Yv);
      _b.makeBasis(X, Yv, Zv).setPosition(xc, y + ny * 0.03, z + nz * 0.03);
      const lg = linkG.clone().applyMatrix4(_b);
      trackGeos.push(lg.index ? lg.toNonIndexed() : lg);
      linkRest.push({ side: s, s0: i * (path.length / links.length), z0: z, y0: y, nz0: nz, ny0: ny });
    });

    // armoured skirt: 2 heavy bolted panels at the front (rubber flaps under them) + 5 light panels; gaps between
    const panels = [
      { z0: -3.64, z1: -2.63, t: 0.08, bot: 0.5, front: true },
      { z0: -2.61, z1: -1.68, t: 0.08, bot: 0.5 },
      { z0: -1.66, z1: -0.68, t: 0.04, bot: 0.55 }, { z0: -0.66, z1: 0.32, t: 0.04, bot: 0.55 },
      { z0: 0.34, z1: 1.32, t: 0.04, bot: 0.55 }, { z0: 1.34, z1: 2.32, t: 0.04, bot: 0.55 },
      { z0: 2.34, z1: 3.3, t: 0.04, bot: 0.55, rear: true },
    ];
    const top = 1.37;
    for (const p of panels) {
      const pts = p.front ? [[p.z0, top], [p.z1, top], [p.z1, p.bot], [p.z0 + 0.42, p.bot], [p.z0 + 0.02, 0.98]]
        : p.rear ? [[p.z0, top], [p.z1, top], [p.z1, 0.82], [p.z1 - 0.3, p.bot], [p.z0, p.bot]]
        : [[p.z0, top], [p.z1, top], [p.z1, p.bot], [p.z0, p.bot]];
      mesh(sideExtrude(pts, p.t, 0.012), M.paint, s * (1.78 + p.t / 2), 0, 0, body);
      const xo = s * (1.78 + p.t + 0.005);
      const n = p.t > 0.05 ? 6 : 4;
      for (let i = 0; i < n; i++) bolts.push(at(BOLT, xo, top - 0.06, p.z0 + 0.1 + (i * (p.z1 - p.z0 - 0.2)) / (n - 1), 0, 0, -s * Math.PI / 2));
      if (p.t > 0.05) {
        for (let i = 0; i < 3; i++) bolts.push(at(BOLT, xo, p.bot + 0.07, p.z0 + 0.5 + i * 0.2 - (p.front ? 0 : 0.35), 0, 0, -s * Math.PI / 2));
        // rubber flap strips hanging under the heavy panels (slightly kinked)
        for (let i = 0; i < 3; i++) {
          const z0 = (p.front ? p.z0 + 0.45 : p.z0) + i * ((p.z1 - p.z0 - (p.front ? 0.45 : 0)) / 3), w = (p.z1 - p.z0 - (p.front ? 0.45 : 0)) / 3 - 0.01;
          rubber.push(at(box(0.025, 0.14, w), s * (1.78 + p.t * 0.5), p.bot - 0.065, z0 + w / 2, 0, 0, s * (0.06 - i * 0.04)));
        }
      } else dark.push(at(box(0.012, 0.02, p.z1 - p.z0 - 0.1), xo - s * 0.004, top - 0.12, (p.z0 + p.z1) / 2)); // stiffening rib
    }
    // rear mud flap behind the sprocket
    rubber.push(at(box(0.62, 0.16, 0.02), xc, 1.0, 3.62));
  }

  // ---- turret (traverses) ----------------------------------------------------------------------------------
  const turret = new THREE.Group(); turret.name = 'turret'; turret.position.set(0, 1.58, 0); body.add(turret);
  const tPaint = [], tDark = [], tSteel = [], tGlass = [], tBolts = [], tFabric = [], tMark = [];
  tDark.push(new THREE.CylinderGeometry(1.28, 1.3, 0.12, 28).translate(0, 0.02, 0));
  // main body: sloped sides and front, roof at 0.8
  const ring = (y, pts) => pts.map(([x, z]) => [x, y, z]);
  tPaint.push(facetLoft([
    ring(0.06, [[-1.5, -1.62], [1.5, -1.62], [1.66, -1.42], [1.66, 1.25], [-1.66, 1.25], [-1.66, -1.42]]),
    ring(0.8, [[-1.4, -1.52], [1.4, -1.52], [1.54, -1.33], [1.54, 1.2], [-1.54, 1.2], [-1.54, -1.33]]),
  ]));
  // undercut rear bustle
  tPaint.push(sideExtrude([[0.9, 0.12], [1.45, 0.34], [2.26, 0.4], [2.31, 0.76], [2.24, 0.8], [0.9, 0.8]], 3.06, 0.02));
  // wedge add-on armour either side of the mantlet: arrowhead in plan, top sloping down to the front
  for (const s of [-1, 1]) {
    const yTop = (z) => 0.8 - ((-1.5 - z) / 1.05) * 0.4;
    const base = [[s * 0.52, -2.55], [s * 1.64, -1.78], [s * 1.64, -1.5], [s * 0.52, -1.5]];
    tPaint.push(facetLoft([base.map(([x, z]) => [x, 0.1, z]), base.map(([x, z]) => [x, yTop(z), z])]));
    // edge bolts along the top
    for (let i = 0; i < 5; i++) { const t = (i + 0.5) / 5, x = s * (0.6 + t * 0.95), z = -2.47 + t * 0.66; tBolts.push(at(BOLT, x, yTop(z) + 0.01, z + 0.06, 0.37)); }
  }
  // roof: plates, gunner's primary sight housing (right front), commander's periscope, cupola, loader's hatch
  tPaint.push(at(box(1.1, 0.03, 0.9), -0.65, 0.815, -0.95), at(box(0.9, 0.03, 0.8), 0.15, 0.815, 1.55));
  tPaint.push(facetLoft([ring(0.79, [[0.7, -1.52], [1.24, -1.52], [1.24, -0.9], [0.7, -0.9]]), ring(1.1, [[0.74, -1.3], [1.2, -1.3], [1.2, -0.95], [0.74, -0.95]])]));
  const slope = Math.atan2(0.22, 0.31);
  tGlass.push(at(box(0.36, 0.2, 0.02), 0.97, 0.955, -1.405, -slope));
  tPaint.push(at(box(0.5, 0.03, 0.14), 0.97, 1.12, -1.33, 0.25));                                  // armoured hood
  tPaint.push(new THREE.CylinderGeometry(0.17, 0.19, 0.17, 14).translate(0.38, 0.88, -0.55));          // PERI base
  tPaint.push(at(box(0.3, 0.25, 0.34), 0.38, 1.09, -0.55), at(box(0.34, 0.035, 0.4), 0.38, 1.235, -0.57));
  tGlass.push(at(box(0.22, 0.11, 0.02), 0.38, 1.08, -0.725));
  // commander's cupola with vision blocks + hatch, MG pintle
  tPaint.push(new THREE.CylinderGeometry(0.46, 0.49, 0.15, 18).translate(0.75, 0.875, 0.3));
  tPaint.push(new THREE.CylinderGeometry(0.37, 0.37, 0.05, 16).translate(0.75, 0.975, 0.3));
  for (let k = 0; k < 7; k++) { const a = -Math.PI / 2 + (k - 3) * 0.55; tGlass.push(at(box(0.12, 0.06, 0.03), 0.75 + Math.cos(a) * 0.475, 0.89, 0.3 + Math.sin(a) * 0.475, 0, -a + Math.PI / 2, 0)); }
  tSteel.push(at(box(0.2, 0.03, 0.03), 0.75, 1.02, 0.42), new THREE.CylinderGeometry(0.03, 0.035, 0.24, 8).translate(0.75, 1.1, 0.3));
  // loader's hatch (left) + periscope, ventilator, lifting eyes, wind sensor mast
  tPaint.push(new THREE.CylinderGeometry(0.4, 0.42, 0.05, 16).translate(-0.72, 0.83, 0.25), new THREE.CylinderGeometry(0.35, 0.35, 0.05, 16).translate(-0.72, 0.875, 0.25));
  tSteel.push(at(box(0.22, 0.03, 0.03), -0.72, 0.915, 0.4), at(new THREE.CylinderGeometry(0.035, 0.035, 0.4, 8).rotateZ(Math.PI / 2), -0.72, 0.87, -0.12));
  tPaint.push(at(box(0.2, 0.07, 0.14), -0.72, 0.85, -0.3)); tGlass.push(at(box(0.16, 0.045, 0.02), -0.72, 0.85, -0.375));
  tPaint.push(new THREE.SphereGeometry(0.13, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.15, 0.8, 0.85));
  for (const [x, z] of [[-1.3, -1.0], [1.3, -0.6], [-1.32, 1.05], [1.32, 1.05]]) tSteel.push(at(EYE, x, 0.84, z, 0, Math.PI / 2, 0));
  tDark.push(new THREE.CylinderGeometry(0.015, 0.02, 0.5, 6).translate(0, 1.05, 1.95), at(box(0.3, 0.03, 0.05), 0, 1.3, 1.95), new THREE.SphereGeometry(0.05, 8, 6).translate(0.15, 1.33, 1.95));
  // antennas at the rear corners
  for (const s of [-1, 1]) {
    tDark.push(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8).translate(s * 1.18, 0.85, 1.9));
    tDark.push(at(new THREE.CylinderGeometry(0.005, 0.01, 2.4, 4).translate(0, 1.2, 0), s * 1.18, 0.9, 1.9, 0.1));
  }
  // smoke grenade dischargers: two banks of four per side, angled up / out / slightly forward
  for (const s of [-1, 1]) for (const zc of [-0.85, -0.3]) {
    tPaint.push(at(box(0.08, 0.1, 0.5), s * 1.6, 0.62, zc));
    for (let k = 0; k < 4; k++) {
      const z = zc - 0.165 + k * 0.11, dir = new THREE.Vector3(s * 0.45, 0.55, -0.7).normalize(), p = new THREE.Vector3(s * 1.64, 0.64, z);
      const mid = p.clone().addScaledVector(dir, 0.13), end = p.clone().addScaledVector(dir, 0.27);
      tDark.push(along(new THREE.CylinderGeometry(0.042, 0.042, 0.27, 8, 1, true), mid.toArray(), dir.toArray()));
      tFabric.push(along(new THREE.CircleGeometry(0.042, 8).rotateX(-Math.PI / 2), end.toArray(), dir.toArray()));
    }
  }
  // side stowage bins on the bustle (team chevron on each) + rear stowage basket with tarp roll, bags, jerrycans
  for (const s of [-1, 1]) {
    tPaint.push(at(box(0.27, 0.46, 1.25), s * 1.665, 0.53, 1.6), at(box(0.29, 0.03, 1.27), s * 1.67, 0.73, 1.6));
    tSteel.push(at(box(0.02, 0.06, 0.05), s * 1.805, 0.66, 1.25), at(box(0.02, 0.06, 0.05), s * 1.805, 0.66, 1.95));
    const ch = new THREE.Shape([new THREE.Vector2(-0.2, -0.06), new THREE.Vector2(0, 0.12), new THREE.Vector2(0.2, -0.06), new THREE.Vector2(0.2, -0.15), new THREE.Vector2(0, 0.03), new THREE.Vector2(-0.2, -0.15)]);
    tMark.push(new THREE.ShapeGeometry(ch).rotateY(s * Math.PI / 2).translate(s * 1.802, 0.48, 1.6));
  }
  const bx = 1.38, bz0 = 2.3, bz1 = 2.82, by0 = 0.3, by1 = 0.74, rod = (w, h, d, x, y, z) => tDark.push(at(box(w, h, d), x, y, z));
  for (const y of [by0, by1]) { rod(2 * bx, 0.03, 0.03, 0, y, bz1); rod(0.03, 0.03, bz1 - bz0, -bx, y, (bz0 + bz1) / 2); rod(0.03, 0.03, bz1 - bz0, bx, y, (bz0 + bz1) / 2); }
  for (let i = 0; i <= 6; i++) rod(0.025, by1 - by0, 0.025, -bx + (i * 2 * bx) / 6, (by0 + by1) / 2, bz1);
  for (const x of [-bx, bx]) rod(0.025, by1 - by0, 0.025, x, (by0 + by1) / 2, (bz0 + bz1) / 2);
  rod(2 * bx, 0.02, bz1 - bz0, 0, by0, (bz0 + bz1) / 2);
  tFabric.push(new THREE.CylinderGeometry(0.15, 0.15, 1.3, 10).rotateZ(Math.PI / 2).translate(-0.5, by0 + 0.16, 2.56));
  tFabric.push(at(box(0.5, 0.3, 0.38), 0.45, by0 + 0.16, 2.56, 0, 0.08, 0.03), at(box(0.42, 0.22, 0.34), 0.25, by0 + 0.4, 2.58, 0.05, -0.12, 0));
  tFabric.push(new THREE.CylinderGeometry(0.13, 0.13, 0.36, 8).rotateX(Math.PI / 2).translate(-0.05, by0 + 0.14, 2.56));
  for (const x of [1.0, 1.2]) tPaint.push(at(box(0.16, 0.34, 0.24), x, by0 + 0.18, 2.56));
  for (const g of tPaint) mesh(g, M.paint, 0, 0, 0, turret);
  group(tDark, M.dark, turret); group(tSteel, M.steel, turret); group(tGlass, M.glass, turret); group(tFabric, M.fabric, turret);
  group(tBolts, M.paint, turret); group(tMark, M.mark, turret);

  // ---- roof MG (aims with the roof gunner; pivot on the cupola pintle)
  const mg = new THREE.Group(); mg.name = 'mg'; mg.position.set(0.75, 1.3, 0.3); turret.add(mg);
  group([
    box(0.1, 0.13, 0.56).translate(0, 0, -0.05), box(0.09, 0.03, 0.26).translate(0, 0.075, -0.12),
    new THREE.CylinderGeometry(0.03, 0.03, 0.5, 10).rotateX(Math.PI / 2).translate(0, 0.015, -0.57),
    new THREE.CylinderGeometry(0.014, 0.014, 0.42, 6).rotateX(Math.PI / 2).translate(0, 0.015, -1.0),
    new THREE.CylinderGeometry(0.022, 0.022, 0.07, 8).rotateX(Math.PI / 2).translate(0, 0.015, -1.21),
    box(0.03, 0.12, 0.03).translate(-0.04, -0.06, 0.25), box(0.03, 0.12, 0.03).translate(0.04, -0.06, 0.25),
    box(0.05, 0.1, 0.18).translate(0, -0.11, 0), box(0.012, 0.09, 0.012).translate(0, -0.05, -0.75),
  ], M.dark, mg);
  mesh(box(0.13, 0.15, 0.24), M.paint, -0.13, -0.05, -0.02, mg);  // ammo box
  const mgMuzzle = new THREE.Object3D(); mgMuzzle.position.set(0, 0.02, -1.25); mg.add(mgMuzzle);

  // ---- 120 mm gun: mantlet / gun shield, barrel with thermal sleeve bands + bore evacuator, muzzle reference sensor
  const gun = new THREE.Group(); gun.name = 'gun'; gun.position.set(0, 0.4, -1.9); turret.add(gun);
  const rect = (z, w, b, t) => [[-w, b, z], [w, b, z], [w, t, z], [-w, t, z]];
  mesh(facetLoft([rect(0.28, 0.46, -0.34, 0.32), rect(-0.4, 0.46, -0.34, 0.32), rect(-0.5, 0.41, -0.3, 0.25)]), M.paint, 0, 0, 0, gun);
  const barrel = new THREE.LatheGeometry([
    [0.21, -0.05], [0.21, 0.08], [0.185, 0.14], [0.165, 0.16], [0.165, 1.1], [0.178, 1.11], [0.178, 1.17], [0.162, 1.18],
    [0.16, 2.12], [0.196, 2.26], [0.199, 2.72], [0.158, 2.86], [0.155, 3.74], [0.168, 3.75], [0.168, 3.81], [0.152, 3.82], [0.148, 4.56], [0.136, 4.57],
  ].map(([r, h]) => new THREE.Vector2(r, h)), 14).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  mesh(barrel, M.paint, 0, 0, 0, gun);
  mesh(new THREE.LatheGeometry([[0.136, 4.55], [0.136, 4.8], [0.07, 4.8], [0.06, 4.6]].map(([r, h]) => new THREE.Vector2(r, h)), 14).rotateX(-Math.PI / 2).translate(0, 0, -0.5), M.dark, 0, 0, 0, gun);
  group([box(0.07, 0.06, 0.13).translate(0, 0.175, -4.98), box(0.03, 0.03, 0.05).translate(0, 0.14, -4.98), box(0.14, 0.08, 0.12).translate(0, 0.36, -0.36),
    new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8).rotateX(Math.PI / 2).translate(-0.28, -0.05, -0.53)], M.dark, gun);
  group([0, 1, 2, 3].map((k) => at(BOLT, -0.36 + k * 0.24, 0.27, -0.47, -0.6)).concat([-0.36, 0.36].map((x) => at(BOLT, x, -0.2, -0.505, Math.PI / 2))), M.paint, gun);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, -5.3); gun.add(muzzle);

  // ---- merge the hull detail batches
  group(bolts, M.paint, body); group(paintBits, M.paint, body); group(steel, M.steel, body); group(dark, M.dark, body);
  // animated running gear: kept as their own meshes (named, so finishVehicle doesn't merge them away)
  const tracks = mesh(merged(trackGeos), M.track, 0, 0, 0, body); tracks.name = 'tracks';
  const spinB = mesh(merged(spinBolts), M.paint, 0, 0, 0, body); spinB.name = 'wheelBolts';
  const spinG = mesh(merged(spinGear), M.dark, 0, 0, 0, body); spinG.name = 'sprockets';
  for (const parts of [spinBoltParts, spinGearParts]) { let o = 0; for (const pt of parts) { pt.start = o; o += pt.count; } }
  const runGear = runningGear(tracks, linkRest, path, [{ mesh: spinB, parts: spinBoltParts }, { mesh: spinG, parts: spinGearParts }]);
  group(glass, M.glass, body); group(rubber, M.rubber, body); group(lens, M.lens, body);
  const tl = mesh(merged(red), M.lightRed, 0, 0, 0, body); tl.castShadow = false;

  root.userData = { type: 'tank', body, turret, gun, muzzle, mgMuzzle, mg, runGear, trackHalf: 1.47 };
  projectUV(root, new Set([M.paint, M.mark]), TILE);
  return finishVehicle(root);
}
