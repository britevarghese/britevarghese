// Garage: 3D studio showroom with turntable + customization UI. Changes are visible on the car
// immediately (paint, finish, vinyl, wheels, spoiler, hood, bumper, tint, calipers) and
// performance upgrades change the physics parameters.
import * as THREE from 'three';
import { VehicleRenderer } from '../vehicles/VehicleRenderer.js';
import {
  CARS, PLAYER_CAR_ORDER, UPGRADE_KEYS, UPGRADE_NAMES, UPGRADE_LEVELS, UPGRADE_COST, PAINTS, RIM_NAMES, FINISHES,
  SPOILER_NAMES, HOOD_NAMES, BUMPER_NAMES, tunedParams, ratings, PAINT_COST, PART_COST, WHEEL_COST, VINYL_COST, TIERS, TIER_NAMES,
} from '../vehicles/VehicleCatalog.js';
import { bus } from '../core/EventBus.js';
import { VINYLS } from '../renderer/Textures.js';
import { formatMoney, damp } from '../core/util.js';
import { DEFAULT_CUSTOM, DEFAULT_UPGRADES } from '../core/SaveSystem.js';

const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

export class Garage {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 200);
    this.orbit = { yaw: 0.7, pitch: 0.18, dist: 8.2, auto: true };
    this.viewId = game.save.data.currentCar;
    this._buildStudio();
    this.car = null;
    this.open = false;
    this._drag = null;
    addEventListener('mousedown', (e) => { if (this.open && e.target.tagName === 'CANVAS') this._drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('mouseup', () => { this._drag = null; });
    addEventListener('mousemove', (e) => {
      if (!this._drag) return;
      this.orbit.yaw -= (e.clientX - this._drag.x) * 0.006; this.orbit.pitch = Math.min(0.8, Math.max(0.02, this.orbit.pitch + (e.clientY - this._drag.y) * 0.004));
      this._drag = { x: e.clientX, y: e.clientY }; this.orbit.auto = false;
    });
    addEventListener('wheel', (e) => { if (this.open) this.orbit.dist = Math.min(13, Math.max(5, this.orbit.dist + e.deltaY * 0.004)); });
  }

  _buildStudio() {
    const s = this.scene;
    s.background = new THREE.Color(0x07080b);
    s.fog = new THREE.Fog(0x07080b, 18, 45);
    // studio env map: dark with bright softbox strips (gives the paint nice reflections)
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d');
      g.fillStyle = f === 3 ? '#060606' : '#0d0f14'; g.fillRect(0, 0, 256, 256);
      if (f === 2) { g.fillStyle = '#ffffff'; g.fillRect(40, 100, 176, 20); g.fillRect(40, 140, 176, 20); }
      else if (f !== 3) {
        const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#1a1e28'); grd.addColorStop(0.5, '#2a3040'); grd.addColorStop(1, '#08090c');
        g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
        g.fillStyle = 'rgba(255,255,255,0.9)'; g.fillRect(20 + f * 20, 60, 30, 110);
        g.fillStyle = f % 2 ? 'rgba(255,61,90,0.6)' : 'rgba(55,226,255,0.6)'; g.fillRect(0, 150, 256, 6);
      }
      faces.push(c);
    }
    const env = new THREE.CubeTexture(faces); env.colorSpace = THREE.SRGBColorSpace; env.needsUpdate = true;
    s.environment = env;
    s.add(new THREE.HemisphereLight(0x8090b0, 0x101010, 0.6));
    const key = new THREE.SpotLight(0xffffff, 55, 40, 0.6, 0.8, 1.5); key.position.set(4, 9, 5); s.add(key, key.target);
    const rim = new THREE.SpotLight(0x9fd8ff, 40, 40, 0.7, 0.8, 1.5); rim.position.set(-6, 6, -6); s.add(rim, rim.target);
    const fill = new THREE.PointLight(0xff4060, 20, 20); fill.position.set(-5, 1.5, 4); s.add(fill);
    // floor
    const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.25, metalness: 0.6 }));
    s.add(floor);
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.9, 0.12, 64), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.35, metalness: 0.7 }));
    plat.position.y = 0.06; s.add(plat);
    this.platform = plat;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.85, 0.035, 8, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3d5a, toneMapped: false }));
    ring.position.y = 0.12; s.add(ring);
    // light strips on the back wall
    for (let i = -3; i <= 3; i++) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 6, 0.08), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x37e2ff : 0xffffff, toneMapped: false }));
      strip.position.set(i * 3.2, 3, -12); s.add(strip);
    }
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9 }));
    wall.position.set(0, 7, -12.2); s.add(wall);
    this.turn = new THREE.Group(); this.turn.position.y = 0.12; s.add(this.turn);
  }

  get save() { return this.game.save; }
  get owned() { return this.save.owns(this.viewId); }
  get custom() { return this.save.data.cars[this.viewId]?.custom || { ...DEFAULT_CUSTOM, ...(CARS[this.viewId]?.real ? { paint: 'factory', ...CARS[this.viewId].look } : {}) }; }
  get upgrades() { return this.save.data.cars[this.viewId]?.upgrades || { ...DEFAULT_UPGRADES }; }

  async show() {
    this.open = true;
    this.viewId = this.save.data.currentCar;
    await this._loadCar();
    this.render();
  }
  hide() { this.open = false; if (this.car) { this.car.dispose(); this.car = null; } }

  async _loadCar() {
    const lib = this.game.lib;
    await lib.load([this.viewId], 1);
    if (this.car) { this.car.dispose(); this.car = null; }
    this.car = new VehicleRenderer(lib, this.viewId, { headlights: 0, shadow: false });
    this.car.applyCustom(this.custom);
    this.turn.add(this.car.group);
    const st = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, wheelOff: [0, 0, 0, 0], wheelComp: [0, 0, 0, 0], wheelSpin: 0, wheelSteer: 0.25, brake: 0, speed: 0, nitroActive: false, onGround: true, groundY: 0 };
    this.car.sync(st, 0.016, null, { night: 0.2 });
    this.car.group.position.set(0, 0, 0);
    this.car.group.rotation.set(0, 0, 0);
    this.car.beam.visible = false;
    for (const f of [...this.car.headFlares, ...this.car.tailFlares]) f.visible = false;
  }

  _charge(cost, label) {
    if (!this.owned) { this.game.ui.toast('Buy this car first', 'err'); return false; }
    if (this.save.data.cash < cost) { this.game.ui.toast(`Not enough cash for ${label}`, 'err'); this.game.audio?.playEvent('uiBack'); return false; }
    if (cost > 0) { this.save.addCash(-cost, label); this.game.audio?.playEvent('purchase'); }
    return true;
  }

  setCustom(key, value, cost) {
    if (this.custom[key] === value) return;
    if (!this._charge(cost, key)) return;
    this.save.data.cars[this.viewId].custom[key] = value;
    this.save.save();
    this.car.applyCustom(this.save.data.cars[this.viewId].custom);
    this.render();
  }

  render() {
    const g = this.game;
    const root = document.getElementById('screens');
    root.innerHTML = '';
    const s = h('div', 'screen garage');
    const left = h('div', 'garage-left');
    const right = h('div', 'garage-right');
    const P = g.progress;
    left.innerHTML = `<h1>GARAGE</h1><div class="sub">${formatMoney(this.save.data.cash)} · DRIVER LEVEL ${P ? P.level : 1}</div>`;
    const car = CARS[this.viewId];
    const real = !!car.real;
    const imported = real && g.lib.isImported(this.viewId);
    this.tab ||= 'cars';
    const tabs = h('div', 'gtabs');
    for (const [id, label] of [['cars', 'CARS'], ['custom', 'CUSTOMIZE']]) {
      const b = h('button', this.tab === id ? 'on' : '', label);
      b.onclick = () => { this.tab = id; this.render(); g.audio?.playEvent('uiClick'); };
      tabs.appendChild(b);
    }
    left.appendChild(tabs);
    if (this.tab === 'cars') {
      // every car, grouped by class: owned / price / what unlocks it
      for (const tier of TIERS) {
        const ids = PLAYER_CAR_ORDER.filter((id) => CARS[id].tier === tier);
        if (!ids.length) continue;
        left.appendChild(h('div', 'gtier', TIER_NAMES[tier]));
        for (const id of ids) {
          const c = CARS[id];
          const own = this.save.owns(id), open = !P || P.isUnlocked(id);
          const status = own ? (id === this.save.data.currentCar ? '<span class="st drive">DRIVING</span>' : '<span class="st own">OWNED</span>')
            : open ? `<span class="st price">${c.price ? formatMoney(c.price) : 'FREE'}</span>` : `<span class="st lock">🔒 ${P.unlockText(id)}</span>`;
          const row = h('button', 'carrow' + (id === this.viewId ? ' on' : '') + (!own && !open ? ' locked' : ''), `<span class="brand">${c.brand}</span><span class="mdl">${c.model}${c.year ? ` <em>${c.year}</em>` : ''}</span>${status}`);
          row.onclick = async () => { this.viewId = id; await this._loadCar(); this.render(); g.audio?.playEvent('uiClick'); };
          left.appendChild(row);
        }
      }
    } else if (this.owned) {
      const c = this.custom;
      const cat = (title) => { const d = h('div', 'gcat', `<h3>${title}</h3>`); left.appendChild(d); return d; };
      const swatches = (parent, colors, cur, fn) => {
        const w = h('div', 'swatches');
        for (const col of colors) {
          const sw = h('div', 'swatch' + (col === cur ? ' on' : '') + (col === 'factory' ? ' factory' : ''));
          if (col === 'factory') { sw.title = 'Factory paint'; sw.style.background = car.factoryColor ? `linear-gradient(135deg, ${car.factoryColor} 55%, #fff 56%)` : '#888'; } else sw.style.background = col;
          sw.onclick = () => fn(col); w.appendChild(sw);
        }
        parent.appendChild(w);
      };
      const choices = (parent, names, cur, fn) => {
        const o = h('div', 'opt');
        names.forEach((n, i) => { const b = h('button', i === cur || n === cur ? 'on' : '', typeof n === 'string' ? n.toUpperCase() : n); b.onclick = () => fn(typeof cur === 'string' ? n : i); o.appendChild(b); });
        parent.appendChild(o);
      };
      swatches(cat(`PAINT · ${formatMoney(PAINT_COST)}`), real ? ['factory', ...PAINTS] : PAINTS, c.paint, (v) => this.setCustom('paint', v, PAINT_COST));
      choices(cat('FINISH'), FINISHES, c.finish, (v) => this.setCustom('finish', v, PAINT_COST));
      if (!imported) {
        swatches(cat('SECONDARY COLOR'), PAINTS, c.paint2, (v) => this.setCustom('paint2', v, PAINT_COST));
        choices(cat(`VINYL · ${formatMoney(VINYL_COST)}`), VINYLS, c.vinyl, (v) => this.setCustom('vinyl', v, VINYL_COST));
        choices(cat(`WHEELS · ${formatMoney(WHEEL_COST)}`), RIM_NAMES, c.wheel, (v) => this.setCustom('wheel', v, WHEEL_COST));
        swatches(cat('WHEEL COLOR'), ['#c0c4ca', '#2a2c30', '#b08d57', '#e8e8ea', '#b3121f', '#1f4fd6', '#f2c200', '#101012'], c.wheelColor, (v) => this.setCustom('wheelColor', v, 300));
        choices(cat(`SPOILER · ${formatMoney(PART_COST)}`), SPOILER_NAMES, c.spoiler, (v) => this.setCustom('spoiler', v, PART_COST));
        choices(cat(`HOOD · ${formatMoney(PART_COST)}`), HOOD_NAMES, c.hood, (v) => this.setCustom('hood', v, PART_COST));
        choices(cat(`BUMPERS · ${formatMoney(PART_COST)}`), BUMPER_NAMES, c.bumper, (v) => this.setCustom('bumper', v, PART_COST));
      }
      choices(cat('WINDOW TINT'), ['Light', 'Medium', 'Dark', 'Limo'], Math.round(c.tint * 3), (v) => this.setCustom('tint', v / 3, 200));
      if (!imported || this.car?.caliperMat) swatches(cat('BRAKE CALIPERS'), ['#c01818', '#f2c200', '#1f4fd6', '#101012', '#1f9d55', '#ff6a00'], c.caliper, (v) => this.setCustom('caliper', v, 250));
    } else {
      left.appendChild(h('p', '', '<span style="color:var(--dim)">Buy this car to customize it.</span>'));
    }
    // right: identity, real specs, ratings, upgrades, credits
    const params = tunedParams(this.viewId, this.upgrades);
    const base = ratings(car.params), now = ratings(params);
    right.innerHTML = `<div class="car-class">${TIER_NAMES[car.tier] || car.class}</div><div class="car-brand">${car.brand}${car.year ? ` · ${car.year}` : ''}</div><div class="car-title">${car.model}</div><div class="car-blurb">${car.blurb}</div>`;
    if (car.spec) {
      const sp = car.spec;
      right.appendChild(h('div', 'specs', [[`${Math.round(sp.kw * 1.341)} HP`, 'POWER'], [`${sp.kg} KG`, 'WEIGHT'], [sp.drive, 'DRIVE'], [`${sp.t100.toFixed(1)} S`, '0-100 KM/H'], [`${sp.vmax} KM/H`, 'TOP SPEED']].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('')));
    }
    for (const [k, l] of [['speed', 'TOP SPEED'], ['accel', 'ACCELERATION'], ['handling', 'HANDLING'], ['braking', 'BRAKING']]) {
      right.appendChild(h('div', 'meter', `<div class="t"><span>${l}</span><span>${now[k].toFixed(1)}</span></div><div class="b" style="position:relative"><div class="f" style="width:${Math.max(4, base[k] * 10)}%"></div><div class="f2" style="position:absolute;top:0;height:100%;left:${base[k] * 10}%;width:${Math.max(0, (now[k] - base[k]) * 10)}%"></div></div>`));
    }
    if (!car.spec) right.appendChild(h('div', 'meter', `<div class="t"><span>TOP SPEED (EST)</span><span>${Math.round(params.maxSpeed * 3.6)} KM/H · ${Math.round(params.enginePower * 1.341)} HP · ${params.drive}</span></div>`));
    if (this.owned) {
      right.appendChild(h('h3', '', '<span style="font-size:.8rem;letter-spacing:.3em;color:var(--dim)">PERFORMANCE</span>'));
      for (const k of UPGRADE_KEYS) {
        const lv = this.upgrades[k] || 0;
        const row = h('div', 'upg', `<div>${UPGRADE_NAMES[k]} <span style="color:var(--dim);font-size:.75rem">${UPGRADE_LEVELS[lv]}</span><div class="lv">${[1, 2, 3].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</div></div>`);
        const b = h('button', 'btn', lv >= 3 ? 'MAX' : formatMoney(UPGRADE_COST[lv + 1]));
        b.disabled = lv >= 3;
        b.onclick = () => {
          if (!this._charge(UPGRADE_COST[lv + 1], UPGRADE_NAMES[k])) return;
          this.save.data.cars[this.viewId].upgrades[k] = lv + 1;
          this.save.save();
          bus.emit('progress:upgrade', { car: this.viewId, key: k, level: lv + 1 });
          this.render();
        };
        row.appendChild(b);
        right.appendChild(row);
      }
    }
    if (car.source) {
      right.appendChild(h('div', 'credit', imported
        ? `3D model: <a href="${car.source.url}" target="_blank" rel="noopener">"${car.source.title}"</a> by ${car.source.author} · CC BY 4.0 (modified)`
        : `Preview model — the real ${car.brand} model ("${car.source.title}" by ${car.source.author}, CC BY 4.0) is installed with <code>node tools/import-cars.mjs</code>`));
    }
    // bottom
    const bottom = h('div', 'garage-bottom');
    const open = !P || P.isUnlocked(this.viewId);
    if (!this.owned) {
      if (open) {
        const buy = h('button', 'btn primary', `BUY ${car.price ? formatMoney(car.price) : 'FREE'}`);
        buy.onclick = () => {
          if (this.save.buyCar(this.viewId, car.price, real)) { g.audio?.playEvent('purchase'); g.ui.toast(`${car.name} purchased`, 'cash'); bus.emit('progress:carBought', { id: this.viewId }); this.render(); }
          else g.ui.toast('Not enough cash', 'err');
        };
        bottom.appendChild(buy);
      } else {
        const lock = h('button', 'btn locked', `🔒 LOCKED · ${P.unlockText(this.viewId)}`);
        lock.disabled = true;
        bottom.appendChild(lock);
      }
    } else if (this.viewId !== this.save.data.currentCar) {
      const use = h('button', 'btn primary', 'DRIVE THIS CAR');
      use.onclick = () => { this.save.data.currentCar = this.viewId; this.save.save(); this.render(); g.ui.toast(`${car.name} selected`); };
      bottom.appendChild(use);
    }
    const repair = h('button', 'btn', 'REPAIR · $0');
    repair.onclick = () => { g.player?.physics && (g.player.state.damage = 0); g.player?.renderer.repair(); g.ui.toast('Car repaired'); };
    const done = h('button', 'btn', 'BACK');
    done.onclick = () => g.closeGarage();
    bottom.append(repair, done);
    s.append(left, right, bottom);
    root.appendChild(s);
    g.ui.current = 'garage';
    g.ui.focusList = []; g.ui.onBack = () => g.closeGarage();
  }

  update(dt) {
    if (!this.open) return;
    if (this.orbit.auto) this.orbit.yaw += dt * 0.18;
    const o = this.orbit;
    this.camera.position.set(Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, 0.9 + Math.sin(o.pitch) * o.dist, Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
    this.camera.lookAt(0, 0.65, 0);
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.turn.rotation.y = damp(this.turn.rotation.y, 0, 1, dt);
  }
}
