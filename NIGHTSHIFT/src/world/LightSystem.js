// LightSystem: fake street lighting without real lights — instanced additive light pools on the
// ground, wet-road reflection streaks (oriented toward the camera), and lamp halos (billboards).
import * as THREE from 'three';
import { chunkKey } from './Props.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();

export class LightSystem {
  constructor(scene, materials, planner, layout) {
    this.M = materials;
    this.layout = layout;
    this.byChunk = new Map();
    for (const l of planner.lightPools) {
      l.y = layout.groundHeight(l.x, l.z) + 0.03;
      const k = chunkKey(l.x, l.z);
      if (!this.byChunk.has(k)) this.byChunk.set(k, []);
      this.byChunk.get(k).push(l);
    }
    // lamp head positions for halos (from props)
    this.lampsByChunk = new Map();
    for (const p of planner.props) {
      if (p.type !== 'lamp' && p.type !== 'highwayLamp' && p.type !== 'floodlight') continue;
      const heads = [];
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      if (p.type === 'lamp') heads.push([p.x + s * 2.6, p.y + 8.3, p.z + c * 2.6]);
      else if (p.type === 'floodlight') heads.push([p.x + s * 0.35, p.y + 9, p.z + c * 0.35]);
      else { heads.push([p.x + c * 5.4, p.y + 11.6, p.z - s * 5.4]); heads.push([p.x - c * 5.4, p.y + 11.6, p.z + s * 5.4]); }
      const k = chunkKey(p.x, p.z);
      if (!this.lampsByChunk.has(k)) this.lampsByChunk.set(k, []);
      for (const h of heads) this.lampsByChunk.get(k).push(h);
    }
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(plane, materials.lightPool, 1200);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1200 * 3), 3);
    this.pools.frustumCulled = false; this.pools.count = 0; this.pools.renderOrder = 2;
    const sg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.streaks = new THREE.InstancedMesh(sg, materials.streak, 800);
    this.streaks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(800 * 3), 3);
    this.streaks.frustumCulled = false; this.streaks.count = 0; this.streaks.renderOrder = 3;
    const hg = new THREE.PlaneGeometry(1, 1);
    this.haloMat = new THREE.MeshBasicMaterial({ map: materials.glow.map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffd8a0, fog: true });
    this.halos = new THREE.InstancedMesh(hg, this.haloMat, 900);
    this.halos.frustumCulled = false; this.halos.count = 0; this.halos.renderOrder = 4;
    scene.add(this.pools, this.streaks, this.halos);
    this.active = [];
    this.lamps = [];
  }

  rebuild(keys) {
    this.active = [];
    this.lamps = [];
    for (const k of keys) {
      const a = this.byChunk.get(k); if (a) for (const l of a) this.active.push(l);
      const b = this.lampsByChunk.get(k); if (b) for (const h of b) this.lamps.push(h);
    }
    const n = Math.min(this.active.length, this.pools.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      const l = this.active[i];
      _m.compose(_p.set(l.x, l.y, l.z), _q.identity(), _s.set(l.r * 2, 1, l.r * 2));
      this.pools.setMatrixAt(i, _m);
      this.pools.setColorAt(i, _c.setHex(l.color).multiplyScalar(l.i));
    }
    this.pools.count = n;
    this.pools.instanceMatrix.needsUpdate = true;
    this.pools.instanceColor.needsUpdate = true;
  }

  update(camera, envState) {
    const night = envState.night;
    this.pools.visible = night > 0.32;
    this.halos.visible = night > 0.32;
    this.haloMat.opacity = Math.min(1, (night - 0.3) * 1.5);
    const wet = this.M.streak.visible;
    this.streaks.visible = wet && night > 0.32;
    const cx = camera.position.x, cz = camera.position.z;
    if (this.halos.visible) {
      // billboard halos facing the camera, nearest lamps only
      let n = 0;
      const max = this.halos.instanceMatrix.count;
      _q.copy(camera.quaternion);
      for (const h of this.lamps) {
        const d = Math.hypot(h[0] - cx, h[2] - cz);
        if (d > 420) continue;
        const size = 2.2 + d * 0.012;
        _m.compose(_p.set(h[0], h[1] - 0.15, h[2]), _q, _s.set(size, size, size));
        this.halos.setMatrixAt(n++, _m);
        if (n >= max) break;
      }
      this.halos.count = n;
      this.halos.instanceMatrix.needsUpdate = true;
    }
    if (this.streaks.visible) {
      // reflection streak: from under the light towards the camera, stretched with distance
      let n = 0;
      const max = this.streaks.instanceMatrix.count;
      for (const l of this.active) {
        const dx = cx - l.x, dz = cz - l.z;
        const d = Math.hypot(dx, dz);
        if (d > 160 || d < 3) continue;
        const ang = Math.atan2(dx, dz);
        const len = Math.min(26, 5 + d * 0.28);
        _e.set(0, ang, 0); _q.setFromEuler(_e);
        _p.set(l.x + dx / d * len * 0.35, l.y + 0.01, l.z + dz / d * len * 0.35);
        _m.compose(_p, _q, _s.set(1.6, 1, len));
        this.streaks.setMatrixAt(n, _m);
        this.streaks.setColorAt(n, _c.setHex(l.color).multiplyScalar(0.8));
        n++;
        if (n >= max) break;
      }
      this.streaks.count = n;
      this.streaks.instanceMatrix.needsUpdate = true;
      this.streaks.instanceColor.needsUpdate = true;
    }
  }
}
