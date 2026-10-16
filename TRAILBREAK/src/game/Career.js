// The driver's career: money, the trucks and parts they own, their best times in the events. Kept in this browser
// (each friend has their own). Money comes from the survey bounties (beacons), from winning events and from towing
// friends out; it goes on trucks from the dealer, parts at the garage, repairs and the tow truck.
//
// A part, once bought for a truck, is that truck's to fit and take off again for free; its factory parts are free.
// Repairs can run the account into the red (a truck is never left broken); buying needs the money.

import { CATEGORY_IDS, decodeBuild, partPrice, stockBuild } from '../physics/Upgrades.js';
import { truckBase } from '../physics/trucks.js';

const STORE = 'trailbreak.career';
export const START_MONEY = 2500;
export const DEBT_LIMIT = -5000;

/** The dealer's prices (US dollars): sound used trucks, ready for the trail. */
export const TRUCK_PRICES = { gecko: 4500, mule: 6500, trekker: 8000, ranger: 9500, shepherd: 13000, hauler: 14500, thar: 15500, wrangler: 18000, drover: 16000, bruiser: 24000, rhino: 42000 };
/** The dealer's trucks, cheapest first. */
export const DEALER_ORDER = Object.keys(TRUCK_PRICES).sort((a, b) => TRUCK_PRICES[a] - TRUCK_PRICES[b]);
/** For now every truck is free: every driver has the whole dealer's yard to drive (false sells them again). */
export const FREE_TRUCKS = true;
/** And every part: the garage fits anything to any truck at no charge (false prices them again). */
export const FREE_PARTS = true;

export class Career {
  /**
   * grandfather: the truck and builds a player had before careers existed (they keep them). freeTrucks: every truck
   * is the driver's (FREE_TRUCKS); freeParts: and every part (FREE_PARTS).
   */
  constructor({ truck = 'ranger', builds = {}, freeTrucks = FREE_TRUCKS, freeParts = FREE_PARTS } = {}, storage = globalThis.localStorage) {
    this.storage = storage;
    this.freeTrucks = freeTrucks;
    this.freeParts = freeParts;
    let data = null;
    try { data = JSON.parse(storage?.getItem(STORE) || 'null'); } catch { data = null; }
    if (!data || typeof data !== 'object') {
      data = { money: START_MONEY, trucks: ['ranger'], parts: {}, best: {}, log: [] };
      if (truck && !data.trucks.includes(truck) && TRUCK_PRICES[truck] !== undefined) data.trucks.push(truck);
      for (const [id, code] of Object.entries(builds || {})) if (code) this.own(id, decodeBuild(truckBase(id), code), data);
    }
    data.money = Number.isFinite(data.money) ? data.money : START_MONEY;
    data.trucks = Array.isArray(data.trucks) && data.trucks.length ? data.trucks : ['ranger'];
    data.parts = data.parts && typeof data.parts === 'object' ? data.parts : {};
    data.best = data.best && typeof data.best === 'object' ? data.best : {};
    data.log = Array.isArray(data.log) ? data.log.slice(-40) : [];
    this.d = data;
    this.save();
    this.onChange = null;
  }

  save() { try { this.storage?.setItem(STORE, JSON.stringify(this.d)); } catch { /* storage blocked */ } }

  get money() { return this.d.money; }
  get trucks() { return this.freeTrucks ? DEALER_ORDER.filter((id) => id === this.d.trucks[0]).concat(DEALER_ORDER.filter((id) => id !== this.d.trucks[0])) : this.d.trucks; }
  get log() { return this.d.log; }

  /** Change the balance (+ earned, - spent) with a line in the log. */
  add(amount, why) {
    amount = Math.round(amount);
    if (!amount) return;
    this.d.money += amount;
    this.d.log.push({ t: Date.now(), amount, why });
    if (this.d.log.length > 40) this.d.log.shift();
    this.save();
    this.onChange?.(amount, why);
  }

  canAfford(amount) { return amount <= 0 || this.d.money >= amount; }

  /** Spend, if there is the money. */
  pay(amount, why) {
    if (!this.canAfford(amount)) return false;
    this.add(-amount, why);
    return true;
  }

  /** Spend even into the red (repairs, the tow truck), down to the bank's limit; returns what was charged. */
  charge(amount, why) {
    const can = Math.max(0, Math.min(amount, this.d.money - DEBT_LIMIT));
    this.add(-can, why);
    return can;
  }

  ownsTruck(id) { return this.freeTrucks ? TRUCK_PRICES[id] !== undefined : this.d.trucks.includes(id); }

  buyTruck(id) {
    if (this.ownsTruck(id)) return true;
    const price = TRUCK_PRICES[id];
    if (price === undefined || !this.pay(price, `Bought the ${truckBase(id).name}`)) return false;
    this.d.trucks.push(id);
    this.save();
    return true;
  }

  // ---- parts
  ownsPart(id, cat, v) {
    if (this.freeParts) return true;
    const base = truckBase(id);
    if (stockBuild(base)[cat] === v) return true;
    return !!this.d.parts[id]?.[cat]?.includes(v);
  }

  own(id, build, data = this.d) {
    const base = truckBase(id), stock = stockBuild(base), p = data.parts[id] || (data.parts[id] = {});
    for (const cat of CATEGORY_IDS) {
      const v = build[cat];
      if (v === undefined || v === stock[cat]) continue;
      const list = p[cat] || (p[cat] = []);
      if (!list.includes(v)) list.push(v);
    }
  }

  /** What fitting a build would cost: the parts in it not already owned. [{ cat, v, price }], total. */
  quote(id, build) {
    const base = truckBase(id), items = [];
    for (const cat of CATEGORY_IDS) {
      const v = build[cat];
      if (v === undefined || this.ownsPart(id, cat, v)) continue;
      const price = partPrice(base, cat, v);
      if (price > 0) items.push({ cat, v, price });
    }
    return { items, total: items.reduce((a, i) => a + i.price, 0) };
  }

  /** Buy what a build needs (if affordable): then every part in it is owned. */
  buyBuild(id, build) {
    const q = this.quote(id, build);
    if (q.total > 0 && !this.pay(q.total, `Parts for the ${truckBase(id).name}`)) return false;
    this.own(id, build);
    this.save();
    return true;
  }

  // ---- events
  best(eventId) { return this.d.best[eventId] || null; }

  /** Record a result { time, medal }; returns true if it is a personal best. */
  record(eventId, result) {
    const b = this.d.best[eventId];
    if (b && b.time <= result.time) return false;
    this.d.best[eventId] = { time: result.time, medal: result.medal || (b && b.medal) || null };
    this.save();
    return true;
  }
}

/** $1,234 (and -$1,234). */
export const money = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
