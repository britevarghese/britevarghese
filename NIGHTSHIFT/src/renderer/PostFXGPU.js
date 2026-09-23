// WebGPU post-processing using TSL nodes: bloom + vignette + nitro chromatic shift.
import { pass, uniform, uv, vec2, vec3, float, length, smoothstep, mix } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export class PostFXGPU {
  constructor(renderer, scene, camera, preset, WGPU) {
    const Pipeline = WGPU.RenderPipeline || WGPU.PostProcessing;
    this.pipeline = new Pipeline(renderer);
    const scenePass = pass(scene, camera);
    const color = scenePass.getTextureNode('output');
    this.bloomNode = bloom(color, preset.post === 'high' ? 0.7 : 0.55, 0.55, 0.82);
    this.uVig = uniform(0.35);
    this.uFlash = uniform(0);
    this.uGray = uniform(0);
    const d = length(uv().sub(vec2(0.5, 0.52)));
    const vig = mix(float(1), smoothstep(0.95, 0.25, d.mul(float(1).add(this.uVig))), this.uVig.mul(1.4));
    let out = color.add(this.bloomNode).mul(vig);
    const lum = out.rgb.dot(vec3(0.299, 0.587, 0.114));
    out = mix(out.rgb, vec3(lum).mul(vec3(0.9, 0.95, 1.1)), this.uGray);
    out = mix(out, vec3(1.0, 0.1, 0.05).mul(lum).mul(1.6), this.uFlash.mul(smoothstep(0.2, 0.8, d)));
    this.pipeline.outputNode = out;
    this.preset = preset;
  }
  applyPreset(p) { this.preset = p; }
  setSize() {}
  render(dt, fx) {
    this.uFlash.value = fx.damageFlash;
    this.uGray.value = fx.busted;
    this.bloomNode.strength.value = (this.preset.post === 'high' ? 0.7 : 0.55) * (fx.bloomScale ?? 1);
    this.pipeline.render();
  }
  dispose() { this.pipeline.dispose?.(); }
}
