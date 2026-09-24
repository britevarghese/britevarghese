// Pedestrians: cheap sidewalk life. Low-poly figures rendered with a handful of InstancedMeshes
// (torso/head, legs, arms) animated per instance (walk cycle), walking loops around blocks,
// waiting at corners, and dodging cars. Distance LOD: limbs only near the camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp } from '../core/util.js';
import { CURB_H } from './CityLayout.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
const SHIRTS = [0x2a3a5a, 0x5a2a2a, 0x2a4a3a, 0x6a6a6a, 0x1a1a1a, 0x8a6a3a, 0x3a2a4a, 0xa0a0a0, 0x7a2a4a];
const PANTS = [0x1a1c22, 0x2a2e3a, 0x3a3228, 0x101010, 0x4a4a52];
const SKIN = [0xe0b090, 0xc08a60, 0x8a5a3a, 0x5a3a28, 0xf0c8a8];
const HAIR = [0x1a1410, 0x2a1c12, 0x3a2616, 0x0e0e10, 0x6a4a2a, 0x8a7a5a, 0x9a9a9a, 0x2a1c12];
const SHOES = [0x111111, 0x1a1a1a, 0xe8e8e8, 0x4a3020, 0x2a2a35];

function clean(g) { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k); return n; }

export class Pedestrians {
  constructor(scene, layout, max) {
    this.layout = layout;
    this.max = max;
    this.peds = [];
    this.R = rng(31337);
    // geometry: pivots at hips (legs) and shoulders (arms)
    const torso = mergeGeometries([
      clean(new THREE.CylinderGeometry(0.19, 0.16, 0.62, 8).translate(0, 1.22, 0)),
      clean(new THREE.CylinderGeometry(0.17, 0.19, 0.2, 8).translate(0, 0.93, 0)),
      // rounded shoulders so arms don't hang off a tube
      clean(new THREE.CapsuleGeometry(0.075, 0.34, 3, 8).rotateZ(Math.PI / 2).translate(0, 1.49, 0)),
    ]);
    // hair cap (upper back of the head); scaled to zero for bald pedestrians
    const hair = clean(new THREE.SphereGeometry(0.124, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.58).scale(1, 1.12, 1.08).rotateX(-0.25).translate(0, 1.69, -0.008));
    const head = clean(new THREE.SphereGeometry(0.115, 10, 8).scale(1, 1.15, 1.05).translate(0, 1.68, 0));
    const neck = clean(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6).translate(0, 1.56, 0));
    const leg = clean(new THREE.CylinderGeometry(0.075, 0.06, 0.86, 6).translate(0, -0.43, 0));
    const arm = clean(new THREE.CylinderGeometry(0.05, 0.045, 0.62, 6).translate(0, -0.31, 0));
    // hands and shoes follow the limb transforms (same pivots), in skin / shoe colours
    const hand = clean(new THREE.SphereGeometry(0.052, 7, 5).scale(0.8, 1.15, 0.7).translate(0, -0.66, 0));
    const shoe = clean(new THREE.BoxGeometry(0.1, 0.07, 0.24).translate(0, -0.85, 0.04));
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, mat, max); m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3); m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); return m; };
    this.meshTorso = mk(torso); this.meshHead = mk(mergeGeometries([head, neck]));
    this.meshLegL = mk(leg); this.meshLegR = mk(leg); this.meshArmL = mk(arm); this.meshArmR = mk(arm);
    this.meshHair = mk(hair);
    this.meshHandL = mk(hand); this.meshHandR = mk(hand); this.meshShoeL = mk(shoe); this.meshShoeR = mk(shoe);
    this.limbMeshes = [this.meshLegL, this.meshLegR, this.meshArmL, this.meshArmR, this.meshHandL, this.meshHandR, this.meshShoeL, this.meshShoeR];
  }

  _spawn(focus) {
    const R = this.R;
    // pick a random dense-ish block near the focus and a point on its sidewalk ring
    const blocks = this.layout.blocks.filter((b) => b.special !== 'river' && b.special !== 'hill' && Math.hypot(b.cx - focus.x, b.cz - focus.z) < 220 && Math.hypot(b.cx - focus.x, b.cz - focus.z) > 40);
    if (!blocks.length) return;
    const b = blocks[Math.floor(R() * blocks.length)];
    const inset = 2.2;
    const x0 = b.x0 + inset, x1 = b.x1 - inset, z0 = b.z0 + inset, z1 = b.z1 - inset;
    const per = 2 * (x1 - x0) + 2 * (z1 - z0);
    const weight = { downtown: 1, commercial: 1, suburban: 0.4, industrial: 0.25, warehouse: 0.15 }[b.district] ?? 0.3;
    if (R() > weight) return;
    this.peds.push({
      b, x0, x1, z0, z1, per, t: R() * per, dir: R() < 0.5 ? 1 : -1, speed: 1.1 + R() * 0.5, phase: R() * 6,
      shirt: SHIRTS[Math.floor(R() * SHIRTS.length)], pants: PANTS[Math.floor(R() * PANTS.length)], skin: SKIN[Math.floor(R() * SKIN.length)],
      hair: R() < 0.12 ? -1 : HAIR[Math.floor(R() * HAIR.length)],
      shoes: SHOES[Math.floor(R() * SHOES.length)],
      build: 0.88 + R() * 0.3, // girth: slim .. heavy
      scale: 0.92 + R() * 0.16, wait: 0, dodge: 0, dx: 0, dz: 0, x: 0, z: 0, yaw: 0,
    });
  }

  // a driver thrown out of their car: sprints away from the player for a few seconds, then leaves
  spawnFleeing(x, z, fromX, fromZ) {
    const n0 = this.peds.length;
    for (let k = 0; k < 12 && this.peds.length === n0; k++) this._spawn({ x: x + 60, z }); // borrow a random look
    if (this.peds.length === n0) return;
    const p = this.peds[this.peds.length - 1];
    const dx = x - fromX, dz = z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.flee = { x, z, vx: dx / l * 5.2, vz: dz / l * 5.2, t: 7 };
    p.speed = 4.6;
  }

  _pos(p) {
    let t = ((p.t % p.per) + p.per) % p.per;
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    if (t < w) return [p.x0 + t, p.z0, p.dir > 0 ? Math.PI / 2 : -Math.PI / 2];
    t -= w; if (t < d) return [p.x1, p.z0 + t, p.dir > 0 ? 0 : Math.PI];
    t -= d; if (t < w) return [p.x1 - t, p.z1, p.dir > 0 ? -Math.PI / 2 : Math.PI / 2];
    t -= w; return [p.x0, p.z1 - t, p.dir > 0 ? Math.PI : 0];
  }

  update(dt, camera, vehicles, enabled = true) {
    const focus = camera.position;
    if (!enabled || this.max === 0) { for (const m of [this.meshTorso, this.meshHead, this.meshHair, ...this.limbMeshes]) m.count = 0; return; }
    if (this.peds.length < this.max && this.R() < 0.6) this._spawn(focus);
    let n = 0, nl = 0;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      const d = Math.hypot(p.x - focus.x, p.z - focus.z);
      if (d > 260 && p.x !== 0) { this.peds.splice(i, 1); continue; }
      // dodge vehicles
      for (const v of vehicles) {
        const s = v.physics.s;
        const dx = p.x - s.x, dz = p.z - s.z, dd = Math.hypot(dx, dz);
        const sp = Math.hypot(s.vx, s.vz);
        if (dd < 3 + sp * 0.35 && sp > 3 && s.y > 0.08) { // car mounted the sidewalk
          const k = 1 / (dd || 1);
          p.dodge = 0.8; p.dx = dx * k * 6; p.dz = dz * k * 6;
        }
      }
      let moving = true;
      if (p.dodge > 0) { p.dodge -= dt; p.ox = (p.ox || 0) + p.dx * dt; p.oz = (p.oz || 0) + p.dz * dt; }
      else {
        p.ox = (p.ox || 0) * (1 - dt); p.oz = (p.oz || 0) * (1 - dt);
        if (p.wait > 0) { p.wait -= dt; moving = false; } else {
          p.t += p.dir * p.speed * dt;
          if (this.R() < dt * 0.02) p.wait = 2 + this.R() * 4;
        }
      }
      let yaw;
      if (p.flee) {
        const f = p.flee;
        f.t -= dt; if (f.t <= 0) { this.peds.splice(i, 1); continue; }
        f.x += f.vx * dt; f.z += f.vz * dt;
        p.x = f.x; p.z = f.z; p.yaw = yaw = Math.atan2(f.vx, f.vz); moving = true;
      } else {
        const [x, z, y2] = this._pos(p);
        yaw = y2; p.x = x + (p.ox || 0); p.z = z + (p.oz || 0); p.yaw = yaw;
      }
      if (d > 150) continue;
      p.phase += dt * (moving ? p.speed * 5.2 : 0);
      const swing = moving ? Math.sin(p.phase) * 0.5 : 0;
      const bob = moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0;
      const y = CURB_H + bob;
      _e.set(0, yaw, 0); _q.setFromEuler(_e);
      _s.set(p.scale * p.build, p.scale, p.scale * p.build);
      _m.compose(_p.set(p.x, y, p.z), _q, _s);
      this.meshTorso.setMatrixAt(n, _m); this.meshTorso.setColorAt(n, _c.setHex(p.shirt));
      _s.setScalar(p.scale);
      _m.compose(_p.set(p.x, y, p.z), _q, _s);
      this.meshHead.setMatrixAt(n, _m); this.meshHead.setColorAt(n, _c.setHex(p.skin));
      if (p.hair < 0) _m.makeScale(0, 0, 0);
      this.meshHair.setMatrixAt(n, _m); this.meshHair.setColorAt(n, _c.setHex(p.hair < 0 ? 0 : p.hair));
      if (d < 110) {
        const limb = (meshes, ox, oy, rot, colors) => {
          _e.set(rot, yaw, 0, 'YXZ'); _q.setFromEuler(_e);
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          _p.set(p.x + (ox * c) * p.scale, y + oy * p.scale, p.z + (-ox * sn) * p.scale);
          _m.compose(_p, _q, _s);
          meshes.forEach((mesh, i) => { mesh.setMatrixAt(nl, _m); mesh.setColorAt(nl, _c.setHex(colors[i])); });
        };
        const sh = 0.24 * p.build;
        limb([this.meshLegL, this.meshShoeL], 0.09, 0.88, swing, [p.pants, p.shoes]);
        limb([this.meshLegR, this.meshShoeR], -0.09, 0.88, -swing, [p.pants, p.shoes]);
        limb([this.meshArmL, this.meshHandL], sh, 1.5, -swing * 0.8, [p.shirt, p.skin]);
        limb([this.meshArmR, this.meshHandR], -sh, 1.5, swing * 0.8, [p.shirt, p.skin]);
        nl++;
      }
      n++;
    }
    for (const m of [this.meshTorso, this.meshHead, this.meshHair]) { m.count = n; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const m of this.limbMeshes) { m.count = nl; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    void clamp;
  }
  count() { return this.peds.length; }
}
