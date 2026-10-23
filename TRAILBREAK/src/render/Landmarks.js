// Buildings and props (Ashwood's ranger station, garage, flagpole, fire tower, the old mine, the summit lookout, the
// radio mast, cabins; the open world's fort at Korlai and wind turbines on Chalkewadi; Kerala's in
// render/KeralaBuildings.js) and the survey beacons with their light beams.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KERALA_BUILD } from './KeralaBuildings.js';
import { FORT, fortPlan } from '../world/Fort.js';

const mat = {
  log: new THREE.MeshStandardMaterial({ color: 0x7a5636, roughness: 0.9 }),
  logDark: new THREE.MeshStandardMaterial({ color: 0x4f3826, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x3d5a45, roughness: 0.6, metalness: 0.3 }),
  tin: new THREE.MeshStandardMaterial({ color: 0x8e9396, roughness: 0.5, metalness: 0.6 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x8a857c, roughness: 0.95, flatShading: true }),
  glass: new THREE.MeshStandardMaterial({ color: 0x223038, roughness: 0.1, metalness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x141312, roughness: 1 }),
  white: new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.7 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa8321e, roughness: 0.6 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x6b6d6e, roughness: 0.6, metalness: 0.5 }),
  // the fort's dark basalt and laterite, weathered; a turbine's white glass-fibre and steel
  fort: new THREE.MeshStandardMaterial({ color: 0x8c7f6d, roughness: 0.97 }),
  fortTop: new THREE.MeshStandardMaterial({ color: 0x766b5d, roughness: 0.97 }),
  turbine: new THREE.MeshStandardMaterial({ color: 0xe8ebe9, roughness: 0.45, metalness: 0.1 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0xa29e94, roughness: 0.95 }),
};
// (the way the monsoon wind blows onto Chalkewadi, from the west-south-west: every turbine's rotor faces into it)
const WIND_YAW = 1.95;

class Builder {
  constructor() { this.parts = new Map(); }
  put(m, g, x, y, z, ry = 0, rx = 0, rz = 0) {
    g.rotateX(rx); g.rotateZ(rz); g.rotateY(ry); g.translate(x, y, z);
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m).push(n);
  }
  box(m, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) { this.put(m, new THREE.BoxGeometry(w, h, d), x, y, z, ry, rx, rz); }
  cyl(m, r0, r1, h, x, y, z, seg = 8, rx = 0, rz = 0, ry = 0) { this.put(m, new THREE.CylinderGeometry(r0, r1, h, seg), x, y, z, ry, rx, rz); }
  build(L) {
    const g = new THREE.Group();
    for (const [m, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), m);
      mesh.castShadow = true; mesh.receiveShadow = true;
      g.add(mesh);
    }
    g.position.set(L.x, L.y, L.z);
    g.rotation.y = L.yaw || 0;
    return g;
  }
}

/** The ground under a point (a world's own ground: terrain without its ruts), for buildings that stand on it all along. */
const groundOf = (world, x, z) => (world.terrain ? world.terrain(x, z) : world.height(x, z));

function logWalls(B, w, d, h, logR = 0.16) {
  const n = Math.round(h / (logR * 1.9));
  for (let i = 0; i < n; i++) {
    const y = logR + i * logR * 1.9;
    B.cyl(i % 2 ? mat.log : mat.logDark, logR, logR, w + 0.5, 0, y, -d / 2, 7, 0, Math.PI / 2);
    B.cyl(i % 2 ? mat.log : mat.logDark, logR, logR, w + 0.5, 0, y, d / 2, 7, 0, Math.PI / 2);
    B.cyl(i % 2 ? mat.logDark : mat.log, logR, logR, d + 0.5, -w / 2, y + logR * 0.95, 0, 7, Math.PI / 2);
    B.cyl(i % 2 ? mat.logDark : mat.log, logR, logR, d + 0.5, w / 2, y + logR * 0.95, 0, 7, Math.PI / 2);
  }
  return n * logR * 1.9 + logR;
}

function gableRoof(B, w, d, y, rise, m = mat.roof, over = 0.6) {
  const half = w / 2 + over, slope = Math.hypot(half, rise), ang = Math.atan2(rise, half);
  B.box(m, slope, 0.12, d + over * 2, -half / 2, y + rise / 2, 0, 0, 0, ang);
  B.box(m, slope, 0.12, d + over * 2, half / 2, y + rise / 2, 0, 0, 0, -ang);
  // gable ends
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rise)]);
  for (const z of [-d / 2, d / 2]) {
    const g = new THREE.ExtrudeGeometry(tri, { depth: 0.2, bevelEnabled: false });
    g.translate(0, 0, -0.1);
    B.put(mat.logDark, g, 0, y, z);
  }
}

function signTexture(text, w = 1024, h = 192) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.fillStyle = '#4b3423'; x.fillRect(0, 0, w, h);
  x.strokeStyle = '#d9c9a3'; x.lineWidth = 10; x.strokeRect(12, 12, w - 24, h - 24);
  x.fillStyle = '#efe2c2'; x.font = 'bold 74px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, w / 2, h / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const BUILD = {
  station(L) {
    const B = new Builder();
    const top = logWalls(B, 10, 8, 3.2);
    gableRoof(B, 10, 8, top, 2.2);
    B.box(mat.logDark, 10.6, 0.15, 3, 0, 0.35, 5.4);                       // porch deck
    for (const x of [-4.8, -1.6, 1.6, 4.8]) B.cyl(mat.log, 0.12, 0.12, 2.8, x, 1.75, 6.7, 6);
    B.box(mat.roof, 11, 0.1, 3.4, 0, 3.2, 5.5, 0, 0.12);
    B.box(mat.dark, 1.1, 2.1, 0.1, 0, 1.2, 4.06);
    for (const x of [-3, 3]) { B.box(mat.glass, 1.3, 1.0, 0.1, x, 1.8, 4.07); B.box(mat.white, 1.45, 0.1, 0.14, x, 1.25, 4.1); }
    for (const z of [-2, 2]) B.box(mat.glass, 0.1, 1.0, 1.3, 5.07, 1.8, z);
    B.box(mat.stone, 1.0, 6.6, 1.0, -4.0, 3.3, -2.0);
    const g = B.build(L);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 0.98), new THREE.MeshStandardMaterial({ map: signTexture((L.sign || 'Ashwood Ranger Station').toUpperCase()), roughness: 0.8 }));
    sign.position.set(0, top + 0.75, 4.2);
    g.add(sign);
    return g;
  },
  garage(L) {
    const B = new Builder();
    B.box(mat.tin, 7, 3.4, 0.1, 0, 1.7, -3);
    B.box(mat.tin, 0.1, 3.4, 6, 3.5, 1.7, 0); B.box(mat.tin, 0.1, 3.4, 6, -3.5, 1.7, 0);
    B.box(mat.tin, 1.2, 3.4, 0.1, 2.9, 1.7, 3); B.box(mat.tin, 1.2, 3.4, 0.1, -2.9, 1.7, 3);
    B.box(mat.tin, 7, 0.6, 0.1, 0, 3.1, 3);
    gableRoof(B, 7, 6, 3.4, 1.0, mat.red, 0.3);
    B.box(mat.dark, 4.6, 2.8, 0.05, 0, 1.4, 2.6);
    return B.build(L);
  },
  flag(L) {
    const B = new Builder();
    B.cyl(mat.white, 0.05, 0.08, 9, 0, 4.5, 0, 8);
    B.box(mat.stone, 1.2, 0.4, 1.2, 0, 0.2, 0);
    const g = B.build(L);
    const flagGeo = new THREE.PlaneGeometry(2.2, 1.3, 12, 4);
    flagGeo.translate(1.1, 0, 0);
    const c = document.createElement('canvas'); c.width = 128; c.height = 76;
    const x = c.getContext('2d');
    x.fillStyle = '#2f5a3a'; x.fillRect(0, 0, 128, 76); x.fillStyle = '#e8893a'; x.beginPath(); x.moveTo(20, 60); x.lineTo(50, 18); x.lineTo(64, 38); x.lineTo(76, 26); x.lineTo(108, 60); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide, roughness: 0.9 }));
    flag.position.set(0.06, 8.2, 0);
    flag.castShadow = true;
    g.add(flag);
    g.userData.flag = flag;
    g.userData.flagBase = flagGeo.attributes.position.array.slice();
    return g;
  },
  firetower(L) {
    const B = new Builder();
    const H = 14;
    for (const [x, z] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) {
      const tilt = 0.06;
      B.cyl(mat.logDark, 0.12, 0.16, H + 0.3, x * 0.86, H / 2, z * 0.86, 6, z > 0 ? -tilt : tilt, x > 0 ? tilt : -tilt);
    }
    for (let y = 2.5; y < H; y += 3) {
      const s = 2 - (y / H) * 0.28;
      for (const [w, d, x, z] of [[s * 2, 0.1, 0, -s], [s * 2, 0.1, 0, s], [0.1, s * 2, -s, 0], [0.1, s * 2, s, 0]]) B.box(mat.log, w, 0.12, d, x, y, z);
    }
    for (let i = 0; i < 4; i++) B.box(mat.log, 0.6, 0.08, 3.4, 0.9 - (i % 2) * 1.8, 1.8 + i * 3.1, 0.2, 0, i % 2 ? 0.85 : -0.85);
    B.box(mat.logDark, 4.2, 0.2, 4.2, 0, H, 0);
    B.box(mat.white, 3.4, 1.0, 3.4, 0, H + 0.6, 0);
    B.box(mat.glass, 3.42, 0.9, 3.42, 0, H + 1.55, 0);
    B.put(mat.red, new THREE.ConeGeometry(3.1, 1.4, 4), 0, H + 2.7, 0, Math.PI / 4);
    return B.build(L);
  },
  mine(L) {
    const B = new Builder();
    B.box(mat.dark, 3.2, 3.0, 2.5, 0, 1.4, 1.2);
    for (const x of [-1.8, 1.8]) B.box(mat.logDark, 0.4, 3.6, 0.4, x, 1.8, 0);
    B.box(mat.logDark, 4.4, 0.45, 0.5, 0, 3.7, 0);
    B.box(mat.stone, 9, 4.5, 3, 0, 1.6, 2.2);
    for (const x of [-0.5, 0.5]) B.box(mat.steel, 0.08, 0.08, 9, x, 0.05, -4.2);
    for (let z = -8; z <= 0; z += 0.8) B.box(mat.logDark, 1.4, 0.06, 0.2, 0, 0.02, z);
    B.box(mat.steel, 1.3, 0.8, 1.7, 0, 0.75, -4.5);
    for (const [x, z] of [[-0.5, -5.1], [0.5, -5.1], [-0.5, -3.9], [0.5, -3.9]]) B.cyl(mat.dark, 0.18, 0.18, 0.1, x, 0.25, z, 8, 0, Math.PI / 2);
    B.put(mat.stone, new THREE.ConeGeometry(4, 2.2, 7), -6, 1.0, -3);
    return B.build(L);
  },
  lookout(L) {
    const B = new Builder();
    B.box(mat.stone, 4, 2.6, 4, 0, 1.3, 0);
    B.box(mat.logDark, 4.6, 0.25, 4.6, 0, 2.7, 0);
    B.box(mat.dark, 0.9, 1.8, 0.1, 0, 0.9, 2.03);
    for (let i = 0; i < 5; i++) B.put(mat.stone, new THREE.DodecahedronGeometry(0.5 - i * 0.07), 5, 0.4 + i * 0.6, 3, i);
    return B.build(L);
  },
  // a lighthouse on the point: a tapering tower in white and red bands, its gallery and lantern room, the keeper's
  // house at its foot; the lamp glows (it shines at night)
  lighthouse(L) {
    const B = new Builder();
    const H = 24, bands = 6, r0 = 3.1, r1 = 2.0;
    for (let k = 0; k < bands; k++) {
      const a = r0 + (r1 - r0) * k / bands, b = r0 + (r1 - r0) * (k + 1) / bands;
      B.cyl(k % 2 ? mat.red : mat.white, b, a, H / bands, 0, H / bands * (k + 0.5), 0, 20);
    }
    B.cyl(mat.dark, 2.7, 2.7, 0.3, 0, H + 0.15, 0, 20);                       // the gallery
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; B.box(mat.dark, 0.06, 1.0, 0.06, Math.cos(a) * 2.6, H + 0.8, Math.sin(a) * 2.6); }
    B.cyl(mat.dark, 2.62, 2.62, 0.06, 0, H + 1.28, 0, 20);                   // its rail
    B.cyl(mat.glass, 1.45, 1.45, 2.2, 0, H + 1.4, 0, 12);                     // the lantern room
    B.cyl(mat.red, 0.25, 1.75, 1.3, 0, H + 3.15, 0, 12);                      // its roof
    B.cyl(mat.dark, 0.06, 0.06, 1.2, 0, H + 4.3, 0, 4);                       // the vane's rod
    B.box(mat.white, 6.5, 3.2, 5, 6.8, 1.6, 0);                               // the keeper's house
    B.box(mat.red, 7.1, 0.25, 5.6, 6.8, 3.3, 0);
    B.box(mat.dark, 1.0, 2.0, 0.1, 6.8, 1.0, 2.53);
    const g = B.build(L);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff2c0, emissive: 0xffe8a0, emissiveIntensity: 2.5 }));
    lamp.position.set(0, H + 1.4, 0);
    g.add(lamp);
    return g;
  },
  mast(L) {
    const B = new Builder();
    const H = 26;
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [0, 0.7]]) B.cyl(mat.steel, 0.05, 0.08, H, x * 0.5, H / 2, z * 0.5, 5, z * 0.02, -x * 0.02);
    for (let y = 1; y < H; y += 1.6) B.cyl(mat.steel, 0.025, 0.025, 1.1, 0, y, 0, 4, 0, Math.PI / 2 + (y % 3.2 > 1.6 ? 0.6 : -0.6));
    B.box(mat.white, 2, 1.6, 1.6, 2.5, 0.8, 0);
    const g = B.build(L);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3 }));
    lamp.position.set(0, H + 0.3, 0);
    g.add(lamp);
    return g;
  },
  // Korlai's fort along its ridge: curtain walls with merlons standing on the ground under them all the way (the
  // ridge's crest rises and falls), round bastions, gateways at both ends with the road through them, the gable of
  // its ruined church inside
  fort(L, world) {
    const B = new Builder(), { walls, towers, church } = fortPlan(L.len), { wall: T, height: HT, tower: TR } = FORT;
    const c = Math.cos(L.yaw || 0), s = Math.sin(L.yaw || 0);
    const g = (x, z) => groundOf(world, L.x + x * c + z * s, L.z - x * s + z * c) - L.y;
    for (const [x0, z0, x1, z1] of walls) {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 4)), along = z0 === z1;
      // (out of the fort: the side its merlons stand on)
      const ox = along ? 0 : Math.sign(x0), oz = along ? Math.sign(z0) : 0;
      for (let k = 0; k < n; k++) {
        const xa = x0 + (x1 - x0) * k / n, za = z0 + (z1 - z0) * k / n, xb = x0 + (x1 - x0) * (k + 1) / n, zb = z0 + (z1 - z0) * (k + 1) / n;
        const ga = g(xa, za), gb = g(xb, zb), foot = Math.min(ga, gb) - 1.5, top = (ga + gb) / 2 + HT, l = len / n + 0.25;
        B.box(mat.fort, along ? l : T, top - foot, along ? T : l, (xa + xb) / 2, (foot + top) / 2, (za + zb) / 2);
        B.box(mat.fortTop, along ? l : T + 0.2, 0.25, along ? T + 0.2 : l, (xa + xb) / 2, top - 0.2, (za + zb) / 2);
        for (let m = 0; m < 2; m++) {
          const f = (m + 0.25) / 2, mx = xa + (xb - xa) * f, mz = za + (zb - za) * f;
          B.box(mat.fort, along ? 1.0 : T * 0.45, 0.95, along ? T * 0.45 : 1.0, mx + ox * T * 0.27, top + 0.45, mz + oz * T * 0.27);
        }
      }
    }
    for (const [x, z] of towers) {
      const g0 = g(x, z), foot = g0 - 2, top = g0 + HT + 1.2;
      B.cyl(mat.fort, TR, TR + 0.35, top - foot, x, (foot + top) / 2, z, 14);
      B.cyl(mat.fortTop, TR + 0.15, TR + 0.15, 0.3, x, top - 0.1, z, 14);
      for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2; B.box(mat.fort, 1.1, 0.95, 0.7, x + Math.cos(a) * (TR - 0.3), top + 0.45, z + Math.sin(a) * (TR - 0.3), -a + Math.PI / 2); }
    }
    // the gateways: a lintel over each, and its jambs
    for (const sx of [-1, 1]) {
      const x = sx * L.len / 2, g0 = g(x, 0);
      B.box(mat.fortTop, T + 0.6, 1.8, FORT.gate * 2 + 1.6, x, g0 + 5.4, 0);
      for (const sz of [-1, 1]) B.box(mat.fortTop, T + 0.6, HT + 1, 1.0, x, g0 + (HT + 1) / 2 - 0.5, sz * (FORT.gate + 0.3));
    }
    // the church's gable: a wall with a pointed top, a dark doorway and a window, open sky behind
    const [cx, cz, cw] = church, gc = g(cx, cz), ch = 8;
    B.box(mat.fort, cw, ch, 0.9, cx, gc + ch / 2 - 0.8, cz);
    const shape = new THREE.Shape([new THREE.Vector2(-cw / 2, 0), new THREE.Vector2(cw / 2, 0), new THREE.Vector2(0, 3.6)]);
    const gable = new THREE.ExtrudeGeometry(shape, { depth: 0.9, bevelEnabled: false });
    gable.translate(0, 0, -0.45);
    B.put(mat.fort, gable, cx, gc + ch - 0.8, cz);
    B.box(mat.dark, 2.0, 3.6, 0.95, cx, gc + 1.0, cz);
    B.box(mat.dark, 1.0, 1.6, 0.95, cx, gc + 5.6, cz);
    return B.build(L);
  },
  // a wind turbine: a tapering white tower on its concrete plinth, the nacelle, and its three blades on a hub that
  // turns (render/Landmarks.js update); all of them facing into the wind, a red light on top for aircraft
  turbine(L) {
    const B = new Builder(), H = 62, BL = 31;
    B.cyl(mat.concrete, 3.4, 3.6, 1.2, 0, 0.2, 0, 16);
    B.cyl(mat.turbine, 1.25, 2.1, H, 0, H / 2, 0, 16);
    B.box(mat.turbine, 3.0, 3.3, 9.5, 0, H + 1.5, 1.2);
    B.cyl(mat.turbine, 1.4, 1.6, 1.2, 0, H + 1.5, -3.8, 12, Math.PI / 2);
    const g = B.build({ ...L, yaw: WIND_YAW });
    const R = new Builder();
    R.put(mat.turbine, new THREE.SphereGeometry(1.5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0, 0, -Math.PI / 2);
    for (let k = 0; k < 3; k++) {
      const blade = new THREE.CylinderGeometry(0.16, 0.95, BL, 6);
      blade.scale(1, 1, 0.32);
      blade.rotateY(0.25);                                                   // (its pitch)
      blade.translate(0, BL / 2 + 1.2, 0);
      R.put(mat.turbine, blade, 0, 0, 0, 0, 0, k * Math.PI * 2 / 3);
    }
    const rotor = R.build({ x: 0, y: H + 1.5, z: -4.6, yaw: 0 });
    // (each turning at its own pace, from its own place in the row)
    rotor.rotation.z = (L.x * 0.37 + L.z * 0.11) % (Math.PI * 2);
    rotor.userData.spin = 1.25 + 0.3 * Math.abs(Math.sin(L.x * 12.9898 + L.z * 78.233));
    g.add(rotor);
    g.userData.rotor = rotor;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 3 }));
    lamp.position.set(0, H + 3.4, 4.5);
    g.add(lamp);
    return g;
  },
  cabin(L) {
    const B = new Builder();
    const top = logWalls(B, 6, 5, 2.6, 0.15);
    gableRoof(B, 6, 5, top, 1.6, mat.tin, 0.4);
    B.box(mat.dark, 0.9, 1.9, 0.1, 0, 1.0, 2.56);
    B.box(mat.glass, 0.1, 0.8, 1.0, 3.06, 1.5, 0);
    B.box(mat.stone, 0.8, 4.6, 0.8, -2.4, 2.3, -1.6);
    return B.build(L);
  },
};

export class Landmarks {
  constructor(world, scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.flags = []; this.rotors = [];
    for (const L0 of world.landmarks) {
      const L = L0.type === 'station' && !L0.sign ? { ...L0, sign: world.map.station.name } : L0;
      // (Kerala's style of a building where it has one, or a building only Kerala has)
      const kerala = KERALA_BUILD[L.type] && (L.style === 'kerala' || !BUILD[L.type]);
      const b = kerala ? KERALA_BUILD[L.type](new Builder(), L) : BUILD[L.type]?.(L, world);
      if (!b) continue;
      this.group.add(b);
      if (b.userData.flag) this.flags.push(b.userData);
      if (b.userData.rotor) this.rotors.push(b.userData.rotor);
    }
    // survey beacons: a striped post on a tripod, a lamp, and a tall soft beam to find it by
    this.beacons = new Map();
    const beamGeo = new THREE.CylinderGeometry(0.7, 1.6, 160, 12, 1, true);
    beamGeo.translate(0, 80, 0);
    const beamMat = (color) => {
      const m = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 } },
        vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying float vY;
varying vec3 vN;
varying vec3 vView;
void main() {
  vY = position.y; vN = normalMatrix * normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`,
        // a soft column of light: brightest looking through its middle, fading to nothing at its edges (a tube of even
        // light seen up close was a slab with hard sides, filling the view), and gone as you come up to the beacon
        fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor; uniform float uFade; varying float vY; varying vec3 vN; varying vec3 vView;
void main() {
#include <logdepthbuf_fragment>
  float facing = abs(dot(normalize(vN), normalize(-vView)));
  float a = (1.0 - smoothstep(0.0, 160.0, vY)) * 0.3 * uFade * facing * facing * smoothstep(8.0, 40.0, length(vView));
  gl_FragColor = vec4(uColor * a, a);
}`,
      });
      return m;
    };
    for (const b of world.beacons) {
      const B = new Builder();
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2;
        B.cyl(mat.logDark, 0.04, 0.05, 2.2, Math.cos(a) * 0.45, 1.0, Math.sin(a) * 0.45, 5, Math.sin(a) * 0.22, -Math.cos(a) * 0.22);
      }
      for (let i = 0; i < 4; i++) B.cyl(i % 2 ? mat.white : mat.red, 0.06, 0.06, 0.45, 0, 2.2 + i * 0.45, 0, 8);
      const g = B.build({ x: b.x, y: b.y, z: b.z, yaw: 0 });
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffb35c, emissive: 0xff8a2a, emissiveIntensity: 2.5 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), lampMat);
      lamp.position.set(0, 4.15, 0);
      const beam = new THREE.Mesh(beamGeo, beamMat(0xffa040));
      beam.frustumCulled = false;
      g.add(lamp, beam);
      this.group.add(g);
      this.beacons.set(b.id, { group: g, lampMat, beam, found: false });
    }
    this.t = 0;
  }

  setFound(id, found) {
    const b = this.beacons.get(id);
    if (!b || b.found === found) return;
    b.found = found;
    b.lampMat.color.set(found ? 0x8ce07a : 0xffb35c);
    b.lampMat.emissive.set(found ? 0x3fbf3a : 0xff8a2a);
    b.beam.material.uniforms.uColor.value.set(found ? 0x5fd06a : 0xffa040);
    b.beam.material.uniforms.uFade.value = found ? 0.35 : 1;
  }

  update(camera, dt) {
    this.t += dt;
    for (const r of this.rotors) r.rotation.z += r.userData.spin * dt;
    for (const f of this.flags) {
      const p = f.flag.geometry.attributes.position, base = f.flagBase;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3], y = base[i * 3 + 1];
        p.array[i * 3 + 2] = Math.sin(x * 2.4 - this.t * 5) * 0.12 * x + Math.sin(y * 3 + this.t * 3) * 0.03 * x;
      }
      p.needsUpdate = true;
    }
    for (const b of this.beacons.values()) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
      b.lampMat.emissiveIntensity = b.found ? 1.2 : 1.8 + 2.2 * pulse;
    }
  }
}

export async function preview(world, r) { return new Landmarks(world, r.scene); }
