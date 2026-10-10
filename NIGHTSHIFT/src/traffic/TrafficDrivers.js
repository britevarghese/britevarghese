// Drivers in the traffic: the nearest cars, autos, lorries and buses get a seated person at the wheel (the 'drive'
// clip), hips on the driver's seat: right-hand drive for Kerala's vehicles, in the middle for an autorickshaw.
// Seat positions come from each model's driver's-eye marker. Two-wheelers have their own riders.
import * as THREE from 'three';
import { TRAFFIC_MODELS } from '../vehicles/VehicleCatalog.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
const _seat = new THREE.Vector3(), _hip = new THREE.Vector3();
// the driver's seat (hips) along the body, metres from its middle toward the front, for the models without a marker
const CAB_Z = { minitruck: 1.0, lorry: 3.15, ksrtc: 4.55, pvtbus2: 4.45, bolero: 0.1 };

export class TrafficDrivers {
  constructor(game) { this.game = game; this.on = new Map(); this.pool = []; this.seats = {}; }

  _seatOf(type) {
    if (this.seats[type] !== undefined) return this.seats[type];
    const root = this.game.lib.cars?.[type], tm = TRAFFIC_MODELS[type];
    let s = null;
    const eye = root?.getObjectByName('eye_cockpit');
    if (eye) {
      s = eye.position.clone();
      if (type === 'auto') s.x = 0;
      else if (tm && /^kl_/.test(tm.id)) s.x = -Math.max(0.3, Math.abs(s.x));   // right-hand drive
      s.y -= 0.62; s.z += type === "auto" ? -0.08 : 0.06;                            // hips under the eyes (seat back reclined)
      // models whose eye marker was never placed (it sits at the body's middle): the cab is at the front
      // (a pickup's driver sat in the cargo bed, a lorry's and a bus's halfway down the body)
      if (CAB_Z[type] !== undefined && Math.abs(eye.position.z) < 0.01) s.z = CAB_Z[type];
    }
    return (this.seats[type] = s);
  }

  _take() {
    const H = this.game.humans;
    if (this.pool.length) return this.pool.pop();
    // (the men among the people models: the player's own look aside)
    const men = H.models.map((m, i) => (i > 0 && m.sex !== 'f' ? i : -1)).filter((i) => i >= 0);
    const h = H.create(men.length ? men[Math.floor(Math.random() * men.length)] : 0, { shadow: false });
    if (h) h.play('drive', { hold: true, fade: 0 });
    return h;
  }

  update(dt) {
    const g = this.game, H = g.humans;
    if (!H?.ready || !g.traffic?.cars) return;
    const K = Math.min(8, Math.round((g.preset.people ?? 8) * 0.75));
    const want = g.traffic.cars.filter((c) => c.dist < 60 && !c.spec.bike && (c.state === 'drive' || c.pulled) && this._seatOf(c.type)).sort((a, b) => a.dist - b.dist).slice(0, K);
    const keep = new Set(want);
    for (const [c, h] of this.on) if (!keep.has(c) || !g.traffic.cars.includes(c)) { h.group.removeFromParent(); this.pool.push(h); this.on.delete(c); }
    for (const c of want) {
      let h = this.on.get(c);
      if (!h) { h = this._take(); if (!h) continue; this.on.set(c, h); g.scene.add(h.group); }
      // in a closed car the shins and feet are under the dash, out of sight, and on low or narrow cabins they
      // poked out through the floor and doors: fold them away at the knee (an autorickshaw is open: keep them)
      const fold = c.type === 'auto' ? 1 : 0.001;
      if (h._fold !== fold) { h._fold = fold; for (const b of [h.B.LeftLeg, h.B.RightLeg]) b?.scale.setScalar(fold); }
      // the car's transform, as the traffic renderer draws it
      _q.setFromEuler(_e.set(-(c.pitch || 0), c.yaw, c.roll || 0, 'YXZ'));
      _m.compose(_p.set(c.x, c.y, c.z), _q, _one);
      _seat.copy(this._seatOf(c.type)).applyMatrix4(_m);
      h.group.quaternion.copy(_q);
      h.animate(0, dt);
      // move the body so its hips sit on the seat
      h.group.updateMatrixWorld(true);
      h.B.Hips.getWorldPosition(_hip);
      h.group.position.add(_seat.sub(_hip));
      h.group.updateMatrixWorld(true);
    }
  }
}
