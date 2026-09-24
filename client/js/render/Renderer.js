// Renderer + daylight lighting model: HDRI sky/IBL, directional sun with camera-following soft shadows,
// hemisphere fill, atmospheric fog, ACES tone mapping. LOW / MEDIUM quality presets.
import * as THREE from 'three';

export const QUALITY = {
  low: { pixelRatio: 0.8, shadowSize: 1024, shadowRange: 38, shadowType: THREE.PCFShadowMap, antialias: false, fogFar: 380, anisotropy: 2, particles: 0.5, maxDpr: 1 },
  medium: { pixelRatio: 1, shadowSize: 2048, shadowRange: 70, shadowType: THREE.PCFSoftShadowMap, antialias: true, fogFar: 520, anisotropy: 4, particles: 1, maxDpr: 1.5 },
};

export function createRenderer(canvasParent, qualityName) {
  const q = QUALITY[qualityName] || QUALITY.medium;
  const renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.maxDpr) * q.pixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = q.shadowType;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvasParent.appendChild(renderer.domElement);
  return { renderer, q };
}

export class Lighting {
  constructor(scene, q) {
    this.q = q;
    this.sunDir = new THREE.Vector3(-0.45, 0.62, 0.38).normalize();
    this.sun = new THREE.DirectionalLight(0xffeedd, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
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
    scene.fog = new THREE.Fog(0xbac4cb, 70, q.fogFar);
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
  follow(camPos) {
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
