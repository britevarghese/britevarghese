// The newer bodies (TruckModel.js has the first three and the shared parts): the micro 4x4, the compact pickup, the
// British utility wagon, the six-cylinder wagon, the one-ton crew cab and the portal-axle expedition truck. Each draws
// its body in the design frame at stock height (x left, y up, z forward, the origin on the ground mid-wheelbase) and
// returns where its lamps, bumpers, spare, steering wheel and frame are, as the others do.
import * as THREE from 'three';
import { slab, arch } from './TruckModel.js';

/** A wheel-well liner behind an arch (the dark inside of the wheel arch). */
function liner(P, M, z, yc, r, w) {
  const g = new THREE.CylinderGeometry(r - 0.01, r - 0.01, w, 20, 1, true, Math.PI / 2 - 1.25, 2.5);
  g.rotateZ(Math.PI / 2);
  P.add(M.under, g, [0, yc, z]);
}

/** A flared arch: a half-round lip around a wheel opening, on both sides. */
function flare(P, mat, x, z, yc, r, t = 0.035, arc = Math.PI) {
  const g = new THREE.TorusGeometry(r, t, 6, 22, arc);
  g.rotateZ((Math.PI - arc) / 2);
  g.rotateY(Math.PI / 2);
  P.add(mat, g, [x, yc, z], null, true);
}

/** A windscreen: frame pillars, header, the glass (the windscreen material: it cracks), wipers. bottom and top: [z, y]. */
function windscreen(P, M, paint, bottom, top, halfW, pillar = 0.05) {
  const rake = Math.atan2(bottom[0] - top[0], top[1] - bottom[1]);
  const c = [(bottom[0] + top[0]) / 2, (bottom[1] + top[1]) / 2], L = Math.hypot(top[0] - bottom[0], top[1] - bottom[1]);
  P.box(paint, [pillar, L, pillar], [halfW - pillar / 2, c[1], c[0]], { r: 0.012, rot: [-rake, 0, 0], mirror: true });
  P.box(paint, [2 * halfW, pillar, pillar + 0.01], [0, top[1] - 0.02, top[0]], { r: 0.012 });
  P.box(M.screen, [2 * halfW - 2 * pillar, L - 0.06, 0.012], [0, c[1], c[0]], { r: 0, rot: [-rake, 0, 0] });
  P.box(M.black, [halfW * 0.6, 0.012, 0.012], [halfW * 0.28, bottom[1] + 0.06, bottom[0] - 0.01], { r: 0, rot: [0, 0, 0.25] });
  P.box(M.black, [halfW * 0.6, 0.012, 0.012], [-halfW * 0.4, bottom[1] + 0.06, bottom[0] - 0.01], { r: 0, rot: [0, 0, 0.25] });
  return rake;
}

/**
 * Seats, a floor and a dash with gauges. The front seats' cushions are centred at seatZ (by default 0.62 m behind the
 * dash); the dash is dashD deep (front to back), its middle at dashZ. The floor and the dash reach `inner` either side
 * (the doors; by default the seats' outer edges). well: close the footwells (a model with no firewall, where the wheels
 * and the ground show under the dash): the bulkhead at z1 and the kick panels beside them. side: where the driver sits
 * (1 left, -1 right): the gauges are in front of him.
 */
export function cabin(P, M, { floorY, z0, z1, x = 0.38, w = 0.5, inner = null, rear = null, dashZ, dashY, dashD = 0.24, seatZ = null, bench = false, well = false, side = 1 }) {
  const hw = inner ?? x + w / 2;
  P.box(M.black, [2 * hw, 0.03, z1 - z0], [0, floorY, (z0 + z1) / 2], { r: 0 });
  const sz = seatZ ?? dashZ - 0.62;
  if (bench) {
    P.box(M.seat, [2 * x + w - 0.1, 0.13, 0.5], [0, floorY + 0.18, sz], { r: 0.04 });
    P.box(M.seat, [2 * x + w - 0.1, 0.55, 0.12], [0, floorY + 0.48, sz - 0.26], { r: 0.04, rot: [-0.1, 0, 0] });
  } else {
    P.box(M.seat, [w, 0.12, 0.48], [x, floorY + 0.18, sz], { r: 0.04, mirror: true });
    P.box(M.seat, [w, 0.54, 0.1], [x, floorY + 0.46, sz - 0.26], { r: 0.04, rot: [-0.14, 0, 0], mirror: true });
  }
  if (rear !== null) {
    P.box(M.seat, [2 * x + w - 0.1, 0.12, 0.48], [0, floorY + 0.18, rear], { r: 0.04 });
    P.box(M.seat, [2 * x + w - 0.1, 0.5, 0.1], [0, floorY + 0.44, rear - 0.26], { r: 0.04, rot: [-0.12, 0, 0] });
  }
  P.box(M.black, [2 * hw, 0.17, dashD], [0, dashY, dashZ], { r: 0.03 });
  if (well) {
    const h = dashY - floorY;
    P.box(M.black, [2 * hw, h, 0.03], [0, floorY + h / 2, z1], { r: 0 });
    P.box(M.black, [0.03, h, 0.7], [hw - 0.015, floorY + h / 2, z1 - 0.35], { r: 0, mirror: true });
  }
  for (const gx of [x - 0.08, x + 0.08]) P.cyl(M.chrome, 0.045, 0.045, 0.02, [side * gx, dashY + 0.04, dashZ - dashD / 2 - 0.01], { axis: 'z', seg: 14 });
}

// ---------------------------------------------------------------- Gecko: the micro 4x4 with a canvas top
export function geckoBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.72, zF = 1.6, zB = -1.8, belt = 1.0, yc = 0.35, ar = 0.41;
  const s = new THREE.Shape();
  s.moveTo(zF, 0.5);
  s.lineTo(zF, 0.93); s.quadraticCurveTo(zF, 0.97, zF - 0.06, 0.97);
  s.lineTo(0.42, 1.02);
  s.lineTo(zB + 0.04, belt); s.quadraticCurveTo(zB, belt, zB, belt - 0.04);
  s.lineTo(zB, 0.5);
  arch(s, zr, yc, ar, 0.5, 0.5);
  arch(s, zf, yc, ar, 0.5, 0.5);
  s.lineTo(zF, 0.5);
  P.add(paint, slab(s, half, 0.022));
  for (const z of [zf, zr]) { liner(P, M, z, yc, ar, 2 * half - 0.1); flare(P, M.black, half + 0.012, z, yc, ar + 0.02, 0.04); }
  // hood seams and a vent, the door seams, handles, a crease along the side
  P.box(M.black, [0.008, 0.01, 1.1], [0.55, 1.0, 1.0], { r: 0, mirror: true });
  P.box(M.black, [1.1, 0.01, 0.05], [0, 1.02, 0.46], { r: 0 });
  for (const z of [0.36, -0.6]) P.box(M.black, [0.006, 0.46, 0.007], [half + 0.012, 0.76, z], { r: 0, mirror: true });
  P.box(M.chrome, [0.02, 0.022, 0.1], [half + 0.02, 0.92, -0.5], { r: 0.006, mirror: true });
  P.box(paint, [0.012, 0.025, 3.3], [half + 0.018, 0.82, -0.1], { r: 0.004, mirror: true });
  // windscreen, canvas top with clear windows
  windscreen(P, M, paint, [0.38, 1.03], [0.16, 1.62], 0.68, 0.045);
  P.box(top, [1.42, 0.05, 1.96], [0, 1.665, -0.82], { r: 0.02 });
  P.box(top, [0.015, 0.64, 1.94], [0.708, 1.34, -0.83], { r: 0, mirror: true });
  P.box(top, [1.4, 0.64, 0.015], [0, 1.34, zB + 0.02], { r: 0 });
  P.box(M.glass, [0.02, 0.32, 0.52], [0.714, 1.38, -0.18], { r: 0, mirror: true });
  P.box(M.glass, [0.02, 0.28, 0.6], [0.714, 1.38, -1.15], { r: 0, mirror: true });
  P.box(M.glass, [0.8, 0.26, 0.02], [0, 1.38, zB + 0.012], { r: 0 });
  for (const z of [-0.55, -1.25]) P.box(M.black, [1.42, 0.02, 0.02], [0, 1.66, z], { r: 0 });
  // the grille: a black panel with vertical slots, round lamps beside it, the turn signals under them
  P.box(M.black, [0.62, 0.24, 0.02], [0, 0.79, zF + 0.012], { r: 0.006 });
  for (let i = -4; i <= 4; i++) P.box(paint, [0.022, 0.24, 0.02], [i * 0.066, 0.79, zF + 0.02], { r: 0 });
  P.box(M.amber, [0.08, 0.035, 0.02], [0.5, 0.67, zF + 0.015], { r: 0.006, mirror: true });
  P.box(M.black, [0.03, 0.1, 0.12], [half + 0.06, 1.16, 0.32], { r: 0.012, mirror: true });
  P.box(M.plate, [0.3, 0.14, 0.012], [0.36, 0.66, zB - 0.02], { r: 0.005 });
  cabin(P, M, { floorY: 0.58, z0: -1.75, z1: 0.3, x: 0.3, w: 0.44, rear: -1.25, dashZ: 0.26, dashY: 0.96 });
  return {
    heads: [[0.5, 0.8, zF + 0.02, 0.075]],
    tails: [[0.64, 0.78, zB - 0.02, 0.07, 0.13]], reverse: [[0.64, 0.67, zB - 0.02, 0.07, 0.05]],
    bumperF: { z: zF + 0.08, y: 0.44, w: 1.42 }, bumperR: { z: zB - 0.07, y: 0.44, w: 1.36 },
    spare: { x: 0, z: zB - 0.02, mount: 'rear' },
    wheel: { x: 0.3, y: 1.1, z: -0.02, tilt: 0.5 },
    frame: { x: 0.35, y: 0.4, z0: zB + 0.05, z1: zF - 0.08 },
    flaps: false, sill: 0.45, half, roofY: 1.69, roofZ: [-1.75, 0.12],
  };
}

// ---------------------------------------------------------------- Trekker: the compact pickup
export function trekkerBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.84, zF = 2.15, zCab = -0.5, zBed0 = -0.58, zB = -2.25, belt = 1.07, yc = 0.4, ar = 0.47;
  // front clip and cab sides, with the front arch
  const s = new THREE.Shape();
  s.moveTo(zF, 0.58);
  s.lineTo(zF, 0.98); s.quadraticCurveTo(zF, 1.02, zF - 0.06, 1.02);
  s.lineTo(0.72, 1.08);
  s.lineTo(zCab + 0.04, belt + 0.01); s.quadraticCurveTo(zCab, belt + 0.01, zCab, belt - 0.03);
  s.lineTo(zCab, 0.52);
  arch(s, zf, yc, ar, 0.52, 0.58);
  s.lineTo(zF, 0.58);
  P.add(paint, slab(s, half, 0.02));
  liner(P, M, zf, yc, ar, 2 * half - 0.12);
  // the bed: sides with the rear arch, floor, front wall, tailgate
  const b = new THREE.Shape();
  b.moveTo(zBed0, 0.56); b.lineTo(zBed0, belt); b.lineTo(zB, belt); b.lineTo(zB, 0.58);
  arch(b, zr, yc, ar, 0.58, 0.56);
  b.lineTo(zBed0, 0.56);
  for (const sx of [1, -1]) { const g = slab(b, 0.035, 0.01); g.translate(sx * (half - 0.02), 0, 0); P.add(paint, g); }
  P.box(paint, [0.012, 0.03, zBed0 - zB], [half + 0.012, belt - 0.015, (zBed0 + zB) / 2], { r: 0.004, mirror: true });
  P.box(M.under, [1.6, 0.04, zBed0 - zB], [0, 0.78, (zBed0 + zB) / 2], { r: 0 });
  P.box(paint, [1.66, 0.3, 0.04], [0, belt - 0.14, zBed0 + 0.01], { r: 0.012 });
  P.box(paint, [1.66, 0.46, 0.05], [0, 0.82, zB - 0.01], { r: 0.012 });
  P.box(M.under, [0.24, 0.26, 0.95], [0.72, 0.9, zr], { r: 0.03, mirror: true });
  // hood seams, door seams and handles, mirrors, a stripe
  P.box(M.black, [0.008, 0.01, 1.4], [0.7, 1.05, 1.42], { r: 0, mirror: true });
  for (const z of [0.68, -0.42]) P.box(M.black, [0.006, 0.5, 0.007], [half + 0.012, 0.82, z], { r: 0, mirror: true });
  P.box(M.chrome, [0.02, 0.025, 0.12], [half + 0.02, 0.98, -0.3], { r: 0.006, mirror: true });
  P.box(M.black, [0.012, 0.06, 4.3], [half + 0.016, 0.66, -0.04], { r: 0.004, mirror: true });
  P.tube(M.black, [half, 1.2, 0.64], [half + 0.12, 1.28, 0.6], 0.01, { mirror: true });
  P.box(M.black, [0.03, 0.13, 0.16], [half + 0.13, 1.3, 0.6], { r: 0.014, mirror: true });
  // cab: windscreen, roof, pillars, back wall and window, door glass
  windscreen(P, M, paint, [0.72, 1.09], [0.4, 1.71], 0.8, 0.05);
  P.box(top, [1.62, 0.06, 0.92], [0, 1.73, -0.04], { r: 0.03, cr: 0.02 });
  P.box(paint, [0.05, 0.62, 0.1], [0.79, 1.4, zCab + 0.05], { r: 0.012, mirror: true });
  P.box(paint, [1.62, 0.64, 0.05], [0, 1.39, zCab + 0.01], { r: 0.015 });
  P.box(M.glass, [0.012, 0.5, 0.86], [0.8, 1.38, 0.12], { r: 0, mirror: true });
  P.box(M.glass, [1.1, 0.34, 0.012], [0, 1.42, zCab - 0.018], { r: 0 });
  // grille: chrome surround, black with horizontal bars; amber parking lamps
  P.box(M.chrome, [1.5, 0.3, 0.03], [0, 0.88, zF + 0.012], { r: 0.012 });
  P.box(M.black, [0.92, 0.22, 0.02], [0, 0.88, zF + 0.025], { r: 0.006 });
  for (const y of [0.82, 0.88, 0.94]) P.box(M.chrome, [0.9, 0.014, 0.012], [0, y, zF + 0.035], { r: 0 });
  P.box(M.amber, [0.12, 0.04, 0.02], [0.62, 0.76, zF + 0.02], { r: 0.008, mirror: true });
  P.box(M.plate, [0.3, 0.14, 0.012], [0, 0.72, zB - 0.04], { r: 0.005 });
  cabin(P, M, { floorY: 0.66, z0: zCab + 0.05, z1: 0.68, x: 0.36, w: 0.5, dashZ: 0.6, dashY: 1.06, bench: true });
  return {
    heads: [[0.6, 0.88, zF + 0.03, 0.08]],
    tails: [[0.76, 0.86, zB - 0.035, 0.1, 0.18]], reverse: [[0.76, 0.72, zB - 0.035, 0.1, 0.05]],
    bumperF: { z: zF + 0.1, y: 0.5, w: 1.72, chrome: true }, bumperR: { z: zB - 0.08, y: 0.5, w: 1.7, chrome: true, step: true },
    spare: { x: 0, z: -1.72, mount: 'under' },
    wheel: { x: 0.36, y: 1.27, z: 0.32, tilt: 0.45 },
    frame: { x: 0.42, y: 0.5, z0: zB + 0.05, z1: zF - 0.1 },
    flaps: true, sill: 0.5, half, roofY: 1.75, roofZ: [zCab, 0.38], bedZ: [zB + 0.04, zBed0 - 0.04],
  };
}

// ---------------------------------------------------------------- Shepherd: the British utility wagon
export function shepherdBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.89, zF = 2.06, zB = -2.36, waist = 1.15, roof = 1.99, yc = 0.41, ar = 0.5, zA = 0.74;
  // the lower body: flat panels, flat-topped front wings, both arches
  const s = new THREE.Shape();
  s.moveTo(zF, 0.55);
  s.lineTo(zF, 1.1); s.lineTo(zF - 0.03, 1.13);
  s.lineTo(zA + 0.05, 1.13); s.lineTo(zA, waist);
  s.lineTo(zB + 0.03, waist); s.lineTo(zB, waist - 0.03);
  s.lineTo(zB, 0.52);
  arch(s, zr, yc, ar, 0.52, 0.55);
  arch(s, zf, yc, ar, 0.55, 0.55);
  s.lineTo(zF, 0.55);
  P.add(paint, slab(s, half, 0.012));
  for (const z of [zf, zr]) { liner(P, M, z, yc, ar, 2 * half - 0.12); flare(P, M.black, half + 0.02, z, yc, ar + 0.035, 0.05, Math.PI * 0.92); }
  // the bonnet between the wings, a little proud of them; the bulkhead vents
  P.box(paint, [1.16, 0.035, 1.28], [0, 1.155, 1.4], { r: 0.012 });
  P.box(M.black, [0.008, 0.012, 1.28], [0.585, 1.14, 1.4], { r: 0, mirror: true });
  P.box(M.black, [0.3, 0.04, 0.02], [0.62, 1.11, zA + 0.035], { r: 0.005, mirror: true });
  // the station-wagon body above the waist, painted, with its windows; the white roof on top
  P.box(paint, [0.03, roof - waist, zA - zB - 0.04], [half - 0.015, (roof + waist) / 2, (zA + zB) / 2 - 0.02], { r: 0.008, mirror: true });
  P.box(paint, [2 * half - 0.04, roof - waist, 0.03], [0, (roof + waist) / 2, zB + 0.015], { r: 0.008 });
  windscreen(P, M, paint, [zA + 0.02, waist + 0.02], [zA - 0.03, 1.78], half - 0.03, 0.06);
  P.box(paint, [2 * half - 0.06, roof - 1.78, 0.06], [0, (roof + 1.78) / 2, zA - 0.03], { r: 0.01 });
  P.box(top, [2 * half + 0.02, 0.06, zA - zB + 0.04], [0, roof + 0.02, (zA + zB) / 2], { r: 0.03, cr: 0.02 });
  P.box(top, [0.06, 0.05, zA - zB], [half - 0.01, roof - 0.01, (zA + zB) / 2], { r: 0.015, mirror: true });
  for (const [z0, z1] of [[zA - 0.08, -0.22], [-0.32, -1.12], [-1.22, zB + 0.12]]) P.box(M.glass, [0.012, 0.46, z0 - z1], [half + 0.002, 1.52, (z0 + z1) / 2], { r: 0, mirror: true });
  for (const z of [-1.8, -0.7]) P.box(M.glass, [0.012, 0.14, 0.62], [half - 0.06, roof - 0.07, z], { r: 0, rot: [0, 0, -0.55], mirror: true });   // alpine windows
  P.box(M.glass, [1.1, 0.42, 0.012], [0, 1.55, zB - 0.004], { r: 0 });
  // doors: seams, external hinges, handles
  for (const z of [zA - 0.02, -0.27, -1.17]) P.box(M.black, [0.006, 0.82, 0.007], [half + 0.017, 0.98, z], { r: 0, mirror: true });
  for (const z of [zA - 0.06, -0.31]) for (const y of [0.78, 1.3]) P.box(M.satin, [0.02, 0.07, 0.05], [half + 0.02, y, z], { r: 0.006, mirror: true });
  for (const z of [-0.2, -1.1]) P.box(M.satin, [0.02, 0.025, 0.1], [half + 0.022, 1.08, z], { r: 0.006, mirror: true });
  P.tube(M.black, [half, 1.3, zA - 0.1], [half + 0.16, 1.38, zA - 0.14], 0.012, { mirror: true });
  P.box(M.black, [0.03, 0.15, 0.17], [half + 0.17, 1.4, zA - 0.15], { r: 0.012, mirror: true });
  // the front: a black panel between the wings with the grille, square lamp surrounds on the wing fronts
  P.box(M.black, [1.14, 0.32, 0.03], [0, 0.97, zF + 0.012], { r: 0.008 });
  for (let i = -6; i <= 6; i++) P.box(M.satin, [0.016, 0.28, 0.02], [i * 0.075, 0.97, zF + 0.025], { r: 0 });
  P.box(M.black, [0.24, 0.24, 0.03], [0.68, 0.95, zF + 0.01], { r: 0.012, mirror: true });
  P.box(M.amber, [0.08, 0.05, 0.02], [0.68, 0.78, zF + 0.012], { r: 0.008, mirror: true });
  P.box(M.plate, [0.32, 0.12, 0.012], [-0.3, 0.68, zB - 0.02], { r: 0.005 });
  cabin(P, M, { floorY: 0.66, z0: -2.3, z1: 0.68, x: 0.4, w: 0.5, rear: -0.75, dashZ: 0.62, dashY: 1.1 });
  return {
    heads: [[0.68, 0.95, zF + 0.025, 0.08]],
    tails: [[0.82, 0.86, zB - 0.02, 0.07, 0.2]], reverse: [[0.82, 0.68, zB - 0.02, 0.07, 0.06]],
    bumperF: { z: zF + 0.1, y: 0.5, w: 1.62 }, bumperR: { z: zB - 0.06, y: 0.5, w: 1.4 },
    spare: { x: 0.12, z: zB - 0.02, mount: 'rear' },
    wheel: { x: 0.4, y: 1.33, z: 0.38, tilt: 0.35 },
    frame: { x: 0.43, y: 0.52, z0: zB + 0.05, z1: zF - 0.1 },
    flaps: true, sill: 0.5, half, roofY: 2.03, roofZ: [zB + 0.04, zA - 0.04],
  };
}

// ---------------------------------------------------------------- Drover: the big six-cylinder wagon
export function droverBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 0.9, zF = 2.2, zB = -2.5, belt = 1.13, roof = 1.8, yc = 0.41, ar = 0.5, zW = 1.0, zT = 0.7;
  const s = new THREE.Shape();
  s.moveTo(zF, 0.56);
  s.lineTo(zF, 1.02); s.quadraticCurveTo(zF, 1.07, zF - 0.07, 1.07);
  s.lineTo(zW, 1.13);
  s.lineTo(zB + 0.05, belt); s.quadraticCurveTo(zB, belt, zB, belt - 0.05);
  s.lineTo(zB, 0.52);
  arch(s, zr, yc, ar, 0.52, 0.56);
  arch(s, zf, yc, ar, 0.56, 0.56);
  s.lineTo(zF, 0.56);
  P.add(paint, slab(s, half, 0.025));
  for (const z of [zf, zr]) { liner(P, M, z, yc, ar, 2 * half - 0.12); flare(P, paint, half + 0.01, z, yc, ar + 0.025, 0.035); }
  P.box(M.black, [0.008, 0.01, 1.15], [0.66, 1.1, 1.62], { r: 0, mirror: true });
  P.box(M.chrome, [0.012, 0.02, 4.5], [half + 0.02, 0.62, -0.15], { r: 0.004, mirror: true });
  // the greenhouse: windscreen, roof, four pillars, three windows a side, the tailgate glass
  windscreen(P, M, paint, [zW, belt + 0.02], [zT, roof - 0.03], half - 0.04, 0.055);
  P.box(top, [2 * half - 0.04, 0.06, zT - zB + 0.02], [0, roof, (zT + zB) / 2], { r: 0.03, cr: 0.025 });
  P.box(M.black, [0.03, 0.03, zT - zB - 0.2], [half - 0.1, roof + 0.05, (zT + zB) / 2], { r: 0.008, mirror: true });   // roof rails
  for (const z of [-0.22, -1.32, zB + 0.06]) P.box(paint, [0.05, roof - belt, 0.11], [half - 0.035, (roof + belt) / 2, z], { r: 0.012, mirror: true });
  for (const [z0, z1] of [[zT - 0.06, -0.28], [-0.28 - 0.06, -1.26], [-1.38, zB + 0.13]]) P.box(M.glass, [0.012, roof - belt - 0.12, z0 - z1], [half - 0.03, (roof + belt) / 2, (z0 + z1) / 2], { r: 0, mirror: true });
  P.box(paint, [2 * half - 0.06, roof - belt, 0.04], [0, (roof + belt) / 2, zB + 0.02], { r: 0.01 });
  P.box(M.glass, [1.36, 0.46, 0.012], [0, 1.48, zB - 0.004], { r: 0 });
  for (const z of [zT + 0.02, -0.25, -1.3]) P.box(M.black, [0.006, 0.6, 0.007], [half + 0.012, 0.84, z], { r: 0, mirror: true });
  for (const z of [-0.12, -1.18]) P.box(M.chrome, [0.02, 0.025, 0.12], [half + 0.02, 1.02, z], { r: 0.006, mirror: true });
  P.tube(M.chrome, [half - 0.02, 1.25, zT - 0.02], [half + 0.14, 1.32, zT - 0.06], 0.01, { mirror: true });
  P.box(M.black, [0.03, 0.16, 0.17], [half + 0.15, 1.34, zT - 0.07], { r: 0.014, mirror: true });
  // the front: a chrome-framed grille across the nose, round lamps, the turn signals inboard
  P.box(M.chrome, [1.66, 0.36, 0.03], [0, 0.92, zF + 0.012], { r: 0.012 });
  P.box(M.black, [1.0, 0.26, 0.02], [0, 0.92, zF + 0.026], { r: 0.006 });
  for (let i = -5; i <= 5; i++) P.box(M.chrome, [0.014, 0.26, 0.012], [i * 0.09, 0.92, zF + 0.034], { r: 0 });
  P.box(M.amber, [0.1, 0.06, 0.02], [0.44, 0.78, zF + 0.02], { r: 0.008, mirror: true });
  P.box(M.plate, [0.3, 0.15, 0.012], [0, 0.74, zB - 0.035], { r: 0.005 });
  cabin(P, M, { floorY: 0.68, z0: zB + 0.1, z1: zW - 0.25, x: 0.4, w: 0.52, rear: -0.95, dashZ: zW - 0.32, dashY: 1.12 });
  P.box(M.seat, [1.5, 0.12, 0.46], [0, 0.86, -1.9], { r: 0.04 });
  return {
    heads: [[0.66, 0.93, zF + 0.03, 0.085]],
    tails: [[0.84, 0.86, zB - 0.02, 0.09, 0.22]], reverse: [[0.84, 0.69, zB - 0.02, 0.09, 0.06]],
    bumperF: { z: zF + 0.1, y: 0.52, w: 1.8, chrome: true }, bumperR: { z: zB - 0.08, y: 0.52, w: 1.76, chrome: true },
    spare: { x: 0, z: zr - 0.72, mount: 'under' },
    wheel: { x: 0.42, y: 1.3, z: zW - 0.08, tilt: 0.45 },
    frame: { x: 0.44, y: 0.54, z0: zB + 0.05, z1: zF - 0.1 },
    flaps: true, sill: 0.52, half, roofY: 1.82, roofZ: [zB + 0.05, zT - 0.04],
  };
}

// ---------------------------------------------------------------- Bruiser: the one-ton crew cab
export function bruiserBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z;
  const half = 1.0, zF = 2.92, zW = 1.3, zT = 0.98, zCab = -0.78, zBed0 = -0.86, zB = -3.16, belt = 1.3, yc = 0.46, ar = 0.56;
  // the front clip and the crew cab's sides, with the front arch
  const s = new THREE.Shape();
  s.moveTo(zF, 0.68);
  s.lineTo(zF, 1.24); s.quadraticCurveTo(zF, 1.29, zF - 0.06, 1.29);
  s.lineTo(zW, 1.33);
  s.lineTo(zCab + 0.04, belt + 0.02); s.quadraticCurveTo(zCab, belt + 0.02, zCab, belt - 0.02);
  s.lineTo(zCab, 0.6);
  arch(s, zf, yc, ar, 0.6, 0.68);
  s.lineTo(zF, 0.68);
  P.add(paint, slab(s, half, 0.02));
  liner(P, M, zf, yc, ar, 2 * half - 0.14);
  // the bed with the rear arch
  const b = new THREE.Shape();
  b.moveTo(zBed0, 0.64); b.lineTo(zBed0, belt); b.lineTo(zB, belt); b.lineTo(zB, 0.66);
  arch(b, zr, yc, ar, 0.66, 0.64);
  b.lineTo(zBed0, 0.64);
  for (const sx of [1, -1]) { const g = slab(b, 0.04, 0.012); g.translate(sx * (half - 0.02), 0, 0); P.add(paint, g); }
  P.box(top, [0.014, 0.035, zBed0 - zB], [half + 0.015, belt - 0.02, (zBed0 + zB) / 2], { r: 0.005, mirror: true });
  P.box(M.under, [1.9, 0.04, zBed0 - zB], [0, 0.98, (zBed0 + zB) / 2], { r: 0 });
  P.box(paint, [1.96, 0.3, 0.05], [0, belt - 0.14, zBed0 + 0.01], { r: 0.015 });
  P.box(paint, [1.96, 0.6, 0.05], [0, 1.0, zB - 0.01], { r: 0.015 });
  P.box(M.chrome, [0.22, 0.04, 0.02], [0, 1.18, zB - 0.04], { r: 0.008 });
  P.box(M.under, [0.3, 0.32, 1.12], [0.82, 1.08, zr], { r: 0.04, mirror: true });
  // hood, the doors (four), handles, a two-tone band, towing mirrors
  P.box(paint, [1.7, 0.03, 1.6], [0, 1.31, 2.1], { r: 0.012, rot: [0.02, 0, 0] });
  P.box(M.black, [0.008, 0.01, 1.6], [0.85, 1.3, 2.1], { r: 0, mirror: true });
  P.box(top, [0.014, 0.12, 6.0], [half + 0.022, 0.95, -0.12], { r: 0.004, mirror: true });
  for (const z of [zW - 0.06, 0.08, zCab + 0.06]) P.box(M.black, [0.006, 0.66, 0.007], [half + 0.012, 0.98, z], { r: 0, mirror: true });
  for (const z of [0.18, -0.68]) P.box(M.chrome, [0.025, 0.03, 0.14], [half + 0.022, 1.18, z], { r: 0.008, mirror: true });
  P.tube(M.chrome, [half, 1.42, zW - 0.12], [half + 0.2, 1.52, zW - 0.18], 0.012, { mirror: true });
  P.tube(M.chrome, [half, 1.74, zW - 0.16], [half + 0.2, 1.64, zW - 0.2], 0.012, { mirror: true });
  P.box(M.black, [0.04, 0.32, 0.2], [half + 0.22, 1.58, zW - 0.2], { r: 0.016, mirror: true });
  // the crew cab: windscreen, roof, pillars, two rows of door glass, back window, cab lights
  windscreen(P, M, paint, [zW, belt + 0.04], [zT, 1.95], half - 0.08, 0.06);
  P.box(top, [1.84, 0.07, zT - zCab + 0.02], [0, 1.96, (zT + zCab) / 2], { r: 0.035, cr: 0.03 });
  P.box(paint, [0.06, 0.6, 0.1], [half - 0.09, 1.66, 0.08], { r: 0.015, mirror: true });
  P.box(paint, [1.84, 0.66, 0.06], [0, 1.64, zCab + 0.02], { r: 0.02 });
  P.box(M.glass, [0.012, 0.52, zT - 0.16], [half - 0.08, 1.64, (zT + 0.16) / 2], { r: 0, mirror: true });
  P.box(M.glass, [0.012, 0.52, -0.02 - zCab - 0.08], [half - 0.08, 1.64, (-0.02 + zCab + 0.08) / 2], { r: 0, mirror: true });
  P.box(M.glass, [1.3, 0.38, 0.012], [0, 1.66, zCab - 0.012], { r: 0 });
  for (const x of [0.28, 0, -0.28]) P.box(M.amber, [0.1, 0.035, 0.05], [x, 1.995, zT - 0.02], { r: 0.01 });
  // the front: a big chrome grille, quad lamps in chrome bezels
  P.box(M.chrome, [1.84, 0.5, 0.04], [0, 1.0, zF + 0.015], { r: 0.015 });
  P.box(M.black, [1.0, 0.36, 0.03], [0, 1.0, zF + 0.03], { r: 0.008 });
  for (let i = -3; i <= 3; i++) P.box(M.chrome, [0.02, 0.36, 0.02], [i * 0.14, 1.0, zF + 0.042], { r: 0 });
  for (const y of [0.94, 1.06]) P.box(M.chrome, [1.0, 0.02, 0.02], [0, y, zF + 0.042], { r: 0 });
  P.box(M.amber, [0.2, 0.05, 0.02], [0.7, 0.82, zF + 0.035], { r: 0.008, mirror: true });
  P.box(M.plate, [0.3, 0.15, 0.012], [0, 0.82, zB - 0.04], { r: 0.005 });
  cabin(P, M, { floorY: 0.8, z0: zCab + 0.05, z1: zW - 0.2, x: 0.42, w: 0.54, rear: -0.38, dashZ: zW - 0.32, dashY: 1.28 });
  return {
    heads: [[0.78, 1.04, zF + 0.05, 0.075], [0.6, 1.04, zF + 0.05, 0.075]],
    tails: [[0.9, 1.08, zB - 0.035, 0.12, 0.26]], reverse: [[0.9, 0.89, zB - 0.035, 0.12, 0.07]],
    bumperF: { z: zF + 0.12, y: 0.62, w: 2.02, chrome: true }, bumperR: { z: zB - 0.1, y: 0.62, w: 2.02, chrome: true, step: true },
    spare: { x: 0, z: -2.65, mount: 'under' },
    wheel: { x: 0.42, y: 1.46, z: zW - 0.12, tilt: 0.5 },
    frame: { x: 0.47, y: 0.6, z0: zB + 0.05, z1: zF - 0.1 },
    flaps: true, sill: 0.6, half, roofY: 1.98, roofZ: [zCab, zT - 0.05], bedZ: [zB + 0.04, zBed0 - 0.04],
  };
}

// ---------------------------------------------------------------- Rhino: the portal-axle expedition truck
export function rhinoBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z, R = spec.tyre.radius - (spec.dR || 0);
  const halfC = 1.04, zF = 2.72, zB = -2.8, cab0 = 0.55, cab1 = 2.36, floor = 1.5, cabTop = 2.78, deck = 1.52;
  // the cab: a steel box over the front axle, its roof, the two-pane windscreen, the doors and their glass
  P.box(paint, [2 * halfC, cabTop - floor, cab1 - cab0], [0, (floor + cabTop) / 2, (cab0 + cab1) / 2], { r: 0.06 });
  P.box(top, [2 * halfC + 0.04, 0.06, cab1 - cab0 + 0.06], [0, cabTop + 0.02, (cab0 + cab1) / 2], { r: 0.025 });
  for (const sx of [0.48, -0.48]) P.box(M.screen, [0.9, 0.66, 0.012], [sx, 2.33, cab1 + 0.006], { r: 0, rot: [-0.06, 0, 0] });
  P.box(paint, [0.06, 0.66, 0.02], [0, 2.33, cab1 + 0.01], { r: 0.005 });
  P.box(M.glass, [0.012, 0.62, 1.05], [halfC + 0.002, 2.32, 1.75], { r: 0, mirror: true });
  P.box(M.glass, [0.012, 0.5, 0.42], [halfC + 0.002, 2.36, 0.85], { r: 0, mirror: true });
  P.box(M.glass, [1.2, 0.42, 0.012], [0, 2.38, cab0 - 0.004], { r: 0 });
  for (const z of [2.3, 1.18]) P.box(M.black, [0.006, 1.1, 0.008], [halfC + 0.004, 2.05, z], { r: 0, mirror: true });
  P.box(M.satin, [0.02, 0.03, 0.12], [halfC + 0.012, 1.98, 1.32], { r: 0.008, mirror: true });
  P.box(M.black, [0.012, 0.04, 1.8], [halfC + 0.005, 1.66, (cab0 + cab1) / 2], { r: 0.004, mirror: true });
  P.tube(M.black, [halfC, 2.45, 2.25], [halfC + 0.24, 2.5, 2.25], 0.016, { mirror: true });
  P.box(M.black, [0.05, 0.36, 0.22], [halfC + 0.26, 2.45, 2.22], { r: 0.02, mirror: true });
  // the short bonnet in front of the cab, the grille and lamp panel
  P.box(paint, [1.62, 0.5, zF - cab1 + 0.04], [0, 1.6, (zF + cab1) / 2 - 0.02], { r: 0.05 });
  P.box(paint, [1.58, 0.06, zF - cab1 - 0.02], [0, 1.86, (zF + cab1) / 2 - 0.03], { r: 0.02, rot: [0.18, 0, 0] });
  P.box(M.black, [1.0, 0.3, 0.02], [0, 1.62, zF + 0.012], { r: 0.008 });
  for (let i = -5; i <= 5; i++) P.box(M.satin, [0.02, 0.26, 0.02], [i * 0.085, 1.62, zF + 0.022], { r: 0 });
  P.box(M.amber, [0.1, 0.05, 0.02], [0.66, 1.42, zF + 0.012], { r: 0.008, mirror: true });
  // separate mudguards over the front wheels (body-mounted, with room for the axle's travel), and steps to the cab
  {
    const g = new THREE.CylinderGeometry(R + 0.24, R + 0.24, 0.56, 22, 1, true, Math.PI / 2 - 1.05, 2.1); g.rotateZ(Math.PI / 2);
    P.add(M.black, g, [0.93, R, zf], null, true);
  }
  for (const y of [0.98, 1.24]) P.box(M.alu, [0.06, 0.03, 0.34], [halfC + 0.03, y, cab0 + 0.4], { r: 0.008, mirror: true });
  P.box(M.black, [0.04, 0.5, 0.04], [halfC + 0.02, 1.12, cab0 + 0.24], { r: 0.01, mirror: true });
  P.box(M.black, [0.04, 0.5, 0.04], [halfC + 0.02, 1.12, cab0 + 0.56], { r: 0.01, mirror: true });
  // the flatbed: a floor on the frame, drop sides, front wall, tailgate, stake pockets
  const b0 = zB + 0.02, b1 = cab0 - 0.12, bl = b1 - b0;
  P.box(M.wood, [2.16, 0.06, bl], [0, deck, (b0 + b1) / 2], { r: 0.01 });
  P.box(M.under, [2.18, 0.12, bl], [0, deck - 0.09, (b0 + b1) / 2], { r: 0.01 });
  P.box(paint, [0.04, 0.4, bl], [1.08, deck + 0.23, (b0 + b1) / 2], { r: 0.01, mirror: true });
  P.box(paint, [2.16, 0.55, 0.04], [0, deck + 0.3, b1 - 0.02], { r: 0.01 });
  P.box(paint, [2.16, 0.4, 0.04], [0, deck + 0.23, b0 + 0.02], { r: 0.01 });
  for (let i = 0; i < 4; i++) P.box(M.black, [0.05, 0.42, 0.05], [1.105, deck + 0.22, b0 + 0.2 + i * (bl - 0.4) / 3], { r: 0.008, mirror: true });
  // flat mudguards over the rear wheels, under the bed
  P.box(M.black, [0.55, 0.03, 1.25], [0.93, deck - 0.16, zr], { r: 0.008, mirror: true });
  P.box(M.black, [0.03, 0.3, 1.25], [1.19, deck - 0.3, zr], { r: 0.006, mirror: true });
  // the raised air intake: up the back of the cab to the roof
  if (spec.snorkel) {
    const [sx, sy0, sz] = spec.intake, sy = sy0 - (spec.raise || 0);
    P.cyl(M.black, 0.07, 0.07, cabTop + 0.1 - 1.1, [sx, (cabTop + 0.1 + 1.1) / 2, cab0 - 0.06]);
    P.box(M.black, [0.2, 0.16, 0.24], [sx, cabTop + 0.14, cab0 - 0.02], { r: 0.04 });
    P.box(M.satin, [0.14, 0.1, 0.02], [sx, cabTop + 0.14, cab0 + 0.11], { r: 0.01 });
    void sy; void sz;
  }
  P.box(M.plate, [0.3, 0.14, 0.012], [-0.5, deck - 0.2, zB - 0.02], { r: 0.005 });
  // spring towers: the long coils stand outside the frame rails, up to cups on arms off the rails
  for (const z of [zf, zr]) {
    const s = spec.axles[0].springTrack / 2;
    P.box(M.under, [0.03, 1.43 - 1.12, 0.3], [0.4, (1.43 + 1.12) / 2, z], { r: 0.008, mirror: true });
    P.box(M.under, [s + 0.15 - 0.385, 0.08, 0.16], [(s + 0.15 + 0.385) / 2, 1.38, z], { r: 0.01, mirror: true });
    P.cyl(M.under, 0.15, 0.15, 0.06, [s, 1.33, z], { seg: 16, mirror: true });
  }
  // a subframe under the bed: two runners on the frame
  P.box(M.under, [0.12, deck - 0.15 - 1.15, b1 - b0 - 0.1], [0.38, (deck - 0.15 + 1.15) / 2, (b0 + b1) / 2], { r: 0.01, mirror: true });
  cabin(P, M, { floorY: floor + 0.05, z0: cab0 + 0.1, z1: cab1 - 0.1, x: 0.5, w: 0.56, dashZ: cab1 - 0.25, dashY: 2.0 });
  return {
    heads: [[0.62, 1.66, zF + 0.025, 0.095]],
    tails: [[0.98, deck - 0.2, zB - 0.02, 0.1, 0.1]], reverse: [[0.98, deck - 0.32, zB - 0.02, 0.1, 0.05]],
    bumperF: { z: zF + 0.06, y: 0.84, w: 2.0 }, bumperR: { z: zB - 0.06, y: 0.9, w: 1.9 },
    spare: { x: 0, z: cab0 - 0.75, y: deck + 0.04, mount: 'bed' },
    wheel: { x: 0.5, y: 2.12, z: cab1 - 0.38, tilt: 0.95 },
    frame: { x: 0.38, y: 1.0, z0: zB + 0.1, z1: zF - 0.15 }, coilY: 1.3,
    flaps: false, sill: 0.8, half: 1.1, roofY: cabTop + 0.05, roofZ: [cab0 + 0.08, cab1 - 0.08], bedZ: [b0 + 0.04, b1 - 0.06], ownSnorkel: true,
  };
}

// ---------------------------------------------------------------- Coupe: any road car, while its model comes down
export function coupeBody(P, M, paint, top, spec) {
  const zf = spec.axles[0].z, zr = spec.axles[1].z, R = spec.tyre.radius, side = Math.sign(spec.eye?.[0] || 1);
  const body = spec.hull[0], half = Math.min(0.94, body.h[0]);
  const zF = body.c[2] + body.h[2], zB = body.c[2] - body.h[2];
  const sill = body.c[1] - body.h[1] + 0.04, belt = body.c[1] + body.h[1], roof = spec.roofY, ar = R + 0.04;
  // the body's side: a low nose rising to the beltline, a short tail, the two arches cut out of it
  const s = new THREE.Shape();
  s.moveTo(zF, sill + 0.05);
  s.lineTo(zF, belt - 0.24); s.quadraticCurveTo(zF, belt - 0.14, zF - 0.3, belt - 0.12);
  s.lineTo(zf + 0.2, belt - 0.03);
  s.lineTo(zB + 0.15, belt); s.quadraticCurveTo(zB, belt, zB, belt - 0.12);
  s.lineTo(zB, sill + 0.05);
  arch(s, zr, R, ar, sill, sill);
  arch(s, zf, R, ar, sill, sill);
  s.lineTo(zF, sill + 0.05);
  P.add(paint, slab(s, half, 0.04));
  for (const z of [zf, zr]) liner(P, M, z, R, ar, 2 * half - 0.1);
  // the glasshouse: a raked windscreen, the roof, side and back glass
  const ws0 = [zf - 0.55, belt], ws1 = [zf - 1.45, roof - 0.02], rz1 = zr + 0.35;
  windscreen(P, M, paint, ws0, ws1, half - 0.18, 0.05);
  P.box(paint, [2 * (half - 0.2), 0.04, ws1[0] - rz1], [0, roof - 0.02, (ws1[0] + rz1) / 2], { r: 0.02 });
  P.box(M.glass, [0.02, roof - belt - 0.06, ws1[0] - rz1 + 0.3], [half - 0.18, (roof + belt) / 2, (ws1[0] + rz1) / 2 + 0.1], { r: 0, mirror: true });
  P.box(M.glass, [2 * (half - 0.22), 0.02, 0.7], [0, (roof + belt) / 2, rz1 - 0.3], { r: 0, rot: [-1.05, 0, 0] });
  cabin(P, M, { floorY: sill + 0.08, z0: rz1 - 0.2, z1: ws0[0] + 0.2, x: 0.37, w: 0.46, dashZ: ws0[0] - 0.05, dashY: belt - 0.05 });
  return {
    heads: [[half - 0.25, belt - 0.22, zF - 0.02, 0.07]],
    tails: [[half - 0.2, belt - 0.12, zB - 0.01, 0.2, 0.06]], reverse: [],
    bumperF: { z: zF, y: sill + 0.1, w: 2 * half - 0.1 }, bumperR: { z: zB, y: sill + 0.12, w: 2 * half - 0.1 },
    spare: null,
    wheel: { x: side * 0.37, y: belt + 0.02, z: ws0[0] - 0.3, tilt: 0.35 },
    frame: { x: 0.4, y: sill, z0: zB + 0.2, z1: zF - 0.2 },
    flaps: false, sill, half, roofY: roof, roofZ: [rz1, ws1[0]], ownChassis: true, ownBumpers: true,
  };
}
