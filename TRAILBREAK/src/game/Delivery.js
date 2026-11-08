// Playing a delivery (game/Jobs.js): take a job (Modes & races, N), drive to its pickup and stop there: the load goes
// on, and the truck squats under it (physics/Upgrades.js: the load's weight on the bed, the springs set for the truck
// empty), sits lower, pulls slower and sinks deeper. Drive it to the drop and stop: it comes off, for the job's pay
// less what the load lost on the way. What it loses: hard jolts in the bed (a landing, a hole taken fast), a crash, and
// for cement and tea, water over the bed floor. A roll-over spills it, and the job is lost.
import { JOBS, CARGO, placeOf, loadOf, payOf, loadText } from './Jobs.js';
import { money } from './Career.js';
import { escapeHtml } from '../ui/HUD.js';

const STOP = 0.6;          // m/s: stopped
const HOLD = 2;            // s stopped in the place for the load to go on or come off
const JOLT = 2.5;          // g up through the bed floor that a load takes without harm (a landing is 3 to 5)
const CRASH = 4;           // g of sudden horizontal stop (a tree, a rock face) that a load takes without harm
const SOAK = 3;            // s for cement or tea under water to be ruined

const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

export class Delivery {
  constructor(game) {
    this.g = game;
    this.jobs = JOBS;
    this.byId = new Map(JOBS.map((j) => [j.id, j]));
    this.active = null;
  }

  get carrying() { return this.active?.phase === 'carry'; }

  /** Take a job: the satnav to its pickup. */
  take(id) {
    const job = this.byId.get(id);
    if (!job) return;
    if (this.active) this.drop(true);
    const from = placeOf(job.from), to = placeOf(job.to);
    if (!from || !to) return;
    this.active = { job, from, to, phase: 'pickup', cond: 1, hold: 0, vel: null, cool: 0, wet: 0, upside: 0, said: '' };
    this.g.setRoute({ kind: 'job', name: from.name, x: from.x, z: from.z }, true);
    this.g.hud.toast(`Job: ${job.title}. Drive to ${from.name} and stop there to load ${loadText(job)}`, true, 7);
  }

  /** Give the job up (what's on comes off where it is: the load is lost). */
  drop(quiet = false) {
    const A = this.active;
    if (!A) return;
    if (A.phase === 'carry') this.g.setCargo(null);
    this.active = null;
    if (this.g.route?.target.kind === 'job') this.g.clearRoute();
    if (!quiet) this.g.hud.toast(`Job given up: ${A.job.title}`, false, 4);
  }

  update(dt) {
    const A = this.active;
    if (!A || !(dt > 0)) return;
    const g = this.g, v = g.vehicle, p = v.pos;
    const place = A.phase === 'pickup' ? A.from : A.to;
    const d = Math.hypot(place.x - p.x, place.z - p.z), speed = Math.hypot(v.vel.x, v.vel.z);
    if (A.phase === 'carry' && this.wear(dt)) return;
    if (d < place.r && !g.events.racing) {
      if (speed < STOP) {
        A.hold += dt;
        if (A.hold >= HOLD) { if (A.phase === 'pickup') this.load(); else this.deliver(); return; }
        g.hud.hint(A.phase === 'pickup' ? `Loading ${loadText(A.job)}...` : `Unloading at ${place.name}...`, 0.4);
      } else {
        A.hold = 0;
        g.hud.hint(`${place.name}: stop to ${A.phase === 'pickup' ? 'load' : 'unload'}`, 0.4);
      }
    } else A.hold = 0;
  }

  load() {
    const A = this.active, g = this.g, L = loadOf(A.job);
    g.setCargo({ m: L.m, kind: L.kind });
    A.phase = 'carry'; A.hold = 0; A.cond = 1; A.vel = null; A.wet = 0; A.upside = 0;
    g.setRoute({ kind: 'job', name: A.to.name, x: A.to.x, z: A.to.z }, true);
    const c = L.cargo;
    g.hud.toast(`Loaded ${loadText(A.job)}: take it to ${A.to.name} (${A.job.km} km)${c.wet ? '. Keep it dry: water over the bed floor ruins it' : ''}`, true, 7);
  }

  deliver() {
    const A = this.active, g = this.g;
    const pay = Math.round((payOf(A.job) * A.cond) / 10) * 10;
    g.setCargo(null);
    this.active = null;
    if (g.route?.target.kind === 'job') g.clearRoute();
    g.career?.add(pay, `Delivery: ${A.job.title}`);
    const lost = Math.round((1 - A.cond) * 100);
    g.hud.toast(lost < 1 ? `Delivered: ${A.job.title}. ${money(pay)}` : `Delivered: ${A.job.title}, ${lost}% of the load damaged. ${money(pay)}`, true, 7);
  }

  fail(why) {
    const A = this.active, g = this.g;
    g.setCargo(null);
    this.active = null;
    if (g.route?.target.kind === 'job') g.clearRoute();
    g.hud.toast(`${why}: ${A.job.title} lost`, true, 7);
  }

  /** What the road does to the load; true when it's gone. */
  wear(dt) {
    const A = this.active, g = this.g, v = g.vehicle, c = CARGO[A.job.cargo];
    A.cool = Math.max(0, A.cool - dt);
    // jolts and crashes: the body's acceleration over the frame (up through the bed floor, in g; and stopping short);
    // not across a truck set down somewhere (towed home) or rebuilt (a load on or off)
    const jumped = A.veh !== v || !A.at || Math.hypot(v.pos.x - A.at[0], v.pos.z - A.at[1]) > Math.max(5, 3 * Math.hypot(v.vel.x, v.vel.z) * dt);
    A.veh = v; A.at = [v.pos.x, v.pos.z];
    if (jumped) A.vel = null;
    if (A.vel) {
      const up = (v.vel.y - A.vel[1]) / dt / 9.81 + 1;
      const stop = Math.hypot(v.vel.x - A.vel[0], v.vel.z - A.vel[2]) / dt / 9.81;
      const harm = Math.max(0, up - JOLT) * 0.04 + Math.max(0, stop - CRASH) * 0.03;
      if (harm > 0 && A.cool === 0) {
        A.cond = Math.max(0, A.cond - harm * c.jolt);
        A.cool = 0.25;
        if (harm * c.jolt > 0.01) g.hud.hint(`The ${c.name} took a knock: ${Math.round(A.cond * 100)}% left`, 2);
      }
    }
    A.vel = [v.vel.x, v.vel.y, v.vel.z];
    // water over the bed floor (a load's centre sits a quarter metre above it: Upgrades.js)
    const floor = (g.spec.cargo?.y ?? 1.1) - 0.25;
    if (c.wet && v.waterDepth > floor) {
      A.cond = Math.max(0, A.cond - dt / SOAK);
      if (A.said !== 'wet') { A.said = 'wet'; g.hud.toast(`The water's over the bed floor: the ${c.name} is getting soaked!`, true, 4); }
    } else if (A.said === 'wet') A.said = '';
    // over on its side or roof: the load is out
    A.upside = v.up.y < 0.3 ? A.upside + dt : 0;
    if (A.upside > 1) { this.fail('The load spilled as the truck went over'); return true; }
    if (A.cond <= 0.02) { this.fail(`The ${c.name} is ruined`); return true; }
    return false;
  }

  /** The line under the compass while a job is on (ui/HUD.js drawObjective). */
  objective(route) {
    const A = this.active;
    if (!A) return null;
    const p = this.g.vehicle.pos, place = A.phase === 'pickup' ? A.from : A.to;
    const left = route && route.target.kind === 'job' ? route.left : Math.hypot(place.x - p.x, place.z - p.z);
    if (A.phase === 'pickup') return `<span class="route">➤</span> <b>${escapeHtml(A.job.title)}</b> · load at <b>${escapeHtml(place.name)}</b> ${fmtDist(left)}`;
    const L = loadOf(A.job);
    return `<span class="route">➤</span> <b>${L.m} kg ${escapeHtml(L.cargo.name)}</b> to <b>${escapeHtml(place.name)}</b> ${fmtDist(left)} · <b class="${A.cond < 0.7 ? 'bad' : ''}">${Math.round(A.cond * 100)}%</b>`;
  }

  /** The Deliveries cards in Modes & races (game/EventPlay.js listHtml's helpers). */
  cards({ card, group, ic, feat }) {
    const A = this.active, here = this.g.vehicle.pos;
    const list = this.jobs.map((job) => {
      const from = placeOf(job.from), to = placeOf(job.to), L = loadOf(job), on = A?.job === job;
      const near = Math.hypot(from.x - here.x, from.z - here.z);
      return card({
        sec: 'job', edge: 'teal', icon: 'weight', title: escapeHtml(job.title), tag: on ? (A.phase === 'carry' ? 'On board' : 'Taken') : 'Delivery',
        image: `<div class="mc-route"><b>${escapeHtml(from.name)}</b>${ic('arrow')}<b>${escapeHtml(to.name)}</b></div>`,
        desc: escapeHtml(job.desc),
        feats: [feat('weight', loadText(job)), feat('pin', `${job.km} km`), feat('cash', `Pays ${money(payOf(job))}`), ...(L.cargo.wet ? [feat('water', 'Keep it dry')] : []), feat('map', `Pickup ${fmtDist(near)} away`)],
        acts: on ? `<button class="mc-btn b-teal" data-jobdrop="${job.id}">${ic('close')}Give it up</button>`
          : `<button class="mc-btn b-teal" data-job="${job.id}">${ic('play')}Take the job</button>`,
      });
    });
    return group('job', 'weight', 'Deliveries', 'haul a load across the map: stop at the pickup to load, at the drop to unload') + list.join('');
  }
}
