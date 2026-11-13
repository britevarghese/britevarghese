// Start screen -> join a room (or drive alone) -> build the map's world -> drive.
import { generateWorld } from './world/WorldGen.js';
import { mapById } from './world/maps/index.js';
import { World } from './world/World.js';
import { WORLD } from './world/maps/world.js';
import { OpenWorld } from './world/OpenWorld.js';
import { WorldLoader } from './world/WorldLoader.js';
import { homeOf } from './world/homes.js';
import { WorldView } from './render/WorldView.js';
import { TRUCKS } from './physics/trucks.js';
import { buildSummary, decodeBuild } from './physics/Upgrades.js';
import { Garage } from './ui/Garage.js';
import { TruckView } from './ui/TruckView.js';
import { showroomFor } from './ui/Showroom.js';
import { Career, TRUCK_PRICES, money } from './game/Career.js';
import { Renderer } from './render/Renderer.js';
import { TerrainRenderer } from './render/Terrain.js';
import { loadGround } from './render/Ground.js';
import { Vegetation } from './render/Vegetation.js';
import { Grass } from './render/Grass.js';
import { Tea } from './render/Tea.js';
import { Rocks } from './render/Rocks.js';
import { Water } from './render/Water.js';
import { RoadMarkings } from './render/RoadMarkings.js';
import { RoadWear } from './render/RoadWear.js';
import { Landmarks } from './render/Landmarks.js';
import { Effects, Rope } from './render/Effects.js';
import { MUD_TINT } from './render/TruckModel.js';
import { loadTruckAsset } from './render/TruckAssets.js';
import { loadDriverAssets } from './render/DriverAssets.js';
import { Input } from './core/Input.js';
import { Game, soloBeaconsKey } from './core/Game.js';
import { decodeLayout } from './game/Props.js';
import { Audio } from './audio/Audio.js';
import { NetClient } from './net/NetClient.js';
import { Voice } from './net/Voice.js';
import { VoicePanel } from './ui/VoicePanel.js';
import { HUD } from './ui/HUD.js';
import { TouchControls, isTouchDevice } from './ui/Touch.js';
import { idle, setPlaying } from './core/Idle.js';
import { startLevel, rememberLevel } from './game/Quality.js';

const $ = (id) => document.getElementById(id);
// the map: the one world, every map joined into it (the maps once driven alone are all in it, where they always were)
const MAPS = { [WORLD.id]: WORLD }, MAP_IDS = Object.keys(MAPS), DEFAULT_MAP = WORLD.id;
const PAINTS = ['#b5532c', '#3d6b8c', '#6b7d3e', '#c9a227', '#8c2f2f', '#e6e1d3', '#2f4f3a', '#4a4a4a'];
const STORE = 'trailbreak.settings';

const settings = Object.assign({ name: '', map: DEFAULT_MAP, truck: 'thar', paint: PAINTS[0], hour: 16.5, weather: 'clear', shadows: true, sound: true, assist: true, rumble: true, fullscreen: true, quality: 'high', autoQuality: true, damage: 'cosmetic', builds: {} }, (() => {
  try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; }
})());
if (!settings.builds || typeof settings.builds !== 'object') settings.builds = {};
// the Mahindra Thar is the truck to start in: everyone who had another picked gets it once (and can pick theirs again)
if (!settings.tharDefault) { settings.truck = 'thar'; settings.tharDefault = 1; }
// crashes only dent and break glass now: everyone gets that once (the menu still has forgiving and realistic)
if (!settings.lookDamage) { settings.damage = 'cosmetic'; settings.lookDamage = 1; }
// the graphics stepped down for a slow spell used to be kept: everyone who never picked them gets high back once (the
// game steps down for the session only now, Game.perf)
if (!settings.qualityKept) { if (settings.autoQuality !== false) settings.quality = 'high'; settings.qualityKept = 1; }
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* storage blocked */ } };
/**
 * Another game's server to play on (?server=ws://192.168.1.5:47610, or wss://trailbreak-xxxx.onrender.com): the Windows
 * app joins a friend's game this way, so this page, and with it your own career, trucks and settings, stays your own.
 */
const SERVER = (() => { const v = new URLSearchParams(location.search).get('server'); return v && /^wss?:\/\/[a-z0-9.\-[\]:]+$/i.test(v) ? v.toLowerCase() : null; })();
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
  // the car: chosen in the showroom (ui/Showroom.js), yours to drive or the dealer's price
  const showroom = showroomFor($('showroom'));
  const showTrucks = () => {
    const t = TRUCKS[settings.truck] || TRUCKS.ranger;
    $('choose-car-sub').textContent = `${t.name} · ${t.road ? 'sports car' : 'off-road'}`;
  };
  $('choose-car').onclick = () => {
    view.stop();
    showroom.open({
      title: (MAPS[settings.map] || MAPS[DEFAULT_MAP]).dealer || 'Motors',
      current: settings.truck, paint: settings.paint, builds: settings.builds,
      owns: (id) => career.ownsTruck(id),
      action: (id) => {
        const t = TRUCKS[id], price = TRUCK_PRICES[id] ?? 0;
        if (id === settings.truck) return { label: 'Selected', enabled: false };
        const pick = () => { settings.truck = id; save(); showroom.close(); };
        if (career.ownsTruck(id)) return { label: 'Select this one', enabled: true, run: pick };
        if (!career.canAfford(price)) return { label: `Need ${money(price)}`, enabled: false, note: `The ${t.name} costs ${money(price)} and you have ${money(career.money)}: win events, survey beacons and tow friends out to earn it.` };
        return { label: `Buy for ${money(price)}`, enabled: true, run: () => { if (career.buyTruck(id)) pick(); } };
      },
      onClose: () => { showTrucks(); showBuild(); },
    });
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
    net = new NetClient({ name: settings.name, room: choice.room, map: choice.map, quick: choice.quick, server: SERVER });
    try {
      welcome = await net.connect();
      break;
    } catch (e) {
      $('lobby-msg').textContent = `${e.message} You can still drive alone.`;
      net = null;
      $('paints').innerHTML = '';                     // (the lobby lays its paints out again)
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
  const open = mapId === WORLD.id, M = open ? WORLD : mapById(mapId);
  document.querySelector('#loading h2').textContent = M.name;

  $('lobby').classList.add('hidden');
  $('loading').classList.remove('hidden');
  setLoad(0.02, 'Surveying the valley');
  let world, renderer, terrain, vegetation, rocks, grass, tea, water, landmarks, effects, breakView = null, game = null, loader = null, goLive;
  const live = new Promise((r) => { goLive = r; });
  if (open) {
    // the open world: its maps built in workers (or taken from storage), the map of the truck's home first (after the
    // ones it is laid onto); the game starts on it and the others join as they come in, with no loading screen for them
    const home = homeOf(settings.truck), start = home.region;
    world = new OpenWorld(WORLD, home);
    renderer = new Renderer($('app'));
    effects = new Effects(renderer.scene);
    const S = world.regionDef(WORLD.start).map;
    renderer.setAtmosphere(S.atmosphere);
    effects.setPalette(S.dust);
    if (S.mudTint) MUD_TINT.setRGB(...S.mudTint);
    const view = await WorldView.create(world, renderer, { quality: settings.quality, audio, effects });
    // (the loading bar: the start map and those built before it, each its share)
    const early = WorldLoader.before(start), part = new Map();
    loader = new WorldLoader({ onProgress: (id, f, label) => {
      if (!early.has(id) || game) return;
      part.set(id, f);
      let sum = 0; for (const v of part.values()) sum += v;
      setLoad(0.02 + 0.6 * sum / early.size, early.size > 1 && id !== start ? `${world.regionDef(id).map.name}: ${label}` : label);
    } });
    let started;
    const first = new Promise((r) => { started = r; });
    world.loading = loader.load(start, async (id, data) => {
      // (the others once the game is under way: the start map's loading screen is for it alone)
      if (id !== start) await live;
      const region = world.add(id, data);
      if (region.id === start) setLoad(0.64, 'Painting the ground');
      else await idle();
      await view.add(region, region.id === start ? { onProgress: (f) => setLoad(0.64 + f * 0.16), slice: Infinity } : {});
      if (region.id === start) started(); else game?.regionIn(region);
    }).catch((e) => { console.error('the open world', e); game?.hud.toast(`Part of the world could not be built: ${e.message}`, true, 8); });
    await first;
    ({ terrain, vegetation, grass, tea, rocks, water, landmarks, breakView } = view);
    world.view = view;
  } else {
    const data = await generateWorld({ map: M, onProgress: (f, label) => setLoad(0.02 + f * 0.6, label) });
    world = new World(data);
    setLoad(0.64, 'Painting the ground');
    await new Promise((r) => setTimeout(r, 0));
    renderer = new Renderer($('app'));
    renderer.setAtmosphere(M.atmosphere);
    const ground = await loadGround(M.ground, settings.quality).catch((e) => { console.warn('ground textures', e); return null; });
    terrain = new TerrainRenderer(world, renderer.scene, { ground, onProgress: (f) => setLoad(0.64 + f * 0.16) });
    setLoad(0.82, 'Growing the trees');
    await new Promise((r) => setTimeout(r, 0));
    vegetation = await Vegetation.create(world, renderer);
    rocks = new Rocks(world, renderer.scene, ground);
    grass = new Grass(world, terrain, renderer.scene, ground, vegetation.uniforms);
    tea = M.tea ? new Tea(world, renderer.scene) : null;
    water = new Water(world, renderer.scene);
    new RoadMarkings(world, renderer.scene);                       // (the lines on a map's tarmac, if it has any)
    new RoadWear(world, renderer.scene);                           // (and its wear, cracks and mud)
    landmarks = new Landmarks(world, renderer.scene);
    effects = new Effects(renderer.scene);
    effects.setPalette(M.dust);
  }
  if (!open && M.mudTint) MUD_TINT.setRGB(...M.mudTint);
  const rope = new Rope(renderer.scene);
  setLoad(0.9, 'Warming up the engine');
  // (a model body, and the driver: loaded before the truck is built)
  await Promise.all([loadTruckAsset(settings.truck), loadDriverAssets()]);
  const hud = new HUD(world, terrain);
  const input = new Input();
  // voice chat with the others in the room (net/Voice.js)
  const voice = net ? new Voice(net) : null;
  if (net) net.onBinary = (b) => voice.onBinary(b);
  // the graphics level this session starts at: where the last one settled on this machine, or by its graphics card the
  // first time (game/Quality.js); and no step up tried for a few sessions after one that didn't hold
  const gl = renderer.renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String((dbg && gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) || gl.getParameter(gl.RENDERER) || '');
  const autoQuality = startLevel(settings, gpu, isTouchDevice());
  const autoStuck = settings.autoHold > 0;
  if (autoStuck) settings.autoHold--;
  if (settings.autoStart === undefined && settings.autoQuality !== false) rememberLevel(settings, autoQuality || settings.quality || 'high');
  save();
  game = new Game({
    autoQuality, autoStuck,
    world, renderer, terrain, vegetation, grass, tea, rocks, water, landmarks, breakView, effects, rope, audio, net, voice, hud, input, settings, garage, career,
    truckId: settings.truck, build: settings.builds[settings.truck] || '', paint: settings.paint, name: settings.name, mapName: M.name, dealerName: M.dealer,
  });
  game.onBuild = (id, code) => { settings.truck = id; settings.builds[id] = code; save(); };
  game.onAutoQuality = (level, stuck) => { rememberLevel(settings, level, stuck); save(); };
  $('m-dmg').onclick = () => game.fitSpare();          // (a tap on phones)
  window.game = game;                              // (handy in the console)
  // (the open world's maps still to come: the one the truck is nearest and looking toward next)
  if (loader) loader.score = (id) => game.regionScore(id);
  await audio.setLocalEngine(game.spec).catch(() => {});
  // a map from a link (?layout=, the builder's SHARE), else the room's (whoever built in it), onto this map
  const linkLayout = new URLSearchParams(location.search).get('layout');
  if (net) {
    net.onEvent = (m) => game.onNet(m);
    for (const id of welcome.beacons || []) game.found.add(id);
    for (const k of welcome.broken || []) world.breakKey(k, 0, 1, 0, true);   // (what friends have knocked down here)
    game.events.welcome(welcome.race);
    if (welcome.layout && !linkLayout) game.takeLayout(welcome.layout, null);
    // (the room's weather; a room without one yet takes this player's)
    if (welcome.weather) game.setWeather(welcome.weather, false, true);
    else if (game.weather !== 'clear') net.send({ t: 'weather', w: game.weather });
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
  // build the patches around the start before the first frame (not drawn), then compile the shaders they need, all at
  // once where the browser can (KHR_parallel_shader_compile: one by one, each waited on, they held the loading screen
  // for most of its time on a slow graphics chip)
  terrain.budget = 400;
  game.noRender = true;
  game.frame(0.016);
  game.noRender = false;
  setLoad(0.96, 'Warming up the shaders');
  await renderer.renderer.compileAsync(renderer.scene, renderer.camera).catch((e) => console.warn('shaders', e));
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
  if (open) hud.toast(`Your ${(TRUCKS[settings.truck] || TRUCKS.ranger).name} starts at ${world.map.spawn.name}. Fast travel to the other bases, the rocky hills and your friends: M, then T`, false, 9);
  hud.toast('Find the survey beacons: follow the orange light beams', false, 6);
  if (autoQuality) hud.toast(`Graphics start at ${autoQuality} on this machine${autoStuck ? '' : ', and go up if it runs smoothly'} (Esc to change)`, false, 6);
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
  loader?.playing();                                  // (the rest of the world built with cores to spare for the game)
  setPlaying(true);                                   // (and the maps that come in drawn in the idle time between frames)
  goLive();
}

/**
 * The Windows app: let friends on the same Wi-Fi or LAN into this room (the app's server listens on the network as well,
 * and the invite link carries this PC's address there). The game carries on: the room reconnects in a moment.
 */
function wireLanHost(D, showLink, game) {
  const box = $('lan-host'), on = $('lan-on'), note = $('lan-note');
  const show = (n) => {
    box.classList.toggle('hidden', !!n.joined);
    on.checked = n.hosting;
    note.textContent = !n.hosting ? 'Tick it and the link above takes friends on your Wi-Fi or LAN straight to this room.'
      : n.inviteBase ? 'Send them the link: they open it in their TRAILBREAK (Join a friend\'s game, in its lobby) or in a browser. If Windows asks, allow TRAILBREAK on private networks.'
        : 'This PC is on no network: connect it to one, and the link will carry its address.';
    showLink();
  };
  show(D.network());
  D.onNetwork?.(show);
  on.onchange = async () => {
    const want = on.checked;
    on.disabled = true;
    note.textContent = want ? 'Opening this game to your network...' : 'Closing it to your network...';
    try { show(await D.setHosting(want)); game.hud.toast(want ? 'Friends on your network can join: Esc for the link' : 'Only this PC now', false, 5); } catch (e) { on.checked = !want; note.textContent = `Could not: ${e.message}`; }
    on.disabled = false;
  };
}

function wireMenus(game, net) {
  const s = game.settings;
  if (game.voice) game.voicePanel = new VoicePanel(game.voice, s, save, (text, t) => game.hud.hint(text, t));
  if (net) {
    $('invite').classList.remove('hidden');
    $('room-code').textContent = net.room;
    // (in the Windows app hosting a game for its network, the address friends reach this PC at: desktop/preload.js)
    const D = window.trailbreakDesktop;
    const showLink = () => {
      // (on a friend's game, its own address: https on the same port as its server)
      const link = new URL((SERVER && SERVER.replace(/^wss?:/, 'https:')) || (D?.network ? D.network().inviteBase : D?.inviteBase) || location.href);
      link.search = `?room=${net.room}&map=${game.world.map.id}`;
      $('invite-link').value = link.toString();
    };
    showLink();
    if (D?.network && D.setHosting && !SERVER) wireLanHost(D, showLink, game);
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
  // the weather: the player's own, or in a room the room's (Game.setWeather shares it; a friend's change shows here)
  $('opt-weather').value = game.weather;
  game.onWeather = (w) => { $('opt-weather').value = w; };
  $('opt-weather').onchange = () => { s.weather = $('opt-weather').value; game.setWeather(s.weather); save(); };
  $('opt-shadows').checked = s.shadows;
  $('opt-shadows').onchange = () => { s.shadows = $('opt-shadows').checked; game.applySettings(); save(); };
  $('opt-sound').checked = s.sound;
  $('opt-sound').onchange = () => { s.sound = $('opt-sound').checked; game.audio.setEnabled(s.sound); save(); };
  $('opt-quality').value = s.quality || 'high';
  $('opt-quality').onchange = () => { s.quality = $('opt-quality').value; s.autoQuality = false; game.autoQuality = null; game.applyQuality(); save(); };
  $('opt-assist').checked = s.assist;
  $('opt-assist').onchange = () => { s.assist = $('opt-assist').checked; save(); };
  $('opt-damage').value = ['realistic', 'forgiving'].includes(s.damage) ? s.damage : 'cosmetic';
  $('opt-damage').onchange = () => { s.damage = $('opt-damage').value; game.vehicle.damage.setLevel(s.damage); save(); };
  $('opt-perf').checked = !!s.perf;
  $('opt-perf').onchange = () => game.showPerf($('opt-perf').checked);
  game.onPerf = (on) => { s.perf = on; $('opt-perf').checked = on; save(); };
  if (s.perf) game.showPerf(true);
  $('opt-rumble').checked = s.rumble;
  $('opt-rumble').onchange = () => { s.rumble = $('opt-rumble').checked; save(); };
  // a steering wheel's gear paddles (the browser shows a wheel once a button on it is pressed): click, pull the paddle
  const I = game.input;
  I.shifters = s.shifters ||= {};
  I.wheelCal = s.wheelCal ||= {};
  I.wheelRot = s.wheelRot ||= {};
  const wheelUI = () => {
    // (any controller can be calibrated: many wheels pass themselves off as an Xbox pad, and steer like a thumbstick
    // until they are)
    const any = I.pad(), pad = I.wheelPad(), S = pad && I.shiftersFor(pad);
    const name = (p) => p.id.replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').replace(/\s*\(.*\)\s*$/, '');
    $('wheel-name').textContent = pad ? name(pad) || 'Steering wheel' : any ? `${name(any) || 'Controller'} (as a gamepad)` : 'No steering wheel (press a button on it)';
    $('wheel-cal').disabled = !any;
    $('wheel-cal').textContent = I.calib ? 'Cancel' : any && I.wheelCal[any.id] ? 'Recalibrate steering' : 'Calibrate steering';
    $('wheel-cal-box').classList.toggle('hidden', !I.calib);
    $('wheel-rot').disabled = !any;
    if (any) $('wheel-rot').value = String(I.rotationOf(any));
    for (const k of ['up', 'down']) {
      const b = $('wheel-' + k), learning = I.learning?.which === k;
      b.disabled = !pad;
      b.classList.toggle('learn', learning);
      b.textContent = learning ? 'Pull the paddle…' : `Gear ${k}: ${S ? 'button ' + (S[k] + 1) : '–'}`;
    }
  };
  for (const k of ['up', 'down']) $('wheel-' + k).onclick = () => { I.learn(k, () => { save(); wheelUI(); }); wheelUI(); };
  $('wheel-rot').onchange = () => { const any = I.pad(); if (any) { I.wheelRot[any.id] = Number($('wheel-rot').value); save(); } };
  $('wheel-cal').onclick = (e) => {
    e.currentTarget.blur();
    if (I.calib) { I.cancelCalibrate(); wheelUI(); return; }
    $('wheel-cal-text').textContent = 'Turn the wheel all the way left, then all the way right, then let it back to the centre';
    I.calibrate((st) => {
      if (st.none) return;
      $('wheel-cal-pos').style.left = `${50 + 46 * Math.max(-1, Math.min(1, st.pos))}%`;
      document.querySelector('#wheel-cal-box .wc-l').classList.toggle('on', st.left);
      document.querySelector('#wheel-cal-box .wc-r').classList.toggle('on', st.right);
      if (st.left && st.right) $('wheel-cal-text').textContent = 'Now let the wheel back to the centre';
    }, () => { save(); wheelUI(); game.hud.hint('Steering calibrated: the whole turn of your wheel is the whole lock', 3); });
    wheelUI();
  };
  addEventListener('gamepadconnected', wheelUI);
  addEventListener('gamepaddisconnected', wheelUI);
  game.onPause = (on) => { if (on) wheelUI(); else if (I.calib) I.cancelCalibrate(); };
  wheelUI();
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

// (the Windows app: open a friend's game from their invite link or address, from the lobby: desktop/)
if (window.trailbreakDesktop?.join) { $('lan-join-row').classList.remove('hidden'); $('lan-join').onclick = () => window.trailbreakDesktop.join(); }
// (on a friend's game: whose, and the way back to your own)
if (SERVER) {
  $('joining-host').textContent = SERVER.replace(/^wss?:\/\//, '');
  $('joining').classList.remove('hidden');
  $('joining-back').onclick = () => { location.href = location.pathname; };
}

// (the Windows app: a newer TRAILBREAK has downloaded in the background, and installs when the game is closed: desktop/)
window.trailbreakDesktop?.onUpdate?.((version) => {
  const text = `TRAILBREAK ${version} has downloaded: it installs when you close the game (or now: Alt, Game > Restart to update)`;
  if (window.game?.hud) window.game.hud.toast(text, false, 12); else $('lobby-msg').textContent = text;
});

start().catch((e) => {
  console.error(e);
  $('loading').classList.remove('hidden');
  $('load-label').textContent = `Something went wrong: ${e.message}`;
});
