// Wraps an imported weapon GLB: normalizes orientation/scale into "weapon space"
//   -Z = muzzle direction, +Y = up, +X = right, origin = bounding-box centre, metres
// and exposes technical sockets: rightGrip, leftGrip, stock, muzzle, opticEye (+ optic lens / reticle).
// No weapon geometry is ever synthesized — only invisible sockets and a lightweight lens/reticle overlay.
// Moving parts (manifest "action": slide, hammer, bolt, charging handle, dust cover, magazine) are the GLB's own
// nodes, animated in place: blowback per shot, slide lock on empty, the bolt-action cycle, spent cases thrown from
// the ejection port (through WeaponModel.sink = the page's Effects), magazines placed by the reload choreography.
import * as THREE from 'three';
import { WEAPONS } from '/shared/weapons.js';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const ein = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t; }; // slammed home
const _X = new THREE.Vector3(1, 0, 0), _Z = new THREE.Vector3(0, 0, 1);
const _pv = new THREE.Vector3(), _pm = new THREE.Matrix4();
const _ep = new THREE.Vector3(), _evel = new THREE.Vector3(), _eq = new THREE.Quaternion();

const AXES = { '+x': [1, 0, 0], '-x': [-1, 0, 0], '+z': [0, 0, 1], '-z': [0, 0, -1] };
const SOCKET_NAMES = {
  rightGrip: /^(right_?grip|rightgrip|grip_?r|r_?grip|righthandgrip|pistol_?grip)$/i,
  leftGrip: /^(left_?grip|leftgrip|grip_?l|l_?grip|lefthandgrip|foregrip|handguard_?grip)$/i,
  stock: /^(stock_?point|stock|butt|stocksocket)$/i,
  muzzle: /^(muzzle_?point|muzzle|muzzle_?socket|barrel_?end)$/i,
  opticEye: /^(optic_?eye_?point|optic_?eye|eye_?point|aim_?point)$/i,
};

export class WeaponModel {
  constructor(assets, loaded, { key, firstPerson = false } = {}) {
    this.key = key;
    this.def = loaded.def;
    this.file = loaded.file;
    this.root = new THREE.Group();
    this.root.name = `weapon:${key}`;
    this.pivot = new THREE.Group();   // oriented + scaled container of the imported scene
    this.root.add(this.pivot);
    this.model = assets.clone(loaded.gltf);
    this.pivot.add(this.model);
    this.sockets = {};
    this.lens = null;
    this.hidden = [];
    this.#normalize();
    this.#findSockets();
    this.#setupOptic(firstPerson);
    this.#setupParts();
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = !firstPerson; o.receiveShadow = true; } });
  }

  #normalize() {
    for (const n of this.def.hide || []) { const o = this.model.getObjectByName(n); if (o) { o.visible = false; this.hidden.push(n); } }
    // magazines are laid out beside the gun in some source files: seat them in the well (model space) first
    const A = this.def.action;
    if (A?.magSeat) for (const k of ['mag', 'magEmpty']) { const o = A[k] && this.model.getObjectByName(A[k]); if (o) o.position.set(...A.magSeat); }
    this.model.updateMatrixWorld(true);
    const box = this.#visibleBox(this.model);
    const size = box.getSize(new THREE.Vector3());
    let fwd = this.def.forward;
    if (!fwd || fwd === 'auto') fwd = this.#guessForward(box, size);
    this.forwardAxis = fwd;
    const f = new THREE.Vector3(...AXES[fwd]);
    this.pivot.quaternion.setFromUnitVectors(f, new THREE.Vector3(0, 0, -1));
    // Real-world scale: explicit length, else fix obviously wrong units (cm / mm exports).
    const len = Math.abs(f.x) ? size.x : size.z;
    let s = 1;
    if (this.def.length) s = this.def.length / len;
    else if (len > 3 || len < 0.2) s = 0.9 / len;
    this.pivot.scale.setScalar(s);
    this.pivot.updateMatrixWorld(true);
    const b2 = this.#visibleBox(this.pivot, this.root);
    const c = b2.getCenter(new THREE.Vector3());
    this.pivot.position.sub(c);
    this.root.updateMatrixWorld(true);
    this.bounds = this.#visibleBox(this.pivot, this.root);
    this.length = this.bounds.max.z - this.bounds.min.z;
  }

  #visibleBox(obj, relativeTo = null) {
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    const inv = relativeTo ? new THREE.Matrix4().copy(relativeTo.matrixWorld).invert() : null;
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || !isVisible(o)) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      if (inv) tmp.applyMatrix4(inv);
      box.union(tmp);
    });
    return box;
  }

  #guessForward(box, size) {
    const axis = size.x >= size.z ? 'x' : 'z';
    const center = box.getCenter(new THREE.Vector3());
    let sign = 0;
    this.model.traverse((o) => {
      if (!o.isMesh || !isVisible(o)) return;
      const nm = `${o.name} ${[o.material].flat().map((m) => m.name).join(' ')}`;
      const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3());
      if (/barrel|muzzle|suppress|silenc|handguard|flash/i.test(nm)) sign += Math.sign(c[axis] - center[axis]) * 2;
      if (/stock|butt/i.test(nm)) sign -= Math.sign(c[axis] - center[axis]) * 2;
      if (/mag/i.test(nm)) sign += Math.sign(c[axis] - center[axis]) * 0.5;
    });
    const s = sign < 0 ? '-' : '+';
    console.warn(`[weapon] ${this.key}: forward axis auto-detected as ${s}${axis} (set "forward" in asset-manifest.json to override)`);
    return `${s}${axis}`;
  }

  #findSockets() {
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    this.model.traverse((o) => {
      for (const [k, re] of Object.entries(SOCKET_NAMES)) {
        if (!this.sockets[k] && re.test(o.name)) this.sockets[k] = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      }
    });
    const cfg = this.def.sockets || {};
    for (const [k, v] of Object.entries(cfg)) if (Array.isArray(v)) this.sockets[k] = new THREE.Vector3(...v);
    // Heuristic sockets from geometry (weapon space) when neither nodes nor config provide them.
    const b = this.bounds, L = this.length;
    const endY = (zSel) => {
      let sum = 0, n = 0; const v = new THREE.Vector3();
      this.model.updateMatrixWorld(true);
      this.model.traverse((o) => {
        if (!o.isMesh || !isVisible(o)) return;
        const pos = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0; i < pos.count; i += 3) { v.fromBufferAttribute(pos, i).applyMatrix4(m); if (zSel(v.z)) { sum += v.y; n++; } }
      });
      return n ? sum / n : 0;
    };
    const barrelY = endY((z) => z < b.min.z + 0.03 * L);
    if (!this.sockets.muzzle) this.sockets.muzzle = new THREE.Vector3(0, barrelY, b.min.z);
    if (!this.sockets.stock) this.sockets.stock = new THREE.Vector3(0, endY((z) => z > b.max.z - 0.03 * L), b.max.z);
    if (!this.sockets.rightGrip) this.sockets.rightGrip = new THREE.Vector3(0, barrelY - 0.07, b.max.z - 0.36 * L);
    if (!this.sockets.leftGrip) this.sockets.leftGrip = new THREE.Vector3(0, barrelY - 0.035, b.max.z - 0.66 * L);
  }

  #setupOptic(firstPerson) {
    const optic = this.def.optic || { type: 'auto' };
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    // find glass
    let glass = null;
    this.model.traverse((o) => {
      if (!o.isMesh || !isVisible(o)) return;
      const nm = [o.material].flat().map((m) => m.name).join(' ');
      if ((optic.lens && (o.name === optic.lens || nm === optic.lens)) || /glass|lens/i.test(nm) || /lens/i.test(o.name)) glass = glass || o;
    });
    let type = optic.type;
    if (type === 'auto') {
      let named = null;
      this.model.traverse((o) => { if (!named && /scope|optic|sight|reddot|red_dot|holo|acog/i.test(o.name)) named = o; });
      type = glass || named ? (/scope|acog/i.test(named?.name || '') ? 'scope' : 'reddot') : 'iron';
    }
    this.opticType = type;
    this.magnification = optic.magnification || (type === 'scope' ? 4 : 1);
    if (glass) {
      // Real optical glass: slightly tinted, low roughness, reflective, partially transparent.
      glass.material = new THREE.MeshStandardMaterial({ name: 'optic_glass', color: 0x9fb8c0, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.28, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide });
      glass.renderOrder = 2;
      glass.castShadow = false;
      const gb = new THREE.Box3().setFromObject(glass).applyMatrix4(inv);
      this.lensBox = gb;
      const gc = gb.getCenter(new THREE.Vector3());
      this.sightY = gc.y;
      this.lensRadius = Math.min(gb.max.y - gb.min.y, gb.max.x - gb.min.x) / 2;
      this.lensRearZ = gb.max.z;
      this.lensFrontZ = gb.min.z;
      if (!this.sockets.opticEye || !(this.def.sockets || {}).opticEye) this.sockets.opticEye = new THREE.Vector3(gc.x, gc.y, gb.max.z + (type === 'scope' ? 0.075 : 0.2));
      this.lens = glass;
    } else if (!this.sockets.opticEye) {
      // iron sights: top of the receiver toward the rear
      this.sightY = this.bounds.max.y - 0.01;
      this.sockets.opticEye = new THREE.Vector3(0, this.sightY, this.bounds.max.z * 0.4 + 0.1);
    } else this.sightY = this.sockets.opticEye.y;

    if (firstPerson && type === 'reddot' && glass) {
      // Collimated red dot: an emissive dot placed ON the optic's sight axis at the lens plane.
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 16), new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false, transparent: true, depthTest: false }));
      dot.position.set(this.sockets.opticEye.x, this.sightY, this.lensRearZ - 0.002);
      dot.renderOrder = 3;
      this.root.add(dot);
      this.reticle = dot;
    }
    if (firstPerson && type === 'scope' && glass) {
      // Eyepiece disc that displays the magnified picture-in-picture view + reticle while aiming.
      const r = Math.max(0.012, this.lensRadius * 0.92);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      disc.position.set(this.sockets.opticEye.x, this.sightY, this.lensRearZ + 0.001);
      disc.visible = false;
      disc.renderOrder = 3;
      this.root.add(disc);
      this.scopeDisc = disc;
      this.scopeDiscRadius = r;
    }
  }

  // ------------------------------------------------------------------ moving parts
  // manifest "action" (weapon space, metres): { type: 'pistol' | 'rifle' | 'bolt', slide / hammer / bolt / charge /
  // cover / carrier / mag / magEmpty: node names, slideTravel, boltStroke, boltLift (rad), chargeTravel, magAxis (out
  // of the well), magOut (how far it slides out), magGrab (support hand on the magazine, seat frame), clipGuide,
  // round (cartridge node for the stripper clip), eject: { pos, dir, speed, case } }
  #setupParts() {
    const A = this.def.action;
    this.action = A || null;
    this.parts = {};
    this.shotT = -1e9; this.coverOpen = false; this.chamberSpent = false; this.slideLocked = false;
    this.boltLift = 0; this.boltBack = 0; this.slideK = 0; this.chargeK = 0; this.boltHand = 0; this.cycleU = -1;
    this.vel = new THREE.Vector3(); // carrier velocity (world): spent cases keep it
    const gd = WEAPONS[this.key] || Object.values(WEAPONS).find((d) => d.visual === this.key);
    this.cycleTime = gd?.bolt || 1.05;
    if (!A) return;
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    for (const k of ['slide', 'hammer', 'bolt', 'charge', 'cover', 'carrier', 'mag', 'magEmpty']) {
      const o = A[k] && this.model.getObjectByName(A[k]);
      if (!o) continue;
      // the parent's frame in weapon space turns weapon-space offsets / axes into the node's own parent space
      m.multiplyMatrices(inv, o.parent.matrixWorld).decompose(v, q, sc);
      this.parts[k] = { o, p0: o.position.clone(), q0: o.quaternion.clone(), s0: o.scale.clone(), pqi: q.clone().invert(), ps: sc.x };
    }
    // (a user's own GLB in place of the default has none of these nodes: no moving parts, the generic reload)
    if (!Object.keys(this.parts).length) { this.action = null; return; }
    const mag = this.parts.mag;
    if (mag) {
      mag.o.visible = true;
      // seat frame = top centre of the seated magazine; the mesh rides on it rigidly (rel)
      const b = new THREE.Box3().setFromObject(mag.o).applyMatrix4(inv);
      this.sockets.magSeat = new THREE.Vector3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2);
      this.magAxis = new THREE.Vector3(...(A.magAxis || [0, -1, 0])).normalize();
      this.magOut = A.magOut ?? (b.max.y - b.min.y);
      this.magGrab = new THREE.Vector3(...(A.magGrab || [-0.016, -0.07, 0]));
      const seatInv = new THREE.Matrix4().makeTranslation(this.sockets.magSeat).invert();
      for (const k of ['mag', 'magEmpty']) if (this.parts[k]) this.parts[k].rel = seatInv.clone().multiply(m.multiplyMatrices(inv, this.parts[k].o.matrixWorld));
      if (this.parts.magEmpty) this.parts.magEmpty.o.visible = false;
    }
    const bolt = this.parts.bolt;
    if (bolt) {
      // bolt knob = the vertices farthest from the bolt axis (the handle tip), kept in the bolt's own space
      const o = bolt.o, axis = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), pts = [];
      o.updateMatrixWorld(true);
      o.traverse((c) => {
        if (!c.isMesh) return;
        const pos = c.geometry.attributes.position, cm = new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld);
        for (let i = 0; i < pos.count; i++) { const p = v.fromBufferAttribute(pos, i).applyMatrix4(cm); pts.push([p.x, p.y, p.z, Math.hypot(p.x - axis.x, p.y - axis.y)]); }
      });
      let rmax = 0; for (const p of pts) rmax = Math.max(rmax, p[3]);
      const knob = new THREE.Vector3(); let n = 0;
      for (const p of pts) if (p[3] > rmax * 0.86) { knob.x += p[0]; knob.y += p[1]; knob.z += p[2]; n++; }
      knob.divideScalar(Math.max(1, n));
      this.boltSide = Math.sign(knob.x - axis.x) || 1;
      this.sockets.boltKnob = knob.clone();
      this.knobLocal = knob.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld).invert());
    }
    // action sockets: a node in the GLB (eject_port, charge_grip, clip_guide) or weapon-space numbers
    const at = (node, val) => { const o = this.model.getObjectByName(node); return o ? o.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv) : val && new THREE.Vector3(...val); };
    if (A.eject) { this.sockets.eject = at('eject_port', A.eject.pos); this.ejectDir = new THREE.Vector3(...A.eject.dir).normalize(); }
    for (const [k, node] of [['chargeGrip', 'charge_grip'], ['clipGuide', 'clip_guide']]) { const p = at(node, A[k]); if (p) this.sockets[k] = p; }
    if (this.sockets.clipGuide) this.#makeClip(A);
  }

  // bolt rifle: a 5-round stripper clip (the GLB's own cartridge, cloned) for the reload
  #makeClip(A) {
    const round = A.round && this.model.getObjectByName(A.round);
    if (!round) return;
    const clip = new THREE.Group(); clip.name = 'stripper_clip'; clip.visible = false;
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert(), rel = new THREE.Matrix4().multiplyMatrices(inv, round.matrixWorld);
    const rb = new THREE.Box3().setFromObject(round).applyMatrix4(inv), rc = rb.getCenter(new THREE.Vector3()), len = rb.max.z - rb.min.z;
    clip.rounds = [];
    for (let i = 0; i < 5; i++) {
      // rounds stacked one above the other (staggered), rims in the clip at the rear, bullets forward
      const r = new THREE.Group(), m = round.clone(); m.visible = true;
      rel.decompose(m.position, m.quaternion, m.scale); m.position.sub(rc);
      r.add(m); r.position.set(i % 2 ? 0.0025 : -0.0025, -i * 0.0105, 0); clip.add(r); clip.rounds.push(r);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.058, 0.004), new THREE.MeshStandardMaterial({ color: 0x3b3a36, metalness: 0.8, roughness: 0.45 }));
    strip.position.set(0, -0.021, len / 2 - 0.004); clip.add(strip);
    clip.len = len;
    this.root.add(clip);
    this.clip = clip;
  }

  // move a part: weapon-space translation (tx, ty, tz) and rotation `ang` about weapon-space `axis` (node pivot)
  #pose(P, tx, ty, tz, axis = null, ang = 0) {
    P.o.position.set(tx, ty, tz).applyQuaternion(P.pqi).divideScalar(P.ps).add(P.p0);
    if (ang) P.o.quaternion.setFromAxisAngle(_pv.copy(axis).applyQuaternion(P.pqi), ang).multiply(P.q0);
    else P.o.quaternion.copy(P.q0);
  }

  // a round was fired: self-loaders throw the case out at once, a bolt action keeps it until the bolt is worked
  fired(now = performance.now()) {
    this.shotT = now;
    const A = this.action;
    if (!A) return;
    if (A.type === 'bolt') this.chamberSpent = true; else this.eject();
    if (this.parts.cover) this.coverOpen = true; // the M4's dust cover pops open on the first shot and stays open
  }

  // spent case (or stripper clip) out of the ejection port: world position / velocity / orientation to the sink
  eject(kind = this.action?.eject?.case, at = 'eject', dir = null, speed = null) {
    const E = this.action?.eject;
    if (!E || !this.sockets[at]) return;
    const pos = this.socketWorld(at, _ep);
    const q = this.root.getWorldQuaternion(_eq);
    const s = (speed ?? E.speed) * (0.85 + Math.random() * 0.3);
    _evel.copy(dir || this.ejectDir).applyQuaternion(q).multiplyScalar(s);
    _evel.x += (Math.random() - 0.5) * 0.25 * s; _evel.y += (Math.random() - 0.5) * 0.25 * s; _evel.z += (Math.random() - 0.5) * 0.25 * s;
    _evel.add(this.vel);
    if (this.onEject) this.onEject(pos, _evel, kind, q);
    else WeaponModel.sink?.brass(pos, _evel, kind, q);
  }

  // world frame of the magazine seat slid `out` metres along the well axis (0 = seated)
  magFrame(out = 0, target = new THREE.Matrix4()) {
    _pv.copy(this.magAxis).multiplyScalar(out).add(this.sockets.magSeat);
    return target.makeTranslation(_pv).premultiply(this.root.matrixWorld);
  }

  // place a magazine node from a rigid world seat frame F; null = seated in the gun
  placeMag(F, which = 'mag') {
    const P = this.parts[which];
    if (!P) return;
    if (!F) { P.o.position.copy(P.p0); P.o.quaternion.copy(P.q0); P.o.scale.copy(P.s0); return; }
    P.o.parent.updateMatrixWorld(true);
    _pm.copy(P.o.parent.matrixWorld).invert().multiply(F).multiply(P.rel); // F * rel = the magazine in the world
    _pm.decompose(P.o.position, P.o.quaternion, P.o.scale);
  }

  // bolt knob in world space (follows the animated bolt)
  knobWorld(target = new THREE.Vector3()) {
    const b = this.parts.bolt;
    b.o.updateMatrixWorld(true);
    return target.copy(this.knobLocal).applyMatrix4(b.o.matrixWorld);
  }

  // Per frame: parts from the time since the last shot and the reload fraction (rl, 0 = not reloading).
  // mag: rounds left (local player; remote soldiers pass 1). Leaves for the arm choreography:
  //   boltHand (0..1 right hand on the bolt knob), cycleU (bolt-cycle phase), boltLift / boltBack, chargeK, slideK.
  animate(now = performance.now(), rl = 0, empty = false, mag = 1) {
    const A = this.action, P = this.parts;
    this.boltHand = 0; this.cycleU = -1;
    if (!A) return;
    const dt = (now - this.shotT) / 1000;
    if (mag > 0) this.slideLocked = false;
    else if (dt < 0.25 && A.type !== 'bolt' && !(rl >= 0.88)) this.slideLocked = true; // last round: slide stop / bolt catch holds it
    if (A.type === 'pistol' || A.type === 'rifle') {
      // blowback: ~25 mm back and home again in ~70 ms
      let k = dt < 0.02 ? sm(0, 0.02, dt) : 1 - sm(0.02, 0.07, dt);
      if (this.slideLocked) {
        k = 1;
        // empty reload: slide stop pressed / charging handle let go at 0.88 — it flies home, chambering a round
        if (rl >= 0.88 && empty) { this.slideLocked = false; this.releaseT = now; if (A.type === 'pistol') this.slamT = now; }
      }
      if (!this.slideLocked && now - (this.releaseT || -1e9) < 45) k = Math.max(k, 1 - (now - this.releaseT) / 45);
      this.slideK = k;
      if (P.slide) this.#pose(P.slide, 0, 0, (A.slideTravel ?? 0.025) * k);
      if (P.hammer) this.#pose(P.hammer, 0, 0, 0, _X, (A.hammerCock ?? 0.5) * Math.min(1, k));
      if (P.carrier) this.#pose(P.carrier, 0, 0, (A.carrierTravel ?? 0.03) * Math.min(1, k));
      if (P.cover) this.#pose(P.cover, 0, 0, 0, _Z, this.coverOpen ? (A.coverOpen ?? -1.9) : 0);
      // empty rifle reload: charging handle pulled back 0.80-0.865, let go at 0.88
      const ck = rl > 0 && empty && A.type === 'rifle' ? sm(0.8, 0.865, rl) * (1 - sm(0.876, 0.886, rl)) : 0;
      if (this.chargeK >= 0.5 && ck < 0.5) this.slamT = now; // charging handle let go: the bolt slams home
      this.chargeK = ck;
      if (P.charge) this.#pose(P.charge, 0, 0, (A.chargeTravel ?? 0.07) * this.chargeK);
      if (P.carrier && this.chargeK) this.#pose(P.carrier, 0, 0, (A.carrierTravel ?? 0.03) * this.chargeK * 2.5);
    } else if (A.type === 'bolt') {
      // bolt cycle after a shot (0.15 s after it, over def.bolt): up 0.10, back 0.30 (case out), forward 0.55,
      // down 0.70, hand back on the grip by 1.0
      const u = (dt - 0.15) / this.cycleTime;
      let lift = 0, back = 0, hand = 0;
      if (u > -0.12 && u < 1) {
        hand = sm(-0.1, 0.06, u) * (1 - sm(0.7, 1, u));
        lift = sm(0.05, 0.1, u) * (1 - sm(0.55, 0.7, u));
        back = ein(0.1, 0.3, u) * (1 - ein(0.36, 0.55, u));
        this.cycleU = u;
      }
      if (rl > 0) {
        // reload: open (up by 0.11, back by 0.20), clip in at 0.70, forward 0.77-0.85, down / closed at 0.88
        if (!this.rlFrom) this.rlFrom = { lift, back, hand };
        const L = sm(0.07, 0.11, rl) * (1 - sm(0.85, 0.88, rl)), B = ein(0.11, 0.2, rl) * (1 - ein(0.77, 0.85, rl));
        // a cycle cut short by the reload: the bolt stays where it was until the reload has it fully open
        lift = rl < 0.2 ? Math.max(L, this.rlFrom.lift) : L; back = rl < 0.2 ? Math.max(B, this.rlFrom.back) : B;
        hand = 0; this.cycleU = -1;
      } else this.rlFrom = null;
      // the case comes out as the bolt reaches the back (or late, if a slow update stepped over that moment)
      if (this.chamberSpent && (back > 0.97 || this.cycleU > 0.36 || rl > 0.22)) { this.chamberSpent = false; this.eject(); }
      if (this.boltLift > 0.05 && lift <= 0.05) this.slamT = now; // handle down: locked
      this.boltLift = lift; this.boltBack = back; this.boltHand = hand;
      const b = P.bolt;
      if (b) {
        b.o.position.set(0, 0, (A.boltStroke ?? 0.085) * back).applyQuaternion(b.pqi).divideScalar(b.ps).add(b.p0);
        b.o.quaternion.setFromAxisAngle(_pv.copy(_Z).applyQuaternion(b.pqi), this.boltSide * (A.boltLift ?? 1.45) * lift).multiply(b.q0);
      }
    }
  }

  // Socket world position helper
  socketWorld(name, target = new THREE.Vector3()) {
    return target.copy(this.sockets[name]).applyMatrix4(this.root.matrixWorld);
  }

  describe() {
    const f = (v) => (v ? `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})` : 'missing');
    return {
      key: this.key, file: this.file, forward: this.forwardAxis, length: this.length.toFixed(3), optic: this.opticType, lens: this.lens?.name || 'none',
      rightGrip: f(this.sockets.rightGrip), leftGrip: f(this.sockets.leftGrip), stock: f(this.sockets.stock), muzzle: f(this.sockets.muzzle), opticEye: f(this.sockets.opticEye),
    };
  }
}

function isVisible(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }
