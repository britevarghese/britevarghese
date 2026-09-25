// Persistent user settings (graphics / gameplay / audio).
import { Storage } from './Storage.js';
import { bus } from './EventBus.js';

export const DEFAULT_SETTINGS = {
  version: 2,
  graphics: {
    quality: 'auto',          // auto | veryLow | low | medium | high | ultra
    detectedQuality: null,    // result of auto-detection
    detectedGpu: null,        // GPU the detection ran on (a different GPU re-detects)
    backend: 'auto',          // auto | webgl2 | webgpu
    resolutionScale: 1,
    textures: 'auto',         // auto | 256 | 512 | 1024 | 2048
    shadows: 'auto',          // auto | off | low | high
    reflections: 'auto',      // auto | off | on
    postProcessing: 'auto',   // auto | off | low | high
    antialias: 'auto',        // auto | off | fxaa | msaa
    viewDistance: 'auto',     // auto | low | medium | high | ultra
    trafficDensity: 'auto',   // auto | low | medium | high
    particles: 'auto',        // auto | low | medium | high
    weather: 'auto',          // auto | clear | cloudy | rain  (auto = dynamic)
    timeOfDay: 'real',        // real (local clock) | cycle (48-min game day) | morning | day | evening | night
    motionBlur: true,
    showFps: false,
  },
  gameplay: {
    cameraSensitivity: 1,
    steeringSensitivity: 1,
    vibration: true,
    units: 'kmh',             // kmh | mph
    defaultCamera: 1,
    playerName: '',           // multiplayer name (empty = random DriverNNN)
  },
  audio: { master: 0.8, engine: 0.85, traffic: 0.6, police: 0.75, music: 0.45, environment: 0.7 },
};

function merge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(over || {})) {
    if (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) out[k] = merge(base[k], over[k]);
    else if (k in (base || {})) out[k] = over[k];
  }
  return out;
}

export class Settings {
  constructor() {
    this.data = merge(DEFAULT_SETTINGS, Storage.load('settings', {}));
    // v2: 'night' was the old default for everyone; move players to real-time day/night once
    if ((this.data.version || 1) < 2) { if (this.data.graphics.timeOfDay === 'night') this.data.graphics.timeOfDay = 'real'; this.data.version = 2; }
  }
  get graphics() { return this.data.graphics; }
  get gameplay() { return this.data.gameplay; }
  get audio() { return this.data.audio; }
  set(section, key, value) {
    this.data[section][key] = value;
    this.save();
    bus.emit('settings:changed', { section, key, value });
  }
  save() { Storage.save('settings', this.data); }
  reset() { this.data = merge(DEFAULT_SETTINGS, {}); this.save(); bus.emit('settings:changed', { section: '*', key: '*' }); }
}
