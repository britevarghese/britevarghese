// WebGL2 post-processing chain: HDR render -> bloom -> speed FX (radial blur, chromatic
// aberration, vignette, grain) -> FXAA -> tone mapping/output. Each stage scales with quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const SpeedShader = {
  uniforms: {
    tDiffuse: { value: null }, uBlur: { value: 0 }, uChroma: { value: 0 }, uVignette: { value: 0.35 },
    uFlash: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0.012 }, uCenter: { value: new THREE.Vector2(0.5, 0.52) },
    uGray: { value: 0 }, uRain: { value: 0 }, uRainSpeed: { value: 0 }, tDrops: { value: null }, uAspect: { value: 16 / 9 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur, uChroma, uVignette, uFlash, uTime, uGrain, uGray; uniform vec2 uCenter;
    uniform sampler2D tDrops; uniform float uRain, uRainSpeed, uAspect;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    // rain on the lens: droplet normal map (rg = normal, b = mask). Beads fade in/out per cell, some run
    // down the glass, and airflow at speed sweeps them outward.
    vec3 drops(vec2 uv) {
      vec2 p = vec2(uv.x * uAspect, uv.y) * 1.6;
      vec2 cell = floor(p * 6.0);
      float life = fract(rand(cell) + uTime * (0.05 + rand(cell + 7.1) * 0.08));
      float vis = smoothstep(0.0, 0.08, life) * smoothstep(1.0, 0.55, life) * (1.0 - uRainSpeed * 0.7);
      vec4 a = texture2D(tDrops, p + vec2(0.0, uRainSpeed * uTime * 0.6));
      vec2 q = vec2(uv.x * uAspect, uv.y) * 0.9 + vec2(0.37, 0.0);
      float lane = step(0.72, rand(vec2(floor(q.x * 5.0), 3.0)));
      vec4 b = texture2D(tDrops, q + vec2(0.0, uTime * (0.05 + lane * 0.12) + uRainSpeed * uTime * 1.2));
      float m1 = a.b * vis, m2 = b.b * mix(0.25, 1.0, lane);
      vec2 n = (a.rg - 0.5) * m1 + (b.rg - 0.5) * m2;
      return vec3(n, clamp(m1 + m2, 0.0, 1.0));
    }
    void main(){
      vec3 dr = uRain > 0.01 ? drops(vUv) : vec3(0.0);
      float dm = dr.z * uRain;
      vec2 duv = vUv - dr.xy * 0.035 * uRain; // refraction: each drop shows a flipped, shrunk view
      vec2 dir = duv - uCenter;
      float dist = length(dir);
      // radial speed blur, weaker toward the top of the frame so the sky/stars don't streak
      float amt = uBlur * smoothstep(0.18, 0.8, dist) * mix(0.25, 1.0, smoothstep(0.9, 0.4, vUv.y));
      vec4 col = vec4(0.0);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 uv = duv - dir * amt * t * 0.12;
        vec2 off = dir * uChroma * 0.012 * dist;
        col.r += texture2D(tDiffuse, uv + off).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv - off).b;
      }
      col.rgb /= float(N); col.a = 1.0;
      // drops: slightly darker rims, a specular glint on the upper-left edge
      col.rgb *= 1.0 - dm * 0.12;
      col.rgb += dm * max(0.0, dot(normalize(dr.xy + 1e-4), vec2(-0.6, 0.8))) * 0.08;
      float v = smoothstep(0.95, 0.25, dist * (1.0 + uVignette));
      col.rgb *= mix(1.0, v, uVignette * 1.4);
      col.rgb += (rand(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      col.rgb = mix(col.rgb, vec3(1.0, 0.1, 0.05) * dot(col.rgb, vec3(0.3,0.5,0.2)) * 1.6, uFlash * smoothstep(0.2, 0.8, dist));
      // subtle split-tone grade (linear HDR): cool shadows, warm highlights
      float lum = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));
      col.rgb *= mix(vec3(0.93, 0.98, 1.08), vec3(1.04, 1.0, 0.95), smoothstep(0.02, 0.5, lum));
      float g = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(g) * vec3(0.9, 0.95, 1.1), uGray);
      gl_FragColor = col;
    }`,
};

const _v2 = new THREE.Vector2();

// 512x512 tileable droplet normal map: rg = surface normal (0.5 = flat), b = coverage
function dropTexture() {
  const n = 512, c = document.createElement('canvas'); c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n), d = img.data;
  for (let i = 0; i < n * n; i++) { d[i * 4] = 128; d[i * 4 + 1] = 128; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  let seed = 7;
  const R = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const drop = (cx, cy, rx, ry) => {
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry, r2 = dx * dx + dy * dy;
      if (r2 > 1) continue;
      const px = ((x % n) + n) % n, py = ((y % n) + n) % n, o = (py * n + px) * 4;
      const m = Math.min(1, (1 - r2) * 3);
      d[o] = 128 + dx * 127 * m; d[o + 1] = 128 - dy * 127 * m; d[o + 2] = Math.max(d[o + 2], m * 255);
    }
  };
  for (let i = 0; i < 90; i++) { const r = 2 + R() * R() * 9; drop(R() * n, R() * n, r, r * (0.9 + R() * 0.3)); }
  // a few elongated runs
  for (let i = 0; i < 18; i++) { const x = R() * n, y = R() * n, r = 2 + R() * 3; for (let k = 0; k < 6; k++) drop(x, y + k * r * 1.6, r * (1 - k * 0.1), r * 1.3); }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export class PostFX {
  constructor(renderer, scene, camera, preset) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: preset.antialias === 'msaa' ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    const bloomRes = new THREE.Vector2(size.x, size.y).multiplyScalar(preset.post === 'high' ? 0.5 : 0.35);
    this.bloom = new UnrealBloomPass(bloomRes, preset.post === 'high' ? 0.6 : 0.45, 0.5, 0.9);
    this.composer.addPass(this.bloom);
    this.speed = new ShaderPass(SpeedShader);
    this.composer.addPass(this.speed);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = preset.antialias === 'fxaa';
    this.composer.addPass(this.fxaa);
    this.speed.uniforms.tDrops.value = dropTexture();
    this.preset = preset;
    this.time = 0;
  }
  applyPreset(p) { this.preset = p; this.fxaa.enabled = p.antialias === 'fxaa'; }
  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    const f = this.fxaa.material.uniforms.resolution;
    f.value.set(1 / (w * pr), 1 / (h * pr));
  }
  render(dt, fx) {
    this.time += dt;
    const u = this.speed.uniforms;
    const blur = this.preset.motionBlur ? fx.speed : 0;
    u.uBlur.value = blur;
    u.uChroma.value = this.preset.post === 'high' ? fx.nitro : 0;
    u.uFlash.value = fx.damageFlash;
    u.uTime.value = this.time % 100;
    u.uGray.value = fx.busted;
    u.uRain.value = fx.lensRain || 0;
    u.uRainSpeed.value = Math.min(1, fx.lensWind || 0);
    const sz = this.renderer.getSize(_v2);
    u.uAspect.value = sz.x / Math.max(1, sz.y);
    this.speed.enabled = blur > 0.01 || fx.nitro > 0.01 || fx.damageFlash > 0.01 || fx.busted > 0.01 || true;
    this.bloom.strength = (this.preset.post === 'high' ? 0.6 : 0.45) * (fx.bloomScale ?? 1);
    this.composer.render(dt);
  }
  dispose() { this.composer.dispose(); }
}
