// Start screen -> join a room (or drive alone) -> build the map's world -> drive.
import { generateWorld } from './world/WorldGen.js';
import { MAPS, MAP_IDS, DEFAULT_MAP, mapById } from './world/maps/index.js';
import { World } from './world/World.js';
import { TRUCKS, TRUCK_IDS } from './physics/trucks.js';
import { buildSummary, decodeBuild } from './physics/Upgrades.js';
import { Garage } from './ui/Garage.js';
import { TruckView } from './ui/TruckView.js';
import { Career, TRUCK_PRICES, DEALER_ORDER, money } from './game/Career.js';
import { Renderer } from './render/Renderer.js';
import { TerrainRenderer } from './render/Terrain.js';
import { loadGround } from './render/Ground.js';
import { Vegetation } from './render/Vegetation.js';
import { Grass } from './render/Grass.js';
import { Tea } from './render/Tea.js';
import { Rocks } from './render/Rocks.js';
import { Water } from './render/Water.js';
import { Landmarks } from './render/Landmarks.js';
import { Effects, Rope } from './render/Effects.js';
import { MUD_TINT } from './render/TruckModel.js';
import { loadTruckAsset } from './render/TruckAssets.js';
import { Input } from './core/Input.js';
import { Game, soloBeaconsKey } from './core/Game.js';
import { decodeLayout } from './game/Props.js';
import { Audio } from './audio/Audio.js';
import { NetClient } from './net/NetClient.js';
import { Voice } from './net/Voice.js';
import { VoicePanel } from './ui/VoicePanel.js';
import { HUD } from './ui/HUD.js';
import { TouchControls, isTouchDevice } from './ui/Touch.js';

const $ = (id) => document.getElementById(id);
const PAINTS = ['#b5532c', '#3d6b8c', '#6b7d3e', '#c9a227', '#8c2f2f', '#e6e1d3', '#2f4f3a', '#4a4a4a'];
const STORE = 'trailbreak.settings';

const settings = Object.assign({ name: '', map: DEFAULT_MAP, truck: 'thar', paint: PAINTS[0], hour: 16.5, shadows: true, sound: true, assist: true, rumble: true, fullscreen: true, quality: 'high', autoQuality: true, damage: 'cosmetic', builds: {} }, (() => {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
})());
if (!settings.builds || typeof settings.builds !== 'object') settings.builds = {};
// the Mahindra Thar is the truck to start in: everyone who had another picked gets it once (and can pick theirs again)
if (!settings.tharDefault) { settings.truck = 'thar'; settings.tharDefault = 1; }
// crashes only dent and break glass now: everyone gets that once (the menu still has forgiving and realistic)
if (!settings.lookDamage) { settings.damage = 'cosmetic'; settings.lookDamage = 1; }
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
  // the maps (an invite link, or the address after a game in a room, names its room and that room's map)
  const linkRoom = (params.get('room') || '').toUpperCase(), linkMap = MAP_IDS.includes(params.get('map')) ? params.get('map') : null;
  if (linkMap) settings.map = linkMap;
  if (!MAP_IDS.includes(settings.map)) settings.map = DEFAULT_MAP;
  const mapsEl = $('maps');
  const showMaps = () => {
    mapsEl.innerHTML = '';
    for (const id of MAP_IDS) {
      const M = MAPS[id], b = document.createElement('button');
      b.className = 'map-opt map-' + id + (settings.map === id ? ' sel' : '');
      b.innerHTML = `<b>${M.name}</b><span>${M.blurb}</span>`;
      b.onclick = () => {
        settings.map = id; save();
        // another map than the link's room drives: that room code goes, and a new room opens on the map picked
        if (linkRoom && linkMap && id !== linkMap && $('room').value.trim().toUpperCase() === linkRoom) {
          $('room').value = '';
          const url = new URL(location.href);
          url.searchParams.delete('room'); url.searchParams.delete('map');
          history.replaceState(null, '', url);
        }
        showMaps();
      };
      mapsEl.appendChild(b);
    }
    const code = $('room').value.trim().toUpperCase();
    $('map-note').textContent = !code ? ''
      : code === linkRoom && linkMap && settings.map === linkMap ? `Room ${code} drives ${MAPS[linkMap].name}. Pick another map to open a new room on it.`
        : 'Joining a room: you drive the map it was opened on.';
  };
  $('room').addEventListener('input', showMaps);
  showMaps();
  const trucksEl = $('trucks');
  // the picked truck in 3D, with its build and paint
  const view = new TruckView($('truck-view'));
  const showView = () => {
    view.show(settings.truck, settings.builds[settings.truck], settings.paint);
    $('truck-view-name').textContent = (TRUCKS[settings.truck] || TRUCKS.ranger).name;
  };
  const showBuild = () => {
    const base = TRUCKS[settings.truck] || TRUCKS.ranger;
    $('build-name').textContent = `Build: ${buildSummary(base, decodeBuild(base, settings.builds[base.id] || ''))}`;
    $('lobby-money').innerHTML = `Your money: <b>${money(career.money)}</b>`;
    showView();
  };
  // the trucks: yours to drive, or the dealer's price
  const showTrucks = () => {
    trucksEl.innerHTML = '';
    let sel = null;
    for (const id of DEALER_ORDER.filter((id) => TRUCK_IDS.includes(id))) {
      const t = TRUCKS[id], owned = career.ownsTruck(id), price = TRUCK_PRICES[id] ?? 0, on = settings.truck === id;
      const b = document.createElement('button');
      b.className = 'truck-opt' + (on ? ' sel' : '') + (owned ? '' : ' locked');
      // the kind of truck in the list; the whole description for the one picked
      b.innerHTML = `<b>${t.name}${owned ? '' : ` <em>${money(price)}</em>`}</b><span>${on ? t.blurb : t.blurb.split(':')[0]}</span>`;
      if (on) sel = b;
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
    if (sel) trucksEl.scrollTop = Math.max(0, sel.offsetTop - 60);
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
    b.onclick = () => { settings.paint = p; for (const c of paintsEl.children) c.classList.remove('sel'); b.classList.add('sel'); showView(); };
    paintsEl.appendChild(b);
  }
  return new Promise((resolve) => {
    const go = (online, quick = false) => {
      fullscreen();                                   // (inside the click: the only time a browser allows it)
      settings.name = ($('name').value.trim() || 'Driver').slice(0, 20);
      save();
      view.dispose();                                 // the game wants the GPU
      resolve({ online, quick, room: quick ? '' : $('room').value.trim().toUpperCase(), map: settings.map });
    };
    $('go').onclick = () => go(true);
    $('quick').onclick = () => go(true, true);
    $('solo').onclick = () => go(false);
    $('room').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(true); });
    $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(true); });
  });
}

/**
 * The game full screen (a browser allows it only from a click or a key press: the lobby's buttons), and a phone held
 * landscape where it lets a page ask. Unless the settings turn it off.
 */
function fullscreen() {
  if (settings.fullscreen === false || document.fullscreenElement || document.webkitFullscreenElement) return;
  const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!req) return;
  Promise.resolve(req.call(el, { navigationUI: 'hide' })).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
}

function setLoad(f, label) {
  $('load-bar').style.width = `${Math.round(f * 100)}%`;
  if (label) $('load-label').textContent = label;
}

// ---------------------------------------------------------------- start
async function start() {
  const audio = new Audio();
  let net = null, welcome = null, mapId = settings.map;
  for (;;) {
    const choice = await lobby();
    mapId = choice.map;
    audio.start().catch(() => {});                  // inside the click: browsers allow sound to start here
    if (!choice.online) break;
    $('lobby-msg').textContent = 'Connecting...';
    net = new NetClient({ name: settings.name, room: choice.room, map: choice.map, quick: choice.quick });
    try {
      welcome = await net.connect();
      break;
    } catch (e) {
      $('lobby-msg').textContent = `${e.message} You can still drive alone.`;
      net = null;
      $('trucks').innerHTML = ''; $('paints').innerHTML = '';
    }
  }
  let otherMap = null;
  if (net) {
    // the room drives the map it was opened on
    if (net.map && MAP_IDS.includes(net.map)) { if (net.map !== mapId) otherMap = mapId; mapId = net.map; }
    const url = new URL(location.href);
    url.searchParams.set('room', net.room);
    url.searchParams.set('map', mapId);
    history.replaceState(null, '', url);
  }
  const M = mapById(mapId);
  document.querySelector('#loading h2').textContent = M.name;
  document.querySelector('#dealer h2').firstChild.textContent = `${M.dealer} `;

  $('lobby').classList.add('hidden');
  $('loading').classList.remove('hidden');
  setLoad(0.02, 'Surveying the valley');
  const data = await generateWorld({ map: M, onProgress: (f, label) => setLoad(0.02 + f * 0.6, label) });
  const world = new World(data);
  setLoad(0.64, 'Painting the ground');
  await new Promise((r) => setTimeout(r, 0));
  const renderer = new Renderer($('app'));
  renderer.setAtmosphere(M.atmosphere);
  const ground = await loadGround(M.ground, settings.quality).catch((e) => { console.warn('ground textures', e); return null; });
  const terrain = new TerrainRenderer(world, renderer.scene, { ground, onProgress: (f) => setLoad(0.64 + f * 0.16) });
  setLoad(0.82, 'Growing the trees');
  await new Promise((r) => setTimeout(r, 0));
  const vegetation = await Vegetation.create(world, renderer);
  const rocks = new Rocks(world, renderer.scene, ground);
  const grass = new Grass(world, terrain, renderer.scene, ground, vegetation.uniforms);
  const tea = M.tea ? new Tea(world, renderer.scene) : null;
  const water = new Water(world, renderer.scene);
  const landmarks = new Landmarks(world, renderer.scene);
  const effects = new Effects(renderer.scene);
  effects.setPalette(M.dust);
  if (M.mudTint) MUD_TINT.setRGB(...M.mudTint);
  const rope = new Rope(renderer.scene);
  setLoad(0.9, 'Warming up the engine');
  await loadTruckAsset(settings.truck);             // (a model body: loaded before the truck is built)
  const hud = new HUD(world, terrain);
  const input = new Input();
  // voice chat with the others in the room (net/Voice.js)
  const voice = net ? new Voice(net) : null;
  if (net) net.onBinary = (b) => voice.onBinary(b);
  const game = new Game({
    world, renderer, terrain, vegetation, grass, tea, rocks, water, landmarks, effects, rope, audio, net, voice, hud, input, settings, garage, career,
    truckId: settings.truck, build: settings.builds[settings.truck] || '', paint: settings.paint, name: settings.name,
  });
  game.onBuild = (id, code) => { settings.truck = id; settings.builds[id] = code; save(); };
  $('m-dmg').onclick = () => game.fitSpare();          // (a tap on phones)
  window.game = game;                              // (handy in the console)
  await audio.setLocalEngine(game.spec).catch(() => {});
  // a map from a link (?layout=, the builder's SHARE), else the room's (whoever built in it), onto this map
  const linkLayout = new URLSearchParams(location.search).get('layout');
  if (net) {
    net.onEvent = (m) => game.onNet(m);
    for (const id of welcome.beacons || []) game.found.add(id);
    for (const k of welcome.broken || []) world.breakKey(k, 0, 1, 0, true);   // (what friends have knocked down here)
    game.events.welcome(welcome.race);
    if (welcome.layout && !linkLayout) game.takeLayout(welcome.layout, null);
  } else {
    try { for (const id of JSON.parse(localStorage.getItem(soloBeaconsKey(M)) || '[]')) { game.found.add(id); landmarks.setFound(id, true); } } catch { /* none */ }
  }
  for (const id of game.found) landmarks.setFound(id, true);
  if (linkLayout) {
    const L = decodeLayout(linkLayout);
    if (L && (!L.map || L.map === M.id)) {
      game.builder.load(L, !!net);
      hud.toast(`${L.name ? `"${L.name}"` : 'A map'} from a link: ${L.props.length} props${game.events.byId.has('custom') ? '. Modes & races (N): the race on it' : ''}. Esc > Map builder to build on it`, true, 8);
    }
    const url = new URL(location.href); url.searchParams.delete('layout'); history.replaceState(null, '', url);
  }
  // build the patches around the start before the first frame
  terrain.budget = 400;
  game.frame(0.016);
  tea?.prime(renderer.camera);
  terrain.budget = 6;
  setLoad(1, 'Ready');
  $('loading').classList.add('hidden');
  hud.show(true);
  renderer.renderer.domElement.focus();
  const others = net ? net.remotes.size : 0;
  hud.toast(!net ? `Driving alone in ${M.name}. Press F1 for the controls`
    : net.public ? `Quick match in ${M.name}: ${others ? `${others} other driver${others > 1 ? 's' : ''} here` : 'you are the first here: others looking for a game will join you'}. Enter to chat`
    : `Room ${net.room} (${M.name}): press Esc for the invite link`, false, 7);
  if (otherMap) hud.toast(`Room ${net.room} was opened on ${M.name}, so you drive it here. For ${MAPS[otherMap].name}, leave the room code empty.`, false, 9);
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
  if (game.voice) game.voicePanel = new VoicePanel(game.voice, s, save, (text, t) => game.hud.hint(text, t));
  if (net) {
    $('invite').classList.remove('hidden');
    $('room-code').textContent = net.room;
    const link = new URL(location.href); link.search = `?room=${net.room}&map=${game.world.map.id}`;
    $('invite-link').value = link.toString();
    const copyText = $('copy-link').querySelector('span');
    $('copy-link').onclick = async () => {
      try { await navigator.clipboard.writeText($('invite-link').value); copyText.textContent = 'Copied'; } catch { $('invite-link').select(); document.execCommand?.('copy'); }
      setTimeout(() => { copyText.textContent = 'Copy'; }, 1500);
    };
    $('pause-sub').textContent = 'Your truck waits with the handbrake on: the room drives on';
  }
  $('to-lobby').onclick = () => { location.href = location.pathname; };
  // the time of day, and its name: 17:30 · Evening
  const todName = () => {
    const h = s.hour, name = h < 6.5 ? 'Dawn' : h < 11 ? 'Morning' : h < 14 ? 'Midday' : h < 17 ? 'Afternoon' : h < 19.5 ? 'Evening' : 'Dusk';
    $('tod-name').textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')} · ${name}`;
  };
  $('tod').value = s.hour;
  todName();
  $('tod').oninput = () => { s.hour = Number($('tod').value); game.renderer.setTime(s.hour); save(); todName(); };
  $('opt-shadows').checked = s.shadows;
  $('opt-shadows').onchange = () => { s.shadows = $('opt-shadows').checked; game.applySettings(); save(); };
  $('opt-sound').checked = s.sound;
  $('opt-sound').onchange = () => { s.sound = $('opt-sound').checked; game.audio.setEnabled(s.sound); save(); };
  $('opt-quality').value = s.quality || 'high';
  $('opt-quality').onchange = () => { s.quality = $('opt-quality').value; s.autoQuality = false; game.applyQuality(); save(); };
  game.onSettingsChanged = () => { $('opt-quality').value = s.quality; save(); };
  $('opt-assist').checked = s.assist;
  $('opt-assist').onchange = () => { s.assist = $('opt-assist').checked; save(); };
  $('opt-damage').value = ['realistic', 'forgiving'].includes(s.damage) ? s.damage : 'cosmetic';
  $('opt-damage').onchange = () => { s.damage = $('opt-damage').value; game.vehicle.damage.setLevel(s.damage); save(); };
  $('opt-rumble').checked = s.rumble;
  $('opt-rumble').onchange = () => { s.rumble = $('opt-rumble').checked; save(); };
  $('opt-full').checked = s.fullscreen !== false;
  $('opt-full').onchange = () => {
    s.fullscreen = $('opt-full').checked; save();
    if (s.fullscreen) fullscreen(); else if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  };
  $('resume').onclick = () => game.togglePause(false);
  $('hud-menu').onclick = (e) => { e.currentTarget.blur(); if (!game.mapOpen) game.togglePause(true); };
  $('respawn').onclick = () => { game.togglePause(false); game.towHome(); };
  $('menu-garage').onclick = () => game.openGarage();
  $('menu-dealer').onclick = () => game.openDealer();
  $('menu-events').onclick = () => game.openEvents();
  $('menu-build').onclick = () => { game.togglePause(false); game.builder.open(); };
  const help = (on) => $('help').classList.toggle('hidden', !on);
  $('show-help').onclick = () => help(true);
  $('close-help').onclick = () => help(false);
  game.onHelp = () => help($('help').classList.contains('hidden'));
}

start().catch((e) => {
  console.error(e);
  $('loading').classList.remove('hidden');
  $('load-label').textContent = `Something went wrong: ${e.message}`;
});
