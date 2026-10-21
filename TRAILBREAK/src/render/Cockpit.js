// The cockpit of a car whose model came without a finished one (TruckModel builds it into the body): a dashboard under
// the windscreen with the instruments in a hood in front of the driver (their faces drawn live: Gauges), the centre
// stack and console with the gear lever, door cards, bucket seats (a bench behind them in a 2+2 or a saloon), the roof
// lined, the windscreen pillars trimmed, a rear-view mirror, sun visors and carpet. Everything in the design frame (+x
// left, +y up, +z forward), fitted to what tools/cars measured of the car (layout.interior: the windscreen's foot and
// top, the side windows' sill, how far in the doors are) and to where the driver sits (spec.eye) and the wheel is.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const mats = new Map();
const FILL = 0.9;                          // the cockpit's fill light: how far it lights itself, in its own colour
/** A cockpit material by colour and finish (shared between cars). */
function mat(hex, rough = 0.8, metal = 0, extra = {}) {
  const key = `${hex}|${rough}|${metal}|${JSON.stringify(extra)}`;
  if (!mats.has(key)) {
    // (nothing in a cockpit is blacker than black leather: 3% of the light back, at the least)
    const c = new THREE.Color(hex), l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    if (l < 0.028 && !metal) c.multiplyScalar(0.028 / Math.max(l, 1e-3));
    // and lit a little from within: the light that comes in through the windows and off everything (the sky's light
    // from outside, under the roof, leaves black trim black against a bright road: a camera set for the road)
    mats.set(key, new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal, emissive: c.clone().multiplyScalar(metal ? 0.3 : 1), emissiveIntensity: FILL, ...extra }));
  }
  return mats.get(key);
}

/** A closed side profile [[z, y], ...] drawn across the car from x0 to x1: a dash, a console. */
function profile(points, x0, x1, bevel = 0.008) {
  const s = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y)));
  const depth = Math.max(0.01, x1 - x0 - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  // (shape x is -z, the extrusion runs along x)
  g.rotateY(Math.PI / 2);
  g.translate(x0 + bevel, 0, 0);
  return g;
}

/** A box with rounded edges (its middle at the origin). */
function rbox(w, h, d, r = 0.02) {
  r = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const s = new THREE.Shape(), x = w / 2 - r, y = h / 2 - r;
  s.moveTo(-x, -h / 2); s.lineTo(x, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -y);
  s.lineTo(w / 2, y); s.quadraticCurveTo(w / 2, h / 2, x, h / 2); s.lineTo(-x, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, y); s.lineTo(-w / 2, -y); s.quadraticCurveTo(-w / 2, -h / 2, -x, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.6, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(d - 2 * r) / 2);
  return g;
}

/** The instruments' faces, drawn on a canvas: analog dials (a rev counter and a speedometer, or the rev counter alone
 * in the middle) or a digital cluster; redrawn a few times a second while they are looked at (draw). */
export class Gauges {
  constructor(kind, redline, accent) {
    this.kind = kind; this.red = redline || 7000; this.accent = accent || '#e0402a';
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512; this.canvas.height = 192;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.t = 0; this.last = '';
    this.draw(0, 0, 'N');
  }

  /** rpm, km/h and the gear shown (redrawn only when they show differently). */
  draw(rpm, kmh, gear) {
    const key = `${Math.round(rpm / 50)}|${Math.round(kmh)}|${gear}`;
    if (key === this.last) return;
    this.last = key;
    const c = this.canvas.getContext('2d'), W = 512, H = 192;
    c.fillStyle = '#050607'; c.fillRect(0, 0, W, H);
    const maxRpm = Math.ceil((this.red * 1.12) / 1000) * 1000;
    if (this.kind === 'digital') {
      // a screen: the revs as an arc of bars, the speed in big figures, the gear beside it
      const cx = W / 2, cy = H * 0.92, R = 150;
      const n = 48, lit = Math.round(n * Math.min(1, rpm / maxRpm));
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (1 + i / (n - 1)), r0 = R - 6, r1 = R + 12;
        c.strokeStyle = i < lit ? (i / n * maxRpm > this.red ? this.accent : '#e8eef2') : '#1c2328';
        c.lineWidth = 6;
        c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
      }
      c.fillStyle = '#f2f6f8'; c.textAlign = 'center'; c.font = 'bold 64px sans-serif';
      c.fillText(String(Math.round(kmh)), cx, cy - 46);
      c.fillStyle = '#7d8a93'; c.font = '20px sans-serif'; c.fillText('km/h', cx, cy - 18);
      c.fillStyle = this.accent; c.font = 'bold 42px sans-serif'; c.fillText(gear, cx + 150, cy - 50);
      c.fillStyle = '#7d8a93'; c.font = '18px sans-serif'; c.fillText(`${(rpm / 1000).toFixed(1)}k rpm`, cx - 150, cy - 50);
    } else {
      // dials: white figures on black, the needle orange-red; the rev counter's redline painted
      const dial = (cx, cy, R, max, step, val, label, red) => {
        c.strokeStyle = '#2a2f33'; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
        const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, at = (v) => a0 + (a1 - a0) * Math.min(1, v / max);
        if (red) { c.strokeStyle = '#c0281c'; c.lineWidth = 7; c.beginPath(); c.arc(cx, cy, R - 8, at(red), a1); c.stroke(); }
        c.strokeStyle = '#e9ecee'; c.fillStyle = '#e9ecee'; c.textAlign = 'center'; c.font = `${Math.round(R * 0.2)}px sans-serif`;
        for (let v = 0; v <= max + 1e-6; v += step) {
          const a = at(v);
          c.lineWidth = 3; c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); c.lineTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); c.stroke();
          c.fillText(String(Math.round(label(v))), cx + Math.cos(a) * (R - 32), cy + Math.sin(a) * (R - 32) + R * 0.07);
        }
        const a = at(val);
        c.strokeStyle = '#ff5a1f'; c.lineWidth = 4;
        c.beginPath(); c.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); c.lineTo(cx + Math.cos(a) * (R - 10), cy + Math.sin(a) * (R - 10)); c.stroke();
        c.fillStyle = '#1a1d20'; c.beginPath(); c.arc(cx, cy, 9, 0, Math.PI * 2); c.fill();
      };
      if (this.kind === 'tach') {
        dial(W / 2, H / 2 + 6, 86, maxRpm, 1000, rpm, (v) => v / 1000, this.red);
        c.fillStyle = '#e9ecee'; c.font = 'bold 30px sans-serif'; c.textAlign = 'center';
        c.fillText(String(Math.round(kmh)), W / 2 + 175, H / 2 + 12); c.fillText(gear, W / 2 - 175, H / 2 + 12);
      } else {
        dial(W * 0.28, H / 2 + 6, 84, maxRpm, 1000, rpm, (v) => v / 1000, this.red);
        dial(W * 0.72, H / 2 + 6, 84, 300, 40, kmh, (v) => v);
        c.fillStyle = this.accent; c.font = 'bold 28px sans-serif'; c.textAlign = 'center'; c.fillText(gear, W / 2, H / 2 + 14);
      }
    }
    this.texture.needsUpdate = true;
  }
}

/** The steering wheel (its own frame: x across, y up the rim, z down the column): a leather rim, three spokes, the
 * boss with its pad, paddles behind it on a paddle-shift car. */
export function sportsWheel(r, style = {}) {
  const g = new THREE.Group();
  const leather = mat(style.wheel || '#141414', 0.62), spoke = mat(style.spoke || '#202224', 0.45, 0.5), metal = mat('#9a9ea3', 0.3, 0.9);
  g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.017, 10, 40), leather));
  const sp = [];
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const b = new THREE.BoxGeometry(r - 0.045, a === -Math.PI / 2 ? 0.035 : 0.05, 0.016);
    b.translate((r - 0.045) / 2 + 0.045, 0, 0.012); b.rotateZ(a);
    sp.push(b);
  }
  g.add(new THREE.Mesh(mergeGeometries(sp), spoke));
  const boss = rbox(0.13, 0.095, 0.05, 0.02); boss.translate(0, 0, 0.02);
  g.add(new THREE.Mesh(boss, leather));
  if (style.accent) {
    const mark = new THREE.BoxGeometry(0.012, 0.022, 0.02); mark.translate(0, r - 0.005, 0);
    g.add(new THREE.Mesh(mark, mat(style.accent, 0.5)));
  }
  if (style.paddles) for (const sx of [1, -1]) {
    const p = rbox(0.06, 0.1, 0.008, 0.003); p.translate(sx * (r * 0.62), 0.02, 0.05);
    g.add(new THREE.Mesh(p, metal));
  }
  return g;
}

/** The steering column's shroud, in the wheel's frame (it doesn't turn). */
export function sportsColumn(style) {
  const col = new THREE.CylinderGeometry(0.032, 0.045, 0.34, 12); col.rotateX(Math.PI / 2); col.translate(0, -0.01, 0.2);
  return new THREE.Mesh(col, mat(style?.dash || '#151617', 0.85));
}

/**
 * Build the cockpit into the PartList P (and a few meshes of its own into `extra`: the instruments' faces and the
 * mirror). I: layout.interior; S: layout.steering; eye: spec.eye; roofAt(x, z): the roof's height there, or null.
 * Returns { gauges, mirror: { position, normal, w, h } } for the game to drive.
 */
export function buildCockpit(P, I, S, eye, roofAt, extra, spec) {
  // (black plastic and leather reflect 4 or 5% of the light: sRGB about #333, no darker, or the cockpit is a hole)
  const st = { seat: '#2c2c2f', bolster: '#323235', accent: '#b8bcc0', dash: '#2e2f32', lining: '#3d3d40', carpet: '#29292a', cluster: 'analog', screen: false, stick: 'auto', ...(I.style || {}) };
  const M = {
    dash: mat(st.dash, 0.86), trim: mat(st.trim || st.dash, 0.78), seat: mat(st.seat, 0.68), bolster: mat(st.bolster, 0.62),
    lining: mat(st.lining, 0.95, 0, { side: THREE.DoubleSide }), carpet: mat(st.carpet, 1), accent: mat(st.accent, 0.4, st.accentMetal ?? 0.6),
    vent: mat('#1b1b1d', 0.6), chrome: mat('#c9ccd0', 0.2, 1), screen: mat('#06080a', 0.15, 0.2, { emissive: new THREE.Color('#0d1a24'), emissiveIntensity: 1 }),
    hood: mat(st.dash, 0.9, 0, { side: THREE.DoubleSide }),
  };
  const side = Math.sign(S.x) || 1, dx = S.x, [yC, zC] = I.cowl, [yT, zT] = I.top, [yB, xBelt] = I.belt;
  const xIn = Math.min(xBelt + 0.02, I.doorX - 0.05);            // the doors' inside, at the sill of the windows
  const floor = I.floorY, r = S.r || 0.18;
  // the dash: its top runs back from the foot of the windscreen, its face stands a hand's width ahead of the wheel's
  // rim, then the lower dash falls away forward (the knees) to the footwells and the bulkhead
  const zR = Math.min(zC - 0.16, S.z + 0.2), yTop = Math.min(yC + 0.015, S.y + 0.06), yFace = Math.max(floor + 0.3, S.y - 0.13);
  const zKnee = zR + 0.24, zFire = Math.min(zC + 0.3, zKnee + 0.55);
  const dash = [[zC + 0.03, yC - 0.005], [zR + 0.04, yTop], [zR, yTop - 0.04], [zR + 0.015, yFace], [zKnee, floor + 0.34], [zKnee + 0.12, floor + 0.12],
    [zFire, floor + 0.02], [zFire, yC - 0.12]];
  P.add(M.dash, profile(dash, -xIn, xIn, 0.012));
  // a strip of trim along the dash face, passenger side to the console (aluminium, carbon or the car's colour)
  P.add(M.accent, new THREE.BoxGeometry(xIn - 0.2, 0.018, 0.012), [-side * (xIn / 2 + 0.06), yTop - 0.07, zR - 0.004]);
  // vents: at the ends of the dash and either side of the middle
  for (const vx of [xIn - 0.11, -(xIn - 0.11), 0.075, -0.075]) {
    P.add(M.vent, rbox(0.11, 0.055, 0.03, 0.012), [vx, yTop - 0.075, zR + 0.002]);
    P.add(M.chrome, new THREE.TorusGeometry(0.03, 0.004, 6, 18).scale(1.6, 0.85, 1), [vx, yTop - 0.075, zR - 0.012]);
  }
  // the instruments, where the driver sees them through the top of the wheel (on the line from his eye through a
  // little under the rim's top): on the dash face under a brow, or, where that line passes above the dash (a low dash,
  // a high wheel), in a pod standing on it; their face tipped to him
  const t = (zR - eye[2]) / ((S.z - eye[2]) || 1), sight = eye[1] + (S.y + 0.085 - eye[1]) * t, ch = 0.1125;
  const pod = sight + ch / 2 > yTop;
  const gy = pod ? Math.max(sight, yTop + ch / 2 - 0.015) : Math.max(yFace + ch / 2 + 0.01, Math.min(sight, yTop - ch / 2 - 0.012)), gz = pod ? zR + 0.03 : zR - 0.008;
  const toEye = Math.atan2(eye[1] - gy, gz - eye[2]);
  const gauges = new Gauges(st.cluster, spec?.engine?.redline, st.accentText || st.accent);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, ch), new THREE.MeshBasicMaterial({ map: gauges.texture, toneMapped: false }));
  face.position.set(dx, gy, gz); face.rotation.set(toEye, Math.PI, 0);
  extra.push(face);
  if (pod) P.add(M.dash, rbox(0.36, gy + ch / 2 + 0.02 - (yTop - 0.03), 0.1, 0.025), [dx, (gy + ch / 2 + 0.02 + yTop - 0.03) / 2, gz + 0.055]);
  const hood = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 24, 1, true, -1.15, 2.3);
  hood.rotateX(-Math.PI / 2); hood.scale(1, 0.42, 1);
  P.add(M.hood, hood, [dx, gy + ch / 2 - 0.045, gz - 0.035], [toEye * 0.3, 0, 0]);
  // the centre stack: a screen on top of the dash (a modern car) or a radio and three small dials in its face
  if (st.screen) {
    P.add(M.dash, rbox(0.26, 0.16, 0.035, 0.012), [0, yTop + 0.06, zR + 0.08], [0.25, 0, 0]);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.235, 0.135), M.screen);
    scr.position.set(0, yTop + 0.06, zR + 0.06); scr.rotation.set(0.25, Math.PI, 0);
    extra.push(scr);
  } else {
    P.add(M.vent, rbox(0.19, 0.055, 0.02, 0.006), [0, yTop - 0.15, zR + 0.012]);
    for (const k of [-1, 0, 1]) P.add(M.chrome, new THREE.TorusGeometry(0.022, 0.004, 6, 16), [k * 0.06, yTop - 0.21, zR + 0.006]);
  }
  // the console: from under the stack back between the seats to the armrest, the gear lever on it
  const zArm = eye[2] - 0.05, cW = 0.24;
  const con = [[zR + 0.02, yFace - 0.02], [zR + 0.02, yFace - 0.12], [zR - 0.3, floor + 0.27], [zArm, floor + 0.3], [zArm, floor + 0.02], [zFire - 0.1, floor + 0.02], [zFire - 0.1, yFace - 0.06]];
  P.add(M.trim, profile(con, -cW / 2, cW / 2, 0.012));
  P.add(M.seat, rbox(cW - 0.02, 0.05, 0.3, 0.02), [0, floor + 0.32, zArm + 0.15]);
  const zLever = zR - 0.28, yLever = floor + 0.3 - 0.02;
  if (st.stick === 'manual') {
    P.add(M.vent, new THREE.CylinderGeometry(0.04, 0.05, 0.03, 12), [0, yLever + 0.01, zLever]);
    P.add(M.chrome, new THREE.CylinderGeometry(0.008, 0.009, 0.16, 8), [0, yLever + 0.09, zLever]);
    P.add(M.seat, new THREE.SphereGeometry(0.028, 14, 10), [0, yLever + 0.18, zLever]);
  } else {
    P.add(M.seat, rbox(0.05, 0.08, 0.09, 0.02), [0, yLever + 0.05, zLever], [0.25, 0, 0]);
    P.add(M.accent, new THREE.BoxGeometry(0.07, 0.006, 0.12), [0, yLever + 0.002, zLever]);
  }
  // the doors: a card on each from the floor up to the window's sill, an armrest and a pull, the handle, a speaker
  const zD0 = I.sideZ[0] + 0.05, zD1 = Math.min(zR - 0.02, I.sideZ[1] - 0.05), dz = zD1 - zD0, dc = (zD0 + zD1) / 2;
  if (dz > 0.2) {
    // (the card, and all on it, a little inside the doors' skin where that is near: a slab-sided body's windows stand
    // almost flush with its doors, and the card stood out through them)
    const xD = Math.min(xIn, (I.skinX ?? Infinity) - 0.057), hD = yB - floor - 0.02;
    P.add(M.trim, rbox(0.05, hD, dz, 0.02), [xD + 0.02, floor + 0.02 + hD / 2, dc], null, true);
    P.add(M.seat, rbox(0.07, 0.05, dz * 0.45, 0.02), [xD - 0.02, yB - 0.24, dc - dz * 0.05], null, true);
    P.add(M.accent, rbox(0.012, 0.03, dz * 0.6, 0.01), [xD - 0.005, yB - 0.08, dc], null, true);
    P.add(M.chrome, rbox(0.02, 0.025, 0.08, 0.008), [xD - 0.01, yB - 0.12, zD1 - 0.12], null, true);
    P.add(M.vent, new THREE.CylinderGeometry(0.075, 0.075, 0.01, 20).rotateZ(Math.PI / 2), [xD - 0.004, floor + 0.17, zD1 - 0.2], null, true);
  }
  // carpet, and the sills
  const zBack = I.rear != null ? I.rear - 0.45 : I.sideZ[0] - 0.05;
  P.add(M.carpet, new THREE.BoxGeometry(2 * xIn, 0.02, zFire - zBack), [0, floor, (zFire + zBack) / 2]);
  // the seats: buckets where the driver sits and across from him, their bolsters and headrests
  const seat = (sx, sz, w, back = true) => {
    const hy = eye[1] - 0.64, hz = sz + 0.2;
    P.add(M.seat, rbox(w, 0.1, 0.48, 0.035), [sx, hy - 0.03, hz + 0.16], [0.12, 0, 0]);
    for (const bx of [1, -1]) P.add(M.bolster, rbox(0.075, 0.1, 0.44, 0.03), [sx + bx * (w / 2 - 0.02), hy + 0.03, hz + 0.15], [0.12, 0, bx * 0.25]);
    if (!back) return;
    const lean = -0.33, bh = 0.62, cy = hy + 0.03 + Math.cos(lean) * bh / 2, cz = hz - 0.08 + Math.sin(lean) * bh / 2;
    P.add(M.seat, rbox(w, bh, 0.1, 0.04), [sx, cy, cz], [lean, 0, 0]);
    for (const bx of [1, -1]) P.add(M.bolster, rbox(0.08, bh * 0.72, 0.16, 0.035), [sx + bx * (w / 2 - 0.015), cy - 0.07, cz + 0.035], [lean, bx * -0.35, 0]);
    const ty = hy + 0.03 + Math.cos(lean) * (bh + 0.1), tz = hz - 0.08 + Math.sin(lean) * (bh + 0.1);
    P.add(M.seat, rbox(w * 0.56, 0.2, 0.09, 0.04), [sx, ty, tz], [lean, 0, 0]);
    if (st.stripe) P.add(mat(st.stripe, 0.6), rbox(0.06, bh * 0.9, 0.012, 0.004), [sx, cy, cz + 0.051], [lean, 0, 0]);
  };
  seat(dx, eye[2], 0.5);
  seat(-dx, eye[2], 0.5);
  if (I.rear != null) {
    const w = Math.min(2 * xIn - 0.2, 1.2), hy = eye[1] - 0.64, rz = I.rear;
    P.add(M.seat, rbox(w, 0.12, 0.45, 0.04), [0, hy - 0.05, rz + 0.1]);
    P.add(M.seat, rbox(w, 0.55, 0.1, 0.04), [0, hy + 0.23, rz - 0.15], [-0.25, 0, 0]);
  }
  // the roof lined: under the roof panel, 3.5 cm down, where the layout's roof map has it. Only the roof itself: across
  // the car the map runs on down over the side windows' frames to the doors, below the driver's eyes, and lined there
  // it stood as a wall in his view. So each row of the lining runs between where the roof falls to that height on
  // either side (found between the map's points: its edge runs smooth, not in steps), and along each side, where it
  // ends, the roof's rail is trimmed; across the front, a header down to the windscreen's top.
  if (roofAt) {
    const x0 = -xIn + 0.04, x1 = xIn - 0.04, z0 = zBack + 0.05, z1 = zT - 0.04, nx = 12, nz = Math.max(4, Math.round((z1 - z0) / 0.1));
    const lineY = (x, z) => { const y = roofAt(x, z); return y == null ? null : y - 0.035; };
    // (from the middle out toward x1, the last x the lining reaches: where it falls below `low`, or the roof ends)
    const reach = (z, low, to) => {
      const n = 48;
      let px = 0, py = lineY(0, z);
      for (let i = 1; i <= n; i++) {
        const x = to * i / n, y = lineY(x, z);
        if (y == null || y < low) return y == null ? px : px + (x - px) * (py - low) / Math.max(1e-6, py - y);
        px = x; py = y;
      }
      return to;
    };
    const rows = [];
    for (let k = 0; k <= nz; k++) {
      const z = z0 + (z1 - z0) * k / nz, mid = lineY(0, z);
      const low = Math.max(eye[1] + 0.06, (mid ?? yT) - 0.12);
      if (mid == null || mid < low) { rows.push(null); continue; }
      const xa = reach(z, low, x0), xb = reach(z, low, x1);
      const row = [];
      for (let i = 0; i <= nx; i++) { const x = xa + (xb - xa) * i / nx; row.push([x, Math.max(low, lineY(x, z) ?? low), z]); }
      rows.push(row);
    }
    const pos = [], idx = [];
    for (let k = 0; k < rows.length; k++) {
      if (!rows[k]) continue;
      const base = pos.length / 3;
      for (const v of rows[k]) pos.push(...v);
      if (k > 0 && rows[k - 1]) {
        const prev = base - (nx + 1);
        for (let i = 0; i < nx; i++) idx.push(prev + i, base + i, prev + i + 1, prev + i + 1, base + i, base + i + 1);
      }
    }
    if (idx.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx); g.computeVertexNormals();
      P.add(M.lining, g);
      const strip = (a, b) => {
        const sp = [];
        for (let k = 0; k < a.length; k++) sp.push(...a[k], ...b[k]);
        const si = [];
        for (let k = 0; k + 1 < a.length; k++) si.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        sg.setIndex(si); sg.computeVertexNormals();
        P.add(M.lining, sg);
      };
      const lined = rows.filter(Boolean);
      // the rails: a strip falling a little outward from the lining's edge (the trim over the side windows' tops)
      for (const [end, out] of [[nx, Math.sign(x1)], [0, Math.sign(x0)]]) {
        const edge = lined.map((r) => r[end]);
        if (edge.length > 1) strip(edge, edge.map(([x, y, z]) => [x + out * 0.05, y - 0.045, z]));
      }
      // the header: from the lining's front edge down to the windscreen's top
      const front = lined[lined.length - 1];
      if (front) strip(front, front.map(([x, y]) => [x, Math.min(y, yT + 0.01), zT + 0.01]));
    }
  }
  // the windscreen's pillars trimmed inside, and the pillar behind the doors
  for (const sx of [1, -1]) {
    P.tube(M.lining, [sx * (I.wsHalf - 0.03), yC + 0.03, zC - 0.03], [sx * (I.wsHalf - 0.11), yT - 0.02, zT + 0.02], 0.032);
    const yr = roofAt?.(sx * (xIn - 0.05), I.sideZ[0]) ?? yT;
    P.tube(M.lining, [sx * (xIn + 0.01), yB, I.sideZ[0] - 0.02], [sx * (xIn - 0.03), yr - 0.03, I.sideZ[0] - 0.05], 0.045);
  }
  // sun visors folded up against the lining over the windscreen's top (not hanging in front of it), the rear-view
  // mirror on the screen's top
  for (const sx of [1, -1]) {
    const vy = Math.max(yT - 0.03, (roofAt?.(sx * 0.3, zT - 0.12) ?? yT) - 0.055);
    P.add(M.lining, rbox(0.34, 0.016, 0.16, 0.006), [sx * 0.3, vy, zT - 0.12], [-0.06, 0, 0]);
  }
  const mirror = { position: new THREE.Vector3(0, yT - 0.085, zT - 0.08), normal: new THREE.Vector3(0, 0, -1), w: 0.23, h: 0.06 };
  P.add(M.vent, new THREE.CylinderGeometry(0.008, 0.008, 0.07, 6), [0, yT - 0.035, zT - 0.05]);
  return { gauges, mirror };
}
