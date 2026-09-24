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
    uGray: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uBlur, uChroma, uVignette, uFlash, uTime, uGrain, uGray; uniform vec2 uCenter;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 dir = vUv - uCenter;
      float dist = length(dir);
      float amt = uBlur * smoothstep(0.12, 0.75, dist);
      vec4 col = vec4(0.0);
      const int N = 8;
      for (int i = 0; i < N; i++) {
        float t = float(i) / float(N - 1);
        vec2 uv = vUv - dir * amt * t * 0.12;
        vec2 off = dir * uChroma * 0.012 * dist;
        col.r += texture2D(tDiffuse, uv + off).r;
        col.g += texture2D(tDiffuse, uv).g;
        col.b += texture2D(tDiffuse, uv - off).b;
      }
      col.rgb /= float(N); col.a = 1.0;
      float v = smoothstep(0.95, 0.25, dist * (1.0 + uVignette));
      col.rgb *= mix(1.0, v, uVignette * 1.4);
      col.rgb += (rand(vUv * 1000.0 + uTime) - 0.5) * uGrain;
      col.rgb = mix(col.rgb, vec3(1.0, 0.1, 0.05) * dot(col.rgb, vec3(0.3,0.5,0.2)) * 1.6, uFlash * smoothstep(0.2, 0.8, dist));
      float g = dot(col.rgb, vec3(0.299, 0.587, 0.114));
      col.rgb = mix(col.rgb, vec3(g) * vec3(0.9, 0.95, 1.1), uGray);
      gl_FragColor = col;
    }`,
};

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
    this.speed.enabled = blur > 0.01 || fx.nitro > 0.01 || fx.damageFlash > 0.01 || fx.busted > 0.01 || true;
    this.bloom.strength = (this.preset.post === 'high' ? 0.6 : 0.45) * (fx.bloomScale ?? 1);
    this.composer.render(dt);
  }
  dispose() { this.composer.dispose(); }
}
