// What breaks, drawn (world/Breakables.js): the roadside things standing (split-rail and bamboo fences, trail marker
// posts, trail signs, steel barrels and water drums, crates, woodpiles); when one goes, its pieces thrown the way the
// truck was going, to tumble and settle on the ground (and be kicked about by a truck driving through them); a tree
// that gives way snaps above its foot and falls the way it was pushed, its stump left standing. Splinters, leaves and
// the sound of it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIND } from './Effects.js';

const G = 9.81;
const POOL = 140;                  // thrown pieces kept per kind of piece (the oldest at rest go first)
const FALLEN = 24;                 // fallen trees kept per species
const STUMPS = 800;

const rnd = (s) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3();
const _e = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0);

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** The kinds of piece: a unit shape (its box: lo..hi), its material, whether it casts a shadow. */
function pieceKinds() {
  const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const cyl = (seg, along) => { const g = new THREE.CylinderGeometry(1, 1, 1, seg); return along ? g.rotateX(Math.PI / 2) : g.translate(0, 0.5, 0); };
  const crateTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#a58556'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(70,45,20,${0.1 + rnd(i) * 0.1})`; g.fillRect(0, i * 32 + 30, w, 3); }
    g.strokeStyle = '#6a5030'; g.lineWidth = 12; g.strokeRect(6, 6, w - 12, h - 12);
    g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.stroke();
  });
  const drum = cyl(18, false), rib = (y) => new THREE.TorusGeometry(1.01, 0.025, 4, 18).rotateX(Math.PI / 2).translate(0, y, 0);
  const steelDrum = mergeGeometries([drum, rib(0.33), rib(0.66)].map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; }));
  const box01 = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  return {
    post: { geo: cyl(7, false), mat: std(0x8a7760, 0.95), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: true },
    rail: { geo: cyl(6, true), mat: std(0x8f7c63, 0.95), lo: [-1, -1, -0.5], hi: [1, 1, 0.5], shadow: true },
    bamboo: { geo: cyl(7, true), mat: std(0xc4b06a, 0.6), lo: [-1, -1, -0.5], hi: [1, 1, 0.5], shadow: true },
    bpost: { geo: cyl(7, false), mat: std(0xb09a58, 0.65), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: true },
    band: { geo: cyl(7, false), mat: std(0xe8642a, 0.6), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: false },
    steel: { geo: steelDrum, mat: std(0xffffff, 0.5, 0.45), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: true },
    plastic: { geo: cyl(18, false), mat: std(0x2f63b0, 0.55), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: true },
    crate: { geo: box01, mat: std(0xffffff, 0.85, 0, { map: crateTex }), lo: [-0.5, 0, -0.5], hi: [0.5, 1, 0.5], shadow: true },
    plank: { geo: new THREE.BoxGeometry(1, 1, 1), mat: std(0xa58556, 0.9), lo: [-0.5, -0.5, -0.5], hi: [0.5, 0.5, 0.5], shadow: true },
    log: { geo: cyl(8, true), mat: std(0xffffff, 0.92), lo: [-1, -1, -0.5], hi: [1, 1, 0.5], shadow: true },
    stump: { geo: new THREE.CylinderGeometry(0.85, 1, 1, 9).translate(0, 0.5, 0), mat: std(0x5a4030, 0.95), lo: [-1, 0, -1], hi: [1, 1, 1], shadow: true },
  };
}

/**
 * A roadside thing's pieces, in its own frame (z along it, y up from its foot): { kind, p: [x, y, z], s: [sx, sy, sz],
 * rot: [rx, ry, rz], color, mass, ground: true for one whose foot stands on the ground under it }.
 */
function piecesOf(it, seed) {
  const L = it.len || 0, out = [];
  const wood = (k) => { const v = 0.82 + rnd(seed + k) * 0.3; return [v, v * 0.97, v * 0.93]; };
  switch (it.kind) {
    case 'rail':
      for (const z of [-L / 2, L / 2]) out.push({ kind: 'post', p: [0, -0.3, z], s: [0.075, 1.5, 0.075], color: wood(z), mass: 9, ground: true });
      for (const [y, k] of [[0.46, 1], [0.94, 2]]) out.push({ kind: 'rail', p: [0, y, 0], s: [0.058, 0.058, L + 0.24], rot: [0, 0, rnd(seed + k) * 3], color: wood(k + 5), mass: 14 });
      break;
    case 'bamboo':
      for (const z of [-L / 2, L / 2]) out.push({ kind: 'bpost', p: [0, -0.25, z], s: [0.055, 1.55, 0.055], color: wood(z), mass: 3, ground: true });
      for (const [y, k] of [[0.36, 1], [0.76, 2], [1.14, 3]]) out.push({ kind: 'bamboo', p: [0.06, y, 0], s: [0.034, 0.034, L + 0.3], color: wood(k + 5), mass: 2 });
      break;
    case 'marker':
      out.push({ kind: 'post', p: [0, -0.3, 0], s: [0.06, 1.6, 0.06], color: wood(1), mass: 6, ground: true });
      out.push({ kind: 'band', p: [0, 1.12, 0], s: [0.064, 0.16, 0.064], color: [1, 1, 1], mass: 0.5 });
      break;
    case 'sign':
      for (const z of [-0.6, 0.6]) out.push({ kind: 'post', p: [0, -0.3, z], s: [0.065, 2.3, 0.065], color: wood(z), mass: 10, ground: true });
      out.push({ kind: 'board', p: [0, 1.55, 0], s: [0.05, 0.46, 1.36], mass: 8 });
      break;
    case 'barrel': {
      const pal = [[0.62, 0.2, 0.13], [0.16, 0.34, 0.55], [0.26, 0.4, 0.22], [0.55, 0.38, 0.16]];
      out.push({ kind: 'steel', p: [0, 0, 0], s: [0.29, 0.88, 0.29], color: pal[Math.floor(rnd(seed) * 4)], mass: 20 });
      break;
    }
    case 'drum': out.push({ kind: 'plastic', p: [0, 0, 0], s: [0.29, 0.88, 0.29], color: [1, 1, 1], mass: 10 }); break;
    case 'crate': out.push({ kind: 'crate', p: [0, 0, 0], s: [0.8, 0.8, 0.8], color: [1, 1, 1], mass: 25 }); break;
    case 'woodpile':
      for (const z of [-L / 2 - 0.05, L / 2 + 0.05]) out.push({ kind: 'post', p: [0, -0.2, z], s: [0.05, 1.05, 0.05], color: wood(z), mass: 2, ground: true });
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 11; k++) {
          const r = 0.08 + rnd(seed + row * 11 + k) * 0.025, v = 0.75 + rnd(seed + row * 37 + k) * 0.3;
          out.push({ kind: 'log', p: [(rnd(seed + k + row) - 0.5) * 0.06, 0.09 + row * 0.18, -L / 2 + 0.1 + k * (L - 0.2) / 10], s: [r, r, 0.42], rot: [0, Math.PI / 2, rnd(seed + k * 3 + row) * 3], color: [0.62 * v, 0.46 * v, 0.32 * v], mass: 4 });
        }
      }
      break;
    default:
  }
  return out;
}

/** A sign's board: the trail's name both sides (Ashwood's routed brown wood, Kerala's green). */
function boardMaterials(text, style) {
  const green = style === 'kerala';
  const tex = canvasTex(512, 172, (g, w, h) => {
    g.fillStyle = green ? '#1d5a33' : '#5a3b22'; g.fillRect(0, 0, w, h);
    if (!green) for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(30,18,8,${0.15 + rnd(i) * 0.1})`; g.fillRect(0, i * 29 + 27, w, 2); }
    g.strokeStyle = green ? '#f2f2ea' : '#d9c79e'; g.lineWidth = 7; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = green ? '#f6f6f0' : '#efe3c4';
    let size = 64;
    g.font = `700 ${size}px Barlow Condensed, Arial Narrow, sans-serif`;
    while (g.measureText(text).width > w - 60 && size > 26) { size -= 4; g.font = `700 ${size}px Barlow Condensed, Arial Narrow, sans-serif`; }
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text.toUpperCase(), w / 2, h / 2 + 3);
  });
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const edge = new THREE.MeshStandardMaterial({ color: green ? 0x174a29 : 0x4a301c, roughness: 0.9 });
  return [face, face, edge, edge, edge, edge];
}

// ---------------------------------------------------------------- the pieces, standing and thrown
class Pieces {
  constructor(spec, staticCount, group) {
    this.spec = spec;
    this.mesh = new THREE.InstancedMesh(spec.geo, spec.mat, Math.max(1, staticCount + POOL));
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array((staticCount + POOL) * 3).fill(1), 3);
    this.mesh.castShadow = spec.shadow; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < staticCount + POOL; i++) this.mesh.setMatrixAt(i, _m);
    this.next = 0;
    this.free = [];
    for (let i = POOL - 1; i >= 0; i--) this.free.push(staticCount + i);
    group.add(this.mesh);
  }
  put(matrix, color) {
    const i = this.next++;
    this.mesh.setMatrixAt(i, matrix);
    if (color) this.mesh.instanceColor.setXYZ(i, ...color);
    return i;
  }
  hide(i) { _m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, _m); this.dirty = true; }
}

export class BreakView {
  /** scene, world, vegetation (render/Vegetation.js), effects (render/Effects.js), audio. */
  constructor(scene, world, vegetation, effects, audio) {
    this.world = world; this.veg = vegetation; this.effects = effects; this.audio = audio;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.kinds = pieceKinds();
    const style = world.map?.id;
    // the roadside things, standing
    const items = world.roadside || [];
    this.items = items.map((it, j) => ({ it, pieces: piecesOf(it, j * 7.31 + 1), slots: [], boards: [] }));
    const counts = {};
    for (const x of this.items) for (const p of x.pieces) if (p.kind !== 'board') counts[p.kind] = (counts[p.kind] || 0) + 1;
    this.pieces = {};
    for (const k of Object.keys(this.kinds)) if (k !== 'stump') this.pieces[k] = new Pieces(this.kinds[k], counts[k] || 0, this.group);
    this.stumps = new Pieces(this.kinds.stump, STUMPS, this.group);
    this.stumps.next = 0;
    for (const x of this.items) {
      const it = x.it;
      for (const p of x.pieces) {
        this.pieceMatrix(it, p, _m);
        if (p.kind === 'board') {
          const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), boardMaterials(it.text || '', style));
          b.matrixAutoUpdate = false; b.matrix.copy(_m); b.castShadow = true; b.receiveShadow = true;
          this.group.add(b);
          x.boards.push(b);
          x.slots.push(null);
        } else x.slots.push(this.pieces[p.kind].put(_m, p.color));
      }
    }
    for (const P of Object.values(this.pieces)) P.mesh.instanceMatrix.needsUpdate = true;
    this.bodies = [];           // thrown pieces
    this.falling = [];          // trees going over and lying
    this.fallenCount = {};      // per species: how many of its slots are taken (the oldest are reused)
  }

  /** A piece's matrix in the world: its thing's place and turn, its own (its foot on the ground under it). */
  pieceMatrix(it, p, out) {
    const c = Math.cos(it.yaw), s = Math.sin(it.yaw);
    const wx = it.x + p.p[0] * c + p.p[2] * s, wz = it.z - p.p[0] * s + p.p[2] * c;
    const gy = p.ground ? this.world.terrain(wx, wz) : it.y;
    _q.setFromEuler(_e.set(p.rot?.[0] || 0, (p.rot?.[1] || 0) + it.yaw, p.rot?.[2] || 0, 'YXZ'));
    return out.compose(_p.set(wx, gy + p.p[1], wz), _q, _s.set(...p.s));
  }

  // ---------------------------------------------------------------- breaks
  /** Take the world's breaks (World.breaks): draw them, sound them; returns the local ones (for the room). */
  take(camPos) {
    const out = [];
    for (const e of this.world.breaks) {
      if (e.tree >= 0) this.breakTree(e, camPos); else this.breakItem(e, camPos);
      if (e.local) out.push(e);
    }
    this.world.breaks.length = 0;
    return out;
  }

  breakItem(e, camPos) {
    const x = this.items[e.item];
    if (!x || x.gone) return;
    x.gone = true;
    const it = x.it;
    x.pieces.forEach((p, k) => {
      if (p.kind === 'board') { const b = x.boards[0]; if (e.quiet) { b.visible = false; return; } this.throwBoard(b, e, p); return; }
      this.pieces[p.kind].hide(x.slots[k]);
      if (e.quiet) return;
      // (a woodpile throws a share of its logs; the rest are the ones left lying under them)
      if (p.kind === 'log' && k % 3) return;
      this.pieceMatrix(it, p, _m);
      _m.decompose(_p, _q, _s);
      this.throwPiece(this.pieces[p.kind], _p, _q, _s, p.color, p.mass, e);
    });
    if (e.quiet) return;
    const near = camPos ? Math.max(0, 1 - camPos.distanceTo(_v.set(e.x, e.y, e.z)) / 120) : 1;
    const kind = it.kind === 'barrel' ? 'metal' : it.kind === 'drum' ? 'plastic' : 'wood';
    this.audio?.breakSound?.(kind, Math.min(1, 0.25 + e.v * 0.05) * near * near);
    if (kind === 'wood') this.splinters(e.x, e.y + 0.6, e.z, e, 10 + Math.round(Math.min(16, e.v * 1.5)), [0.6, 0.5, 0.36]);
    else this.effects.spawn(e.x, e.y + 0.2, e.z, e.dx * 0.5, 0.6, e.dz * 0.5, 0.35, 1.4, [0.55, 0.47, 0.38], 0.25, 1.2, 1.2, -0.2, KIND.PUFF);
  }

  /** A thrown piece: off the way the truck went, up, spinning. */
  throwPiece(P, pos, quat, scale, color, mass, e) {
    let slot = P.free.pop();
    if (slot === undefined) {
      // the pool full: the oldest piece lying still goes
      let old = -1, oa = -1;
      this.bodies.forEach((b, i) => { if (b.P === P && b.sleep > 0.5 && b.age > oa) { oa = b.age; old = i; } });
      if (old < 0) return;
      slot = this.bodies[old].slot;
      this.bodies.splice(old, 1);
    }
    if (color) P.mesh.instanceColor.setXYZ(slot, ...color);
    P.mesh.instanceColor.needsUpdate = true;
    const sp = Math.min(14, e.v), k = 0.55 + Math.random() * 0.5;
    const body = {
      P, slot, pos: pos.clone(), quat: quat.clone(), scale: scale.clone(), m: mass,
      vel: new THREE.Vector3(e.dx * sp * k + (Math.random() - 0.5) * 1.6, 0.6 + Math.random() * (1 + sp * 0.18), e.dz * sp * k + (Math.random() - 0.5) * 1.6),
      w: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9).multiplyScalar(Math.min(1, 0.3 + sp / 8)),
      sleep: 0, age: 0,
    };
    const lo = P.spec.lo, hi = P.spec.hi;
    body.corners = [];
    for (const a of [lo[0], hi[0]]) for (const b of [lo[1], hi[1]]) for (const c of [lo[2], hi[2]]) body.corners.push(new THREE.Vector3(a * scale.x, b * scale.y, c * scale.z));
    const ext = new THREE.Vector3((hi[0] - lo[0]) * scale.x, (hi[1] - lo[1]) * scale.y, (hi[2] - lo[2]) * scale.z);
    body.I = mass * (ext.x * ext.x + ext.y * ext.y + ext.z * ext.z) / 12;
    // the body's own centre (the shape's middle, not its foot)
    body.mid = new THREE.Vector3((lo[0] + hi[0]) / 2 * scale.x, (lo[1] + hi[1]) / 2 * scale.y, (lo[2] + hi[2]) / 2 * scale.z);
    this.bodies.push(body);
  }

  /** A sign's board thrown: the board itself (its own mesh) becomes a body. */
  throwBoard(mesh, e, p) {
    mesh.matrix.decompose(_p, _q, _s);
    const fake = { spec: { lo: [-0.5, -0.5, -0.5], hi: [0.5, 0.5, 0.5] }, mesh: null, free: [] };
    const body = {
      P: fake, mesh, slot: -1, pos: _p.clone(), quat: _q.clone(), scale: _s.clone(), m: p.mass, sleep: 0, age: 0,
      vel: new THREE.Vector3(e.dx * Math.min(10, e.v) * 0.7, 1.5 + Math.random() * 2, e.dz * Math.min(10, e.v) * 0.7),
      w: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6),
    };
    body.corners = [];
    for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) for (const c of [-0.5, 0.5]) body.corners.push(new THREE.Vector3(a * _s.x, b * _s.y, c * _s.z));
    body.I = p.mass * (_s.x * _s.x + _s.y * _s.y + _s.z * _s.z) / 12;
    body.mid = new THREE.Vector3();
    this.bodies.push(body);
  }

  breakTree(e, camPos) {
    const i = e.tree, veg = this.veg;
    if (!veg || veg.hidden?.[i]) return;
    const pose = veg.treePose(i);
    veg.hideTree(i);
    // its stump: the trunk's foot, snapped a little above the ground
    const T = this.world.trees, r = T.r[i], snap = Math.min(0.55, 0.22 + r * 0.9);
    if (this.stumps.next < STUMPS) {
      _m.compose(_p.set(pose.x, pose.y, pose.z), _q.setFromAxisAngle(UP, pose.yaw), _s.set(r * 1.05, snap + 0.12, r * 1.05));
      this.stumps.put(_m, [0.9 + pose.tint * 0.1, 0.85, 0.8]);
      this.stumps.mesh.instanceMatrix.needsUpdate = true; this.stumps.mesh.instanceColor.needsUpdate = true;
    }
    // the tree above it goes over the way it was pushed: a rod tipping about its foot, faster the harder it was hit
    let dx = e.dx, dz = e.dz;
    if (Math.hypot(dx, dz) < 0.1) { const a = Math.random() * 6.283; dx = Math.sin(a); dz = Math.cos(a); }
    const L = Math.max(1, pose.ht - snap), heavy = Math.sqrt(Math.max(1, pose.ht / 5));
    const fall = {
      kind: pose.kind, pose, snap, L, dx, dz, theta: e.quiet ? 0 : 0.02, w: e.quiet ? 0 : Math.min(2.6, (0.25 + e.v / 6) / heavy),
      max: this.restAngle(pose, snap, L, dx, dz), done: !!e.quiet, bounce: 0,
    };
    if (e.quiet) fall.theta = fall.max;
    const F = veg.fallenOf(pose.kind, FALLEN);
    // a slot: the next free, else the oldest (it sinks away)
    const n = this.fallenCount[pose.kind] || 0;
    if (n < F.cap) { fall.slot = n; this.fallenCount[pose.kind] = n + 1; } else {
      const old = this.falling.filter((f) => f.kind === pose.kind).sort((a, b) => a.born - b.born)[0];
      fall.slot = old.slot;
      this.falling.splice(this.falling.indexOf(old), 1);
    }
    fall.born = performance.now();
    F.color.setXYZ(fall.slot, ...pose.color);
    F.color.needsUpdate = true;
    for (const m of F.meshes) m.count = Math.max(m.count, fall.slot + 1);
    this.falling.push(fall);
    this.placeFallen(fall);
    if (e.quiet) return;
    // the crack, the swish and the thud; splinters at the break, leaves shaken out of the crown
    const near = camPos ? Math.max(0, 1 - camPos.distanceTo(_v.set(e.x, e.y, e.z)) / 160) : 1;
    const t = this.fallTime(fall);
    this.audio?.breakSound?.('tree', Math.min(1, 0.3 + r * 2 + e.v * 0.03) * near * near, t);
    this.splinters(pose.x, pose.y + snap, pose.z, e, 8 + Math.round(r * 60), [0.66, 0.54, 0.38]);
    const leaf = this.world.map?.id === 'kerala' ? [0.3, 0.42, 0.14] : [0.2, 0.32, 0.13];
    for (let k = 0; k < 14 + Math.round(pose.ht * 3); k++) {
      const h = pose.ht * (0.45 + Math.random() * 0.5), a = Math.random() * 6.283, rr = Math.random() * pose.wd * 0.25;
      this.effects.spawn(pose.x + Math.sin(a) * rr, pose.y + h, pose.z + Math.cos(a) * rr, dx * 1.5 + (Math.random() - 0.5) * 2, Math.random() * 1.2, dz * 1.5 + (Math.random() - 0.5) * 2,
        0.05 + Math.random() * 0.06, 2.2 + Math.random() * 1.6, [leaf[0] * (0.8 + Math.random() * 0.4), leaf[1] * (0.85 + Math.random() * 0.3), leaf[2]], 1, 0, 2.6, 1.6, KIND.CHUNK);
    }
  }

  /** How far a tree goes over before it lies on the ground (its crown on the slope where it falls). */
  restAngle(pose, snap, L, dx, dz) {
    const base = pose.y + snap;
    for (let th = 0.2; th < 1.75; th += 0.04) {
      const along = L * 0.72, x = pose.x + dx * Math.sin(th) * along, z = pose.z + dz * Math.sin(th) * along;
      const y = base + Math.cos(th) * along, g = this.world.height(x, z);
      if (y < g + Math.max(0.15, pose.wd * 0.09)) return th;
    }
    return 1.7;
  }

  /** About how long a tree takes to go down (for the thud). */
  fallTime(f) {
    let th = f.theta, w = f.w, t = 0;
    while (th < f.max && t < 6) { w += 1.5 * G / f.L * Math.sin(th) * 0.02; th += w * 0.02; t += 0.02; }
    return t;
  }

  placeFallen(f) {
    const F = this.veg.fallenOf(f.kind, FALLEN), P = f.pose;
    // tipping about the stump (axis level, across the way it falls), then its own turn; squashed by the stump's height
    _q.setFromAxisAngle(_n.set(f.dz, 0, -f.dx), f.theta);
    _q2.setFromAxisAngle(UP, P.yaw);
    _q.multiply(_q2);
    _m.compose(_p.set(P.x, P.y + f.snap - (f.sink || 0), P.z), _q, _s.set(P.wd, f.L, P.wd));
    _m.toArray(F.matrix.array, f.slot * 16);
    F.matrix.needsUpdate = true;
  }

  splinters(x, y, z, e, n, col) {
    for (let k = 0; k < n; k++) {
      const sp = Math.min(10, e.v) * (0.3 + Math.random() * 0.5);
      this.effects.spawn(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.3) * 0.4, z + (Math.random() - 0.5) * 0.3,
        e.dx * sp + (Math.random() - 0.5) * 3, 0.8 + Math.random() * 2.5, e.dz * sp + (Math.random() - 0.5) * 3,
        0.02 + Math.random() * 0.045, 1.2 + Math.random(), [col[0] * (0.8 + Math.random() * 0.4), col[1] * (0.8 + Math.random() * 0.4), col[2] * (0.8 + Math.random() * 0.3)], 1, 0, 0.5, 9.81, KIND.CHUNK);
    }
  }

  // ---------------------------------------------------------------- every frame
  /**
   * Trees going over, pieces tumbling; a truck driving through pieces on the ground kicks them on
   * (trucks: [{ pos, vel }]).
   */
  update(dt, trucks = []) {
    dt = Math.min(dt, 1 / 30);
    for (const f of this.falling) {
      if (f.done) continue;
      // a rod tipping over about its foot: w' = (3 g / 2 L) sin(theta)
      f.w += 1.5 * G / f.L * Math.sin(f.theta) * dt;
      f.theta += f.w * dt;
      if (f.theta >= f.max) {
        f.theta = f.max;
        if (f.w > 0.6 && f.bounce < 2) { f.w = -f.w * 0.18; f.bounce++; } else { f.w = 0; f.done = true; }
      }
      this.placeFallen(f);
    }
    for (const t of trucks) {
      for (const b of this.bodies) {
        const dx = b.pos.x - t.pos.x, dz = b.pos.z - t.pos.z, d = Math.hypot(dx, dz);
        if (d > 2.6 || b.pos.y > t.pos.y + 1.2) continue;
        const sp = Math.hypot(t.vel.x, t.vel.z);
        if (sp < 1.5) continue;
        // in the way: shoved on ahead of the truck and a little aside
        b.vel.set(t.vel.x * 1.05 + (dx / (d || 1)) * 1.2, Math.max(b.vel.y, 0.8 + sp * 0.06), t.vel.z * 1.05 + (dz / (d || 1)) * 1.2);
        b.w.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
        b.sleep = 0;
      }
    }
    const h = dt / 2;
    for (const b of this.bodies) {
      b.age += dt;
      if (b.sleep > 0.5) continue;
      for (let k = 0; k < 2; k++) this.step(b, h);
      const moving = b.vel.lengthSq() > 0.02 || b.w.lengthSq() > 0.06;
      b.sleep = moving ? 0 : b.sleep + dt;
      _m.compose(b.pos, b.quat, b.scale);
      if (b.mesh) { b.mesh.matrix.copy(_m); b.mesh.matrixWorldNeedsUpdate = true; } else { b.P.mesh.setMatrixAt(b.slot, _m); b.P.dirty = true; }
    }
    for (const P of Object.values(this.pieces)) if (P.dirty) { P.dirty = false; P.mesh.instanceMatrix.needsUpdate = true; }
  }

  /** One step of a tumbling piece: gravity, its corners against the ground (bounce and friction). */
  step(b, dt) {
    b.vel.y -= G * dt;
    b.pos.addScaledVector(b.vel, dt);
    // the turn: q += 0.5 (w q) dt
    const w = b.w;
    _q2.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(b.quat);
    b.quat.set(b.quat.x + _q2.x, b.quat.y + _q2.y, b.quat.z + _q2.z, b.quat.w + _q2.w).normalize();
    let deepest = 0;
    const centre = _c.copy(b.mid).applyQuaternion(b.quat).add(b.pos);
    for (const corner of b.corners) {
      _p.copy(corner).applyQuaternion(b.quat).add(b.pos);
      const g = this.world.height(_p.x, _p.z), d = g - _p.y;
      if (d <= 0) continue;
      deepest = Math.max(deepest, d);
      // the ground's slope there
      _n.set(this.world.height(_p.x - 0.3, _p.z) - this.world.height(_p.x + 0.3, _p.z), 0.6, this.world.height(_p.x, _p.z - 0.3) - this.world.height(_p.x, _p.z + 0.3)).normalize();
      _r.subVectors(_p, centre);
      _v.copy(w).cross(_r).add(b.vel);                                  // the corner's velocity
      const vn = _v.dot(_n);
      if (vn >= 0) continue;
      const rn = _t.copy(_r).cross(_n), k = 1 / b.m + rn.lengthSq() / b.I;
      const j = -(1 + (vn < -2 ? 0.25 : 0.05)) * vn / k;
      b.vel.addScaledVector(_n, j / b.m);
      w.addScaledVector(rn, j / b.I);
      // friction across the ground
      _v.copy(w).cross(_r).add(b.vel);
      _t.copy(_v).addScaledVector(_n, -_v.dot(_n));
      const vt = _t.length();
      if (vt > 1e-4) {
        _t.multiplyScalar(1 / vt);
        const rt = _s.copy(_r).cross(_t), kt = 1 / b.m + rt.lengthSq() / b.I, jt = Math.min(0.6 * j, vt / kt);
        b.vel.addScaledVector(_t, -jt / b.m);
        w.addScaledVector(rt, -jt / b.I);
      }
    }
    if (deepest > 0) {
      b.pos.y += deepest * 0.8;
      // (rolling resistance and the grass: a drum rolls on a way, a plank stops in a skid)
      w.multiplyScalar(1 - 0.7 * dt);
      b.vel.x *= 1 - 0.35 * dt; b.vel.z *= 1 - 0.35 * dt;
    }
  }
}
