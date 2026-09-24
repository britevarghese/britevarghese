// Remote players & bots: every soldier is the imported character GLB (cloned via SkeletonUtils) holding the
// imported weapon GLB with hand IK. Positions are interpolated from server snapshots.
import * as THREE from 'three';
import { CharacterRig } from '../character/CharacterRig.js';
import { WeaponModel } from '../weapons/WeaponModel.js';
import { WEAPONS } from '/shared/weapons.js';

const STANCES = ['stand', 'crouch', 'prone'];
const _sphere = new THREE.Sphere(new THREE.Vector3(), 1.6), _m4 = new THREE.Matrix4();
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

// team uniform tint applied to the imported materials (keeps all PBR maps; only multiplies albedo)
const TEAM_TINT = { 1: new THREE.Color(0.78, 0.74, 0.58), 2: new THREE.Color(0.58, 0.64, 0.56) };

export class Players {
  constructor(game) {
    this.g = game;
    this.map = new Map(); // id -> { id, name, team, rig, weapons, ... }
    this.charCache = {};
    this.tintCache = new Map();
  }

  info(id) { return this.map.get(id); }

  async #characterFor(team) {
    const key = team === 2 ? 'operator' : 'soldier';
    if (!this.charCache[key]) this.charCache[key] = this.g.assets.loadCharacter(key);
    return this.charCache[key];
  }

  #tint(rig, team) {
    rig.meshes.forEach((m) => {
      const k = `${m.material.uuid}|${team}`;
      if (!this.tintCache.has(k)) { const c = m.material.clone(); c.color = c.color.clone().multiply(TEAM_TINT[team]); this.tintCache.set(k, c); }
      m.material = this.tintCache.get(k);
    });
  }

  async ensure(id, row) {
    let p = this.map.get(id);
    if (p) return p;
    const meta = this.g.board.get(id) || { n: `#${id}`, tm: 1 };
    p = { id, name: meta.n, team: meta.tm, alive: true, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, loading: true, spottedUntil: 0, lastStep: 0 };
    this.map.set(id, p);
    try {
      const loaded = await this.#characterFor(p.team);
      const rig = new CharacterRig(this.g.assets, loaded);
      // ground / floor height under a point (terrain, roads, floors, roofs) for the prone pose
      rig.groundAt = (x, z, y) => this.g.world.collision.supportHeight(x, z, y + 0.6);
      this.#tint(rig, p.team);
      this.g.world.scene.add(rig.root);
      p.rig = rig;
      p.weapons = {};
      p.loading = false;
      if (id === this.g.myId) rig.root.visible = false;
    } catch (e) { console.error(e); }
    return p;
  }

  async #weapon(p, wid) {
    if (!wid) return;
    if (p.weaponId === wid) return;
    p.weaponId = wid;
    const visual = WEAPONS[wid]?.visual || wid;
    if (!p.weapons[wid]) {
      const loaded = await this.g.assets.loadWeapon(visual, { tps: true });
      p.weapons[wid] = new WeaponModel(this.g.assets, loaded, { key: visual });
    }
    if (p.weaponId !== wid) return;
    for (const w of Object.values(p.weapons)) w.root.removeFromParent();
    this.g.world.scene.add(p.weapons[wid].root);
    p.rig.equip(p.weapons[wid]);
  }

  // apply interpolated snapshot state
  update(dt, sample, myId, camPos, thirdPerson, localState, camera = null) {
    if (camera) (this.frustum || (this.frustum = new THREE.Frustum())).setFromProjectionMatrix(_m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const seen = new Set();
    if (sample) {
      const { a, b, k } = sample;
      const A = new Map(a.p.map((r) => [r[0], r]));
      for (const rb of b.p) {
        const id = rb[0]; seen.add(id);
        const ra = A.get(id) || rb;
        const p = this.map.get(id) || (this.ensure(id, rb), this.map.get(id));
        if (!p) continue;
        const wasAlive = p.alive;
        p.alive = true;
        p.x = ra[1] + (rb[1] - ra[1]) * k; p.y = ra[2] + (rb[2] - ra[2]) * k; p.z = ra[3] + (rb[3] - ra[3]) * k;
        p.yaw = lerpAngle(ra[4], rb[4], k); p.pitch = ra[5] + (rb[5] - ra[5]) * k;
        p.stance = STANCES[rb[6]] || 'stand'; p.flags = rb[7]; p.hp = rb[9];
        p.vx = rb[10]; p.vz = rb[11];
        if (!wasAlive && p.rig) p.rig.revive();
        if (p.rig && !p.loading) this.#weapon(p, rb[8]);
      }
    }
    for (const p of this.map.values()) {
      if (!p.rig) continue;
      const isMe = p.id === myId;
      if (isMe && localState) {
        // local third-person body uses predicted state
        Object.assign(p, { x: localState.x, y: localState.y, z: localState.z, yaw: localState.yaw, pitch: localState.pitch, stance: localState.stance, vx: localState.vx, vz: localState.vz, alive: localState.alive, flags: (localState.ads ? 1 : 0) | (localState.sprint ? 2 : 0) | (localState.onGround ? 16 : 0) | (localState.air === 1 ? 32 : 0) | (localState.air === 2 ? 64 : 0) });
        if (localState.weaponId) this.#weapon(p, localState.weaponId);
      } else if (!seen.has(p.id) && p.alive && sample) {
        // not in snapshot => dead (keep the body for the death animation)
        p.alive = false;
        if (!p.rig.state.dead) p.rig.die(Math.random() < 0.5 ? 1 : -1);
      }
      const r = p.rig;
      const visible = isMe ? thirdPerson && p.alive : true;
      r.root.visible = visible;
      if (r.weapon) r.weapon.root.visible = visible && (p.alive || r.blend.death < 1);
      if (!visible && isMe) continue;
      const dist = camPos ? Math.hypot(p.x - camPos.x, p.z - camPos.z) : 0;
      // cheap LOD: far or off-screen characters animate at a reduced rate, fingers only up close
      p.animAcc = (p.animAcc || 0) + dt;
      _sphere.center.set(p.x, p.y + 1, p.z);
      const onScreen = !this.frustum || isMe || this.frustum.intersectsSphere(_sphere);
      const rate = !onScreen ? 0.25 : dist > 90 ? 0.1 : dist > 45 ? 0.05 : dist > 25 ? 0.033 : 0;
      r.detail = dist < 14 ? 0 : 1;
      // battle royale freefall: belly-to-earth (body pitched forward about the chest, weapon slung)
      const freefall = p.alive && (p.flags & 32);
      r.airPitch = (r.airPitch || 0) + ((freefall ? -1.35 : 0) - (r.airPitch || 0)) * (1 - Math.exp(-5 * dt));
      if (r.airPitch < -0.01 || freefall) { r.root.rotation.order = 'YXZ'; r.root.rotation.x = r.airPitch; }
      else r.root.rotation.x = 0;
      const lift = -r.airPitch * 0.75;
      if (r.weapon) r.weapon.root.visible = r.weapon.root.visible && !(p.alive && (p.flags & 96)); // slung while in the air
      if (!onScreen) r.root.position.set(p.x, p.y + lift, p.z);
      if (p.animAcc < rate) { r.root.position.set(p.x, p.y + lift, p.z); continue; }
      const adt = p.animAcc; p.animAcc = 0;
      r.root.position.set(p.x, p.y + lift, p.z);
      const airState = p.alive ? (p.flags & 32 ? 1 : p.flags & 64 ? 2 : 0) : 0;
      // no running animation while falling / hanging under the canopy
      const speed = airState ? 0 : Math.hypot(p.vx || 0, p.vz || 0);
      const reloadEnd = p.reloadEnd || 0, now = performance.now();
      r.setState({
        speed, moveYaw: Math.atan2(-(p.vx || 0), -(p.vz || 0)), aimYaw: p.yaw, pitch: p.pitch, stance: p.stance,
        ads: !!(p.flags & 1), sprint: !!(p.flags & 2), onGround: !!(p.flags & 16), firing: !!(p.flags & 8) && !isMe,
        reload: now < reloadEnd ? 1 - (reloadEnd - now) / p.reloadDur : 0, skydive: airState,
      });
      if (p.alive || r.state.dead) r.update(adt);
      // footsteps for nearby soldiers
      if (!isMe && p.alive && speed > 1 && dist < 35 && (p.flags & 16)) {
        p.stepAcc = (p.stepAcc || 0) + speed * adt;
        if (p.stepAcc > 1.6) { p.stepAcc = 0; this.g.audio.footstep([p.x, p.y, p.z], this.g.surfaceAt(p.x, p.z), false, speed > 4 ? 1.1 : 0.6); }
      }
    }
  }

  onReload(id, dur) { const p = this.map.get(id); if (p) { p.reloadEnd = performance.now() + dur; p.reloadDur = dur; } }

  muzzleOf(id) {
    const p = this.map.get(id);
    if (!p?.rig?.weapon) return null;
    return p.rig.weapon.socketWorld('muzzle', new THREE.Vector3());
  }

  remove(id) {
    const p = this.map.get(id); if (!p) return;
    if (p.rig) { p.rig.root.removeFromParent(); for (const w of Object.values(p.weapons || {})) w.root.removeFromParent(); }
    this.map.delete(id);
  }
}
