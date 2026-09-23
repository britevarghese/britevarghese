// RendererManager: creates WebGPU (preferred where available) or WebGL2 renderer with automatic
// fallback, handles resolution scaling, tone mapping, shadows and the post-processing chain.
import * as THREE from 'three';
import { bus } from '../core/EventBus.js';

export class RendererManager {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.renderer = null;
    this.backend = 'webgl2';
    this.post = null;
    this.preset = null;
    this.fx = { speed: 0, nitro: 0, shake: 0, damageFlash: 0, busted: 0 };
  }

  async init(preset) {
    this.preset = preset;
    const want = this.settings.graphics.backend;
    const tryGPU = want === 'webgpu' || (want === 'auto' && this._autoPrefersWebGPU());
    if (tryGPU && navigator.gpu) {
      try {
        const WGPU = await import('three/webgpu');
        const r = new WGPU.WebGPURenderer({ antialias: preset.antialias === 'msaa', powerPreference: 'high-performance' });
        await r.init();
        if (!r.backend?.isWebGPUBackend) throw new Error('WebGPU backend unavailable (fell back to WebGL inside WebGPURenderer)');
        this.renderer = r; this.backend = 'webgpu'; this.WGPU = WGPU;
      } catch (e) {
        console.warn('[Renderer] WebGPU init failed, using WebGL2:', e?.message || e);
        bus.emit('renderer:fallback', { reason: String(e?.message || e) });
        this.renderer?.dispose?.(); this.renderer = null;
      }
    }
    if (!this.renderer) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2', { antialias: preset.antialias === 'msaa' && preset.post === 'off', powerPreference: 'high-performance', stencil: false, depth: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL2 is not available in this browser. Please enable hardware acceleration or use a newer Chrome/Edge/Firefox.');
      this.renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: preset.antialias === 'msaa' && preset.post === 'off' });
      this.backend = 'webgl2';
    }
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    r.shadowMap.enabled = preset.shadows !== 'off';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.id = 'game-canvas';
    this.container.prepend(r.domElement);
    this.resize();
    addEventListener('resize', () => this.resize());
    console.info(`[Renderer] backend=${this.backend}`);
    return r;
  }

  _autoPrefersWebGPU() {
    // WebGPU is preferred on Chromium browsers where it is stable; Firefox/Safari use WebGL2.
    const ua = navigator.userAgent;
    return !!navigator.gpu && /Chrome\/|Edg\//.test(ua) && !/Firefox/.test(ua) && this.settings.graphics.backend !== 'webgl2';
  }

  setupPost(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.post?.dispose?.();
    this.post = null;
    const preset = this.preset;
    if (preset.post === 'off') return;
    if (this.backend === 'webgl2') {
      return import('./PostFX.js').then(({ PostFX }) => {
        this.post = new PostFX(this.renderer, scene, camera, preset);
        this.resize();
      }).catch((e) => { console.warn('[Renderer] post-processing unavailable', e); this.post = null; });
    }
    return import('./PostFXGPU.js').then(({ PostFXGPU }) => {
      this.post = new PostFXGPU(this.renderer, scene, camera, preset, this.WGPU);
    }).catch((e) => { console.warn('[Renderer] WebGPU post-processing unavailable', e); this.post = null; });
  }

  applyPreset(preset) {
    const oldPost = this.preset?.post;
    this.preset = preset;
    const r = this.renderer;
    r.shadowMap.enabled = preset.shadows !== 'off';
    this.resize();
    if (this.scene && oldPost !== preset.post) this.setupPost(this.scene, this.camera);
    else this.post?.applyPreset?.(preset);
  }

  resize() {
    if (!this.renderer) return;
    const p = this.preset;
    const pr = Math.min(devicePixelRatio || 1, p.pixelRatioCap) * p.resolutionScale;
    this.pixelRatio = pr;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    if (this.camera) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    this.post?.setSize?.(innerWidth, innerHeight, pr);
  }

  render(scene, camera, dt) {
    if (this.post) this.post.render(dt, this.fx);
    else this.renderer.render(scene, camera);
  }

  info() {
    const i = this.renderer.info;
    return {
      calls: i.render?.calls ?? i.render?.drawCalls ?? 0,
      triangles: i.render?.triangles ?? 0,
      textures: i.memory?.textures ?? 0,
      geometries: i.memory?.geometries ?? 0,
    };
  }
}
