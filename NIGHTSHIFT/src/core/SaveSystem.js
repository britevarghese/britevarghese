// Single-player progression, persisted in localStorage.
// If multiplayer is added later, this becomes a cache of server-authoritative data.
import { Storage } from './Storage.js';
import { bus } from './EventBus.js';
import { CARS } from '../vehicles/VehicleCatalog.js';

export const DEFAULT_CUSTOM = {
  paint: '#b3121f', paint2: '#111111', finish: 'metallic', wheel: 0, wheelColor: '#c0c4ca',
  spoiler: 0, hood: 0, bumper: 0, vinyl: 0, tint: 0.5, caliper: '#c01818',
};
export const DEFAULT_UPGRADES = { engine: 0, transmission: 0, tires: 0, brakes: 0, suspension: 0, nitrous: 0 };

const DEFAULT_SAVE = {
  version: 1,
  cash: 12000,
  reputation: 0,
  currentCar: 'kestrel',
  cars: { kestrel: { custom: { ...DEFAULT_CUSTOM }, upgrades: { ...DEFAULT_UPGRADES } } },
  raceWins: 0,
  racesCompleted: {},   // eventId -> best time
  bestHeat: 0,
  busts: 0,
  escapes: 0,
  distanceDriven: 0,
  lastPosition: null,
  // progression (see src/progression/Progression.js)
  xp: 0,
  stats: {},
  missions: {},
};

export class SaveSystem {
  constructor() {
    const s = Storage.load('save', null);
    this.data = { ...structuredClone(DEFAULT_SAVE), ...(s || {}) };
    // saves from before driver levels: turn earned reputation into XP once
    if (s && s.xp === undefined) this.data.xp = Math.round((s.reputation || 0) * 4);
    this.data.version = 2;
    for (const id of Object.keys(this.data.cars)) {
      const c = this.data.cars[id];
      c.custom = { ...DEFAULT_CUSTOM, ...(c.custom || {}) };
      c.upgrades = { ...DEFAULT_UPGRADES, ...(c.upgrades || {}) };
    }
    this._dirty = false;
    this._timer = 0;
  }
  get car() { return this.data.cars[this.data.currentCar]; }
  owns(id) { return !!this.data.cars[id]; }
  addCash(n, reason = '') {
    this.data.cash = Math.max(0, Math.round(this.data.cash + n));
    bus.emit('progress:cash', { cash: this.data.cash, delta: n, reason });
    this.save();
  }
  addRep(n) { this.data.reputation = Math.max(0, Math.round(this.data.reputation + n)); bus.emit('progress:rep', this.data.reputation); this.save(); }
  // real cars arrive in their factory colours
  grantCar(id, real = false) {
    if (this.owns(id)) return false;
    this.data.cars[id] = { custom: { ...DEFAULT_CUSTOM, ...(real ? { paint: 'factory', ...CARS[id]?.look } : {}) }, upgrades: { ...DEFAULT_UPGRADES } };
    this.save();
    return true;
  }
  buyCar(id, price, real = false) {
    if (this.owns(id) || this.data.cash < price) return false;
    this.data.cash -= price;
    return this.grantCar(id, real);
  }
  markDirty() { this._dirty = true; }
  update(dt) { this._timer += dt; if (this._dirty && this._timer > 5) { this.save(); } }
  save() { this._dirty = false; this._timer = 0; Storage.save('save', this.data); }
  reset() { this.data = structuredClone(DEFAULT_SAVE); this.save(); }
}
