// Wraps an imported weapon GLB: normalizes orientation/scale into "weapon space"
//   -Z = muzzle direction, +Y = up, +X = right, origin = bounding-box centre, metres
// and exposes technical sockets: rightGrip, leftGrip, stock, muzzle, opticEye (+ optic lens / reticle).
// No weapon geometry is ever synthesized — only invisible sockets and a lightweight lens/reticle overlay.
import * as THREE from 'three';

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
    this.model.traverse((o) => { if (o.isMesh) { o.castShadow = !firstPerson; o.receiveShadow = true; } });
  }

  #normalize() {
    for (const n of this.def.hide || []) { const o = this.model.getObjectByName(n); if (o) { o.visible = false; this.hidden.push(n); } }
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
