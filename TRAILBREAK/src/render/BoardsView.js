// The recovery boards a truck has laid (game/Boards.js): each a stiff orange plastic board with rows of raised cleats
// across it and its ends turned down, lying where it was put, tilted up out of the rut as it lies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BOARD } from '../game/Boards.js';

/** One board's shape, its long axis along +z, its underside at y = 0. */
function boardGeometry() {
  const { len, w, t } = BOARD, parts = [];
  const deck = new THREE.BoxGeometry(w, t * 0.45, len - 0.06); deck.translate(0, t * 0.225, 0); parts.push(deck);
  // (its ends turned down a little, a lip to dig in by, and its sides' rails)
  for (const s of [-1, 1]) {
    const lip = new THREE.BoxGeometry(w, t * 0.4, 0.05); lip.rotateX(s * 0.35); lip.translate(0, t * 0.12, s * (len / 2 - 0.03)); parts.push(lip);
    const rail = new THREE.BoxGeometry(0.02, t * 0.75, len - 0.1); rail.translate(s * (w / 2 - 0.01), t * 0.37, 0); parts.push(rail);
  }
  // (its cleats: short teeth in staggered rows across it)
  for (let k = 0, z = -len / 2 + 0.07; z < len / 2 - 0.05; z += 0.055, k++) {
    for (let x = -w / 2 + 0.035 + (k % 2) * 0.022; x < w / 2 - 0.02; x += 0.044) {
      const c = new THREE.BoxGeometry(0.016, t * 0.55, 0.012); c.translate(x, t * 0.45 + t * 0.27, z); parts.push(c);
    }
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

export class BoardsView {
  constructor(scene) {
    this.scene = scene;
    this.geo = null; this.mat = null; this.meshes = [];
  }

  /** Show the boards in this list (world coordinates), or none. */
  set(list) {
    list = list || [];
    if (list.length && !this.geo) {
      this.geo = boardGeometry();
      this.mat = new THREE.MeshStandardMaterial({ color: 0xd8571c, roughness: 0.62, metalness: 0 });
    }
    while (this.meshes.length < list.length) {
      const m = new THREE.Mesh(this.geo, this.mat);
      m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m); this.meshes.push(m);
    }
    this.meshes.forEach((m, i) => {
      const b = list[i];
      m.visible = !!b;
      if (!b) return;
      // (its middle; turned to its heading, then tilted up along it as it lies)
      m.position.set(b.x, (b.y0 + b.y1) / 2, b.z);
      m.rotation.set(0, 0, 0, 'YXZ');
      m.rotation.y = b.yaw; m.rotation.x = -Math.atan2(b.y1 - b.y0, BOARD.len);
    });
  }
}
