// QualityManager: hardware detection, short benchmark, and the scalable quality presets.
import { bus } from './EventBus.js';

export const QUALITY_LEVELS = ['veryLow', 'low', 'medium', 'high', 'ultra'];
export const QUALITY_LABELS = { veryLow: 'VERY LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA' };

export const PRESETS = {
  veryLow: {
    resolutionScale: 0.7, pixelRatioCap: 1, textureSize: 256, shadows: 'off', shadowMapSize: 0,
    post: 'off', antialias: 'off', viewDistance: 420, detailDistance: 170, traffic: 10, pedestrians: 0,
    particles: 0.3, rainDrops: 1200, headlightSpots: 0, policeLights: 0, anisotropy: 1, roofDetail: false,
    wetReflections: false, lightPools: true, streetLights: 0, envMapSize: 64, trees: 0.4, lodBias: 0.6, props: 0.5, carLod1Distance: 25,
  },
  low: {
    resolutionScale: 0.85, pixelRatioCap: 1, textureSize: 512, shadows: 'off', shadowMapSize: 0,
    post: 'off', antialias: 'fxaa', viewDistance: 600, detailDistance: 220, traffic: 20, pedestrians: 16,
    particles: 0.5, rainDrops: 2500, headlightSpots: 1, policeLights: 1, anisotropy: 2, roofDetail: false,
    wetReflections: true, lightPools: true, streetLights: 0, envMapSize: 128, trees: 0.7, lodBias: 0.8, props: 0.75, carLod1Distance: 40,
  },
  medium: {
    resolutionScale: 1, pixelRatioCap: 1, textureSize: 1024, shadows: 'low', shadowMapSize: 1024,
    post: 'low', antialias: 'fxaa', viewDistance: 850, detailDistance: 280, traffic: 34, pedestrians: 36,
    particles: 0.75, rainDrops: 5000, headlightSpots: 2, policeLights: 2, anisotropy: 4, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 4, envMapSize: 256, trees: 1, lodBias: 1, props: 1, carLod1Distance: 60,
  },
  high: {
    resolutionScale: 1, pixelRatioCap: 1.5, textureSize: 2048, shadows: 'high', shadowMapSize: 2048,
    post: 'high', antialias: 'msaa', viewDistance: 1200, detailDistance: 360, traffic: 48, pedestrians: 60,
    particles: 1, rainDrops: 8000, headlightSpots: 2, policeLights: 3, anisotropy: 8, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 8, envMapSize: 256, trees: 1, lodBias: 1.25, props: 1, carLod1Distance: 90,
  },
  ultra: {
    resolutionScale: 1, pixelRatioCap: 2, textureSize: 2048, shadows: 'high', shadowMapSize: 4096,
    post: 'high', antialias: 'msaa', viewDistance: 1700, detailDistance: 460, traffic: 64, pedestrians: 90,
    particles: 1.3, rainDrops: 12000, headlightSpots: 2, policeLights: 4, anisotropy: 16, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 12, envMapSize: 512, trees: 1, lodBias: 1.6, props: 1, carLod1Distance: 130,
  },
};

const VIEW_DIST = { low: 450, medium: 800, high: 1200, ultra: 1700 };
const TRAFFIC = { low: 10, medium: 22, high: 36 };
const PARTICLES = { low: 0.35, medium: 0.75, high: 1.2 };
const SHADOW = { off: 0, low: 1024, high: 2048 };

export class QualityManager {
  constructor(settings) {
    this.settings = settings;
    this.gpu = { renderer: 'unknown', vendor: 'unknown', software: false };
    this.level = 'medium';
    this.preset = { ...PRESETS.medium };
  }

  detectHardware() {
    const info = { renderer: 'unknown', vendor: 'unknown', webgl2: false, maxTexture: 0, software: false };
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (gl) {
        info.webgl2 = true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        info.renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        info.vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        info.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch (e) { console.warn('[Quality] WebGL probe failed', e); }
    info.software = /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(info.renderer);
    info.memory = navigator.deviceMemory || 0;
    info.cores = navigator.hardwareConcurrency || 4;
    info.webgpu = !!navigator.gpu;
    info.screen = [screen.width * devicePixelRatio, screen.height * devicePixelRatio];
    this.gpu = info;
    return info;
  }

  // Heuristic initial guess from the GPU string; refined by benchmark().
  guessLevel() {
    const r = (this.gpu.renderer || '').toLowerCase();
    let lvl = 'medium';
    if (this.gpu.software || !this.gpu.webgl2) lvl = 'veryLow';
    else if (/rtx|radeon rx [67]\d{3}|rx 7|rx 6[789]|arc a7|apple m[234] (pro|max)|geforce gtx 1[0-9]80/.test(r)) lvl = 'high';
    else if (/gtx|radeon rx|apple m\d|arc|quadro|radeon pro/.test(r)) lvl = 'medium';
    else if (/intel.*(uhd|iris xe)|radeon\(tm\) graphics|vega/.test(r)) lvl = 'low';
    else if (/intel|hd graphics|mali|adreno|powervr|gma/.test(r)) lvl = 'veryLow';
    if (this.gpu.memory && this.gpu.memory <= 2) lvl = 'veryLow';
    else if (this.gpu.memory && this.gpu.memory <= 4 && QUALITY_LEVELS.indexOf(lvl) > 1) lvl = 'low';
    return lvl;
  }

  // Benchmark: caller renders real frames and passes average frame time (ms).
  refineWithBenchmark(level, avgMs) {
    let i = QUALITY_LEVELS.indexOf(level);
    if (avgMs > 45) i = Math.max(0, i - 2);
    else if (avgMs > 26) i = Math.max(0, i - 1);
    else if (avgMs < 9 && i < 3) i = i + 1;
    return QUALITY_LEVELS[Math.min(i, 3)]; // never auto-select ULTRA
  }

  resolveLevel() {
    const q = this.settings.graphics.quality;
    if (q && q !== 'auto' && PRESETS[q]) return q;
    return this.settings.graphics.detectedQuality || this.guessLevel();
  }

  // Build the effective preset: level preset + individual overrides from settings.
  apply(level = this.resolveLevel()) {
    this.level = level;
    const p = { ...PRESETS[level] };
    const g = this.settings.graphics;
    if (g.resolutionScale && g.resolutionScale !== 1) p.resolutionScale = g.resolutionScale;
    if (g.textures !== 'auto') p.textureSize = +g.textures;
    if (g.shadows !== 'auto') { p.shadows = g.shadows; p.shadowMapSize = SHADOW[g.shadows]; }
    if (g.reflections !== 'auto') p.wetReflections = g.reflections === 'on';
    if (g.postProcessing !== 'auto') p.post = g.postProcessing;
    if (g.antialias !== 'auto') p.antialias = g.antialias;
    if (g.viewDistance !== 'auto') p.viewDistance = VIEW_DIST[g.viewDistance];
    if (g.trafficDensity !== 'auto') p.traffic = TRAFFIC[g.trafficDensity];
    if (g.particles !== 'auto') p.particles = PARTICLES[g.particles];
    p.motionBlur = g.motionBlur;
    // very high-res screens: keep the internal resolution sane
    const px = innerWidth * innerHeight * Math.min(devicePixelRatio, p.pixelRatioCap) ** 2;
    if (px > 3840 * 2160 * 0.9 && level !== 'ultra') p.resolutionScale = Math.min(p.resolutionScale, 0.75);
    this.preset = p;
    bus.emit('quality:changed', { level, preset: p });
    return p;
  }
}
