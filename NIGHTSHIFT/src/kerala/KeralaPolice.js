// Kerala's police on the roads (not chasing anyone):
//   - traffic police at the busy signalled junctions round the player: an officer in khaki on a little podium under
//     a white umbrella at the junction's corner, waving the traffic through;
//   - now and then a checking point on a main road ahead: a Kerala Police Bolero pulled over with its lights going,
//     a red-and-white barricade out on the edge of the lane, two officers waving vehicles down.
// Built round the player and taken away again as they leave (nothing here is saved).
import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { TRAFFIC_VEHICLES } from '../vehicles/VehicleCatalog.js';

const KHAKI = { top: 0xa08a5a, bottom: 0x8c7a52 };
const CHECK_EVERY = 150;      // seconds between checking points (at most one at a time)

export class KeralaPolice {
  constructor(game) {
    this.game = game;
    this.posts = new Map();   // signal node -> { group, cop }
    this.check = null;        // { x, z, group, cops, jeep }
    this.t = 0; this.checkT = 40;
    this.group = new THREE.Group(); this.group.name = 'kl_police_posts';
    game.scene.add(this.group);
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
    this.mats = { podium: M(0xd8d4c8), stripe: M(0xb01818), white: M(0xf2f0ea), pole: M(0x6a6a6a), canopy: M(0xf4f2ec, { side: THREE.DoubleSide }) };
  }

  _cop(n) {
    const h = this.game.humans?.ready ? this.game.humans.createMan(n, { shadow: false, outfit: KHAKI }) : null;
    if (h) { this.group.add(h.group); h.play('talk', { hold: true, fade: 0 }); }
    return h;
  }

  // a podium with a white umbrella: the Kerala traffic policeman's post
  _podium() {
    const g = new THREE.Group(), m = this.mats;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.45, 16), m.podium); base.position.y = 0.22; g.add(base);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.81, 0.81, 0.12, 16, 1, true), m.stripe); band.position.y = 0.3; g.add(band);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 6), m.pole); pole.position.set(0.55, 1.5, 0); g.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.45, 12, 1, true), m.canopy); top.position.set(0.55, 2.8, 0); g.add(top);
    return g;
  }

  // a red-and-white barricade (a 'POLICE' board on two legs)
  _barricade() {
    const g = new THREE.Group(), m = this.mats;
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.06), i % 2 ? m.white : m.stripe); b.position.set(-1.05 + i * 0.42, 0.9, 0); g.add(b); }
    for (const x of [-1.1, 1.1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.9, 0.5), m.pole); l.position.set(x, 0.45, 0); g.add(l); }
    return g;
  }

  update(dt, focus) {
    const g = this.game, W = g.world;
    if (!W.kerala || !g.humans?.ready) return;
    this.t -= dt;
    for (const p of this.posts.values()) p.cop?.animate(0, dt);
    for (const c of this.check?.cops || []) c.h?.animate(0, dt);
    if (this.t > 0) return;
    this.t = 1.5;
    // --- traffic police at the two nearest signalled junctions within 220 m
    const sig = [...(W.lanes?.signals || [])].map(([k, S]) => [k, S, Math.hypot(S.x - focus.x, S.z - focus.z)]).filter((q) => q[2] < 220).sort((a, b) => a[2] - b[2]).slice(0, 2);
    const want = new Set(sig.map((q) => q[0]));
    for (const [k, p] of this.posts) if (!want.has(k)) { p.group.removeFromParent(); p.cop?.group.removeFromParent(); this.posts.delete(k); }
    for (const [k, S] of sig) {
      if (this.posts.has(k)) continue;
      // the corner: the nearest point round the junction off every carriageway
      let spot = null;
      for (let r = 7; r <= 16 && !spot; r += 1.5) for (let a = 0; a < 16 && !spot; a++) {
        const x = S.x + Math.cos(a / 16 * Math.PI * 2 + 0.4) * r, z = S.z + Math.sin(a / 16 * Math.PI * 2 + 0.4) * r;
        if (!W.onCarriageway(x, z, 1.2)) spot = [x, z];
      }
      if (!spot) continue;
      const grp = this._podium(), y = W.groundHeight(spot[0], spot[1]);
      grp.position.set(spot[0], y, spot[1]); grp.rotation.y = Math.atan2(S.x - spot[0], S.z - spot[1]);
      this.group.add(grp);
      const cop = this._cop(k.length * 7 + 3);
      if (cop) { cop.group.position.set(spot[0], y + 0.45, spot[1]); cop.group.rotation.y = grp.rotation.y; }
      this.posts.set(k, { group: grp, cop });
    }
    // --- a checking point: one at a time, on a main road 150-250 m from the player, gone when they're 400 m off
    if (this.check && Math.hypot(this.check.x - focus.x, this.check.z - focus.z) > 400) this._clearCheck();
    this.checkT -= 1.5;
    if (!this.check && this.checkT <= 0 && !g.police?.inPursuit) {
      this.checkT = CHECK_EVERY;
      const lanes = g.traffic?.graph?.lanesNear?.(focus.x, focus.z, 150, 250)?.filter((l) => l.kind === 'lane' && l.laneIndex === 0 && (l.edge?.cls ?? 9) <= 3 && l.length > 60) || [];
      if (lanes.length) this._makeCheck(lanes[Math.floor(Math.random() * lanes.length)]);
    }
  }

  _makeCheck(lane) {
    const g = this.game, W = g.world, tmp = { x: 0, z: 0, dx: 0, dz: 1 };
    lane.sample(lane.length * 0.5, tmp);
    const rx = -tmp.dz, rz = tmp.dx, yaw = Math.atan2(tmp.dx, tmp.dz);   // (right of travel: the kerb side)
    // the carriageway's edge on the kerb side (left of travel), found by stepping out from the lane
    let edge = 1.75; while (edge < 14 && W.onCarriageway(tmp.x + rx * -edge, tmp.z + rz * -edge, 0)) edge += 0.25;
    const off = edge + 1.6;
    const ex = tmp.x + rx * -off, ez = tmp.z + rz * -off;                  // the jeep on the verge
    const grp = new THREE.Group(); this.group.add(grp);
    let jeep = null;
    if (g.lib.has('bolero')) {
      jeep = new Vehicle({ carId: 'bolero', params: { ...TRAFFIC_VEHICLES.bolero.params }, world: W, lib: g.lib, role: 'parked', carType: 'muscle', renderOpts: { police: true, headlights: 0, shadow: false, lodDistance: g.preset.carLod1Distance, detailWheels: false, sharedPaint: true } });
      jeep.renderer.applyCustom({ paint: 'factory', finish: 'gloss', tint: 0.5 });
      jeep.place(ex - tmp.dx * 6, ez - tmp.dz * 6, yaw);
      jeep.renderer.sirenOn = true;
      g.scene.add(jeep.renderer.group);
    }
    const bar = this._barricade(), bx = tmp.x + rx * -(edge - 0.4), bz = tmp.z + rz * -(edge - 0.4);
    bar.position.set(bx, W.groundHeight(bx, bz), bz); bar.rotation.y = yaw; grp.add(bar);   // (along the edge, facing the traffic)
    const cops = [];
    for (let i = 0; i < 2; i++) {
      const h = this._cop(i * 11 + 5); if (!h) continue;
      const cx = tmp.x + rx * -(edge + 0.5 + i * 0.8) + tmp.dx * (2 + i * 3), cz = tmp.z + rz * -(edge + 0.5 + i * 0.8) + tmp.dz * (2 + i * 3);
      h.group.position.set(cx, W.groundHeight(cx, cz), cz); h.group.rotation.y = yaw + Math.PI;   // facing the oncoming traffic
      cops.push({ h });
    }
    this.check = { x: tmp.x, z: tmp.z, group: grp, cops, jeep };
  }

  _clearCheck() {
    const c = this.check; this.check = null;
    if (!c) return;
    c.group.removeFromParent();
    for (const q of c.cops) q.h.group.removeFromParent();
    if (c.jeep) { c.jeep.renderer.group.removeFromParent(); c.jeep.dispose?.(); }
  }

  // the jeep's lights flash with the renderer's own update (it isn't driven)
  sync(dt, cam) { if (this.check?.jeep) { const v = this.check.jeep; v.sync?.(dt, cam, this.game.env); } }
}
