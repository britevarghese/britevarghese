// Street rivals: named racers cruising the city in free roam, marked by a coloured underglow and a
// name tag. Pull up next to one and press E to call them out: a one-on-one sprint through a checkpoint
// to a finish about a kilometre away. The prize grows with the rival's car class; every rival you beat
// is remembered (and levels up the next time you meet them).
import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { AIDriver } from '../vehicles/AIDriver.js';
import { CARS, tunedParams, TIERS } from '../vehicles/VehicleCatalog.js';
import { VehiclePhysics } from '../physics/VehiclePhysics.js';
import { radialGlow } from '../renderer/Textures.js';
import { bus } from '../core/EventBus.js';

const CREW = [
  { name: 'Kaze', color: '#ff3df0' }, { name: 'Vandal', color: '#3dffb0' }, { name: 'Mirage', color: '#8a5bff' },
  { name: 'Rook', color: '#ffb03d' }, { name: 'Hex', color: '#3dc8ff' }, { name: 'Lotus', color: '#ff5b7a' },
  { name: 'Specter', color: '#d8f0ff' }, { name: 'Talon', color: '#ff7a1a' }, { name: 'Zero', color: '#5bff4d' },
];
const PRIZE = { D: 2500, C: 4200, B: 6800, A: 10500, S: 16000 };
const MAX_RIVALS = 2;
const CHALLENGE_DIST = 24;
const CHALLENGE_GRACE = 2.5; // seconds a rival stays challengeable after you were close

function nameTag(text, sub, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 58px Segoe UI, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 10;
  g.fillStyle = color; g.fillText(text.toUpperCase(), 256, 46);
  g.font = '600 30px Segoe UI, Arial'; g.fillStyle = '#e8e8f0'; g.fillText(sub, 256, 100);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StreetRivals {
  constructor(game) {
    this.game = game;
    this.rivals = [];
    this.spawnT = 8;
    this.challenged = null;
    const d = game.save.data;
    d.rivalsBeaten ??= {};
    bus.on('race:countdown', () => this.clear());
    bus.on('race:finished', (r) => {
      if (!r.def.street) return;
      const name = r.def.rival;
      if (r.win) {
        d.rivalsBeaten[name] = (d.rivalsBeaten[name] || 0) + 1;
        const st = game.save.data.stats; st.streetWins = (st.streetWins || 0) + 1;
        game.ui.toast(`${name.toUpperCase()} beaten (${d.rivalsBeaten[name]}x)`, 'cash', 4);
      } else if (!r.failed) game.ui.toast(`${name} takes it. Find them again for a rematch.`, '', 4);
      this.spawnT = 20;
    });
  }

  vehicles() { return this.rivals.map((r) => r.v); }

  _drop(r) {
    r.v.dispose();
    r.tag.material.map.dispose(); r.tag.material.dispose();
    r.glow.geometry.dispose(); r.glow.material.dispose();
  }
  clear() {
    for (const r of this.rivals) this._drop(r);
    this.rivals.length = 0;
  }

  // ------------------------------------------------------------------ spawning
  _pool() {
    const g = this.game;
    const pool = g.races.rivalPool();
    g.lib.load(pool, 4); // background stream; rivals appear once a model is ready
    return pool.filter((id) => g.lib.has(id) && id !== g.save.data.currentCar);
  }

  _spawn() {
    const g = this.game, s = g.player.state;
    const pool = this._pool();
    if (!pool.length) return;
    const free = CREW.filter((c) => !this.rivals.some((r) => r.crew.name === c.name));
    const crew = free[Math.floor(Math.random() * free.length)];
    // a lane spot 170-280 m away, out of the camera's sight
    let spot = null;
    for (let i = 0; i < 8 && !spot; i++) {
      const a = Math.random() * Math.PI * 2, r = 170 + Math.random() * 110;
      const c = g._laneSpot(s.x + Math.sin(a) * r, s.z + Math.cos(a) * r);
      const dc = Math.hypot(c.x - g.camera.position.x, c.z - g.camera.position.z);
      if (dc > 130 && !this.rivals.some((q) => Math.hypot(q.v.state.x - c.x, q.v.state.z - c.z) < 60)) spot = c;
    }
    if (!spot) return;
    const beaten = g.save.data.rivalsBeaten[crew.name] || 0;
    const carId = pool[Math.floor(Math.random() * pool.length)];
    const car = CARS[carId];
    const params = tunedParams(carId, { engine: Math.min(3, 1 + beaten), tires: Math.min(3, 1 + (beaten >> 1)), transmission: 1 });
    const v = new Vehicle({ carId, params, world: g.world, lib: g.lib, role: 'racer', carType: car.carType, renderOpts: { headlights: 0, shadow: false, lodDistance: g.preset.carLod1Distance, sharedPaint: true } });
    if (car.real) v.renderer.applyCustom({ paint: 'factory', finish: 'metallic', tint: 0.6 });
    else v.renderer.applyCustom({ paint: crew.color, paint2: '#111', vinyl: 1 + (crew.name.length % 5), finish: 'metallic', wheel: crew.name.length % 4, spoiler: 2, tint: 0.7, wheelColor: '#1a1a1c' });
    v.place(spot.x, spot.z, spot.yaw);
    // underglow + name tag
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
      map: radialGlow(), color: crew.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.85,
    }));
    glow.position.y = 0.06; glow.renderOrder = 2;
    v.renderer.group.add(glow);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: nameTag(crew.name, `${car.name}${beaten ? ` · BEATEN ${beaten}x` : ''}`, crew.color), depthTest: false, transparent: true, toneMapped: false }));
    tag.scale.set(4, 1, 1); tag.position.y = 2.6; tag.renderOrder = 10;
    v.renderer.group.add(tag);
    g.scene.add(v.renderer.group);
    const ai = new AIDriver(v, { skill: 0.8, maxSpeed: 17 + Math.random() * 4 });
    const r = { v, ai, crew, carId, glow, tag, beaten };
    this._newCruise(r);
    this.rivals.push(r);
  }

  _newCruise(r) {
    const L = this.game.world.layout, s = r.v.state;
    const cands = L.nodes.filter((n) => { const d = Math.hypot(n.x - s.x, n.z - s.z); return d > 500 && d < 1100 && n.type !== 'ring'; });
    const dest = cands[Math.floor(Math.random() * cands.length)] || L.nearestNode(s.x + 600, s.z);
    const ev = this.game.races.prepare({ type: 'sprint', waypoints: [{ x: s.x, z: s.z }, { x: dest.x, z: dest.z }] });
    r.ai.setRoute([[s.x, s.z], ...ev.route]);
  }

  // ------------------------------------------------------------------ challenge
  _challengeDef(r) {
    const g = this.game, L = g.world.layout, s = g.player.state;
    const away = (p, lo, hi, from) => {
      const c = L.nodes.filter((n) => {
        if (n.type === 'ring') return false;
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        return d > lo && d < hi && (!from || Math.hypot(n.x - from.x, n.z - from.z) > d * 0.8);
      });
      return c[Math.floor(Math.random() * c.length)] || L.nearestNode(p.x + lo, p.z);
    };
    const start = L.nearestNode(s.x, s.z);
    const mid = away(start, 380, 620);
    const fin = away(mid, 380, 650, start);
    const car = CARS[r.carId];
    const tier = car.tier || 'D';
    const reward = Math.round(PRIZE[tier] * (1 + 0.25 * Math.min(4, r.beaten)));
    return {
      id: 'street_' + r.crew.name.toLowerCase(), name: `${r.crew.name}'s Callout`, type: 'sprint', opponents: 1, street: true, rival: r.crew.name,
      reward, rep: 80 + TIERS.indexOf(tier) * 40,
      desc: `${r.crew.name} runs a ${car.name} (class ${tier})${r.beaten ? `, tuned up since you last beat them` : ''}. Through the checkpoint, first to the finish. Winner takes the cash.`,
      waypoints: [{ x: start.x, z: start.z }, { x: mid.x, z: mid.z }, { x: fin.x, z: fin.z }],
      rivalCars: [r.carId], rivalNames: [r.crew.name], rivalColor: r.crew.color, rivalTune: r.beaten,
    };
  }

  nearest() {
    let best = null;
    for (const r of this.rivals) if (r.nearT > 0 && (!best || r.dist < best.dist)) best = r;
    return best;
  }

  challenge(r) {
    const g = this.game;
    const ev = g.races.prepare(this._challengeDef(r));
    g.state.mode = 'brief'; g.audio.setPaused(true);
    g.ui.showBriefing(ev);
  }

  // ------------------------------------------------------------------ update
  update(dt, active) {
    const g = this.game;
    if (!active || g.races.active) return;
    const s = g.player.state;
    if (g.police.inPursuit) { if (this.rivals.length) this.clear(); return; }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.rivals.length < MAX_RIVALS) { this.spawnT = 12 + Math.random() * 10; this._spawn(); }
    const obstacles = g.traffic ? g.traffic.cars : [];
    const t = performance.now() / 1000;
    for (let i = this.rivals.length - 1; i >= 0; i--) {
      const r = this.rivals[i], v = r.v;
      const d = Math.hypot(v.state.x - s.x, v.state.z - s.z);
      r.dist = d;
      r.nearT = d < CHALLENGE_DIST ? CHALLENGE_GRACE : (r.nearT || 0) - dt;
      if (d > 480) { this._drop(r); this.rivals.splice(i, 1); continue; }
      r.ai.update(dt, obstacles);
      if (r.ai.needsReset) g.recoverAI(v, r.ai);
      if (r.ai.idx >= r.ai.route.length - 2) this._newCruise(r);
      v.update(dt);
      VehiclePhysics.resolvePair(g.player.physics, v.physics);
      v.sync(dt, g.camera.position, g.env.state);
      r.glow.material.opacity = (0.55 + 0.3 * Math.sin(t * 2.4 + i)) * (0.45 + 0.55 * g.env.state.night);
      r.tag.visible = d < 140;
    }
  }
}
