// NIGHTSHIFT bootstrap: detect hardware → create renderer (WebGPU/WebGL2) → load critical
// assets first (player car, nearby roads/buildings) → show the game while the rest streams in.
import * as THREE from 'three';
import { Settings } from './core/Settings.js';
import { SaveSystem } from './core/SaveSystem.js';
import { QualityManager, QUALITY_LABELS } from './core/QualityManager.js';
import { RendererManager } from './renderer/RendererManager.js';
import { setTextureQuality } from './renderer/Textures.js';
import { AssetManager, PRIORITY } from './assets/AssetManager.js';
import { ModelLibrary } from './vehicles/VehicleRenderer.js';
import { bus } from './core/EventBus.js';
import { Game } from './core/Game.js';

const $ = (id) => document.getElementById(id);
const TIPS = [
  'Tip: tap SPACE mid-corner to kick the rear out, then steer into the slide.',
  'Tip: SHIFT fires nitrous. Drifting and near-misses refill it.',
  'Tip: break line of sight with the police to start the cooldown.',
  'Tip: press V to cycle cameras, M for the city map, F3 for performance stats.',
  'Tip: upgrade tires first — grip wins more races than horsepower.',
  'Tip: roadblocks sit at intersections ahead of you. Take a side street.',
];

function setProgress(p, text) {
  $('load-fill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('load-status').textContent = text;
}
export function fatal(title, msg) {
  $('fatal').classList.remove('hidden');
  $('fatal-title').textContent = title;
  $('fatal-msg').textContent = msg;
}

async function boot() {
  $('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  const settings = new Settings();
  const save = new SaveSystem();
  const quality = new QualityManager(settings);
  const hw = quality.detectHardware();
  let level = quality.resolveLevel();
  let preset = quality.apply(level);
  $('load-foot').textContent = `${hw.renderer} · ${QUALITY_LABELS[level]}`;
  setProgress(0.03, 'Starting renderer...');

  const rm = new RendererManager($('app'), settings);
  try { await rm.init(preset); } catch (e) { fatal('RENDERER ERROR', String(e.message || e)); throw e; }
  $('load-foot').textContent = `${hw.renderer} · ${rm.backend.toUpperCase()} · ${QUALITY_LABELS[level]}`;
  setTextureQuality(preset.textureSize, preset.anisotropy);

  const assets = new AssetManager();
  if (rm.backend === 'webgl2') assets.initKTX2(rm.renderer);
  bus.on('asset:error', (e) => bus.emit('toast', { text: `ASSET LOAD ERROR: ${e.file}`, type: 'err', time: 6 }));
  const lib = new ModelLibrary(assets);

  // 1) player vehicle first
  setProgress(0.08, 'Loading vehicle...');
  const carId = save.data.currentCar;
  await lib.load([carId], PRIORITY.VEHICLE);
  if (!lib.has(carId)) { fatal('ASSET LOAD ERROR', `${carId}.glb`); return; }
  // traffic/police/other cars stream in the background (priority 4)
  const rest = lib.load(['kestrel', 'hikari', 'brawler', 'stratos', 'interceptor', 'sedan', 'suv', 'van', 'truck', 'bus'], PRIORITY.TRAFFIC);

  const game = new Game({ settings, save, quality, rm, assets, lib, preset });
  window.NIGHTSHIFT = game; // handy for debugging from the console
  await game.init((p, t) => setProgress(0.12 + p * 0.78, t));
  setProgress(0.92, 'Loading traffic...');
  await Promise.race([rest, new Promise((r) => setTimeout(r, 4000))]);
  game.onModelsReady(rest);

  // short benchmark on first launch / new GPU (auto quality only)
  if (settings.graphics.quality === 'auto' && !settings.graphics.detectedQuality) {
    setProgress(0.96, 'Measuring performance...');
    let ms = 16;
    try { ms = await game.benchmark(40); } catch (e) { if (rm.backend === 'webgpu') { rm.failWebGPU(e.message); return; } throw e; }
    const refined = quality.refineWithBenchmark(level, ms);
    console.info(`[Quality] benchmark ${ms.toFixed(1)} ms/frame: ${level} -> ${refined}`);
    settings.graphics.detectedQuality = refined; settings.graphics.detectedGpu = quality.gpuKey; settings.save();
    if (refined !== level) { level = refined; preset = quality.apply(level); game.applyPreset(preset, true); }
  }
  setProgress(1, 'Ready');
  game.start();
  $('loading').classList.add('fade');
  setTimeout(() => $('loading').remove(), 900);
}

boot().catch((e) => {
  console.error(e);
  if ($('fatal').classList.contains('hidden')) fatal('STARTUP ERROR', String(e?.stack || e));
});
void THREE;
