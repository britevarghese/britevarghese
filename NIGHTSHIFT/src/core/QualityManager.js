// QualityManager: hardware detection, short benchmark, and the scalable quality presets.
import { bus } from './EventBus.js';

export const QUALITY_LEVELS = ['veryLow', 'low', 'medium', 'high', 'ultra'];
export const QUALITY_LABELS = { veryLow: 'VERY LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', ultra: 'ULTRA' };

export const PRESETS = {
  veryLow: {
    resolutionScale: 0.7, pixelRatioCap: 1, textureSize: 256, shadows: 'off', shadowMapSize: 0,
    post: 'off', antialias: 'off', viewDistance: 420, detailDistance: 170, traffic: 10, pedestrians: 0, people: 0,
    particles: 0.3, rainDrops: 1200, headlightSpots: 0, policeLights: 0, anisotropy: 1, roofDetail: false,
    wetReflections: false, lightPools: true, streetLights: 0, envMapSize: 64, trees: 0.4, lodBias: 0.6, props: 0.5, carLod1Distance: 25,
  },
  low: {
    resolutionScale: 0.85, pixelRatioCap: 1, textureSize: 512, shadows: 'off', shadowMapSize: 0,
    post: 'off', antialias: 'fxaa', viewDistance: 600, detailDistance: 220, traffic: 20, pedestrians: 16, people: 4,
    particles: 0.5, rainDrops: 2500, headlightSpots: 1, policeLights: 1, anisotropy: 2, roofDetail: false,
    wetReflections: true, lightPools: true, streetLights: 0, envMapSize: 128, trees: 0.7, lodBias: 0.8, props: 0.75, carLod1Distance: 40,
  },
  medium: {
    resolutionScale: 1, pixelRatioCap: 1, textureSize: 1024, shadows: 'low', shadowMapSize: 1024,
    post: 'low', antialias: 'fxaa', viewDistance: 850, detailDistance: 280, traffic: 34, pedestrians: 36, people: 8,
    particles: 0.75, rainDrops: 5000, headlightSpots: 2, policeLights: 2, anisotropy: 4, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 4, envMapSize: 256, trees: 1, lodBias: 1, props: 1, carLod1Distance: 60,
  },
  high: {
    resolutionScale: 1, pixelRatioCap: 1.5, textureSize: 2048, shadows: 'high', shadowMapSize: 2048,
    post: 'high', antialias: 'msaa', viewDistance: 1200, detailDistance: 360, traffic: 48, pedestrians: 60, people: 12,
    particles: 1, rainDrops: 8000, headlightSpots: 2, policeLights: 3, anisotropy: 8, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 8, envMapSize: 256, trees: 1, lodBias: 1.25, props: 1, carLod1Distance: 90,
  },
  ultra: {
    resolutionScale: 1, pixelRatioCap: 2, textureSize: 2048, shadows: 'high', shadowMapSize: 4096,
    post: 'high', antialias: 'msaa', viewDistance: 1700, detailDistance: 460, traffic: 64, pedestrians: 90, people: 16,
    particles: 1.3, rainDrops: 12000, headlightSpots: 2, policeLights: 4, anisotropy: 16, roofDetail: true,
    wetReflections: true, lightPools: true, streetLights: 12, envMapSize: 512, trees: 1, lodBias: 1.6, props: 1, carLod1Distance: 130,
  },
};

const clampI = (v, a, b) => Math.max(a, Math.min(b, v));
const VIEW_DIST = { low: 450, medium: 800, high: 1200, ultra: 1700 };
const TRAFFIC = { low: 10, medium: 22, high: 36 };
const PARTICLES = { low: 0.35, medium: 0.75, high: 1.2 };
const SHADOW = { off: 0, low: 1024, high: 2048 };

// "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002560) Direct3D11 vs_5_0 ps_5_0, D3D11)"
// -> "NVIDIA GeForce RTX 3060 Laptop GPU"
export function gpuName(renderer = '', vendor = '') {
  let r = String(renderer || '');
  const m = /^ANGLE \((.*)\)$/.exec(r);
  if (m) { const parts = m[1].split(', '); r = parts.length >= 2 ? parts[1] : parts[0]; }
  r = r.replace(/^ANGLE Metal Renderer:\s*/i, '').replace(/\/PCIe.*$|\/SSE2.*$/i, '');
  r = r.replace(/\(0x[0-9a-f]+\)/ig, '').replace(/Direct3D\S*|vs_\S+|ps_\S+|OpenGL.*$/g, '').replace(/\(R\)|\(TM\)|\(tm\)/g, '').replace(/\s+/g, ' ').trim();
  if (!r || r === 'unknown') return vendor && vendor !== 'unknown' ? String(vendor) : 'Unknown graphics card';
  return r;
}

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
      // ask for the fast GPU: on laptops with integrated + dedicated graphics the default context is the
      // integrated one, while the game itself renders on the dedicated one (high-performance)
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2', { powerPreference: 'high-performance' });
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
    info.name = gpuName(info.renderer, info.vendor);
    info.memory = navigator.deviceMemory || 0;
    info.cores = navigator.hardwareConcurrency || 4;
    info.webgpu = !!navigator.gpu;
    info.screen = [screen.width * devicePixelRatio, screen.height * devicePixelRatio];
    this.gpu = info;
    return info;
  }

  // Browsers that hide the GPU name from WebGL (Safari, Firefox privacy modes, some Chrome builds) often
  // still name it through WebGPU's adapter info.
  async probeWebGPU() {
    try {
      if (!navigator.gpu) return;
      const a = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!a) return;
      const i = a.info || (a.requestAdapterInfo ? await a.requestAdapterInfo() : null);
      if (!i) return;
      const desc = [i.description, i.vendor, i.architecture, i.device].filter(Boolean).join(' ').trim();
      this.gpu.adapter = desc;
      if (desc && (!this.gpu.recognized || this.gpu.renderer === 'unknown')) {
        const r2 = i.description || `${i.vendor || ''} ${i.architecture || ''}`.trim();
        if (r2 && this._tier(gpuName(r2).toLowerCase()) !== null) { this.gpu.renderer = r2; this.gpu.name = gpuName(r2, i.vendor); }
        else if (this.gpu.renderer === 'unknown' && r2) { this.gpu.renderer = r2; this.gpu.name = gpuName(r2, i.vendor); }
      }
    } catch { /* not available */ }
  }

  // The GPU the game actually renders on (the renderer's own context, created with high-performance).
  fromRenderer(rm) {
    try {
      if (rm.backend === 'webgl2') {
        const gl = rm.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const v = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        if (r && (this._tier(gpuName(r).toLowerCase()) !== null || this.gpu.renderer === 'unknown')) { this.gpu.renderer = r; this.gpu.vendor = v; this.gpu.name = gpuName(r, v); }
      } else {
        const i = rm.renderer.backend?.adapter?.info;
        const r = i?.description || (i ? `${i.vendor || ''} ${i.architecture || ''}`.trim() : '');
        if (r && (this._tier(gpuName(r).toLowerCase()) !== null || this.gpu.renderer === 'unknown')) { this.gpu.renderer = r; this.gpu.name = gpuName(r, i.vendor); }
      }
    } catch { /* keep the probe's answer */ }
  }

  // tier index from a GPU name, or null when the name is unknown / generic
  _tier(r) {
    if (/swiftshader|llvmpipe|software|basic render/.test(r)) return 0;
    if (/rtx ?[2-5]0[6-9]0|rtx ?[45]0[5-9]0|rtx a[4-6]000|rtx [0-9]000 ada|titan|radeon rx ?(6[7-9]|7[7-9]|9[0-9])\d0|radeon pro w7|apple m\d (max|ultra)|apple m[3-5] pro/.test(r)) return 4;
    if (/rtx|radeon rx ?(5[6-7]|6[0-6]|7[0-6])\d0|rx ?(5[67]|6[0-6]|7[0-6])\d0|arc (a[57]|b[5-7])|apple m[1-5] (pro|max)|gtx 1(07|08)0|gtx 1660/.test(r)) return 3;
    if (/gtx|geforce|radeon rx|radeon pro|apple m\d|apple gpu|arc|quadro|radeon (8[0-9]0|7[0-9]0|6[0-9]0)m|iris xe max/.test(r)) return 2;
    if (/intel.*(uhd|iris)|radeon\(tm\) graphics|radeon graphics|vega|adreno \(tm\) 7|mali-g7/.test(r)) return 1;
    if (/intel|hd graphics|mali|adreno|powervr|gma|videocore/.test(r)) return 0;
    return null;
  }

  // Heuristic initial guess from the GPU name; refined by benchmark().
  guessLevel() {
    const r = gpuName(this.gpu.renderer).toLowerCase();
    if (!this.gpu.webgl2) return 'veryLow';
    const t = this._tier(r);
    this.gpu.recognized = t !== null;
    let lvl = QUALITY_LEVELS[t ?? 2];
    // deviceMemory is capped at 8 and only reported by some browsers; only trust very low values
    if (this.gpu.memory && this.gpu.memory <= 2 && (t ?? 2) < 3) lvl = 'veryLow';
    return lvl;
  }

  // Benchmark: the caller renders real frames at `level` and passes the median GPU+CPU work time per
  // frame (ms, measured with a pipeline sync, so it is not capped by the display refresh). Budget is a
  // 60 fps frame with headroom for traffic, police and effects. One step up at most, and ULTRA only
  // for a GPU the heuristics already rate as high-end.
  // A fast card goes all the way up: two steps when there is lots of headroom. The cap only applies to
  // recognized low-end chips (an unrecognized name may be a top card behind a privacy mask).
  refineWithBenchmark(level, workMs) {
    const guess = QUALITY_LEVELS.indexOf(this.guessLevel());
    let i = QUALITY_LEVELS.indexOf(level);
    if (workMs > 34) i -= 2;
    else if (workMs > 18) i -= 1;
    else if (workMs < 4) i += 2;
    else if (workMs < 8) i += 1;
    const cap = !this.gpu.recognized || guess >= 3 ? 4 : Math.min(4, guess + 2);
    return QUALITY_LEVELS[clampI(i, 0, cap)];
  }

  // identity of the GPU the detection was made on: a new GPU / browser re-runs the benchmark
  get gpuKey() { return `v2|${this.gpu.vendor}|${this.gpu.renderer}`; }

  resolveLevel() {
    const g = this.settings.graphics;
    const q = g.quality;
    if (q && q !== 'auto' && PRESETS[q]) return q;
    if (g.detectedQuality && g.detectedGpu !== this.gpuKey) g.detectedQuality = null; // new hardware (or a pre-ULTRA detection): measure again
    return g.detectedQuality || this.guessLevel();
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
