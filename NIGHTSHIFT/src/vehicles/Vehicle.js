// Vehicle: gameplay entity = VehiclePhysics (state) + optional VehicleRenderer (view).
// Rendering is decoupled: the physics state (VehicleState) can be replicated over the network.
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { VehicleRenderer } from './VehicleRenderer.js';

let NEXT_ID = 1;
export const FIXED_DT = 1 / 120;

export class Vehicle {
  constructor({ carId, params, world, lib, render = true, renderOpts = {}, role = 'player', carType = 'sports' }) {
    this.id = NEXT_ID++;
    this.carId = carId;
    this.role = role;
    this.carType = carType;
    this.physics = new VehiclePhysics({ ...params }, world);
    this.controls = { throttle: 0, brake: 0, steer: 0, handbrake: 0, nitro: false };
    this.renderer = render ? new VehicleRenderer(lib, carId, renderOpts) : null;
    this.acc = 0;
    this.fixedDt = role === 'player' ? FIXED_DT : 1 / 60;
    this.alive = true;
  }
  get state() { return this.physics.s; }
  get p() { return this.physics.p; }
  get position() { return this.physics.s; }
  get speedKmh() { return Math.abs(this.physics.s.speed) * 3.6; }

  place(x, z, yaw) { this.physics.place(x, z, yaw); }

  // fixed-step simulation with accumulator; returns events emitted by physics
  update(dt) {
    this.acc = Math.min(this.acc + dt, 0.1);
    const h = this.fixedDt;
    while (this.acc >= h) {
      this.physics.step(h, this.controls);
      this.acc -= h;
    }
    const ev = this.physics.events;
    this.physics.events = [];
    return ev;
  }

  sync(dt, camPos, env) { this.renderer?.sync(this.physics.s, dt, camPos, env); }
  dispose() { this.renderer?.dispose(); this.alive = false; }
}
