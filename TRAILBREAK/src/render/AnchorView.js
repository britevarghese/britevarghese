// The spare wheel buried as a winch anchor (game/Anchor.js): the spoil dug out of its trench heaped on the ground,
// the soil's own colour, and the strap coming up out of the slot toward the truck (the winch line goes on from it).
import * as THREE from 'three';

// (the spoil's colour by what was dug, sRGB: freshly dug, darker and damper than the ground's top)
const SOIL = { 0: [0.27, 0.18, 0.11], 1: [0.33, 0.21, 0.12], 2: [0.4, 0.37, 0.33], 4: [0.18, 0.12, 0.07], 5: [0.6, 0.52, 0.38], 6: [0.86, 0.88, 0.92], 10: [0.3, 0.19, 0.11] };

export class AnchorView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;
    // the spoil: lumpy heaps of dug earth either side of the trench, a little longer than the wheel is across
    const lump = new THREE.IcosahedronGeometry(1, 2), p = lump.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.78 + 0.22 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(y * 4.3 - x * 2.9);
      p.setXYZ(i, x * k, Math.max(-0.2, y) * k, z * k);
    }
    lump.computeVertexNormals();
    this.mat = new THREE.MeshStandardMaterial({ color: 0x5c4026, roughness: 1, metalness: 0, flatShading: true });
    for (const s of [-1, 1]) for (const [u, sx, sy, sz] of [[-0.3, 0.42, 0.2, 0.26], [0.12, 0.5, 0.26, 0.3], [0.48, 0.34, 0.16, 0.22]]) {
      const m = new THREE.Mesh(lump, this.mat);
      m.scale.set(sx, sy, sz); m.position.set(u * s, 0, s * (0.4 + 0.05 * u)); m.rotation.y = u * 2 + s;
      m.castShadow = true; m.receiveShadow = true;
      this.group.add(m);
    }
    // the trench between, dark and wet, and the strap (a yellow recovery strap) up out of its slot toward the truck
    const trench = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.36), new THREE.MeshStandardMaterial({ color: 0x140e08, roughness: 0.6 }));
    trench.rotation.x = -Math.PI / 2; trench.position.y = 0.04;
    this.group.add(trench);
    this.strap = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 1.1), new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.7 }));
    this.strap.position.set(0, 0.06, 0.55); this.strap.rotation.x = -0.08;
    this.group.add(this.strap);
    scene.add(this.group);
  }

  /**
   * Show it at the anchor (x, y, z: where the line leaves the ground), the line going off toward (tx, tz), dug in the
   * ground `surface` (a surface id); or hide it (null).
   */
  set(a, tx = 0, tz = 0) {
    this.group.visible = !!a;
    if (!a) return;
    const c = SOIL[a.surface] || SOIL[1];
    this.mat.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    this.group.position.set(a.x, a.y - 0.05, a.z);
    this.group.rotation.y = Math.atan2(tx - a.x, tz - a.z);
  }
}
