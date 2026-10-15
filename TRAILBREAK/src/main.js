// Start screen -> join a room (or drive alone) -> build the valley -> drive.
import { generateWorld } from './world/WorldGen.js';
import { World } from './world/World.js';
import { TRUCKS, TRUCK_IDS } from './physics/trucks.js';
import { buildSummary, decodeBuild } from './physics/Upgrades.js';
import { Garage } from './ui/Garage.js';
import { Career, TRUCK_PRICES, money } from './game/Career.js';
import { Renderer } from './render/Renderer.js';
import { TerrainRenderer } from './render/Terrain.js';
import { loadGround } from './render/Ground.js';
import { Vegetation } from './render/Vegetation.js';
import { Grass } from './render/Grass.js';
import { Rocks } from './render/Rocks.js';
import { Water } from './render/Water.js';
import { Landmarks } from './render/Landmarks.js';
import { Effects, Rope } from './render/Effects.js';
import { Input } from './core/Input.js';
import { Game } from './core/Game.js';
import { Audio } from './audio/Audio.js';
import { NetClient } from './net/NetClient.js';
import { HUD } from './ui/HUD.js';
import { TouchControls, isTouchDevice } from './ui/Touch.js';

const $ = (id) => document.getElementById(id);
const PAINTS = ['#b5532c', '#3d6b8c', '#6b7d3e', '#c9a227', '#8c2f2f', '#e6e1d3', '#2f4f3a', '#4a4a4a'];
const STORE = 'trailbreak.settings';

const settings = Object.assign({ name: '', truck: 'ranger', paint: PAINTS[0], hour: 16.5, shadows: true, sound: true, assist: true, rumble: true, quality: 'high', autoQuality: true, builds: {} }, (() => {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
})());
if (!settings.builds || typeof settings.builds !== 'object') settings.builds = {};
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage blocked */ } };
const garage = new Garage();
// the career: money, the trucks and parts owned (players from before careers keep their truck and its parts)
const career = new Career({ truck: settings.truck, builds: settings.builds });
if (!career.ownsTruck(settings.truck)) settings.truck = career.trucks[0];

// ---------------------------------------------------------------- lobby
function lobby() {
  const params = new URLSearchParams(location.search);
  $('name').value = settings.name || '';
  $('room').value = (params.get('room') || '').toUpperCase();
  const trucksEl = $('trucks');
  const showBuild = () => {
    const base = TRUCKS[settings.truck] || TRUCKS.ranger;
    $('build-name').textContent = `Build: ${buildSummary(base, decodeBuild(base, settings.builds[base.id] || ''))}`;
    $('lobby-money').innerHTML = `Your money: <b>${money(career.money)}</b>`;
  };
  // the trucks: yours to drive, or the dealer's price
  const showTrucks = () => {
    trucksEl.innerHTML = '';
    for (const id of TRUCK_IDS) {
      const t = TRUCKS[id], owned = career.ownsTruck(id), price = TRUCK_PRICES[id] ?? 0;
      const b = document.createElement('button');
      b.className = 'truck-opt' + (settings.truck === id ? ' sel' : '') + (owned ? '' : ' locked');
      b.innerHTML = `<b>${t.name}${owned ? '' : ` <em>${money(price)}</em>`}</b><span>${t.blurb}</span>`;
      b.onclick = () => {
        if (!owned) {
          if (!career.canAfford(price)) { $('lobby-msg').textContent = `The ${t.name} costs ${money(price)} and you have ${money(career.money)}: win events, survey beacons and tow friends out to earn it.`; return; }
          if (!confirm(`Buy the ${t.name} for ${money(price)}? You have ${money(career.money)}.`)) return;
          career.buyTruck(id);
        }
        settings.truck = id; save(); showTrucks(); showBuild();
      };
      trucksEl.appendChild(b);
    }
  };
  showTrucks();
  showBuild();
  $('open-garage').onclick = async () => {
    const code = await garage.open({ truckId: settings.truck, code: settings.builds[settings.truck], paint: settings.paint, fitLabel: 'Use this build', career });
    if (code) { settings.builds[settings.truck] = code; save(); }
    showBuild();
  };
  const paintsEl = $('paints');
  for (const p of PAINTS) {
    const b = document.createElement('button');
    b.className = 'paint' + (settings.paint === p ? ' sel' : '');
    b.style.background = p;
    b.title = p;
    b.onclick = () => { settings.paint = p; for (const c of paintsEl.children) c.classList.remove('sel'); b.classList.add('sel'); };
    paintsEl.appendChild(b);
  }
  return new Promise((resolve) => {
    const go = (online) => {
      settings.name = ($('name').value.trim() || 'Driver').slice(0, 20);
      save();
      resolve({ online, room: $('room').value.trim().toUpperCase() });
    };
    $('go').onclick = () => go(true);
    $('solo').onclick = () => go(false);
    $('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(true); });
    $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(true); });
  });
}

function setLoad(f, label) {
  $('load-bar').style.width = `${Math.round(f * 100)}%`;
  if (label) $('load-label').textContent = label;
}

// ---------------------------------------------------------------- start
async function start() {
  const audio = new Audio();
  let net = null, welcome = null;
  for (;;) {
    const choice = await lobby();
    audio.start().catch(() => {});                  // inside the click: browsers allow sound to start here
    if (!choice.online) break;
    $('lobby-msg').textContent = 'Connecting...';
    net = new NetClient({ name: settings.name, room: choice.room });
    try {
      welcome = await net.connect();
      break;
    } catch (e) {
      $('lobby-msg').textContent = `${e.message} You can still drive alone.`;
      net = null;
      $('trucks').innerHTML = ''; $('paints').innerHTML = '';
    }
  }
  if (net) {
    const url = new URL(location.href);
    url.searchParams.set('room', net.room);
    history.replaceState(null, '', url);
  }

  $('lobby').classList.add('hidden');
  $('loading').classList.remove('hidden');
  setLoad(0.02, 'Surveying the valley');
  const data = await generateWorld({ onProgress: (f, label) => setLoad(0.02 + f * 0.6, label) });
  const world = new World(data);
  setLoad(0.64, 'Painting the ground');
  await new Promise((r) => setTimeout(r, 0));
  const renderer = new Renderer($('app'));
  const ground = await loadGround('ashwood', settings.quality).catch((e) => { console.warn('ground textures', e); return null; });
  const terrain = new TerrainRenderer(world, renderer.scene, { ground, onProgress: (f) => setLoad(0.64 + f * 0.16) });
  setLoad(0.82, 'Growing the trees');
  await new Promise((r) => setTimeout(r, 0));
  const vegetation = await Vegetation.create(world, renderer);
  const rocks = new Rocks(world, renderer.scene, ground);
  const grass = new Grass(world, terrain, renderer.scene, ground, vegetation.uniforms);
  const water = new Water(world, renderer.scene);
  const landmarks = new Landmarks(world, renderer.scene);
  const effects = new Effects(renderer.scene);
  const rope = new Rope(renderer.scene);
  setLoad(0.9, 'Warming up the engine');
  const hud = new HUD(world, terrain);
  const input = new Input();
  const game = new Game({
    world, renderer, terrain, vegetation, grass, rocks, water, landmarks, effects, rope, audio, net, hud, input, settings, garage, career,
    truckId: settings.truck, build: settings.builds[settings.truck] || '', paint: settings.paint, name: settings.name,
  });
  game.onBuild = (id, code) => { settings.truck = id; settings.builds[id] = code; save(); };
  $('m-dmg').onclick = () => game.fitSpare();          // (a tap on phones)
  window.game = game;                              // (handy in the console)
  await audio.setLocalEngine(game.spec).catch(() => {});
  if (net) {
    net.onEvent = (m) => game.onNet(m);
    for (const id of welcome.beacons || []) game.found.add(id);
    game.events.welcome(welcome.race);
  } else {
    try { for (const id of JSON.parse(localStorage.getItem('trailbreak.solo.beacons') || '[]')) { game.found.add(id); landmarks.setFound(id, true); } } catch { /* none */ }
  }
  for (const id of game.found) landmarks.setFound(id, true);
  // build the patches around the start before the first frame
  terrain.budget = 400;
  game.frame(0.016);
  terrain.budget = 6;
  setLoad(1, 'Ready');
  $('loading').classList.add('hidden');
  hud.show(true);
  renderer.renderer.domElement.focus();
  hud.toast(net ? `Room ${net.room}: press Esc for the invite link` : 'Driving alone. Press F1 for the controls', false, 6);
  hud.toast('Find the survey beacons: follow the orange light beams', false, 6);
  wireMenus(game, net);
  if (isTouchDevice()) {
    const touch = new TouchControls(input);
    game.touch = touch;
  }

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__ready = true;
}

function wireMenus(game, net) {
  const s = game.settings;
  if (net) {
    $('invite').classList.remove('hidden');
    $('room-code').textContent = net.room;
    const link = new URL(location.href); link.search = `?room=${net.room}`;
    $('invite-link').value = link.toString();
    $('copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText($('invite-link').value); $('copy-link').textContent = 'Copied'; } catch { $('invite-link').select(); document.execCommand?.('copy'); }
      setTimeout(() => { $('copy-link').textContent = 'Copy'; }, 1500);
    };
  }
  $('tod').value = s.hour;
  $('tod').oninput = () => { s.hour = Number($('tod').value); game.renderer.setTime(s.hour); save(); };
  $('opt-shadows').checked = s.shadows;
  $('opt-shadows').onchange = () => { s.shadows = $('opt-shadows').checked; game.applySettings(); save(); };
  $('opt-sound').checked = s.sound;
  $('opt-sound').onchange = () => { s.sound = $('opt-sound').checked; game.audio.setEnabled(s.sound); save(); };
  $('opt-quality').value = s.quality || 'high';
  $('opt-quality').onchange = () => { s.quality = $('opt-quality').value; s.autoQuality = false; game.applyQuality(); save(); };
  game.onSettingsChanged = () => { $('opt-quality').value = s.quality; save(); };
  $('opt-assist').checked = s.assist;
  $('opt-assist').onchange = () => { s.assist = $('opt-assist').checked; save(); };
  $('opt-rumble').checked = s.rumble;
  $('opt-rumble').onchange = () => { s.rumble = $('opt-rumble').checked; save(); };
  $('resume').onclick = () => game.togglePause(false);
  $('respawn').onclick = () => { game.togglePause(false); game.towHome(); };
  $('menu-garage').onclick = () => game.openGarage();
  $('menu-dealer').onclick = () => game.openDealer();
  $('menu-events').onclick = () => game.openEvents();
  const help = (on) => $('help').classList.toggle('hidden', !on);
  $('show-help').onclick = () => help(true);
  $('close-help').onclick = () => help(false);
  game.onHelp = () => help($('help').classList.contains('hidden'));
  $('map').onclick = () => game.toggleMap();
}

start().catch((e) => {
  console.error(e);
  $('loading').classList.remove('hidden');
  $('load-label').textContent = `Something went wrong: ${e.message}`;
});
