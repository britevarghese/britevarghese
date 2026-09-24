// Renderer + daylight lighting model: HDRI sky/IBL, directional sun with camera-following soft shadows,
// hemisphere fill, atmospheric fog, ACES tone mapping. LOW / MEDIUM quality presets.
import * as THREE from 'three';
import { ACTIVE_MAP } from '/shared/map.js';

// shadowEvery: refresh the (camera-following) sun shadow map every N frames. minScale/maxScale bound the
// automatic resolution scaling that keeps the frame rate up on weak GPUs.
export const QUALITY = {
  verylow: { pixelRatio: 0.7, shadowSize: 0, shadowRange: 0, shadowType: THREE.BasicShadowMap, antialias: false, fogFar: 300, anisotropy: 1, particles: 0.35, maxDpr: 1, shadowEvery: 0, minScale: 0.45, veg: 'verylow' },
  low: { pixelRatio: 0.85, shadowSize: 1024, shadowRange: 36, shadowType: THREE.PCFShadowMap, antialias: false, fogFar: 360, anisotropy: 2, particles: 0.5, maxDpr: 1, shadowEvery: 3, minScale: 0.5, veg: 'low' },
  medium: { pixelRatio: 1, shadowSize: 2048, shadowRange: 60, shadowType: THREE.PCFSoftShadowMap, antialias: true, fogFar: 480, anisotropy: 4, particles: 1, maxDpr: 1.25, shadowEvery: 2, minScale: 0.6, veg: 'medium' },
};

// Keeps frame time near the target by scaling the render resolution (only the 3D view; HUD stays sharp).
export class DynamicResolution {
  constructor(renderer, q) {
    this.r = renderer; this.q = q;
    this.max = Math.min(devicePixelRatio, q.maxDpr) * q.pixelRatio;
    this.min = Math.max(0.35, q.minScale * Math.min(devicePixelRatio, 1));
    this.scale = this.max;
    this.acc = 0; this.n = 0; this.cool = 0;
    this.enabled = localStorage.getItem('sp_dynres') !== '0';
  }
  frame(dtMs) {
    if (!this.enabled) return;
    this.acc += dtMs; this.n++;
    if (this.acc < 700) return;
    const avg = this.acc / this.n; this.acc = 0; this.n = 0;
    if (this.cool-- > 0) return;
    let s = this.scale;
    if (avg > 22) s -= avg > 40 ? 0.15 : 0.08;       // below ~45 fps: drop resolution
    else if (avg < 14.5) s += 0.05;                   // above ~68 fps: sharpen again
    s = Math.max(this.min, Math.min(this.max, s));
    if (Math.abs(s - this.scale) > 0.01) { this.scale = s; this.r.setPixelRatio(s); this.cool = 1; }
  }
}

export function createRenderer(canvasParent, qualityName) {
  const q = QUALITY[qualityName] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxDpr) * q.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = q.shadowSize > 0;
  renderer.shadowMap.type = q.shadowType;
  renderer.shadowMap.autoUpdate = false; // refreshed every q.shadowEvery frames (see Lighting.follow)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasParent.appendChild(renderer.domElement);
  return { renderer, q };
}

export class Lighting {
  constructor(scene, q) {
    this.q = q;
    const atm = ACTIVE_MAP.atmosphere || {};
    this.sunDir = new THREE.Vector3(...(atm.sun || [-0.45, 0.62, 0.38])).normalize();
    this.sun = new THREE.DirectionalLight(0xffeedd, 3.1);
    this.sun.castShadow = q.shadowSize > 0;
    this.sun.shadow.mapSize.set(Math.max(q.shadowSize, 256), Math.max(q.shadowSize, 256));
    this.frameN = 0;
    const r = q.shadowRange;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 400 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 2.5;
    this.target = new THREE.Object3D();
    this.sun.target = this.target;
    this.hemi = new THREE.HemisphereLight(0xcfdcf0, 0x5b5040, 0.6);
    scene.add(this.sun, this.target, this.hemi);
    // haze colour matched to the HDRI horizon
    scene.fog = new THREE.Fog(atm.fog ?? 0xbac4cb, atm.fogNear ?? 70, q.fogFar * (atm.fogFar ?? 1));
    this.exposure = atm.exposure ?? 0.95;
    // low sun = warmer light
    if (this.sunDir.y < 0.45) this.sun.color.setHex(0xffdcb8);
    this.scene = scene;
  }

  setEnvironment(env, background) {
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.7;
    this.scene.background = background;
    this.scene.backgroundBlurriness = 0.0;
    this.scene.backgroundIntensity = 0.95;
  }

  // keep the shadow frustum centred on the camera, snapped to shadow texels to avoid shimmering
  follow(camPos, renderer) {
    if (!this.q.shadowRange) return;
    // only move the shadow frustum on frames where the shadow map is re-rendered (otherwise shadows would slide)
    if (renderer && this.q.shadowEvery && ++this.frameN % this.q.shadowEvery !== 0 && this.frameN > 2) return;
    if (renderer) renderer.shadowMap.needsUpdate = true;
    const r = this.q.shadowRange;
    const texel = (2 * r) / this.q.shadowSize;
    const c = camPos.clone();
    const lightRot = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0));
    const inv = lightRot.clone().invert();
    c.applyMatrix4(inv);
    c.x = Math.round(c.x / texel) * texel; c.y = Math.round(c.y / texel) * texel;
    c.applyMatrix4(lightRot);
    this.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 180);
    this.target.updateMatrixWorld();
  }
}
