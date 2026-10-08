// Walk into any plain building: when the player steps through its door, the ground floor is generated inside the
// footprint (rooms split by partition walls with doorways, furniture by room type, windows with grills, tube lights
// and ceiling fans), solid for walking and the camera, and thrown away again on the way out. Same building, same
// rooms: the layout is seeded from the building. Kerala homes (sit-out living room, bedrooms with steel almirahs,
// a kitchen with a gas stove and cylinder, a tiled bathroom), shops (shelves round the walls, a counter facing the
// door, a store room behind), offices and sheds.
// The lighting is baked into the vertices (tube light falloff, ambient occlusion, daylight from the windows) and
// mixed in the shader by the time of day, so going in adds no lights and recompiles nothing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const WALL = 0.1, DOOR_W = 0.95, DOOR_H = 2.1;
const INDOOR = 3;   // render layer: inside, the camera sees only the room and the player (a garden tree or a
                    // neighbour's wall standing into the footprint stays outside)
const _c = new THREE.Color();
const hex = (h) => _c.set(h).clone();

// a floor of 60 cm vitrified tiles (or red oxide), grout lines in the texture, tinted per building
function floorTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const x = cv.getContext('2d');
  x.fillStyle = '#e8e4dc'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) { const v = 200 + Math.random() * 40 | 0; x.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`; x.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 5, 1 + Math.random() * 3); }
  x.fillStyle = 'rgba(80,70,60,0.55)'; x.fillRect(0, 0, 256, 3); x.fillRect(0, 0, 3, 256);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// colour * (ambient * daylight + tube light * lamps on): attribute `light` = (ambient, lamp)
function litMaterial(opts) {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, ...opts });
  m.userData.u = { uDay: { value: 1 }, uLamp: { value: 1 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 light; varying vec2 vLight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLight = light;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uDay; uniform float uLamp; varying vec2 vLight;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vLight.x * uDay + vLight.y * uLamp;');
  };
  m.customProgramCacheKey = () => 'interiorLit';
  return m;
}

export class Interiors {
  constructor(game) {
    this.game = game;
    this.active = null;          // { c, group, colliders, floor, ceil, door: {x, z, out: [x, z]} }
    this.colliders = [];
    this.mat = litMaterial({});
    this.floorMat = litMaterial({ map: floorTexture() });
    this.glass = new THREE.MeshBasicMaterial({ color: 0xdde8f0, fog: false });
    this.glow = new THREE.MeshBasicMaterial({ color: 0xf4fbff, fog: false });
    this.screen = new THREE.MeshBasicMaterial({ color: 0x1a2a40, fog: false });
    this.fans = [];
    this.fade = 0; this.fadeEl = null; this.pending = null;
  }

  // ------------------------------------------------------------------ door finding
  // the building wall the player is standing at and facing: { c, side, t } (side: 'x+' 'x-' 'z+' 'z-', t: along it)
  doorAt(x, z, yaw) {
    const col = this.game.world.collision;
    if (!col || this.active) return null;
    const tmp = this._tmp || (this._tmp = []);
    col.query(x - 1.5, z - 1.5, x + 1.5, z + 1.5, tmp);
    let best = null, bd = 1.05;
    for (const c of tmp) {
      if (!c.bld) continue;
      const lx = (x - c.cx) * c.cos - (z - c.cz) * c.sin, lz = (x - c.cx) * c.sin + (z - c.cz) * c.cos;
      const ox = Math.abs(lx) - c.hx, oz = Math.abs(lz) - c.hz;
      if (ox > 0 && oz > 0) continue;               // round a corner
      const d = Math.max(ox, oz);
      if (d < -0.1 || d > bd) continue;
      const side = ox > oz ? (lx > 0 ? 'x+' : 'x-') : (lz > 0 ? 'z+' : 'z-');
      const along = side[0] === 'x' ? c.hz : c.hx;
      if (along < 1.4) continue;
      const t = Math.max(-along + 0.85, Math.min(along - 0.85, side[0] === 'x' ? lz : lx));
      // facing the wall: the walk direction in the building's frame against the outward normal
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const flx = fx * c.cos - fz * c.sin, flz = fx * c.sin + fz * c.cos;
      const nrm = side === 'x+' ? flx : side === 'x-' ? -flx : side === 'z+' ? flz : -flz;
      if (nrm > -0.35) continue;
      bd = d; best = { c, side, t };
    }
    return best;
  }

  // ------------------------------------------------------------------ enter / leave
  enter(door) {
    if (this.active) return;
    const c = door.c, B = c.bld;
    const g = this._build(c, door);
    this.game.scene.add(g.group);
    g.group.traverse((o) => o.layers.set(INDOOR));
    this.game.onFoot.body.group.traverse((o) => o.layers.enable(INDOOR));
    this.game.scene.traverse((o) => { if (o.isLight) o.layers.enable(INDOOR); });   // same lights: nothing recompiles
    this._mask = this.game.camera.layers.mask;
    this.game.camera.layers.set(INDOOR);
    c.off = true;                                  // its outer box no longer pushes the player out
    const P = this.game.peds;
    if (g.keeper && P?.spawnIndoor) { const k = this._toWorld(c, g.keeper[0], g.keeper[1]); g.person = P.spawnIndoor(k[0], B.floor, k[1], g.keeper[2] + c.angle); }
    if (P) P.indoorColliders = g.colliders;
    this.active = g;
    this.colliders = g.colliders;
    const p = this._toWorld(c, ...g.spawn);
    const f = this.game.onFoot, s = f.state;
    s.x = p[0]; s.z = p[1]; s.y = B.floor; s.vx = s.vz = 0; f.vy = 0;
    s.yaw = g.spawnYaw + c.angle; f.camYaw = s.yaw; f.camPitch = 0.12;
    f.camPos.set(s.x - Math.sin(s.yaw) * 1.5, s.y + 1.7, s.z - Math.cos(s.yaw) * 1.5);
    this.game.ui?.toast?.({ house: 'Home', shop: 'Shop', office: 'Office', shed: 'Shed' }[g.type] || 'Inside', '', 1.2);
  }

  leave() {
    const A = this.active;
    if (!A) return;
    const c = A.c, f = this.game.onFoot, s = f.state;
    const p = this._toWorld(c, ...A.outside);
    s.x = p[0]; s.z = p[1]; s.vx = s.vz = 0;
    s.y = this.game.world.layout.groundHeight(s.x, s.z, A.floor + 0.5);
    s.yaw = A.outYaw + c.angle; f.camYaw = s.yaw;
    f.camPos.set(s.x - Math.sin(s.yaw) * 3, s.y + 2, s.z - Math.cos(s.yaw) * 3);
    this.dispose();
  }

  dispose() {
    const A = this.active;
    if (!A) return;
    A.c.off = false;
    this._show(null);
    if (A.person) this.game.peds?.remove(A.person);
    if (this.game.peds) this.game.peds.indoorColliders = null;
    this.game.camera.layers.mask = this._mask ?? 1;
    this.game.scene.remove(A.group);
    A.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    this.active = null; this.colliders = []; this.fans = [];
    if (this.game.env) this.game.env.indoorLamp = 0;
    this.game.env?.update?.(0, this.game.camera.position, true);   // the sky light back to outdoors
  }

  _show(h) {
    if (h === this._shown) return;
    this._shown?.group.traverse((o) => o.layers.disable(INDOOR));
    h?.group.traverse((o) => o.layers.enable(INDOOR));
    this._shown = h;
  }

  // the player near the way out (the inside of the door they came in by)
  nearExit(x, z) {
    const A = this.active;
    if (!A) return false;
    const p = this._toWorld(A.c, ...A.exit);
    return Math.hypot(x - p[0], z - p[1]) < 1.15;
  }

  // a black blink while the door is used; `fn` runs at the dark moment
  blink(fn) {
    if (this.pending) return;
    if (!this.fadeEl) {
      const d = document.createElement('div');
      d.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:40;transition:none';
      document.body.appendChild(d); this.fadeEl = d;
    }
    this.pending = { fn, t: 0 };
  }

  update(dt, env) {
    if (this.pending) {
      const P = this.pending; P.t += dt;
      if (P.t >= 0.22 && P.fn) { const fn = P.fn; P.fn = null; fn(); }
      const o = P.t < 0.22 ? P.t / 0.22 : Math.max(0, 1 - (P.t - 0.3) / 0.3);
      this.fadeEl.style.opacity = o.toFixed(3);
      if (P.t > 0.6) { this.pending = null; this.fadeEl.style.opacity = '0'; }
    }
    const A = this.active;
    if (!A) return;
    // left some other way (respawn, a loaded save, back in a car): gone
    if (Math.hypot(this.game.onFoot.state.x - A.c.cx, this.game.onFoot.state.z - A.c.cz) > 60 || !this.game.onFoot.active) { this.dispose(); return; }
    const night = env?.night ?? 0, day = 1 - night;
    const lamps = A.type === 'shop' || A.type === 'office' ? 0.3 + 0.7 * night : Math.min(1, 0.25 + night * 1.2);
    for (const m of [this.mat, this.floorMat]) { m.userData.u.uDay.value = 0.22 + 0.78 * day; m.userData.u.uLamp.value = lamps; }
    this.glass.color.setRGB(0.07 + 0.68 * day, 0.09 + 0.72 * day, 0.16 + 0.72 * day);
    // the player is lit by the room: the sky light turns into tube light (same light, nothing recompiles)
    if (this.game.env) this.game.env.indoorLamp = lamps;
    this.glow.color.setScalar(lamps > 0.5 ? 1 : 0.45);
    for (const f of this.fans) f.rotation.y += dt * 9;
    // whoever is in here (their character comes from the crowd's pool) is drawn on the indoor layer
    this._show(A.person?.human || null);
  }

  // ------------------------------------------------------------------ geometry helpers
  _toWorld(c, lx, lz) { return [c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos]; }

  _build(c, door) {
    const B = c.bld;
    let s = B.seed || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
    const W = c.hx - WALL, D = c.hz - WALL, H = B.ceil - B.floor;
    const type = B.shop ? 'shop' : B.kind === 2 ? 'shed' : B.kind === 4 ? 'office' : 'house';
    // ---- the entry door on the inside of the wall they walked up to
    const side = door.side, t = door.t;
    const sideNorm = { 'x+': [-1, 0], 'x-': [1, 0], 'z+': [0, -1], 'z-': [0, 1] }[side]; // inward
    const dpos = side === 'x+' ? [W, t] : side === 'x-' ? [-W, t] : side === 'z+' ? [t, D] : [t, -D];
    const doorways = [{ axis: side[0], at: side[0] === 'x' ? dpos[0] : dpos[1], c: t, outer: true }];
    // ---- rooms: split the floor plan while the rooms are big
    const rooms = [];
    let keeper = null;
    const limit = type === 'shop' ? 7.5 : type === 'office' ? 6.5 : type === 'shed' ? 99 : 4.3;
    const near = (r, axis, v) => doorways.some((d) => d.axis !== axis && Math.abs(d.c - v) < DOOR_W / 2 + 0.45 &&
      (d.axis === 'x' ? d.at >= r.x0 - 0.02 && d.at <= r.x1 + 0.02 : d.at >= r.z0 - 0.02 && d.at <= r.z1 + 0.02));
    const parts = [];
    const split = (r, depth) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      if (Math.max(w, d) < limit * 1.2 || depth >= (type === 'shop' ? 1 : 3) || w * d < 8) { rooms.push(r); return; }
      const axis = type === 'shop' ? side[0] : (w >= d ? 'x' : 'z');    // a shop: the store room across the back
      const lo = axis === 'x' ? r.x0 : r.z0, hi = axis === 'x' ? r.x1 : r.z1;
      if (hi - lo < 4.4) { rooms.push(r); return; }
      let at = null;
      for (let k = 0; k < 8 && at === null; k++) {
        let v = type === 'shop' ? (side === 'x+' || side === 'z+' ? lo + (hi - lo) * 0.3 : lo + (hi - lo) * 0.7) : lo + (hi - lo) * (0.36 + rnd() * 0.28);
        if (type === 'shop') v += (rnd() - 0.5) * 0.3;
        if (v - lo < 2.1 || hi - v < 2.1 || near(r, axis, v)) continue;
        at = v;
      }
      if (at === null) { rooms.push(r); return; }
      // the partition and its doorway (somewhere along it, clear of its ends)
      const a0 = axis === 'x' ? r.z0 : r.x0, a1 = axis === 'x' ? r.z1 : r.x1;
      const dc = a0 + 0.75 + rnd() * Math.max(0, a1 - a0 - 1.5);
      doorways.push({ axis, at, c: dc });
      parts.push({ axis, at, a0, a1, dc });
      const A = { ...r }, Bb = { ...r };
      if (axis === 'x') { A.x1 = at - WALL / 2; Bb.x0 = at + WALL / 2; } else { A.z1 = at - WALL / 2; Bb.z0 = at + WALL / 2; }
      split(A, depth + 1); split(Bb, depth + 1);
    };
    split({ x0: -W, x1: W, z0: -D, z1: D }, 0);
    // ---- room types
    const inR = (r, x, z) => x >= r.x0 - 0.05 && x <= r.x1 + 0.05 && z >= r.z0 - 0.05 && z <= r.z1 + 0.05;
    const entry = rooms.find((r) => inR(r, dpos[0] + sideNorm[0] * 0.3, dpos[1] + sideNorm[1] * 0.3)) || rooms[0];
    const area = (r) => (r.x1 - r.x0) * (r.z1 - r.z0);
    const others = rooms.filter((r) => r !== entry).sort((a, b) => area(a) - area(b));
    if (type === 'house') {
      entry.type = 'living';
      if (others.length && area(others[0]) < 9 && others.length > 1) others.shift().type = 'bath';
      const order = ['kitchen', 'bed', 'bed', 'dining', 'bed', 'store'];
      others.sort((a, b) => area(b) - area(a)).forEach((r, i) => { r.type = order[i] || 'bed'; });
      // the kitchen goes to a mid-sized room, the biggest one other than the hall is a bedroom
      const big = others[0], k = others.find((r) => r.type === 'kitchen');
      if (big && k && big === k && others.length > 1) { big.type = 'bed'; others[1].type = 'kitchen'; }
    } else if (type === 'shop') { entry.type = 'shop'; others.forEach((r) => { r.type = 'store'; }); }
    else if (type === 'office') { entry.type = 'office'; others.forEach((r, i) => { r.type = i === 0 && area(r) < 9 ? 'bath' : 'office'; }); }
    else { entry.type = 'shed'; others.forEach((r) => { r.type = 'store'; }); }
    for (const r of rooms) r.light = [(r.x0 + r.x1) / 2, H - 0.35, (r.z0 + r.z1) / 2];

    // ---- palette
    const paint = type === 'house' ? pick(['#e9dfc4', '#d9e6d0', '#e6d2c8', '#cfe0e6', '#efe6b8', '#e4d6ea']) : type === 'shed' ? '#9a958c' : pick(['#ecebe4', '#e2e6e0']);
    const floorTint = type === 'shed' ? '#7c766c' : type === 'house' ? pick(['#ffffff', '#f4e4d0', '#b8584a', '#d8d0c0']) : pick(['#ffffff', '#e8e0d4']);
    const wood = pick(['#6b4428', '#7a5232', '#5a3a22']);

    // ---- geometry: boxes with colour and baked light
    const geos = [], floorGeos = [], glassGeos = [], glowGeos = [], screenGeos = [];
    const colliders = [];
    const roomOf = (x, z) => rooms.find((r) => inR(r, x, z)) || entry;
    const bake = (geo, col, opts = {}) => {
      const P = geo.attributes.position, N = geo.attributes.normal, n = P.count;
      const C = new Float32Array(n * 3), L = new Float32Array(n * 2);
      for (let i = 0; i < n; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i), nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i);
        const r = roomOf(x + nx * 0.06, z + nz * 0.06), l = r.light;
        const dx = l[0] - x, dy = l[1] - y, dz = l[2] - z, dd = Math.hypot(dx, dy, dz) || 1;
        const lam = Math.max(0, (dx * nx + dy * ny + dz * nz) / dd);
        // occlusion: dark into the corners and under things
        const wx = Math.min(x - r.x0, r.x1 - x), wz = Math.min(z - r.z0, r.z1 - z), edge = Math.min(wx, wz);
        let ao = Math.min(1, 0.62 + 0.38 * Math.min(1, Math.max(0, edge) / 0.7));
        ao *= 0.72 + 0.28 * Math.min(1, y / 1.4);
        if (ny < -0.5 && !opts.ceil) ao *= 0.55;
        ao *= opts.ao ?? 1;
        const sky = (opts.ceil ? 0.78 : 0.62 + 0.25 * ny + 0.13) * ao;
        const lamp = (0.25 + lam * 1.25 / (1 + 0.07 * dd * dd)) * ao;
        C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
        L[i * 2] = sky * 0.95; L[i * 2 + 1] = lamp;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      geo.setAttribute('light', new THREE.BufferAttribute(L, 2));
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      return geo;
    };
    // a box in building-local space (centre x, bottom y, centre z), optionally turned by `rot`
    const box = (x, y, z, w, h, d, color, rot = 0, list = geos, seg = 1) => {
      const g = new THREE.BoxGeometry(w, h, d, seg > 1 ? Math.max(1, Math.round(w / seg)) : 1, seg > 1 ? Math.max(1, Math.round(h / seg)) : 1, seg > 1 ? Math.max(1, Math.round(d / seg)) : 1);
      g.translate(0, h / 2, 0);
      if (rot) g.rotateY(rot);
      g.translate(x, y, z);
      if (list === geos || list === floorGeos) bake(g, typeof color === 'string' ? hex(color) : color);
      list.push(g);
      return g;
    };
    const solid = (x, z, hx, hz, h) => {
      const p = this._toWorld(c, x, z);
      colliders.push({ cx: p[0], cz: p[1], hx, hz, cos: c.cos, sin: c.sin, angle: c.angle, h: B.floor + h, kind: 'interior' });
    };

    // floor (tiles: uv in 60 cm), ceiling
    {
      const g = new THREE.PlaneGeometry(2 * W + 0.2, 2 * D + 0.2, Math.ceil(W * 1.5), Math.ceil(D * 1.5));
      g.rotateX(-Math.PI / 2);
      const P = g.attributes.position, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) U.setXY(i, P.getX(i) / 0.6, P.getZ(i) / 0.6);
      bake(g, hex(floorTint)); floorGeos.push(g);
      const cg = new THREE.PlaneGeometry(2 * W + 0.2, 2 * D + 0.2, Math.ceil(W), Math.ceil(D));
      cg.rotateX(Math.PI / 2); cg.translate(0, H, 0);
      bake(cg, hex('#f2f0ea'), { ceil: true }); geos.push(cg);
    }
    // outer walls, inner faces; windows cut into them (sill 0.9 m, 1.2 m tall) with the gaps filled round them
    const windows = [];   // { axis, at, c, w } for furniture to keep clear of
    const outer = [['x', -W, -D, D, 'x-'], ['x', W, -D, D, 'x+'], ['z', -D, -W, W, 'z-'], ['z', D, -W, W, 'z+']];
    const wallColor = (x, z) => (roomOf(x, z).type === 'bath' ? hex('#d6e4ea') : hex(paint));
    for (const [axis, at, a0, a1, sd] of outer) {
      // openings along this wall: the door and the windows (a window every ~3.2 m, clear of partitions)
      const ops = [];
      if (sd === side) ops.push({ c: t, w: DOOR_W + 0.1, y0: 0, y1: DOOR_H + 0.05, door: true });
      const L = a1 - a0, nwin = type === 'shed' ? 0 : Math.floor(L / 3.2);
      for (let k = 0; k < nwin; k++) {
        const cc = a0 + (k + 0.5) * (L / nwin), w = type === 'shop' ? 1.5 : 1.2;
        if (ops.some((o) => Math.abs(o.c - cc) < (o.w + w) / 2 + 0.4)) continue;
        if (parts.some((p) => p.axis !== axis && Math.abs(p.at - cc) < w / 2 + 0.3)) continue;
        if (rnd() < 0.15) continue;
        ops.push({ c: cc, w, y0: 0.9, y1: 2.1 });
        windows.push({ axis, at, c: cc, w });
      }
      ops.sort((a, b) => a.c - b.c);
      const seg = (b0, b1, y0, y1) => {
        if (b1 - b0 < 0.01 || y1 - y0 < 0.01) return;
        const mc = (b0 + b1) / 2, len = b1 - b0, nIn = -Math.sign(at), wc = at + Math.sign(at) * WALL / 2;
        const g = axis === 'x' ? new THREE.BoxGeometry(WALL, y1 - y0, len, 1, Math.max(1, Math.round((y1 - y0) / 0.8)), Math.max(1, Math.round(len / 0.8))) : new THREE.BoxGeometry(len, y1 - y0, WALL, Math.max(1, Math.round(len / 0.8)), Math.max(1, Math.round((y1 - y0) / 0.8)), 1);
        g.translate(axis === 'x' ? wc : mc, y0 + (y1 - y0) / 2, axis === 'x' ? mc : wc);
        bake(g, wallColor(axis === 'x' ? at + nIn * 0.3 : mc, axis === 'x' ? mc : at + nIn * 0.3)); geos.push(g);
      };
      let cur = a0 - WALL;
      for (const o of ops) {
        seg(cur, o.c - o.w / 2, 0, H);
        seg(o.c - o.w / 2, o.c + o.w / 2, 0, o.y0);
        seg(o.c - o.w / 2, o.c + o.w / 2, o.y1, H);
        cur = o.c + o.w / 2;
      }
      seg(cur, a1 + WALL, 0, H);
      // wall solid
      const mc = (a0 + a1) / 2, hl = (a1 - a0) / 2 + WALL;
      if (axis === 'x') solid(at + Math.sign(at) * WALL / 2, mc, WALL / 2 + 0.02, hl, H); else solid(mc, at + Math.sign(at) * WALL / 2, hl, WALL / 2 + 0.02, H);
      // fill the openings: the door (closed, wooden panels in a frame), windows (glass, wooden frame, steel grill)
      for (const o of ops) {
        const P = (along, out) => (axis === 'x' ? [at + Math.sign(at) * out, along] : [along, at + Math.sign(at) * out]);
        const rot = axis === 'x' ? Math.PI / 2 : 0;
        if (o.door) {
          const [x, z] = P(o.c, WALL * 0.5);
          box(x, 0, z, DOOR_W, DOOR_H, 0.05, wood, rot);
          const [fx, fz] = P(o.c, 0.02);
          for (const sgn of [-1, 1]) { const q = P(o.c + sgn * (DOOR_W / 2 + 0.04), 0.02); box(q[0], 0, q[1], 0.08, DOOR_H + 0.08, 0.1, '#4a3020', rot); }
          box(fx, DOOR_H, fz, DOOR_W + 0.16, 0.08, 0.1, '#4a3020', rot);
          // handle and a bolt
          const hq = P(o.c + DOOR_W * 0.38, -0.01); box(hq[0], 1.0, hq[1], 0.03, 0.14, 0.05, '#c8c0a0', rot);
          const bq = P(o.c + DOOR_W * 0.3, -0.01); box(bq[0], 1.7, bq[1], 0.16, 0.03, 0.04, '#b0a888', rot);
        } else {
          const [gx, gz] = P(o.c, WALL * 0.75);
          const gg = axis === 'x' ? new THREE.PlaneGeometry(o.w, o.y1 - o.y0) : new THREE.PlaneGeometry(o.w, o.y1 - o.y0);
          gg.rotateY(axis === 'x' ? (at > 0 ? -Math.PI / 2 : Math.PI / 2) : at > 0 ? Math.PI : 0);
          gg.translate(gx, (o.y0 + o.y1) / 2, gz); glassGeos.push(gg);
          // frame
          for (const sgn of [-1, 1]) { const q = P(o.c + sgn * o.w / 2, WALL * 0.4); box(q[0], o.y0, q[1], 0.07, o.y1 - o.y0, WALL * 0.9, '#5a3c26', rot); }
          for (const yy of [o.y0 - 0.04, o.y1 - 0.03]) { const q = P(o.c, WALL * 0.4); box(q[0], yy, q[1], o.w + 0.1, 0.07, WALL * 1.1, '#5a3c26', rot); }
          { const q = P(o.c, WALL * 0.4); box(q[0], o.y0, q[1], 0.05, o.y1 - o.y0, WALL * 0.8, '#5a3c26', rot); }
          // grill: vertical bars
          const nb = Math.round(o.w / 0.12);
          for (let k = 1; k < nb; k++) { const q = P(o.c - o.w / 2 + k * o.w / nb, 0.02); box(q[0], o.y0, q[1], 0.014, o.y1 - o.y0, 0.014, '#2a2c30', rot); }
          { const q = P(o.c, 0.02); box(q[0], (o.y0 + o.y1) / 2, q[1], o.w, 0.02, 0.014, '#2a2c30', rot); }
          // a curtain to one side, in houses
          if (type === 'house' && rnd() < 0.7) { const q = P(o.c - o.w / 2 - 0.12, -0.05); box(q[0], o.y0 - 0.2, q[1], 0.3, o.y1 - o.y0 + 0.45, 0.06, pick(['#8a2a2a', '#2a5a7a', '#c8a050', '#5a7a3a']), rot); }
        }
      }
    }
    // partitions with their doorways (door frame, lintel above)
    for (const p of parts) {
      const segs = [[p.a0 - WALL, p.dc - DOOR_W / 2, 0, H], [p.dc + DOOR_W / 2, p.a1 + WALL, 0, H], [p.dc - DOOR_W / 2, p.dc + DOOR_W / 2, DOOR_H, H]];
      for (const [b0, b1, y0, y1] of segs) {
        if (b1 - b0 < 0.01) continue;
        const mc = (b0 + b1) / 2, len = b1 - b0;
        const g = p.axis === 'x' ? new THREE.BoxGeometry(WALL, y1 - y0, len, 1, Math.max(1, Math.round((y1 - y0) / 0.8)), Math.max(1, Math.round(len / 0.8))) : new THREE.BoxGeometry(len, y1 - y0, WALL, Math.max(1, Math.round(len / 0.8)), Math.max(1, Math.round((y1 - y0) / 0.8)), 1);
        g.translate(p.axis === 'x' ? p.at : mc, y0 + (y1 - y0) / 2, p.axis === 'x' ? mc : p.at);
        bake(g, hex(paint)); geos.push(g);
        if (y0 === 0) { if (p.axis === 'x') solid(p.at, mc, WALL / 2 + 0.02, len / 2, H); else solid(mc, p.at, len / 2, WALL / 2 + 0.02, H); }
      }
      const rot = p.axis === 'x' ? Math.PI / 2 : 0;
      for (const sgn of [-1, 1]) { const q = p.axis === 'x' ? [p.at, p.dc + sgn * DOOR_W / 2] : [p.dc + sgn * DOOR_W / 2, p.at]; box(q[0], 0, q[1], 0.07, DOOR_H, WALL + 0.06, '#5a3c26', rot); }
      { const q = p.axis === 'x' ? [p.at, p.dc] : [p.dc, p.at]; box(q[0], DOOR_H - 0.06, q[1], DOOR_W + 0.1, 0.07, WALL + 0.06, '#5a3c26', rot); }
    }

    // ---- furniture
    // keep-out zones (local AABBs): in front of every doorway, both sides
    const taken = [];
    for (const d of doorways) {
      const half = DOOR_W / 2 + 0.25, deep = 1.0;
      if (d.axis === 'x') taken.push([d.at - deep, d.at + deep, d.c - half, d.c + half]); else taken.push([d.c - half, d.c + half, d.at - deep, d.at + deep]);
    }
    const hit = (L, b) => L.some((o) => b[0] < o[1] && b[1] > o[0] && b[2] < o[3] && b[3] > o[2]);
    const floorTaken = [], wallTaken = [];   // things on the floor; things on the walls (and the tall furniture)
    const free = (b, decor) => b[0] >= -W - 0.01 && b[1] <= W + 0.01 && b[2] >= -D - 0.01 && b[3] <= D + 0.01 && !hit(taken, b) && !hit(decor ? wallTaken : floorTaken, b);
    // an item is a list of parts in item space: x across, z out from its back (0..d), y up; placed with its back
    // to a wall of the room (or in the middle), turned to face into the room
    const place = (r, item, where = 'wall') => {
      const { w, d, h, parts: P, solidH = h, decor = false } = item;
      const tries = [];
      if (where === 'centre') {
        const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
        for (const rot of rnd() < 0.5 ? [0, Math.PI / 2] : [Math.PI / 2, 0]) tries.push({ x: mx, z: mz, rot, c: true });
      } else {
        const sides = [['z', r.z0, 0], ['z', r.z1, Math.PI], ['x', r.x0, Math.PI / 2], ['x', r.x1, -Math.PI / 2]].sort(() => rnd() - 0.5);
        for (const [ax, at, rot] of sides) {
          const a0 = ax === 'z' ? r.x0 : r.z0, a1 = ax === 'z' ? r.x1 : r.z1;
          const n = Math.max(1, Math.floor((a1 - a0 - w) / 0.25));
          const start = Math.floor(rnd() * (n + 1));
          for (let k = 0; k <= n; k++) {
            const v = a0 + w / 2 + ((k + start) % (n + 1)) * 0.25;
            if (v + w / 2 > a1 + 0.01) continue;
            if (ax === 'z') tries.push({ x: v, z: at, rot }); else tries.push({ x: at, z: v, rot });
          }
        }
      }
      for (const T of tries) {
        // footprint in local space
        const sn = Math.sin(T.rot), cs = Math.cos(T.rot);
        const zc = T.c ? 0 : d / 2;  // centred items: geometry spans z -d/2..d/2
        const cx = T.x + sn * (zc - (T.c ? 0 : 0)), cz = T.z + cs * zc;
        const ex = Math.abs(cs) * w / 2 + Math.abs(sn) * d / 2, ez = Math.abs(sn) * w / 2 + Math.abs(cs) * d / 2;
        const bb = [cx - ex, cx + ex, cz - ez, cz + ez];
        if (!free(bb, decor)) continue;
        if (h > 0.95 && windows.some((wn) => (wn.axis === 'x' ? bb[0] < wn.at + 0.3 && bb[1] > wn.at - 0.3 && bb[2] < wn.c + wn.w / 2 && bb[3] > wn.c - wn.w / 2 : bb[2] < wn.at + 0.3 && bb[3] > wn.at - 0.3 && bb[0] < wn.c + wn.w / 2 && bb[1] > wn.c - wn.w / 2))) continue;
        if (!(bb[0] >= r.x0 - 0.01 && bb[1] <= r.x1 + 0.01 && bb[2] >= r.z0 - 0.01 && bb[3] <= r.z1 + 0.01)) continue;
        if (decor) wallTaken.push(bb); else { floorTaken.push(bb); if (h > 1.5) wallTaken.push([bb[0], bb[1], bb[2], bb[3]]); }
        const oz = T.c ? -d / 2 : 0;
        for (const q of P) {
          const px = q[0], pz = q[2] + oz;
          const lx = T.x + px * cs + pz * sn, lz = T.z - px * sn + pz * cs;
          box(lx, q[1], lz, q[3], q[4], q[5], q[6], T.rot, q[7] || geos);
        }
        if (solidH > 0.35) solid(cx, cz, ex, ez, solidH);
        return { x: cx, z: cz, rot: T.rot };
      }
      return false;
    };

    // the furniture catalogue: [x, y, z(centre), w, h, d, colour, list?]
    const I = {
      sofa: (col) => ({ w: 1.9, d: 0.85, h: 0.85, parts: [[0, 0, 0.45, 1.9, 0.42, 0.85, col], [0, 0.42, 0.12, 1.9, 0.43, 0.22, col], [-0.88, 0.42, 0.45, 0.16, 0.22, 0.85, col], [0.88, 0.42, 0.45, 0.16, 0.22, 0.85, col], [0, 0.42, 0.5, 1.5, 0.08, 0.6, col.clone().multiplyScalar(1.1)]] }),
      tv: () => ({ w: 1.3, d: 0.45, h: 1.15, solidH: 0.6, parts: [[0, 0, 0.22, 1.3, 0.5, 0.45, wood], [0, 0.5, 0.18, 1.05, 0.62, 0.05, '#101010'], [0, 0.53, 0.2, 0.98, 0.56, 0.02, '#000', screenGeos]] }),
      chair: (col) => ({ w: 0.5, d: 0.5, h: 0.85, solidH: 0.3, parts: [[0, 0.42, 0.25, 0.48, 0.05, 0.46, col], [0, 0.45, 0.03, 0.48, 0.42, 0.04, col], [-0.21, 0, 0.05, 0.04, 0.44, 0.04, col], [0.21, 0, 0.05, 0.04, 0.44, 0.04, col], [-0.21, 0, 0.45, 0.04, 0.44, 0.04, col], [0.21, 0, 0.45, 0.04, 0.44, 0.04, col]] }),
      showcase: () => ({ w: 1.2, d: 0.42, h: 1.8, parts: [[0, 0, 0.21, 1.2, 0.8, 0.42, wood], [0, 0.8, 0.21, 1.2, 1.0, 0.36, wood], [0, 0.85, 0.4, 1.1, 0.9, 0.02, '#a8c0c8'], [-0.3, 1.25, 0.25, 0.2, 0.25, 0.15, '#c8a040'], [0.25, 1.25, 0.25, 0.25, 0.2, 0.15, '#e0e0e0']] }),
      bed: () => { const sh = pick(['#b03a48', '#3a6aa0', '#e0c060', '#5a8a5a', '#f0ece0']); return { w: 1.6, d: 2.05, h: 1.0, solidH: 0.55, parts: [[0, 0, 1.03, 1.6, 0.3, 2.05, wood], [0, 0, 0.04, 1.6, 1.0, 0.08, wood], [0, 0.3, 1.05, 1.52, 0.2, 1.95, '#f0eee6'], [0, 0.5, 1.2, 1.54, 0.03, 1.6, sh], [-0.36, 0.5, 0.3, 0.6, 0.12, 0.38, '#fafafa'], [0.36, 0.5, 0.3, 0.6, 0.12, 0.38, '#fafafa']] }; },
      almirah: () => { const col = pick(['#5a6a5a', '#7a8088', '#4a5a6a', '#8a7a68']); return { w: 0.95, d: 0.55, h: 1.95, parts: [[0, 0.05, 0.27, 0.95, 1.9, 0.55, col], [0, 0.1, 0.55, 0.01, 1.8, 0.01, '#222'], [0.08, 1.0, 0.56, 0.03, 0.18, 0.03, '#ddd'], [0, 0, 0.27, 0.9, 0.05, 0.5, '#333']] }; },
      desk: () => ({ w: 1.2, d: 0.6, h: 0.75, parts: [[0, 0.72, 0.3, 1.2, 0.04, 0.6, wood], [-0.56, 0, 0.3, 0.05, 0.72, 0.56, wood], [0.56, 0, 0.3, 0.05, 0.72, 0.56, wood], [0.2, 0.76, 0.3, 0.3, 0.02, 0.22, '#e8e2d0'], [-0.3, 0.76, 0.2, 0.18, 0.22, 0.14, '#3a3a3a']] }),
      office: () => ({ w: 1.4, d: 0.7, h: 1.1, parts: [[0, 0.72, 0.35, 1.4, 0.04, 0.7, '#8a7458'], [-0.66, 0, 0.35, 0.05, 0.72, 0.66, '#5a5a5a'], [0.66, 0, 0.35, 0.05, 0.72, 0.66, '#5a5a5a'], [0, 0.76, 0.12, 0.5, 0.32, 0.03, '#111'], [0, 0.78, 0.13, 0.46, 0.28, 0.01, '#000', screenGeos], [0, 0.76, 0.42, 0.42, 0.02, 0.14, '#2a2a2a']] }),
      cabinet: () => ({ w: 0.5, d: 0.6, h: 1.35, parts: [[0, 0, 0.3, 0.5, 1.35, 0.6, '#7c8288'], [0, 0.3, 0.61, 0.2, 0.03, 0.02, '#ccc'], [0, 0.75, 0.61, 0.2, 0.03, 0.02, '#ccc'], [0, 1.15, 0.61, 0.2, 0.03, 0.02, '#ccc']] }),
      counter: () => ({ w: 2.2, d: 0.6, h: 1.05, solidH: 0.9, parts: [[0, 0, 0.3, 2.2, 0.82, 0.58, '#c8c0b0'], [0, 0.82, 0.3, 2.24, 0.04, 0.62, '#2a2a2e'], [-0.55, 0.86, 0.3, 0.6, 0.06, 0.4, '#1a1a1a'], [-0.7, 0.92, 0.3, 0.16, 0.12, 0.16, '#9aa0a8'], [0.55, 0.78, 0.32, 0.45, 0.08, 0.35, '#9aa0a8'], [-0.55, 0.1, 0.62, 0.32, 0.55, 0.02, '#8a2020'], [0.6, 1.3, 0.12, 0.05, 0.2, 0.05, '#9aa0a8']] }),
      fridge: () => ({ w: 0.65, d: 0.65, h: 1.65, parts: [[0, 0, 0.32, 0.65, 1.65, 0.65, pick(['#e8e8e8', '#b8bcc4', '#7a1c24'])], [0.27, 0.9, 0.66, 0.03, 0.4, 0.03, '#999'], [0, 1.15, 0.655, 0.62, 0.01, 0.01, '#555']] }),
      vessels: () => ({ w: 1.0, d: 0.3, h: 1.6, parts: [[0, 0, 0.15, 1.0, 0.04, 0.3, wood], [0, 0.6, 0.15, 1.0, 0.04, 0.3, wood], [0, 1.2, 0.15, 1.0, 0.04, 0.3, wood], [-0.48, 0, 0.15, 0.04, 1.3, 0.3, wood], [0.48, 0, 0.15, 0.04, 1.3, 0.3, wood], [-0.25, 0.64, 0.15, 0.22, 0.2, 0.22, '#c8ccd0'], [0.1, 0.64, 0.15, 0.25, 0.14, 0.25, '#b8bcc0'], [0.3, 1.24, 0.15, 0.2, 0.25, 0.2, '#c8ccd0'], [-0.2, 1.24, 0.15, 0.16, 0.3, 0.16, '#a87a40']] }),
      table: (n) => ({ w: 1.4, d: 0.85, h: 0.77, parts: [[0, 0.73, 0.42, 1.4, 0.04, 0.85, wood], [-0.64, 0, 0.08, 0.05, 0.73, 0.05, wood], [0.64, 0, 0.08, 0.05, 0.73, 0.05, wood], [-0.64, 0, 0.77, 0.05, 0.73, 0.05, wood], [0.64, 0, 0.77, 0.05, 0.73, 0.05, wood],
        ...(n ? [-0.35, 0.35].flatMap((x) => [[x, 0.42, -0.25, 0.42, 0.04, 0.42, '#f0f0ee'], [x, 0.44, -0.47, 0.42, 0.4, 0.03, '#f0f0ee'], [x, 0.42, 1.1, 0.42, 0.04, 0.42, '#f0f0ee'], [x, 0.44, 1.32, 0.42, 0.4, 0.03, '#f0f0ee']]) : [])] }),
      coffee: () => ({ w: 1.0, d: 0.55, h: 0.42, parts: [[0, 0.38, 0.27, 1.0, 0.04, 0.55, wood], [0, 0, 0.27, 0.9, 0.05, 0.45, wood], [-0.45, 0, 0.27, 0.05, 0.38, 0.45, wood], [0.45, 0, 0.27, 0.05, 0.38, 0.45, wood], [0.2, 0.42, 0.2, 0.25, 0.02, 0.32, '#d8d0b8']] }),
      rug: () => ({ w: 2.0, d: 1.4, h: 0.01, parts: [[0, 0, 0.7, 2.0, 0.012, 1.4, pick(['#7a2a2a', '#3a4a6a', '#8a6a3a'])], [0, 0.002, 0.7, 1.7, 0.012, 1.1, pick(['#c8a060', '#a84040', '#d0c8b0'])]] }),
      toilet: () => ({ w: 0.45, d: 0.7, h: 0.8, parts: [[0, 0, 0.42, 0.38, 0.4, 0.52, '#f4f4f4'], [0, 0.4, 0.42, 0.42, 0.03, 0.55, '#ffffff'], [0, 0.4, 0.09, 0.42, 0.38, 0.18, '#f4f4f4']] }),
      bucket: () => ({ w: 0.45, d: 0.45, h: 0.4, solidH: 0, parts: [[0, 0, 0.22, 0.34, 0.36, 0.34, pick(['#2a5aa8', '#c83030', '#3a9a5a'])], [0.25, 0, 0.3, 0.14, 0.14, 0.14, '#e8c040'], [0, 0.85, 0.03, 0.06, 0.06, 0.08, '#c0c4c8']] }),
      basin: () => ({ w: 0.55, d: 0.45, h: 1.6, solidH: 0.85, parts: [[0, 0.7, 0.22, 0.52, 0.16, 0.42, '#f6f6f6'], [0, 0, 0.12, 0.12, 0.7, 0.12, '#f6f6f6'], [0, 1.1, 0.01, 0.45, 0.55, 0.02, '#9ab0c0']] }),
      shelf: (fill) => {
        const parts = [[0, 0, 0.22, 1.6, 0.06, 0.45, '#8a8a84'], [-0.78, 0, 0.22, 0.04, 2.0, 0.45, '#8a8a84'], [0.78, 0, 0.22, 0.04, 2.0, 0.45, '#8a8a84'], [0, 0, 0.02, 1.6, 2.0, 0.03, '#a0a098']];
        for (let k = 0; k < 4; k++) {
          const y = 0.08 + k * 0.5; parts.push([0, y + 0.36, 0.22, 1.56, 0.03, 0.43, '#8a8a84']);
          if (!fill) continue;
          let x = -0.72;
          while (x < 0.66) { const w = 0.08 + rnd() * 0.18, hh = 0.12 + rnd() * 0.2; parts.push([x + w / 2, y + 0.39, 0.22, w * 0.9, hh, 0.3, pick(['#c83a2a', '#e8b030', '#2a7ac8', '#3aa04a', '#f0f0f0', '#8a3aa0', '#e87a2a', '#2a2a2a'])]); x += w; }
        }
        return { w: 1.6, d: 0.45, h: 2.0, parts };
      },
      shopCounter: () => ({ w: 2.0, d: 0.65, h: 1.0, parts: [[0, 0, 0.32, 2.0, 0.92, 0.62, '#7a5a3a'], [0, 0.92, 0.32, 2.06, 0.04, 0.68, '#3a3a40'], [0, 0.2, 0.64, 1.8, 0.55, 0.02, '#c8dce4'], [0.6, 0.96, 0.32, 0.36, 0.22, 0.3, '#1a1a1a'], [-0.5, 0.96, 0.3, 0.3, 0.32, 0.3, '#c8dce4'], [-0.5, 0.97, 0.3, 0.26, 0.15, 0.26, '#e8a030']] }),
      crates: () => { const parts = []; for (let k = 0; k < 4; k++) parts.push([-0.5 + (k % 2) * 0.55, Math.floor(k / 2) * 0.4, 0.3, 0.5, 0.4, 0.5, pick(['#8a6a40', '#a07a4a', '#6a5034'])]); return { w: 1.1, d: 0.6, h: 0.8, parts }; },
      sacks: () => ({ w: 1.2, d: 0.7, h: 0.7, parts: [[-0.3, 0, 0.35, 0.55, 0.35, 0.65, '#d8ccb0'], [0.3, 0, 0.35, 0.55, 0.35, 0.65, '#d0c4a4'], [0, 0.35, 0.35, 0.6, 0.33, 0.62, '#e0d4b8']] }),
      cylinder: () => ({ w: 0.36, d: 0.36, h: 0.62, solidH: 0, parts: [[0, 0, 0.18, 0.32, 0.55, 0.32, '#b02020'], [0, 0.55, 0.18, 0.12, 0.08, 0.12, '#999']] }),
      bike: () => ({ w: 0.6, d: 1.8, h: 1.0, solidH: 0.8, parts: [[0, 0, 0.3, 0.1, 0.55, 0.55, '#1a1a1a'], [0, 0, 1.5, 0.1, 0.55, 0.55, '#1a1a1a'], [0, 0.4, 0.9, 0.28, 0.35, 1.0, pick(['#b02020', '#203a80', '#1a1a1a'])], [0, 0.75, 1.05, 0.26, 0.1, 0.6, '#151515'], [0, 0.75, 0.35, 0.6, 0.04, 0.04, '#333']] }),
      clock: () => ({ decor: true, w: 0.3, d: 0.05, h: 2.2, solidH: 0, parts: [[0, 1.9, 0.02, 0.3, 0.3, 0.04, '#f4f0e0'], [0, 2.04, 0.045, 0.02, 0.12, 0.01, '#111'], [0.04, 2.04, 0.045, 0.1, 0.02, 0.01, '#111']] }),
      calendar: () => ({ decor: true, w: 0.35, d: 0.03, h: 2.0, solidH: 0, parts: [[0, 1.45, 0.012, 0.32, 0.48, 0.015, '#f8f8f4'], [0, 1.7, 0.02, 0.28, 0.2, 0.005, pick(['#c84030', '#3a6ab0', '#e0a020'])]] }),
      photo: () => ({ decor: true, w: 0.5, d: 0.04, h: 2.1, solidH: 0, parts: [[0, 1.55, 0.015, 0.5, 0.4, 0.03, '#6a4a2a'], [0, 1.59, 0.03, 0.42, 0.32, 0.005, pick(['#6a8a5a', '#8a6a5a', '#5a6a8a', '#c0a070'])]] }),
      tube: () => ({ decor: true, w: 1.25, d: 0.08, h: 2.6, solidH: 0, parts: [[0, 2.45, 0.03, 1.25, 0.06, 0.05, '#e8e8e8'], [0, 2.43, 0.07, 1.2, 0.035, 0.035, '#fff', glowGeos]] }),
    };
    const fabric = () => hex(pick(['#7a3a2a', '#3a4a6a', '#6a6a4a', '#8a5a3a', '#4a2a3a']));
    const plastic = () => hex(pick(['#f2f2ee', '#c83030', '#2a5ab0', '#3a8a4a']));

    for (const r of rooms) {
      const big = area(r) > 10;
      switch (r.type) {
        case 'living': place(r, I.rug(), 'centre') && place(r, I.coffee(), 'centre'); place(r, I.sofa(fabric())); place(r, I.tv()); place(r, I.showcase()); place(r, I.chair(plastic())); place(r, I.chair(plastic())); if (big) place(r, I.chair(plastic())); break;
        case 'bed': place(r, I.bed()); place(r, I.almirah()); if (big) place(r, I.desk()) && place(r, I.chair(plastic())); break;
        case 'kitchen': place(r, I.counter()); place(r, I.fridge()); place(r, I.vessels()); place(r, I.cylinder()); if (big) place(r, I.table(false), 'centre'); break;
        case 'dining': place(r, I.table(true), 'centre'); place(r, I.basin()); place(r, I.fridge()); place(r, I.showcase()); break;
        case 'bath': place(r, I.toilet()); place(r, I.bucket()); place(r, I.basin()); break;
        case 'shop': {
          for (let k = 0; k < 8; k++) place(r, I.shelf(true));
          // the counter: across the room a step in from the door
          const mx = (r.x0 + r.x1) / 2, mz = (r.z0 + r.z1) / 2;
          const ct = place({ x0: mx - 1.6, x1: mx + 1.6, z0: mz - 1.6, z1: mz + 1.6 }, I.shopCounter(), 'centre');
          // the shopkeeper behind it, facing the door
          if (ct) { const vx = ct.x - dpos[0], vz = ct.z - dpos[1], l = Math.hypot(vx, vz) || 1; keeper = [ct.x + vx / l * 0.75, ct.z + vz / l * 0.75, Math.atan2(-vx, -vz)]; }
          place(r, I.chair(plastic()));
          break;
        }
        case 'office': { for (let k = 0; k < Math.max(1, Math.floor(area(r) / 9)); k++) { if (!place(r, I.office())) break; } place(r, I.cabinet()); place(r, I.cabinet()); place(r, I.chair(plastic())); place(r, I.chair(plastic())); if (big) place(r, I.office(), 'centre'); break; }
        case 'store': place(r, I.shelf(rnd() < 0.5)); place(r, I.crates()); place(r, I.sacks()); place(r, I.crates()); break;
        case 'shed': place(r, I.bike()); place(r, I.crates()); place(r, I.sacks()); place(r, I.shelf(false)); place(r, I.crates()); break;
      }
      // on the walls: a tube light (every room), a clock, a calendar, a photo
      place(r, I.tube());
      if (r.type !== 'bath' && r.type !== 'store') { place(r, I.clock()); if (rnd() < 0.8) place(r, I.calendar()); if (type === 'house' && rnd() < 0.7) place(r, I.photo()); }
    }

    // ---- meshes
    const group = new THREE.Group();
    group.position.set(c.cx, B.floor, c.cz);
    group.rotation.y = c.angle;
    const merge = (list, mat, keep) => {
      if (!list.length) return;
      const norm = list.map((q) => { const o = q.index ? q.toNonIndexed() : q; for (const k of Object.keys(o.attributes)) if (!keep.includes(k)) o.deleteAttribute(k); return o; });
      const g = mergeGeometries(norm, false);
      if (g) { const m = new THREE.Mesh(g, mat); m.frustumCulled = false; group.add(m); }
    };
    merge(geos, this.mat, ['position', 'color', 'light', 'uv']);
    merge(floorGeos, this.floorMat, ['position', 'color', 'light', 'uv']);
    merge(glassGeos, this.glass, ['position']);
    merge(glowGeos, this.glow, ['position']);
    merge(screenGeos, this.screen, ['position']);
    // ceiling fans: a down-rod, a motor and three blades, turning
    this.fans = [];
    for (const r of rooms) {
      if (r.type === 'bath' || r.type === 'store' || area(r) < 6) continue;
      const fan = new THREE.Group();
      const parts = [];
      const rod = new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6); rod.translate(0, -0.175, 0); bake(rod, hex('#e8e4dc')); parts.push(rod);
      const mot = new THREE.CylinderGeometry(0.14, 0.12, 0.12, 12); mot.translate(0, -0.4, 0); bake(mot, hex('#d8d4cc')); parts.push(mot);
      for (let k = 0; k < 3; k++) { const b = new THREE.BoxGeometry(0.11, 0.012, 0.6); b.translate(0, -0.42, 0.42); b.rotateY(k * Math.PI * 2 / 3); bake(b, hex('#e0dcd2')); parts.push(b); }
      const g = mergeGeometries(parts.map((q) => { const o = q.index ? q.toNonIndexed() : q; o.deleteAttribute('normal'); return o; }), false);
      fan.add(new THREE.Mesh(g, this.mat));
      fan.position.set(r.light[0], H, r.light[2]);
      group.add(fan); this.fans.push(fan);
    }
    group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
    // where the player appears (just inside the door, facing in) and leaves (just outside, facing out)
    const spawn = [dpos[0] + sideNorm[0] * 0.75, dpos[1] + sideNorm[1] * 0.75];
    const exit = [dpos[0] + sideNorm[0] * 0.4, dpos[1] + sideNorm[1] * 0.4];
    const outLocal = side === 'x+' ? [c.hx + 0.85, t] : side === 'x-' ? [-c.hx - 0.85, t] : side === 'z+' ? [t, c.hz + 0.85] : [t, -c.hz - 0.85];
    const spawnYaw = Math.atan2(sideNorm[0], sideNorm[1]), outYaw = Math.atan2(-sideNorm[0], -sideNorm[1]);
    return { c, group, colliders, floor: B.floor, ceil: B.ceil, type, rooms, spawn, spawnYaw, exit, outside: outLocal, outYaw, keeper };
  }
}
