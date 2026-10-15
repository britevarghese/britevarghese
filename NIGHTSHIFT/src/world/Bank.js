// The story's bank: Kayal Mercantile Bank, Kannur branch. A real commercial building on a main road in town is
// picked for it (the ground floor of a shop or office block, a wall to the road); its front gets the bank's board,
// glass doors and an ATM, and walking in builds the branch inside (Interiors.enter with this layout):
//
//   the customer hall: steel chairs in rows facing the counter, the queue rail at the cash window, an enquiry desk,
//     the token display, gold-loan notices, a clock, ceiling fans and tube lights, the guard's chair by the door
//   the counter: laminate on a steel base, glass above it with cash windows, CASH / LOANS / ENQUIRY boards; the
//     cashiers sit behind it; the gap at one end is the staff gate
//   the staff floor: desks, computers, files
//   the manager's cabin: a glass partition on a solid base, his desk and two visitor chairs
//   the strongroom: thick walls, a steel door (two keys: the manager's and the cashier's, as in every Indian bank),
//     steel racks inside with bundles of 500s, 200s and 100s and the gold-loan packets
//
// People: customers (queueing, seated, at the enquiry window), two cashiers, a clerk, the manager, and the guard (an
// ex-serviceman in khaki with an old twelve-bore). Each has a place and a state the story sets: calm, cowering on the
// floor with their hands on their heads, hands up, walking somewhere (the manager to the strongroom), turning a key.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { INDOOR } from './Interiors.js';
import { BodyIK } from '../vehicles/Interaction.js';
import { handsUp, handsOnHead } from '../story/HeistProps.js';

const WALL = 0.1, DOOR_W = 0.95, DOOR_H = 2.1;
const _c = new THREE.Color(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const hex = (h) => _c.set(h).clone();
const turn = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + Math.max(-k, Math.min(k, d)); };
const SIDES = { 'x+': [1, 0], 'x-': [-1, 0], 'z+': [0, 1], 'z-': [0, -1] };   // outward, in the building's frame

// building frame <-> world
export const toWorld = (c, lx, lz) => [c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos];
const toLocal = (c, x, z) => [(x - c.cx) * c.cos - (z - c.cz) * c.sin, (x - c.cx) * c.sin + (z - c.cz) * c.cos];

// ------------------------------------------------------------------------------------------------ finding it
// a building near `near`, 8-20 m along a wall that faces a carriageway, 7-20 m deep: a shop or an office block by
// preference (the map calls most of a Kerala town's buildings houses: on a main road in town they are shops below)
export function findBank(game, near, radius = 450) {
  const W = game.world, list = W.collision.query(near.x - radius, near.z - radius, near.x + radius, near.z + radius, []);
  let best = null;
  for (const c of list) {
    const B = c.bld;
    if (!B || B.ceil - B.floor < 2.6) continue;
    for (const [side, [nx, nz]] of Object.entries(SIDES)) {
      const len = (side[0] === 'x' ? c.hz : c.hx) * 2, dep = (side[0] === 'x' ? c.hx : c.hz) * 2;
      if (len < 8 || len > 20 || dep < 7 || dep > 20) continue;
      // the road in front: carriageway 4-8 m out from the middle of this wall, none right against it
      const half = side[0] === 'x' ? c.hx : c.hz;
      const at = (d) => toWorld(c, nx * (half + d), nz * (half + d));
      const road = [4, 5.5, 7].some((d) => { const [x, z] = at(d); return W.onCarriageway(x, z); });
      if (!road) continue;
      const [fx, fz] = at(1.2);
      if (W.onCarriageway(fx, fz, 0.3)) continue;
      // an open front: no compound wall or gate (or another building) between the door and the road
      if (closedFront(W, c, side, half)) continue;
      const [mx, mz] = at(0);
      // (and not a wall shared with a neighbour: the pavement either side of the door clear)
      const d = Math.hypot(mx - near.x, mz - near.z), score = d + (len < 10 ? 40 : 0) + (dep < 9 ? 50 : 0) + (B.house ? 60 : 0);
      if (!best || score < best.score) best = { c, side, score, x: mx, z: mz };
    }
  }
  if (!best) return null;
  const { c, side } = best, [nx, nz] = SIDES[side], half = side[0] === 'x' ? c.hx : c.hz;
  // outside the door (where people walk up to it), facing in; the road point in front
  const out = toWorld(c, nx * (half + 1.4), nz * (half + 1.4)), road = toWorld(c, nx * (half + 6), nz * (half + 6));
  const yawIn = Math.atan2(best.x - out[0], best.z - out[1]);
  return { c, side, cx: c.cx, cz: c.cz, door: { x: out[0], z: out[1], yaw: yawIn }, front: { x: best.x, z: best.z }, road: { x: road[0], z: road[1] }, floor: c.bld.floor };
}

// whether anything solid stands across the way from this wall's middle out to the road (three lines a metre apart):
// a house's compound wall and its gate, a neighbour's building
function closedFront(W, c, side, half) {
  const [nx, nz] = SIDES[side], tx = -nz, tz = nx;
  let reach = 7;
  for (let d = 2; d <= 7; d += 0.5) { const [x, z] = toWorld(c, nx * (half + d), nz * (half + d)); if (W.onCarriageway(x, z)) { reach = d; break; } }
  const [ax, az] = toWorld(c, nx * (half + 0.3), nz * (half + 0.3)), [bx, bz] = toWorld(c, nx * (half + reach), nz * (half + reach));
  const list = W.collision.query(Math.min(ax, bx) - 2, Math.min(az, bz) - 2, Math.max(ax, bx) + 2, Math.max(az, bz) + 2, []);
  for (const b of list) {
    if (b === c || !(b.kind === 'barrier' || b.bld)) continue;
    for (const o of [-1, 0, 1]) {
      for (let t = 0; t <= 1; t += 0.05) {
        const lx0 = tx * o, lz0 = tz * o;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const [wx, wz] = [x + (lx0 * c.cos + lz0 * c.sin), z + (-lx0 * c.sin + lz0 * c.cos)];
        const lx = (wx - b.cx) * b.cos - (wz - b.cz) * b.sin, lz = (wx - b.cx) * b.sin + (wz - b.cz) * b.cos;
        if (Math.abs(lx) < b.hx + 0.25 && Math.abs(lz) < b.hz + 0.25) return true;
      }
    }
  }
  return false;
}

// the same building again once its tile has been rebuilt (the collider objects are new): the box nearest the spot
export function refindBank(game, site) {
  const list = game.world.collision.query(site.cx - 2, site.cz - 2, site.cx + 2, site.cz + 2, []);
  let best = null, bd = 1.5;
  for (const c of list) { if (!c.bld) continue; const d = Math.hypot(c.cx - site.cx, c.cz - site.cz); if (d < bd) { bd = d; best = c; } }
  if (best) site.c = best;
  return best;
}

// ------------------------------------------------------------------------------------------------ outside
function signTexture() {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 160;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 160); g.addColorStop(0, '#0d3a7a'); g.addColorStop(1, '#082a5a');
  x.fillStyle = g; x.fillRect(0, 0, 1024, 160);
  x.strokeStyle = '#e8c040'; x.lineWidth = 6; x.strokeRect(6, 6, 1012, 148);
  // the logo: a boat on two waves
  x.fillStyle = '#e8c040'; x.beginPath(); x.arc(92, 80, 52, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#0d3a7a'; x.beginPath(); x.moveTo(52, 82); x.lineTo(132, 82); x.lineTo(118, 100); x.lineTo(66, 100); x.closePath(); x.fill();
  x.fillRect(90, 44, 4, 38); x.beginPath(); x.moveTo(94, 46); x.lineTo(120, 76); x.lineTo(94, 76); x.closePath(); x.fill();
  x.strokeStyle = '#0d3a7a'; x.lineWidth = 5; for (const y of [110, 120]) { x.beginPath(); x.moveTo(50, y); for (let k = 0; k <= 8; k++) x.lineTo(50 + k * 10.5, y + (k % 2 ? -5 : 5)); x.stroke(); }
  x.fillStyle = '#ffffff'; x.font = '700 64px system-ui, "Segoe UI", Arial, sans-serif'; x.textBaseline = 'middle';
  x.fillText('KAYAL MERCANTILE BANK', 170, 66);
  x.fillStyle = '#e8c040'; x.font = '600 30px system-ui, "Segoe UI", Arial, sans-serif';
  x.fillText('KANNUR BRANCH  ·  ESTD. 1956  ·  GOLD LOAN · SAVINGS · NRI', 172, 122);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function textPanel(lines, { w = 512, h = 128, bg = '#1a1a1a', fg = '#ffffff', font = 54 } = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((L, i) => { x.font = `${L.weight || 700} ${L.size || font}px system-ui, "Segoe UI", Arial, sans-serif`; x.fillStyle = L.color || fg; x.fillText(L.text, w / 2, h * (i + 0.5) / lines.length); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// the board over the door, glass double doors, an ATM booth beside them (taken away again with dispose())
export function dressBank(game, site) {
  const c = site.c, [nx, nz] = SIDES[site.side], along = site.side[0] === 'x';
  const half = along ? c.hx : c.hz, len = (along ? c.hz : c.hx) * 2;
  const face = half / 0.96 + 0.05;           // (the collider is 4% inside the walls)
  const grp = new THREE.Group(); grp.name = 'bank_front';
  const fy = site.floor, cols = [];
  // the frame: x along the wall, z out of it
  const put = (o, u, y, out = 0) => { const [x, z] = toWorld(c, nx * (face + out) + (along ? 0 : u), nz * (face + out) + (along ? u : 0)); o.position.set(x, fy + y, z); o.rotation.y = Math.atan2(nx, nz) + c.angle; grp.add(o); };
  // (rotation: +z of the object out of the wall. The collider's own angle turns the frame)
  const sw = Math.min(7.5, len - 0.8);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(sw, 0.85, 0.08), [
    new THREE.MeshStandardMaterial({ color: 0x082a5a, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x082a5a, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ color: 0x082a5a, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x082a5a, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: signTexture(), roughness: 0.45, emissive: 0x202020, emissiveMap: null }), new THREE.MeshStandardMaterial({ color: 0x082a5a })]);
  put(sign, 0, 2.62, 0.06);
  // glass double doors in a steel frame, push bars
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.7, roughness: 0.35 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.45 });
  const door = new THREE.Group();
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.78, 2.15, 0.03), glass); p.position.set(s * 0.4, 1.075, 0); door.add(p);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.03, 0.03), steel); bar.position.set(s * 0.28, 1.05, 0.04); door.add(bar);
  }
  for (const [w, h, x, y] of [[1.7, 0.06, 0, 2.18], [0.06, 2.2, -0.82, 1.1], [0.06, 2.2, 0.82, 1.1], [0.04, 2.15, 0, 1.075]]) { const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), steel); f.position.set(x, y, 0); door.add(f); }
  put(door, 0, 0, 0.0);
  // the ATM booth to one side
  if (len > 9) {
    const atm = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.3), new THREE.MeshStandardMaterial({ color: 0xe8e8e4, roughness: 0.5 })); box.position.y = 1.15; atm.add(box);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), new THREE.MeshBasicMaterial({ map: textPanel([{ text: 'ATM', size: 80 }], { bg: '#0d3a7a', fg: '#ffffff' }), toneMapped: false })); top.position.set(0, 2.06, 0.152); atm.add(top);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.26), new THREE.MeshBasicMaterial({ color: 0x3a7ac8, toneMapped: false })); scr.position.set(0, 1.35, 0.152); atm.add(scr);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.16), steel); pad.position.set(0, 1.05, 0.2); atm.add(pad);
    put(atm, Math.min(len / 2 - 1.2, 3.0), 0, 0.15);
    // (solid: walked round, the camera kept out of it)
    const a = atm.rotation.y;
    cols.push({ cx: atm.position.x, cz: atm.position.z, hx: 0.7, hz: 0.2, cos: Math.cos(a), sin: Math.sin(a), angle: a, h: fy + 2.3, kind: 'barrier' });
  }
  grp.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  game.scene.add(grp);
  for (const q of cols) game.world.collision.add(q);
  return { group: grp, dispose: () => { for (const q of cols) game.world.collision.remove(q); grp.removeFromParent(); grp.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } }); } };
}

// ------------------------------------------------------------------------------------------------ inside
// the branch, laid out from the front wall: u across it (metres from its middle), w into the building
export function buildBank(I, c, door, opts = {}) {
  const B = c.bld, H = B.ceil - B.floor;
  const side = door.side, [onx, onz] = SIDES[side], nx = -onx, nz = -onz;    // n: inward
  const along = side[0] === 'x';
  const U = (along ? c.hz : c.hx) - WALL, DEP = 2 * ((along ? c.hx : c.hz) - WALL);
  const W = c.hx - WALL, D = c.hz - WALL;
  // (u, w) -> building-local (x, z): the front wall's middle is (u 0, w 0); a = along the wall
  const ax = -nz, az = nx;
  const fx = onx * (along ? W : 0), fz = onz * (along ? 0 : D);
  const L = (u, w) => [fx + ax * u + nx * w, fz + az * u + nz * w];
  const rotUW = Math.atan2(nx, nz);                 // an item's +z (its front) into the building: facing the back
  // ---- the plan
  const wc = Math.max(3.2, Math.min(5.2, DEP * 0.46));                  // the hall's depth (the counter's front)
  const back = Math.max(2.1, Math.min(3.1, DEP - wc - 0.75 - 1.7));     // the back rooms' depth
  const wb = DEP - back;                                                // their front wall
  const Vw = Math.max(2.3, Math.min(3.3, U * 0.7)), Cw = Math.max(2.3, Math.min(3.2, U * 0.7));
  const gate = [U - 1.15, U - 0.15];                                    // the staff gate (the counter's gap)
  const rooms = [
    { name: 'hall', u0: -U, u1: U, w0: 0, w1: wc, light: [0, wc * 0.5] },
    { name: 'staff', u0: -U, u1: U, w0: wc, w1: wb, light: [0, (wc + wb) / 2] },
    { name: 'vault', u0: -U, u1: -U + Vw, w0: wb, w1: DEP, light: [-U + Vw / 2, (wb + DEP) / 2] },
    { name: 'cabin', u0: U - Cw, u1: U, w0: wb, w1: DEP, light: [U - Cw / 2, (wb + DEP) / 2] },
    { name: 'records', u0: -U + Vw, u1: U - Cw, w0: wb, w1: DEP, light: [(Vw - Cw) / 2, (wb + DEP) / 2] },
  ];
  for (const r of rooms) { const [lx, lz] = L(r.light[0], r.light[1]); r.L = [lx, H - 0.35, lz]; }
  const roomAt = (lx, lz) => {
    // building-local back to (u, w)
    const px = lx - fx, pz = lz - fz, u = px * ax + pz * az, w = px * nx + pz * nz;
    return rooms.find((r) => u >= r.u0 - 0.06 && u <= r.u1 + 0.06 && w >= r.w0 - 0.06 && w <= r.w1 + 0.06) || rooms[0];
  };
  // ---- geometry with baked light (as Interiors: colour, and (sky, lamp) light per vertex)
  const geos = [], floorGeos = [], glassGeos = [], dayGeos = [], glowGeos = [], screenGeos = [], steelGeos = [], noteGeos = [];
  const colliders = [];
  const bake = (geo, col, o = {}) => {
    const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
    const C = new Float32Array(n * 3), Lt = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), ux = N.getX(i), uy = N.getY(i), uz = N.getZ(i);
      const r = roomAt(x + ux * 0.06, z + uz * 0.06), l = r.L;
      const dx = l[0] - x, dy = l[1] - y, dz = l[2] - z, dd = Math.hypot(dx, dy, dz) || 1;
      const lam = Math.max(0, (dx * ux + dy * uy + dz * uz) / dd);
      let ao = 0.72 + 0.28 * Math.min(1, y / 1.4);
      if (uy < -0.5 && !o.ceil) ao *= 0.55;
      const sky = (o.ceil ? 0.78 : 0.62 + 0.25 * uy + 0.13) * ao;
      const lamp = (0.3 + lam * 1.3 / (1 + 0.05 * dd * dd)) * ao;
      C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
      Lt[i * 2] = sky * 0.9; Lt[i * 2 + 1] = lamp;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
    geo.setAttribute('light', new THREE.BufferAttribute(Lt, 2));
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return geo;
  };
  // a box at (u, w) (its bottom at y), w across the wall-parallel axis... sizes: su along the wall, sw into the room
  const boxUW = (u, w, y, su, sh, sw, color, list = geos, rot = 0) => {
    const [lx, lz] = L(u, w);
    const g = new THREE.BoxGeometry(su, sh, sw);
    g.translate(0, sh / 2, 0);
    g.rotateY(rotUW + rot);
    g.translate(lx, y, lz);
    if (list === geos || list === floorGeos || list === steelGeos || list === noteGeos) bake(g, typeof color === 'string' ? hex(color) : color);
    list.push(g);
    return g;
  };
  const solidUW = (u0, u1, w0, w1, h) => {
    const [lx, lz] = L((u0 + u1) / 2, (w0 + w1) / 2), hu = (u1 - u0) / 2, hw = (w1 - w0) / 2;
    // (in the building's frame: the u axis is x when the door is on a z wall)
    const hx = along ? hw : hu, hz = along ? hu : hw;
    const p = toWorld(c, lx, lz);
    colliders.push({ cx: p[0], cz: p[1], hx, hz, cos: c.cos, sin: c.sin, angle: c.angle, h: B.floor + h, kind: 'interior' });
  };
  // a wall from (u0, w0) to (u1, w1) (straight along u or along w), with gaps: [{ c, w, y0, y1 }]
  const wallUW = (u0, w0, u1, w1, thick, color, gaps = [], solid = true, top = H) => {
    const horiz = Math.abs(w1 - w0) < 1e-3, a0 = horiz ? Math.min(u0, u1) : Math.min(w0, w1), a1 = horiz ? Math.max(u0, u1) : Math.max(w0, w1);
    const seg = (b0, b1, y0, y1) => {
      if (b1 - b0 < 0.01 || y1 - y0 < 0.01) return;
      const mid = (b0 + b1) / 2, len = b1 - b0;
      if (horiz) boxUW(mid, w0, y0, len, y1 - y0, thick, color); else boxUW(u0, mid, y0, thick, y1 - y0, len, color);
    };
    let cur = a0;
    for (const o of [...gaps].sort((p, q) => p.c - q.c)) {
      seg(cur, o.c - o.w / 2, 0, top);
      seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0 ?? 0);
      seg(o.c - o.w / 2, o.c + o.w / 2, o.y1 ?? DOOR_H, top);
      if (solid && (o.y0 ?? 0) > 0.4) { if (horiz) solidUW(o.c - o.w / 2, o.c + o.w / 2, w0 - thick / 2, w0 + thick / 2, o.y0); else solidUW(u0 - thick / 2, u0 + thick / 2, o.c - o.w / 2, o.c + o.w / 2, o.y0); }
      if (solid) { if (horiz) solidUW(cur, o.c - o.w / 2, w0 - thick / 2, w0 + thick / 2, H); else solidUW(u0 - thick / 2, u0 + thick / 2, cur, o.c - o.w / 2, H); }
      cur = o.c + o.w / 2;
    }
    seg(cur, a1, 0, top);
    if (solid) { if (horiz) solidUW(cur, a1, w0 - thick / 2, w0 + thick / 2, H); else solidUW(u0 - thick / 2, u0 + thick / 2, cur, a1, H); }
  };
  const paint = '#eef0ea', trim = '#c8ccc4';
  // floor (vitrified tiles), ceiling (false ceiling panels)
  {
    const g = new THREE.PlaneGeometry(2 * W + 0.2, 2 * D + 0.2, Math.ceil(W * 1.5), Math.ceil(D * 1.5));
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position, Uv = g.attributes.uv;
    for (let i = 0; i < P.count; i++) Uv.setXY(i, P.getX(i) / 0.6, P.getZ(i) / 0.6);
    bake(g, hex('#f4f2ec')); floorGeos.push(g);
    const cg = new THREE.PlaneGeometry(2 * W + 0.2, 2 * D + 0.2, Math.ceil(W), Math.ceil(D)); cg.rotateX(Math.PI / 2); cg.translate(0, H, 0);
    bake(cg, hex('#f6f6f2'), { ceil: true }); geos.push(cg);
  }
  // the outer walls: the front with the door and two shop windows, the rest plain (the strongroom has no window)
  const fw = [{ c: 0, w: 1.75, y0: 0, y1: 2.2 }];
  if (U > 3.2) fw.push({ c: -U * 0.62, w: Math.min(2.2, U * 0.5), y0: 0.9, y1: 2.2 }, { c: U * 0.62, w: Math.min(2.2, U * 0.5), y0: 0.9, y1: 2.2 });
  wallUW(-U - WALL, -WALL / 2, U + WALL, -WALL / 2, WALL, paint, fw);
  wallUW(-U - WALL, DEP + WALL / 2, U + WALL, DEP + WALL / 2, WALL, paint);
  wallUW(-U - WALL / 2, 0, -U - WALL / 2, DEP, WALL, paint);
  wallUW(U + WALL / 2, 0, U + WALL / 2, DEP, WALL, paint);
  // window glass in the front, frosted (with the bank's name read backwards from inside... just frosted)
  // (daylight through it: the street isn't drawn from in here)
  for (const o of fw.slice(1)) { const g = new THREE.PlaneGeometry(o.w, o.y1 - o.y0); g.rotateY(rotUW); const [lx, lz] = L(o.c, -0.02); g.translate(lx, (o.y0 + o.y1) / 2, lz); dayGeos.push(g); }
  // the glass doors from inside: frame and push bars
  for (const s of [-1, 1]) boxUW(s * 0.86, 0.0, 0, 0.06, 2.2, 0.1, '#9aa0a8');
  boxUW(0, 0.0, 2.17, 1.75, 0.06, 0.1, '#9aa0a8');
  { const g = new THREE.PlaneGeometry(1.7, 2.15); g.rotateY(rotUW); const [lx, lz] = L(0, -0.01); g.translate(lx, 1.075, lz); dayGeos.push(g); }
  // skirting along every wall
  for (const [u0, w0, u1, w1] of [[-U, 0.02, U, 0.02], [-U, DEP - 0.02, U, DEP - 0.02]]) boxUW((u0 + u1) / 2, w0, 0, u1 - u0, 0.1, 0.02, trim);

  // ---- the counter: steel base, laminate top, glass above with cash windows; the staff gate at one end
  const cwFront = wc, cDepth = 0.7, cH = 1.02, glassTop = 2.15;
  const winU = [-U * 0.45, U * 0.05, U * 0.5 - 0.6].filter((u) => u + 0.4 < gate[0]);
  for (const [a0, a1] of [[-U, gate[0]], [gate[1], U]]) {
    if (a1 - a0 < 0.05) continue;
    const mid = (a0 + a1) / 2, len = a1 - a0;
    boxUW(mid, cwFront + cDepth / 2, 0, len, cH - 0.04, cDepth - 0.04, '#7a8088', steelGeos);
    boxUW(mid, cwFront + cDepth / 2, cH - 0.04, len + 0.02, 0.05, cDepth, '#3a3028');
    boxUW(mid, cwFront + 0.02, 0.08, len, 0.86, 0.02, '#e8e2d4');                          // the front panel
    // glass partition on the hall edge, its cash windows a slot at the bottom
    const slots = winU.filter((u) => u > a0 && u < a1);
    let cur = a0;
    for (const u of [...slots, a1 + 9]) {
      const e = Math.min(u - 0.32, a1);
      if (e - cur > 0.02) { const g = new THREE.PlaneGeometry(e - cur, glassTop - cH); g.rotateY(rotUW); const [lx, lz] = L((cur + e) / 2, cwFront + 0.06); g.translate(lx, (cH + glassTop) / 2, lz); glassGeos.push(g); }
      if (u < a1) { const g = new THREE.PlaneGeometry(0.64, glassTop - cH - 0.18); g.rotateY(rotUW); const [lx, lz] = L(u, cwFront + 0.06); g.translate(lx, (cH + 0.18 + glassTop) / 2, lz); glassGeos.push(g); }
      cur = u + 0.32;
    }
    boxUW(mid, cwFront + 0.06, glassTop, len, 0.06, 0.06, '#9aa0a8');                        // the glass's top rail
    for (let k = 0; k <= Math.floor(len / 1.4); k++) boxUW(a0 + Math.min(len, k * 1.4), cwFront + 0.06, cH, 0.04, glassTop - cH, 0.05, '#9aa0a8');
    solidUW(a0, a1, cwFront, cwFront + cDepth, glassTop);
  }
  // counter boards over the windows
  const boards = [];
  winU.forEach((u, i) => boards.push({ u, text: ['CASH', 'LOANS & GOLD LOAN', 'ENQUIRY / NRI'][i] || 'COUNTER', no: i + 1 }));
  // the cashiers' chairs and things on the counter (a note-counting machine, a monitor, stamps)
  for (const b of boards) {
    boxUW(b.u, cwFront + 0.45, cH + 0.01, 0.34, 0.16, 0.26, '#2a2c30');          // note counter
    boxUW(b.u + 0.4, cwFront + 0.5, cH + 0.01, 0.42, 0.3, 0.04, '#141414');        // monitor
    const g = new THREE.PlaneGeometry(0.38, 0.24); g.rotateY(rotUW); const [lx, lz] = L(b.u + 0.4, cwFront + 0.525); g.translate(lx, cH + 0.17, lz); screenGeos.push(g);
    chair(b.u, cwFront + 1.15, '#2a2a30', Math.PI);
  }
  // ---- the hall: steel chairs in rows facing the counter, the queue rail at the cash window, an enquiry desk
  function chair(u, w, col, rot = 0) {
    boxUW(u, w, 0.43, 0.48, 0.05, 0.46, col, geos, rot);
    boxUW(u, w + (Math.abs(rot) > 1 ? 0.2 : -0.2), 0.48, 0.48, 0.42, 0.04, col, geos, rot);
    for (const [du, dw] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) boxUW(u + du, w + dw, 0, 0.035, 0.43, 0.035, '#5a5a5a');
  }
  const seatRows = [];
  for (let row = 0; row < 2; row++) {
    const w = 1.35 + row * 1.05;
    if (w > wc - 1.4) break;
    for (let k = 0; k < 4; k++) {
      const u = -U + 1.1 + k * 0.55;
      if (u > -0.6) break;
      boxUW(u, w, 0.42, 0.5, 0.04, 0.46, '#8a9098', steelGeos);
      boxUW(u, w - 0.21, 0.46, 0.5, 0.4, 0.04, '#8a9098', steelGeos);
      seatRows.push([u, w]);
    }
    boxUW(-U + 1.1 + 0.825, w, 0, 2.0, 0.42, 0.06, '#5a5e64');
    solidUW(-U + 0.8, -U + 2.95, w - 0.26, w + 0.24, 0.85);
  }
  // queue rail: chrome posts and a rope, in front of the cash window
  const qU = winU[0];
  for (const w of [cwFront - 0.5, cwFront - 1.5, cwFront - 2.4].filter((q) => q > 0.6)) {
    for (const s of [-1, 1]) { boxUW(qU + s * 0.45, w, 0, 0.05, 0.95, 0.05, '#c8ccd0'); boxUW(qU + s * 0.45, w, 0, 0.26, 0.04, 0.26, '#c8ccd0'); }
  }
  boxUW(qU - 0.45, cwFront - 1.45, 0.88, 0.03, 0.03, 1.9, '#8a1a1a'); boxUW(qU + 0.45, cwFront - 1.45, 0.88, 0.03, 0.03, 1.9, '#8a1a1a');
  // the enquiry / "May I help you" desk near the door, a slip table with a pen on a chain
  const helpU = U * 0.55;
  boxUW(helpU, 1.4, 0, 1.3, 0.78, 0.6, '#7a5a3a'); boxUW(helpU, 1.4, 0.78, 1.36, 0.04, 0.66, '#3a3028'); solidUW(helpU - 0.65, helpU + 0.65, 1.1, 1.7, 0.82);
  boxUW(helpU - 0.3, 1.45, 0.82, 0.34, 0.26, 0.03, '#141414');
  boxUW(0.0, wc - 1.0, 0, 0.9, 0.95, 0.5, '#9aa0a8', steelGeos); solidUW(-0.45, 0.45, wc - 1.25, wc - 0.75, 0.95);
  boxUW(0.0, wc - 1.0, 0.95, 0.4, 0.02, 0.3, '#f2f0ea');
  // a water cooler and a dustbin, a fire extinguisher by the door
  boxUW(-U + 0.35, 0.6, 0, 0.32, 1.2, 0.32, '#e8e8ea'); boxUW(-U + 0.35, 0.6, 1.2, 0.26, 0.36, 0.26, '#7ab0e0');
  boxUW(U - 0.25, 0.4, 0.5, 0.14, 0.52, 0.14, '#c81a1a');
  // the guard's chair and his old twelve-bore leaning beside it
  const guardU = U - 0.75, guardW = 0.95;
  chair(guardU, guardW, '#3a3a3a', -Math.PI / 2);
  boxUW(guardU + 0.35, guardW - 0.25, 0, 0.05, 1.05, 0.05, '#4a3020');

  // ---- the staff floor: desks with computers, files
  for (let k = 0; k < 3; k++) {
    const u = -U + Vw + 0.9 + k * 1.6, w = wc + cDepth + 1.0;
    if (u > U - 1.6 || w + 0.8 > wb) continue;
    boxUW(u, w, 0.72, 1.2, 0.04, 0.6, '#8a7458'); boxUW(u - 0.56, w, 0, 0.05, 0.72, 0.56, '#5a5a5a'); boxUW(u + 0.56, w, 0, 0.05, 0.72, 0.56, '#5a5a5a');
    boxUW(u, w + 0.15, 0.76, 0.46, 0.3, 0.04, '#141414');
    const g = new THREE.PlaneGeometry(0.42, 0.26); g.rotateY(rotUW + Math.PI); const [lx, lz] = L(u, w + 0.125); g.translate(lx, 0.92, lz); screenGeos.push(g);
    boxUW(u + 0.35, w - 0.1, 0.76, 0.22, 0.14, 0.3, ['#c83a2a', '#2a5ab0', '#e8b030'][k]);   // files
    chair(u, w - 0.55, '#2a2a30');
    solidUW(u - 0.62, u + 0.62, w - 0.3, w + 0.3, 0.76);
  }
  // steel almirahs of records along the back
  for (let u = -U + Vw + 0.6; u < U - Cw - 0.5; u += 1.0) { boxUW(u, wb - 0.3, 0, 0.92, 1.95, 0.5, '#7c8288', steelGeos); solidUW(u - 0.46, u + 0.46, wb - 0.55, wb - 0.05, 1.95); }

  // ---- the strongroom: 25 cm walls, the steel door in its frame, racks of cash inside
  const vt = 0.25, vdu = -U + Vw * 0.5, vdW = 1.0;
  wallUW(-U, wb - vt / 2, -U + Vw, wb - vt / 2, vt, '#c8c4bc', [{ c: vdu, w: vdW + 0.1, y0: 0, y1: 2.05 }]);
  wallUW(-U + Vw + vt / 2, wb, -U + Vw + vt / 2, DEP, vt, '#c8c4bc');
  boxUW(vdu, wb - vt / 2, 2.05, vdW + 0.3, 0.12, vt + 0.04, '#5a6068', steelGeos);
  for (const s of [-1, 1]) boxUW(vdu + s * (vdW / 2 + 0.08), wb - vt / 2, 0, 0.12, 2.1, vt + 0.04, '#5a6068', steelGeos);
  // racks: steel shelves with bricks of notes (500s stone grey, 200s yellow, 100s lavender) and gold-loan packets
  const racks = [];
  const rackAt = (u, w, rot, wide) => {
    for (let k = 0; k < 4; k++) boxUW(u, w, 0.15 + k * 0.48, wide, 0.03, 0.42, '#8a9098', steelGeos, rot);
    for (const s of [-1, 1]) boxUW(u + (rot ? 0 : s * wide / 2), w + (rot ? s * wide / 2 : 0), 0, 0.04, 1.9, 0.42, '#6a7078', steelGeos, rot);
    for (let k = 0; k < 4; k++) {
      const y = 0.18 + k * 0.48, n = Math.floor(wide / 0.2);
      for (let j = 0; j < n; j++) {
        const along2 = -wide / 2 + 0.1 + j * 0.2, col = k === 3 ? (j % 2 ? '#c8a050' : '#e8dcc0') : ['#b8b4a0', '#c8c0a8', '#e0b840', '#a898c8'][(j + k) % 4];
        const hgt = k === 3 ? 0.08 : 0.07 + (j % 3) * 0.07;
        const list = k === 3 ? geos : noteGeos;   // (the notes textured as bundles; the gold-loan packets plain)
        if (rot) boxUW(u, w + along2, y, 0.16, hgt, 0.18, col, list, 0); else boxUW(u + along2, w, y, 0.18, hgt, 0.16, col, list);
      }
    }
    racks.push({ u, w, rot });
  };
  const vIn = (wb + DEP) / 2;
  rackAt(-U + 0.3, vIn - 0.2, Math.PI / 2, Math.min(1.6, DEP - wb - 0.6));
  rackAt(-U + Vw * 0.55, DEP - 0.3, 0, Math.min(1.4, Vw - 0.9));
  solidUW(-U, -U + 0.55, wb + 0.2, DEP - 0.2, 1.9); solidUW(-U + 0.6, -U + Vw - 0.2, DEP - 0.55, DEP, 1.9);
  boxUW(-U + Vw - 0.55, wb + 0.75, 0, 0.6, 0.75, 0.9, '#7c8288', steelGeos); solidUW(-U + Vw - 0.85, -U + Vw - 0.25, wb + 0.3, wb + 1.2, 0.75);
  // the door: a 12 cm steel slab with a wheel and bolts, hinged on its left (opened by the story)
  const vdoorG = [];
  {
    const add = (g, col) => { bake(g, hex(col)); vdoorG.push(g); };
    const slab = new THREE.BoxGeometry(vdW, 2.0, 0.12); slab.translate(vdW / 2, 1.0, 0); add(slab, '#6a7078');
    for (let k = 0; k < 3; k++) { const b = new THREE.BoxGeometry(0.14, 0.06, 0.06); b.translate(vdW - 0.05, 0.4 + k * 0.6, 0); add(b, '#c8ccd0'); }
    // (the wheel and the two keyholes on the outer face: the pivot's +z, toward the staff floor)
    const hub = new THREE.CylinderGeometry(0.06, 0.06, 0.08, 12); hub.rotateX(Math.PI / 2); hub.translate(vdW * 0.62, 1.1, 0.1); add(hub, '#c8ccd0');
    for (let k = 0; k < 3; k++) { const sp = new THREE.BoxGeometry(0.4, 0.025, 0.025); sp.rotateZ(k * Math.PI / 3); sp.translate(vdW * 0.62, 1.1, 0.13); add(sp, '#c8ccd0'); }
    for (let k = 0; k < 2; k++) { const kh = new THREE.BoxGeometry(0.05, 0.08, 0.02); kh.translate(vdW * 0.3 + k * 0.12, 1.25, 0.07); add(kh, '#2a2a2a'); }
  }
  // the vault door's own collider, taken out when it opens
  const [vdx, vdz] = L(vdu, wb - vt / 2), vdp = toWorld(c, vdx, vdz);
  const vaultCol = { cx: vdp[0], cz: vdp[1], hx: along ? vt / 2 + 0.05 : vdW / 2, hz: along ? vdW / 2 : vt / 2 + 0.05, cos: c.cos, sin: c.sin, angle: c.angle, h: B.floor + 2.0, kind: 'interior' };
  colliders.push(vaultCol);

  // ---- the manager's cabin: a solid base to 1 m, glass above, the door; his desk, his chair, two visitor chairs
  const cu0 = U - Cw, cdoor = cu0 + 0.7;
  wallUW(cu0, wb, U, wb, 0.08, '#c8b898', [{ c: cdoor, w: 0.9, y0: 0, y1: 2.1 }], true, 1.0);
  wallUW(cu0, wb, cu0, DEP, 0.08, '#c8b898', [], true, 1.0);
  { const g = new THREE.PlaneGeometry(Cw - 0.95, 1.15); g.rotateY(rotUW); const [lx, lz] = L((cdoor + 0.45 + U) / 2, wb); g.translate(lx, 1.6, lz); glassGeos.push(g); }
  { const g = new THREE.PlaneGeometry(DEP - wb, 1.15); g.rotateY(rotUW + Math.PI / 2); const [lx, lz] = L(cu0, (wb + DEP) / 2); g.translate(lx, 1.6, lz); glassGeos.push(g); }
  boxUW((cu0 + U) / 2, wb, 2.15, Cw, 0.06, 0.08, '#8a7458'); boxUW(cu0, (wb + DEP) / 2, 2.15, 0.08, 0.06, DEP - wb, '#8a7458');
  const mU = U - Cw / 2 + 0.15, mW = DEP - 0.75;
  boxUW(mU, mW - 0.55, 0.74, 1.3, 0.04, 0.7, '#6a4428'); boxUW(mU, mW - 0.55, 0, 1.2, 0.72, 0.6, '#5a3a22'); solidUW(mU - 0.65, mU + 0.65, mW - 0.9, mW - 0.2, 0.78);
  boxUW(mU - 0.3, mW - 0.4, 0.78, 0.42, 0.28, 0.04, '#141414');
  boxUW(mU + 0.3, mW - 0.6, 0.78, 0.25, 0.05, 0.32, '#e8e2d0');
  chair(mU, mW, '#3a2418', Math.PI);
  chair(mU - 0.35, mW - 1.25, '#2a2a30'); chair(mU + 0.35, mW - 1.25, '#2a2a30');

  // ---- the walls' things: tube lights, a clock, notices, the CCTV dome, the token display
  const glowAt = (u, w, len = 1.2) => { boxUW(u, w, H - 0.08, len, 0.04, 0.12, '#f2f2f2'); boxUW(u, w, H - 0.11, len - 0.05, 0.03, 0.05, '#fff', glowGeos); };
  for (const r of rooms) glowAt((r.u0 + r.u1) / 2, (r.w0 + r.w1) / 2, Math.min(1.2, r.u1 - r.u0 - 0.4));
  glowAt(-U * 0.5, wc * 0.5); glowAt(U * 0.5, wc * 0.5);
  boxUW(0, 0.25, H - 0.25, 0.14, 0.1, 0.14, '#1a1a1a');     // CCTV
  boxUW(-U * 0.5, wc - 0.05, H - 0.32, 0.12, 0.08, 0.12, '#1a1a1a');

  // ---- meshes
  const group = new THREE.Group();
  group.position.set(c.cx, B.floor, c.cz);
  group.rotation.y = c.angle;
  const merge = (list, mat, keep) => {
    if (!list.length) return null;
    const norm = list.map((q) => { const o = q.index ? q.toNonIndexed() : q; for (const k of Object.keys(o.attributes)) if (!keep.includes(k)) o.deleteAttribute(k); return o; });
    const g = mergeGeometries(norm, false);
    if (!g) return null;
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; group.add(m); return m;
  };
  merge(geos, I.mat, ['position', 'color', 'light', 'uv']);
  merge(steelGeos, I.mat, ['position', 'color', 'light', 'uv']);
  merge(floorGeos, I.floorMat, ['position', 'color', 'light', 'uv']);
  merge(noteGeos, I.notes || I.mat, ['position', 'color', 'light', 'uv']);
  const counterGlass = new THREE.MeshBasicMaterial({ color: 0xcfe4ec, transparent: true, opacity: 0.16, depthWrite: false, fog: false, side: THREE.DoubleSide });
  merge(glassGeos, counterGlass, ['position']);
  merge(dayGeos, I.glass, ['position']);
  merge(glowGeos, I.glow, ['position']);
  merge(screenGeos, I.screen, ['position']);
  // the strongroom door on its hinge
  const vaultPivot = new THREE.Group();
  {
    const [hx, hz] = L(vdu - vdW / 2, wb - vt / 2 - 0.02);
    vaultPivot.position.set(hx, 0, hz);
    vaultPivot.rotation.y = rotUW + Math.PI;     // its +z out of the strongroom, into the staff floor
    const norm = vdoorG.map((q) => { const o = q.index ? q.toNonIndexed() : q; for (const k of Object.keys(o.attributes)) if (!['position', 'color', 'light', 'uv'].includes(k)) o.deleteAttribute(k); return o; });
    // (built in the hinge's frame: x along the door, z its thickness; un-rotate what boxUW-style building would do)
    const g = mergeGeometries(norm, false);
    const m = new THREE.Mesh(g, I.mat); m.frustumCulled = false; vaultPivot.add(m);
    group.add(vaultPivot);
  }
  // boards: counter names, the token display, notices (canvas text)
  const panel = (tex, u, w, y, wpx, hpx, rot = 0, lit = 0.9) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(wpx, hpx), new THREE.MeshBasicMaterial({ map: tex, fog: false, color: new THREE.Color(lit, lit, lit) }));
    const [lx, lz] = L(u, w); m.position.set(lx, y, lz); m.rotation.y = rotUW + rot; group.add(m); return m;
  };
  for (const b of boards) panel(textPanel([{ text: `${b.no}  ${b.text}`, size: 46 }], { bg: '#0d3a7a', w: 512, h: 96 }), b.u, cwFront + 0.02, glassTop + 0.22, 1.05, 0.2, Math.PI);
  const token = panel(textPanel([{ text: 'TOKEN  047  →  COUNTER 1', size: 44, color: '#ff3a2a' }], { bg: '#100808', w: 640, h: 96 }), -U * 0.15, cwFront + 0.02, glassTop + 0.5, 1.3, 0.2, Math.PI, 1);
  void token;
  panel(textPanel([{ text: 'GOLD LOAN', size: 56, color: '#e8c040' }, { text: '@ 8.5% p.a. · 1 hour sanction', size: 30 }], { bg: '#5a1018', w: 512, h: 200 }), U - 0.04 - 0.01, wc * 0.55, 1.75, 0.9, 0.36, Math.PI / 2);
  panel(textPanel([{ text: 'KAYAL MERCANTILE BANK', size: 34, color: '#0d3a7a' }, { text: 'Serving Kannur since 1956', size: 26, color: '#333' }], { bg: '#f2efe4', w: 512, h: 140 }), -U + 0.04, wc * 0.4, 1.8, 1.0, 0.28, -Math.PI / 2);
  panel(textPanel([{ text: 'Strong Room', size: 40, color: '#ffffff' }, { text: 'Authorised staff only', size: 26, color: '#ffd0d0' }], { bg: '#7a1818', w: 512, h: 140 }), vdu, wb - vt - 0.02, 2.45, 0.7, 0.2, Math.PI);
  // clock
  { const cl = new THREE.Mesh(new THREE.CircleGeometry(0.17, 24), new THREE.MeshBasicMaterial({ map: textPanel([{ text: '10:20', size: 40, color: '#111' }], { bg: '#f4f0e0', w: 128, h: 128 }), fog: false })); const [lx, lz] = L(0, DEP - 0.03); cl.position.set(lx, 2.45, lz); cl.rotation.y = rotUW + Math.PI; group.add(cl); }
  // ceiling fans over the hall
  const fans = [];
  for (const fu of [-U * 0.5, U * 0.5]) {
    const fan = new THREE.Group(), parts = [];
    const rod = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6); rod.translate(0, -0.175, 0); bake(rod, hex('#e8e4dc')); parts.push(rod);
    const mot = new THREE.CylinderGeometry(0.14, 0.12, 0.12, 12); mot.translate(0, -0.4, 0); bake(mot, hex('#d8d4cc')); parts.push(mot);
    for (let k = 0; k < 3; k++) { const b = new THREE.BoxGeometry(0.11, 0.012, 0.6); b.translate(0, -0.42, 0.42); b.rotateY(k * Math.PI * 2 / 3); bake(b, hex('#e0dcd2')); parts.push(b); }
    const g = mergeGeometries(parts.map((q) => { const o = q.index ? q.toNonIndexed() : q; o.deleteAttribute('normal'); return o; }), false);
    fan.add(new THREE.Mesh(g, I.mat)); const [lx, lz] = L(fu, wc * 0.5 + 0.6); fan.position.set(lx, H, lz); group.add(fan); fans.push(fan);
  }
  I.fans = fans;
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });

  // ---- marks: where people stand / sit, in the world (x, z, yaw facing)
  const yawOf = (du, dw) => { const [lx, lz] = [ax * du + nx * dw, az * du + nz * dw]; return Math.atan2(lx * c.cos + lz * c.sin, -lx * c.sin + lz * c.cos); };
  const M = (u, w, fu = 0, fw = 1) => { const [lx, lz] = L(u, w), p = toWorld(c, lx, lz); return { x: p[0], z: p[1], yaw: yawOf(fu, fw), u, w }; };
  const marks = {
    inside: M(0, 1.0), hallMid: M(0, wc * 0.5), hallLeft: M(-U * 0.45, wc * 0.42, 1, 0.3), nearDoor: M(U * 0.3, 0.9, -0.3, 1),
    guard: M(guardU, guardW, -1, 0.2),
    queue: [M(qU, cwFront - 0.6), M(qU, cwFront - 1.3), M(qU, cwFront - 2.0)].filter((m) => m.w > 0.7),
    seats: seatRows.slice(0, 3).map(([u, w]) => M(u, w + 0.02)),
    help: M(helpU, 1.4 - 0.6), helpStaff: M(helpU, 1.4 + 0.55, 0, -1),
    cashiers: boards.slice(0, 2).map((b) => M(b.u, cwFront + 1.12, 0, -1)),
    clerk: M(-U + Vw + 0.9, wc + cDepth + 0.45, 0, 1),
    manager: M(mU, mW + 0.02, 0, -1), cabinDoor: M(cdoor, wb - 0.6, 0, 1),
    gate: M((gate[0] + gate[1]) / 2, cwFront + cDepth / 2, 0, 1), gateHall: M((gate[0] + gate[1]) / 2, cwFront - 0.6, 0, 1), gateStaff: M((gate[0] + gate[1]) / 2, cwFront + cDepth + 0.5, -0.4, 1),
    vaultFront: M(vdu, wb - vt - 0.7, 0, 1), vaultKey: M(vdu + 0.3, wb - vt - 0.45, 0, 1), vaultKey2: M(vdu - 0.25, wb - vt - 0.5, 0.2, 1),
    vaultIn: M(vdu, (wb + DEP) / 2 + 0.1, -0.2, 1), staffMid: M(0, (wc + cDepth + wb) / 2),
    racks: racks.map((r) => (r.rot ? M(r.u + 0.75, r.w, -1, 0) : M(r.u, r.w - 0.75, 0, 1))),
  };
  // the way out: inside the door; out to the pavement
  const spawn = L(0, 0.8), exit = L(0, 0.4);
  const outLocal = L(0, -1.0);
  return {
    c, group, colliders, floor: B.floor, ceil: B.ceil, type: 'bank', title: 'Kayal Mercantile Bank', rooms: [],
    spawn, spawnYaw: Math.atan2(nx, nz), exit, outside: outLocal, outYaw: Math.atan2(onx, onz),
    marks, vault: { pivot: vaultPivot, collider: vaultCol, open: 0 }, U, DEP, wc, wb,
    tick: null, dispose: null,
  };
}

// open the strongroom door (k 0..1 of the swing; past half way its collider goes)
export function setVault(layout, k) {
  const V = layout.vault;
  V.open = k;
  V.pivot.rotation.y = V.pivot.userData.r0 ?? (V.pivot.userData.r0 = V.pivot.rotation.y);
  V.pivot.rotation.y = V.pivot.userData.r0 - k * 1.85;
  const col = V.collider, I = layout.colliders, i = I.indexOf(col);
  if (k > 0.45 && i >= 0) I.splice(i, 1);
  if (k <= 0.45 && i < 0) I.push(col);
}

// ------------------------------------------------------------------------------------------------ the people
// a bank's worth of people, each at a mark: { role, human, x, z, yaw, sit, state, ... }. update() poses them:
//   calm: standing (talking, idle) or sitting; cower: down on the floor, hands on the head, face down;
//   handsup: standing with the hands raised; walk: to a point (hands up), then the next state; key: turning a key
export class BankPeople {
  constructor(game, layout) {
    this.game = game; this.layout = layout; this.list = [];
    const H = game.humans, m = layout.marks, sh = { shadow: false };
    const add = (role, which, mark, opts = {}) => {
      if (!mark) return null;
      const h = H.create(which, { ...sh, outfit: opts.outfit, idle: opts.talk ? 'talk' : 'idle' });
      if (!h) return null;
      h.group.traverse((o) => o.layers.enable(INDOOR));
      game.scene.add(h.group);
      const p = { role, human: h, x: mark.x, z: mark.z, yaw: mark.yaw, home: mark, sit: !!opts.sit, state: 'calm', t: 0, delay: 0, ik: new BodyIK(h), speed: 0 };
      if (opts.talk) h.play('talk', { hold: true, fade: 0 });
      if (opts.sit) h.play('sitIdle', { hold: true, fade: 0 });
      this.list.push(p);
      return p;
    };
    // the staff: two cashiers (a woman in office wear, a man in a white shirt), a clerk, the manager (blue shirt)
    this.cashier = add('cashier', 'kl_office', m.cashiers[0], { sit: true });
    add('cashier2', 'alex', m.cashiers[1], { sit: true, outfit: { top: 0xf2f0ea, bottom: 0x23262c } });
    add('clerk', 'pmariano', m.clerk, { sit: true, outfit: { top: 0xa9c8e8, bottom: 0x2e2e30 } });
    this.manager = add('manager', 'arnold', m.manager, { sit: true, outfit: { top: 0x8fb0d8, bottom: 0x1f2430 } });
    add('help', 'kl_saree_pink', m.helpStaff, { sit: false });
    // the guard: an ex-serviceman in khaki
    this.guard = add('guard', 'emilius', m.guard, { outfit: { top: 0xb8a070, bottom: 0x8a7650 } });
    // customers: in the queue, on the chairs, at the enquiry window
    const people = ['kl_saree', 'kl_elder', 'jake', 'kl_saree_yellow', 'kl_kurta_dhoti', 'kl_saree_rose'];
    let k = 0;
    for (const q of m.queue) add('customer', people[k++ % people.length], q, { outfit: k === 3 ? { top: 0xe6dcc0, bottom: 0xf2efe6 } : undefined });
    for (const s of m.seats.slice(0, 2)) add('customer', people[k++ % people.length], s, { sit: true });
    add('customer', 'songbird', m.help, { talk: true, outfit: { top: 0x7a1f2b, bottom: 0xf2efe6 } });
  }

  // everyone onto the floor (cowering) a moment apart; the ones behind the counter put their hands up first
  holdUp(from) {
    for (const p of this.list) {
      if (p.state !== 'calm') continue;
      p.delay = 0.15 + Math.random() * 0.9;
      p.next = p.role === 'cashier' || p.role === 'cashier2' || p.role === 'manager' || p.role === 'clerk' ? 'handsup' : 'cower';
      p.from = from;
    }
  }
  // someone walks (hands up) to a point, then does `then` ('key' | 'cower' | 'handsup')
  walk(p, mark, then = 'handsup') { if (!p) return; p.state = 'walk'; p.dest = mark; p.then = then; p.sit = false; p.human.clearAction(0.2); }

  update(dt) {
    for (const p of this.list) this._one(p, dt);
  }
  _one(p, dt) {
    const h = p.human, g = h.group, fy = this.layout.floor;
    p.t += dt;
    if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0 && p.next) { this._set(p, p.next); p.next = null; } }
    let speed = 0;
    if (p.state === 'walk') {
      const dx = p.dest.x - p.x, dz = p.dest.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.12) { p.yaw = p.dest.yaw; this._set(p, p.then); }
      else { const sp = Math.min(1.25, d / dt); p.x += dx / d * sp * dt; p.z += dz / d * sp * dt; p.yaw = turn(p.yaw, Math.atan2(dx, dz), dt * 8); speed = 1.25; }
    }
    // cowering faces away from the trouble
    if (p.state === 'cower' && p.from) p.yaw = turn(p.yaw, Math.atan2(p.x - p.from.x, p.z - p.from.z), dt * 3);
    g.position.set(p.x, fy, p.z); g.rotation.set(0, p.yaw, 0); g.updateMatrixWorld(true);
    h.animate(speed, dt);
    // sitting: the hips onto the seat (the clip's hips are its own height)
    if (p.sit && h.B.Hips) {
      const hp = h.B.Hips.getWorldPosition(_v), want = fy + 0.5;
      g.position.y += want - hp.y; g.updateMatrixWorld(true);
    }
    const k = Math.min(1, p.t / 0.35);
    if (p.state === 'handsup' || (p.state === 'walk' && p.then !== 'calm')) handsUp(h, p.ik, p.state === 'walk' ? 0.8 : k);
    else if (p.state === 'cower') { handsOnHead(h, p.ik, k); if (h.B.Head) p.ik.look(_w.set(p.x + Math.sin(p.yaw) * 2, fy - 1, p.z + Math.cos(p.yaw) * 2), 0.6 * k); }
    else if (p.state === 'key') p.ik.look(_w.set(this.layout.marks.vaultFront.x, fy + 1.1, this.layout.marks.vaultFront.z), 0.5);
  }
  _set(p, state) {
    const h = p.human;
    p.state = state; p.t = 0;
    if (state === 'cower') { p.sit = false; h.play('crouchIdle', { hold: true, fade: 0.35 }); }
    else if (state === 'handsup') { if (!p.sit) h.clearAction(0.25); }
    else if (state === 'key') { h.play('interact', { rate: 0.9, fade: 0.2 }); }
    else if (state === 'calm') { h.clearAction(0.3); }
  }

  dispose() { for (const p of this.list) { p.human.group.removeFromParent(); p.human.dispose?.(); } this.list = []; }
}
