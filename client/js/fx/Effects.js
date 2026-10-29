// Pooled combat effects: muzzle flash, tracers, surface-specific impacts (dust/chips, sparks, splinters, dirt,
// grass, blood mist), bullet-hole decals, grenade explosions (flash, fireball, smoke, dust, debris), ambient smoke,
// spent cases (instanced brass with bounces). Registers itself as WeaponModel.sink: guns throw their cases here.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WeaponModel } from '../weapons/WeaponModel.js';

function softTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); draw(g, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// a lumpy puff of dust / smoke: a cluster of soft blobs (not a disc), fine grain on top; each particle shows it
// at its own rotation, so no two puffs look alike
const puffTex = softTexture((g, s) => {
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 14; i++) {
    const a = r() * 6.28, d = r() * s * 0.2, cx = s / 2 + Math.cos(a) * d, cy = s / 2 + Math.sin(a) * d, rad = s * (0.12 + r() * 0.2);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.35 + r() * 0.3})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  const img = g.getImageData(0, 0, s, s);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] *= 0.75 + r() * 0.25;
  g.putImageData(img, 0, 0);
});
const flashTex = softTexture((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,250,220,1)'); gr.addColorStop(0.25, 'rgba(255,190,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { g.save(); g.translate(s / 2, s / 2); g.rotate((i / 6) * Math.PI * 2 + Math.random() * 0.3); g.fillStyle = 'rgba(255,200,120,0.35)'; g.fillRect(0, -2, s / 2, 4); g.restore(); }
});
const holeTex = softTexture((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(10,10,10,1)'); gr.addColorStop(0.18, 'rgba(20,18,16,0.95)'); gr.addColorStop(0.35, 'rgba(60,55,50,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});
const scorchTex = softTexture((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(8,6,5,0.9)'); gr.addColorStop(0.6, 'rgba(20,16,12,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

// ------------------------------------------------------------------ muzzle flash shapes
// side view of the flame (muzzle at u = 0, flame toward u = 1): hot core, orange fringe, ragged edge
const flameTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d'), img = g.createImageData(128, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const u = x / 127, v = (y - 31.5) / 31.5, w = 0.18 + 0.82 * Math.sin(Math.min(1, u * 1.6) * Math.PI * 0.5) * (1 - u * 0.75);
    const ragged = 0.85 + 0.15 * Math.sin(u * 37 + Math.sin(u * 11) * 3);
    const d = Math.abs(v) / (w * ragged), a = Math.max(0, 1 - d) ** 1.3 * (1 - u) ** 0.7;
    const hot = Math.max(0, 1 - d * 1.8) * (1 - u * 1.4);
    const i = (y * 128 + x) * 4;
    img.data[i] = 255; img.data[i + 1] = Math.min(255, 150 + 105 * hot); img.data[i + 2] = Math.min(255, 50 + 200 * hot * hot); img.data[i + 3] = Math.min(255, 255 * a);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
// seen down the bore: a small bright disc with short jets
const starTex = softTexture((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,250,225,1)'); gr.addColorStop(0.18, 'rgba(255,205,120,0.95)'); gr.addColorStop(0.45, 'rgba(255,140,40,0.35)'); gr.addColorStop(1, 'rgba(255,110,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) { g.save(); g.translate(s / 2, s / 2); g.rotate((i / 5) * Math.PI * 2 + 0.3); const j = g.createLinearGradient(0, 0, s / 2, 0); j.addColorStop(0, 'rgba(255,220,150,0.7)'); j.addColorStop(1, 'rgba(255,150,60,0)'); g.fillStyle = j; g.beginPath(); g.moveTo(0, -3); g.lineTo(s / 2, 0); g.lineTo(0, 3); g.fill(); g.restore(); }
});
const flashMat = (map) => new THREE.MeshBasicMaterial({ map, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
const _flameGeo = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0);
// Muzzle flash as seen in first person (built per weapon kind, lives at the viewmodel's muzzle; local -Z = bore):
//  rifle  — A2 birdcage: little forward flame, the gas vents sideways through the slots (short radial jets)
//  pistol — no flash hider: a short round fireball ahead of the muzzle
//  bolt   — long-barrelled 7.62x54R without a hider: a long cone and a big disc
export function makeMuzzleFlash(kind = 'rifle') {
  const P = { rifle: { cone: [0.07, 0.05], jets: 4, jet: [0.05, 0.022], star: 0.08 }, pistol: { cone: [0.07, 0.08], jets: 0, star: 0.1 }, bolt: { cone: [0.22, 0.1], jets: 0, star: 0.18 } }[kind] || {};
  const g = new THREE.Group(), coneMat = flashMat(flameTex), starMat = flashMat(starTex);
  for (let i = 0; i < 2; i++) { // two crossed planes along the bore
    const m = new THREE.Mesh(_flameGeo, coneMat); m.rotation.set(i * Math.PI / 2, Math.PI / 2, 0, 'YXZ'); m.scale.set(P.cone[0], P.cone[1], 1); g.add(m);
  }
  for (let i = 0; i < P.jets; i++) { // side vents, square to the bore
    const a = Math.PI / 2 + (i - (P.jets - 1) / 2) * 0.95, m = new THREE.Mesh(_flameGeo, coneMat);
    m.position.z = -0.012; m.rotation.set(0, 0, a); m.scale.set(P.jet[0], P.jet[1], 1); g.add(m);
  }
  const star = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), starMat); star.scale.setScalar(P.star); star.position.z = -0.01; g.add(star);
  g.star = star; g.visible = false; g.renderOrder = 4;
  g.traverse((o) => { o.frustumCulled = false; });
  return g;
}

// ------------------------------------------------------------------ spent cases (brass)
// lathe profiles [radius, height] in mm from the case head: rim, extractor groove, body, shoulder, neck, mouth
const CASES = {
  556: { n: 48, prof: [[0, 0], [4.78, 0], [4.78, 1.1], [4.15, 1.4], [4.15, 2], [4.75, 2.6], [4.57, 36.5], [3.2, 39.7], [3.2, 44.7], [2.85, 44.7], [2.85, 41]], color: 0xc9a050, rough: 0.3 },
  '9mm': { n: 32, prof: [[0, 0], [4.95, 0], [4.95, 1.2], [4.3, 1.5], [4.3, 2.1], [4.95, 2.6], [4.82, 19.1], [4.5, 19.1], [4.5, 17]], color: 0xc9a050, rough: 0.32 },
  '762r': { n: 16, prof: [[0, 0], [7.2, 0], [7.2, 1.6], [6.25, 1.8], [5.9, 39], [4.25, 44.2], [4.2, 53.7], [3.9, 53.7], [3.9, 50]], color: 0xa7874a, rough: 0.38 }, // (lacquered, duller)
};
function caseGeometry(prof) {
  const pts = prof.map(([r, h]) => new THREE.Vector2(r / 1000, h / 1000)), len = prof[prof.length - 3][1] / 1000;
  // axis along -Z (mouth forward, like the round in the chamber), centred on its middle
  return new THREE.LatheGeometry(pts, 10).rotateX(-Math.PI / 2).translate(0, 0, len / 2);
}
const _bq = new THREE.Quaternion(), _bq2 = new THREE.Quaternion(), _bv = new THREE.Vector3(), _bv2 = new THREE.Vector3(), _bm = new THREE.Matrix4(), _bs = new THREE.Vector3(), _bZ = new THREE.Vector3(0, 0, -1);

const SURF = {
  concrete: { color: 0xb8b2a8, n: 7, speed: 2.2, size: 0.35, chips: 0xcfc8bc, life: 1.1 },
  dirt: { color: 0x7d6a52, n: 8, speed: 2.8, size: 0.45, chips: 0x5b4a38, life: 1.3 },
  sand: { color: 0xb7a17a, n: 8, speed: 2.4, size: 0.45, chips: 0x9a8560, life: 1.3 },
  rock: { color: 0x9a948a, n: 6, speed: 2.4, size: 0.3, chips: 0x777168, life: 1.0 },
  wood: { color: 0x8a6c4a, n: 4, speed: 2.0, size: 0.22, chips: 0xa98456, life: 0.8, splinters: true },
  metal: { color: 0x9a9a9a, n: 2, speed: 1.2, size: 0.12, sparks: true, life: 0.5 },
  rubber: { color: 0x333333, n: 2, speed: 1, size: 0.15, life: 0.5 },
  flesh: { color: 0x7a1612, n: 5, speed: 1.8, size: 0.13, life: 0.25, blood: true },
  none: null,
};

export class Effects {
  constructor(scene, q, audio) {
    this.scene = scene; this.q = q; this.audio = audio;
    const maxP = Math.round(700 * q.particles);
    // particle pool as a single Points cloud with per-particle size/alpha (custom shader)
    this.P = { n: maxP, pos: new Float32Array(maxP * 3), vel: new Float32Array(maxP * 3), col: new Float32Array(maxP * 3), life: new Float32Array(maxP), max: new Float32Array(maxP), size: new Float32Array(maxP), grow: new Float32Array(maxP), alpha: new Float32Array(maxP), drag: new Float32Array(maxP), grav: new Float32Array(maxP), add: new Float32Array(maxP), next: 0 };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.P.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.P.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.aSize = new THREE.BufferAttribute(new Float32Array(maxP), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(maxP), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('psize', this.aSize); geo.setAttribute('palpha', this.aAlpha);
    geo.setAttribute('prot', new THREE.BufferAttribute(Float32Array.from({ length: maxP }, () => Math.random() * 6.283), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTex }, scale: { value: innerHeight / 2 }, fogColor: { value: new THREE.Color(0xb9c3c9) }, fogFar: { value: 500 } },
      vertexShader: `attribute float psize; attribute float palpha; attribute float prot; varying float vA; varying vec3 vC; varying float vFog; varying float vR; uniform float scale;
        void main(){ vC = color; vA = palpha; vR = prot; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(psize * scale / max(-mv.z, 0.5), scale * 0.5); vFog = clamp(-mv.z / 450.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
      // colours are linear (THREE.Color): tone-map and encode like every other material — written raw, dust and
      // blood came out two to three times too dark (black discs on sunlit ground)
      fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; varying float vA; varying vec3 vC; varying float vFog; varying float vR;
        void main(){ vec2 pc = gl_PointCoord - 0.5; float c = cos(vR), s = sin(vR); pc = mat2(c, -s, s, c) * pc + 0.5;
          vec4 t = texture2D(map, clamp(pc, 0.0, 1.0)); gl_FragColor = vec4(mix(vC, fogColor, vFog*0.8), t.a * vA); if (gl_FragColor.a < 0.01) discard;
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    // additive sparks/fire (separate cloud)
    this.sparks = this.#lineSparks();
    // tracers
    this.tracers = [];
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const tg = new THREE.CylinderGeometry(0.012, 0.012, 1, 4, 1, true); tg.rotateX(Math.PI / 2); tg.translate(0, 0, -0.5);
    for (let i = 0; i < 24; i++) { const m = new THREE.Mesh(tg, tracerMat.clone()); m.visible = false; m.frustumCulled = false; scene.add(m); this.tracers.push({ m, t: 0, life: 0, from: new THREE.Vector3(), dir: new THREE.Vector3(), len: 0, dist: 0 }); }
    // muzzle flashes (world, for remote players & third person)
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
      sp.visible = false; scene.add(sp); this.flashes.push({ sp, t: 0 });
    }
    this.flashLight = new THREE.PointLight(0xffaa55, 0, 9, 2); scene.add(this.flashLight);
    this.boomLight = new THREE.PointLight(0xff9944, 0, 30, 2); scene.add(this.boomLight);
    // decals
    this.decals = [];
    const dg = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshStandardMaterial({ map: holeTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.scorchMat = new THREE.MeshStandardMaterial({ map: scorchTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 1 });
    this.decalMax = Math.round(160 * q.particles);
    this.decalGeo = dg; this.decalIdx = 0;
    this.shake = 0;
    this.ambient = [];
    this.#brassSetup();
    this.groundAt = null;    // (x, z, y) -> floor height under a point (set by the game: cases land on the real ground)
    this.onBrassLand = null; // (x, y, z, kind) first bounce of a case (hook for a tinkle sound)
    WeaponModel.sink = this;
  }

  #lineSparks() {
    const n = 200;
    const pos = new Float32Array(n * 6), vel = new Float32Array(n * 3), life = new Float32Array(n);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    m.frustumCulled = false; this.scene.add(m);
    return { m, pos, vel, life, n, next: 0 };
  }

  emit(x, y, z, vx, vy, vz, color, size, life, { grow = 1.5, alpha = 0.8, drag = 2, grav = 1, add = 0 } = {}) {
    const P = this.P, i = P.next; P.next = (P.next + 1) % P.n;
    P.pos[i * 3] = x; P.pos[i * 3 + 1] = y; P.pos[i * 3 + 2] = z;
    P.vel[i * 3] = vx; P.vel[i * 3 + 1] = vy; P.vel[i * 3 + 2] = vz;
    const c = new THREE.Color(color); P.col[i * 3] = c.r; P.col[i * 3 + 1] = c.g; P.col[i * 3 + 2] = c.b;
    P.life[i] = life; P.max[i] = life; P.size[i] = size; P.grow[i] = grow; P.alpha[i] = alpha; P.drag[i] = drag; P.grav[i] = grav;
  }

  spark(x, y, z, vx, vy, vz, life = 0.25) {
    const S = this.sparks, i = S.next; S.next = (S.next + 1) % S.n;
    S.pos.set([x, y, z, x, y, z], i * 6); S.vel.set([vx, vy, vz], i * 3); S.life[i] = life;
  }

  impact(point, normal, surface) {
    const s = SURF[surface]; if (!s) return;
    // never spawn puffs inside the viewer's face (e.g. hits on the local player)
    if (this.camPos && Math.hypot(point[0] - this.camPos.x, point[1] - this.camPos.y, point[2] - this.camPos.z) < 1.2) return;
    const [x, y, z] = point, n = normal || [0, 1, 0];
    const k = this.q.particles;
    for (let i = 0; i < Math.ceil(s.n * k); i++) {
      const sp = s.speed * (0.4 + Math.random());
      this.emit(x + n[0] * 0.05, y + n[1] * 0.05, z + n[2] * 0.05, n[0] * sp + (Math.random() - 0.5) * 1.2, n[1] * sp + Math.random() * 0.8, n[2] * sp + (Math.random() - 0.5) * 1.2, s.color, s.size * (0.6 + Math.random() * 0.8), s.life * (0.6 + Math.random() * 0.6), { grow: s.blood ? 1.2 : 2.2, alpha: s.blood ? 0.6 : 0.55, drag: 3.5, grav: s.blood ? 2 : 0.25 });
    }
    if (s.chips || s.splinters) for (let i = 0; i < 4 * k; i++) {
      this.emit(x, y, z, n[0] * 3 + (Math.random() - 0.5) * 4, n[1] * 3 + Math.random() * 3, n[2] * 3 + (Math.random() - 0.5) * 4, s.chips, 0.04, 0.6, { grow: 0, alpha: 1, drag: 0.5, grav: 9.8 });
    }
    if (s.sparks) for (let i = 0; i < 10 * k; i++) {
      this.spark(x, y, z, n[0] * 6 + (Math.random() - 0.5) * 8, n[1] * 6 + Math.random() * 5, n[2] * 6 + (Math.random() - 0.5) * 8, 0.15 + Math.random() * 0.25);
    }
    if (surface !== 'flesh' && surface !== 'dirt' && surface !== 'sand') this.decal(point, n, 0.07 + Math.random() * 0.03, this.decalMat);
    else if (surface === 'dirt') this.decal(point, n, 0.12, this.decalMat, 0.5);
    // (the impact sound is played by the callers, alongside: every one of them calls audio.impact)
  }

  // shattered window: glittering shards thrown in the direction of the hit + a little dust, falling under gravity
  glass(p, dir, n) {
    const [x, y, z] = p, k = this.q.particles, d = dir || [0, 0, 0];
    for (let i = 0; i < 26 * k; i++) {
      const s = 1.5 + Math.random() * 3.5;
      this.emit(x + (Math.random() - 0.5) * 0.8, y + (Math.random() - 0.5) * 0.9, z + (Math.random() - 0.5) * 0.8,
        d[0] * s + (Math.random() - 0.5) * 2.2, d[1] * s + Math.random() * 1.2, d[2] * s + (Math.random() - 0.5) * 2.2,
        i % 3 ? 0xd8eef2 : 0x9fc4cc, 0.035 + Math.random() * 0.04, 0.9 + Math.random() * 0.6, { grow: 0, alpha: 0.9, drag: 0.4, grav: 9.8, add: i % 4 === 0 ? 1 : 0 });
    }
    for (let i = 0; i < 6 * k; i++) this.spark(x, y, z, d[0] * 3 + (Math.random() - 0.5) * 3, Math.random() * 2, d[2] * 3 + (Math.random() - 0.5) * 3, 0.12);
    for (let i = 0; i < 5 * k; i++) this.emit(x, y, z, (Math.random() - 0.5), 0.3, (Math.random() - 0.5), 0xbfc4c4, 0.5, 1.2, { grow: 2, alpha: 0.18, drag: 2, grav: 0 });
  }

  decal(point, n, size, mat, opacity = 1) {
    let d = this.decals[this.decalIdx];
    if (!d) { d = new THREE.Mesh(this.decalGeo, mat); this.scene.add(d); this.decals[this.decalIdx] = d; }
    d.material = mat;
    d.position.set(point[0] + n[0] * 0.01, point[1] + n[1] * 0.01, point[2] + n[2] * 0.01);
    d.lookAt(d.position.x + n[0], d.position.y + n[1], d.position.z + n[2]);
    d.rotateZ(Math.random() * 6.28);
    d.scale.setScalar(size);
    d.visible = true;
    this.decalIdx = (this.decalIdx + 1) % this.decalMax;
  }

  tracer(from, to, speed = 700) {
    const t = this.tracers.find((x) => x.t <= 0) || this.tracers[0];
    t.from.set(...from); t.dir.set(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    t.dist = t.dir.length(); t.dir.normalize(); t.len = Math.min(6, t.dist * 0.4); t.life = t.dist / speed; t.t = t.life; t.speed = speed;
    t.m.visible = true;
  }

  // big: an unsuppressed full-power rifle / vehicle gun. fp: the viewmodel draws its own flash at its muzzle —
  // here only the light on the surroundings and the smoke
  muzzleFlash(pos, dir, big = false, fp = false) {
    if (!fp) {
      // seen from outside: a short bright star (a flash hider breaks the flame up), larger without one
      const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
      f.sp.position.set(pos.x + dir.x * 0.06, pos.y + dir.y * 0.06, pos.z + dir.z * 0.06);
      f.sp.material.map = big ? flashTex : starTex;
      f.sp.scale.setScalar((big ? 0.5 : 0.26) * (0.8 + Math.random() * 0.4)); f.sp.material.rotation = Math.random() * 6.28; f.t = 0.035; f.sp.visible = true;
    }
    this.flashLight.position.copy(pos); this.flashLight.intensity = big ? 9 : 5; this.flashT = 0.04;
    // a small puff of smoke that drifts off the muzzle (more from the big calibres)
    const n = big ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const s = 0.6 + Math.random() * 0.9 + i * 0.5;
      this.emit(pos.x + dir.x * 0.05, pos.y + dir.y * 0.05, pos.z + dir.z * 0.05, dir.x * s + (Math.random() - 0.5) * 0.3, dir.y * s + 0.25, dir.z * s + (Math.random() - 0.5) * 0.3, 0xb3aea6, big ? 0.22 : 0.12, big ? 1.6 : 0.9, { grow: big ? 4 : 3.5, alpha: big ? 0.3 : 0.2, drag: 2.2, grav: -0.25 });
    }
  }

  explosion(p, camPos) {
    const [x, y, z] = p, k = this.q.particles;
    this.boomLight.position.set(x, y + 1, z); this.boomLight.intensity = 60; this.boomT = 0.25;
    const r = () => Math.random() - 0.5;
    // a hand grenade's fireball is a metre or two across and gone within a tenth of a second
    for (let i = 0; i < 8 * k; i++) this.emit(x + r() * 0.4, y + 0.4, z + r() * 0.4, r() * 4, Math.random() * 3, r() * 4, 0xffb060, 0.5 + Math.random() * 0.5, 0.08 + Math.random() * 0.07, { grow: 2.5, alpha: 0.95, drag: 6, grav: -1 });
    // then a ragged column of dirt and smoke: dark grey-brown, mixed sizes, mostly thrown up, some sideways (a cloud
    // of equal puffs flying out evenly reads as a smooth dome)
    for (let i = 0; i < 30 * k; i++) {
      const up = Math.random(), side = 6 * (1 - up * 0.7);
      this.emit(x + r() * 1.2, y + 0.3 + up * 0.6, z + r() * 1.2, r() * side, 1.5 + up * 7.5, r() * side, i % 3 ? 0x4e4740 : 0x6e6252, 0.6 + Math.random() * 1.7, 2 + Math.random() * 3, { grow: 1.4 + Math.random() * 1.2, alpha: 0.45 + Math.random() * 0.3, drag: 2.4, grav: -0.15 });
    }
    for (let i = 0; i < 16 * k; i++) this.emit(x, y + 0.2, z, (Math.random() - 0.5) * 14, 3 + Math.random() * 8, (Math.random() - 0.5) * 14, 0x3b332c, 0.07, 1.4, { grow: 0, alpha: 1, drag: 0.4, grav: 9.8 });
    for (let i = 0; i < 30 * k; i++) this.spark(x, y + 0.3, z, (Math.random() - 0.5) * 22, Math.random() * 14, (Math.random() - 0.5) * 22, 0.3 + Math.random() * 0.4);
    // dust ring along the ground
    for (let i = 0; i < 16 * k; i++) { const a = (i / 16) * 6.28 + r() * 0.3, v = 5 + Math.random() * 5; this.emit(x, y + 0.2, z, Math.cos(a) * v, 0.3 + Math.random() * 0.5, Math.sin(a) * v, 0x9c8a72, 0.7 + Math.random() * 0.8, 1.4 + Math.random() * 0.8, { grow: 2.2, alpha: 0.35, drag: 3, grav: 0 }); }
    this.decal([x, y + 0.02, z], [0, 1, 0], 4.5, this.scorchMat);
    if (camPos) { const d = Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z); this.shake = Math.max(this.shake, Math.max(0, 1 - d / 35) * 1.0); }
  }

  // persistent drifting smoke from burning wrecks to sell the aftermath of combat
  addAmbientSmoke(x, y, z, opts = {}) { const h = { x, y, z, acc: Math.random(), ...opts }; this.ambient.push(h); return h; }
  removeAmbientSmoke(h) { this.ambient = this.ambient.filter((a) => a !== h); }

  update(dt) {
    const P = this.P;
    for (let i = 0; i < P.n; i++) {
      if (P.life[i] <= 0) { this.aAlpha.array[i] = 0; continue; }
      P.life[i] -= dt;
      const dr = Math.exp(-P.drag[i] * dt);
      P.vel[i * 3] *= dr; P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * dr - P.grav[i] * dt; P.vel[i * 3 + 2] *= dr;
      P.pos[i * 3] += P.vel[i * 3] * dt; P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt; P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
      const t = 1 - P.life[i] / P.max[i];
      this.aSize.array[i] = P.size[i] * (1 + P.grow[i] * t);
      this.aAlpha.array[i] = P.alpha[i] * Math.min(1, (1 - t) * 1.6) * Math.min(1, t * 12 + 0.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
    this.points.material.uniforms.scale.value = innerHeight / 2;
    const S = this.sparks;
    for (let i = 0; i < S.n; i++) {
      if (S.life[i] <= 0) { S.pos.fill(0, i * 6, i * 6 + 6); continue; }
      S.life[i] -= dt; S.vel[i * 3 + 1] -= 9.8 * dt;
      for (let k = 0; k < 3; k++) { S.pos[i * 6 + k] = S.pos[i * 6 + 3 + k]; S.pos[i * 6 + 3 + k] += S.vel[i * 3 + k] * dt * 1.4; }
    }
    S.m.geometry.attributes.position.needsUpdate = true;
    for (const t of this.tracers) {
      if (t.t <= 0) { t.m.visible = false; continue; }
      t.t -= dt;
      const travelled = (1 - t.t / t.life) * t.dist;
      t.m.position.copy(t.from).addScaledVector(t.dir, Math.min(t.dist, travelled + t.len));
      t.m.lookAt(t.m.position.clone().add(t.dir));
      t.m.scale.set(1, 1, Math.min(t.len, travelled + t.len));
    }
    for (const f of this.flashes) { if (f.t > 0) { f.t -= dt; if (f.t <= 0) f.sp.visible = false; } }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flashLight.intensity = 0; }
    if (this.boomT > 0) { this.boomT -= dt; this.boomLight.intensity = Math.max(0, this.boomT / 0.25) * 60; }
    for (const a of this.ambient) {
      a.acc += dt * (a.rate || 2.2) * this.q.particles;
      while (a.acc > 1) { a.acc -= 1; this.emit(a.x + (Math.random() - 0.5) * 0.8, a.y + 0.8, a.z + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.3, (a.rise || 1.2) + Math.random() * 0.6, 0.2, a.color ?? 0x3a3634, a.size || 1.2, 7, { grow: 4, alpha: a.alpha || 0.35, drag: 0.15, grav: -0.05 }); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.#brassUpdate(dt);
  }

  // ---------------------------------------------------------------- spent cases
  // one InstancedMesh per calibre (+ stripper clips, grenade spoons), ring-buffer pools: thrown out with the
  // ejection velocity + the shooter's own, tumbling, a couple of bounces, then they lie on the ground for a
  // while and sink away. Cost: a few matrix composes per live case; nothing at all when none are flying.
  #brassSetup() {
    this.brassK = {};
    const pool = (kind, geo, mat, n, flat = false) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.count = 0; m.visible = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.add(m);
      geo.computeBoundingBox();
      const s = geo.boundingBox.getSize(new THREE.Vector3());
      this.brassK[kind] = { m, n, next: 0, flat, r: flat ? Math.min(s.x, s.y, s.z) / 2 : Math.min(s.x, s.y) / 2,
        pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), q: new Float32Array(n * 4), qr: new Float32Array(n * 4), w: new Float32Array(n * 3),
        st: new Uint8Array(n), t: new Float32Array(n), gy: new Float32Array(n), hits: new Uint8Array(n) };
    };
    for (const [k, d] of Object.entries(CASES)) pool(k, caseGeometry(d.prof), new THREE.MeshStandardMaterial({ color: d.color, metalness: 1, roughness: d.rough }), d.n);
    pool('clip', new THREE.BoxGeometry(0.016, 0.058, 0.0035), new THREE.MeshStandardMaterial({ color: 0x45433e, metalness: 0.8, roughness: 0.5 }), 4, true);
    // M67 safety lever: a bent strip
    const spoon = new THREE.BoxGeometry(0.013, 0.07, 0.0016).translate(0, -0.03, 0);
    const hook = new THREE.BoxGeometry(0.013, 0.016, 0.0016).rotateX(-1.2).translate(0, 0.009, 0.006);
    pool('spoon', mergeGeometries([spoon.toNonIndexed(), hook.toNonIndexed()]), new THREE.MeshStandardMaterial({ color: 0x4d5238, metalness: 0.5, roughness: 0.6 }), 6, true);
  }

  // pos / vel (world), kind ('556' | '9mm' | '762r' | 'clip' | 'spoon'), q: orientation at the port (bore along -Z)
  brass(pos, vel, kind, q) {
    const K = this.brassK[kind];
    if (!K || (this.camPos && pos.distanceToSquared(this.camPos) > 35 * 35)) return;
    const i = K.next; K.next = (K.next + 1) % K.n;
    K.pos[i * 3] = pos.x; K.pos[i * 3 + 1] = pos.y; K.pos[i * 3 + 2] = pos.z;
    K.vel[i * 3] = vel.x; K.vel[i * 3 + 1] = vel.y; K.vel[i * 3 + 2] = vel.z;
    q.toArray(K.q, i * 4);
    // tumbling end over end (spin about an axis across the case) with some wobble
    const sp = kind === 'clip' || kind === 'spoon' ? 14 : 28 + Math.random() * 22;
    _bv.set(Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.3).normalize().applyQuaternion(q).multiplyScalar(sp);
    K.w[i * 3] = _bv.x; K.w[i * 3 + 1] = _bv.y; K.w[i * 3 + 2] = _bv.z;
    // ground under the landing point (one query per case)
    const tf = (vel.y + Math.sqrt(vel.y * vel.y + 2 * 9.81 * 1.6)) / 9.81;
    const gx = pos.x + vel.x * tf, gz = pos.z + vel.z * tf;
    K.gy[i] = this.groundAt ? this.groundAt(gx, gz, pos.y) : 0;
    K.st[i] = 1; K.t[i] = 0; K.hits[i] = 0;
  }

  #brassUpdate(dt) {
    for (const kind in this.brassK) {
      const K = this.brassK[kind];
      let hi = -1;
      for (let i = 0; i < K.n; i++) {
        const st = K.st[i];
        if (!st) continue;
        const p = i * 3;
        K.t[i] += dt;
        let scale = 1;
        if (st === 1) {
          K.vel[p + 1] -= 9.81 * dt;
          const drag = Math.exp(-0.4 * dt);
          K.vel[p] *= drag; K.vel[p + 2] *= drag;
          K.pos[p] += K.vel[p] * dt; K.pos[p + 1] += K.vel[p + 1] * dt; K.pos[p + 2] += K.vel[p + 2] * dt;
          // integrate the spin
          _bv.set(K.w[p], K.w[p + 1], K.w[p + 2]);
          const ang = _bv.length() * dt;
          if (ang > 1e-5) { _bq2.setFromAxisAngle(_bv.normalize(), ang); _bq.fromArray(K.q, i * 4).premultiply(_bq2).normalize().toArray(K.q, i * 4); }
          const floor = K.gy[i] + K.r;
          if (K.pos[p + 1] < floor && K.vel[p + 1] < 0) {
            // bounce: brass rings off hard ground, loses most of its energy, skitters sideways
            K.pos[p + 1] = floor;
            K.vel[p + 1] *= -0.32; K.vel[p] = K.vel[p] * 0.5 + (Math.random() - 0.5) * 0.4; K.vel[p + 2] = K.vel[p + 2] * 0.5 + (Math.random() - 0.5) * 0.4;
            for (let k = 0; k < 3; k++) K.w[p + k] = K.w[p + k] * 0.45 + (Math.random() - 0.5) * 8;
            if (!K.hits[i]++) this.onBrassLand?.(K.pos[p], K.pos[p + 1], K.pos[p + 2], kind);
            if (K.vel[p + 1] < 0.45 || K.hits[i] > 3) {
              // come to rest lying on its side (cases) / flat (clip, spoon), roughly where it was pointing
              K.st[i] = 2; K.t[i] = 0;
              _bq.fromArray(K.q, i * 4);
              if (K.flat) { _bv.set(0, 0, 1).applyQuaternion(_bq); _bq2.setFromUnitVectors(_bv, _bv2.set(0, Math.sign(_bv.y) || 1, 0)).multiply(_bq); }
              else { _bv.copy(_bZ).applyQuaternion(_bq); _bv.y = 0; if (_bv.lengthSq() < 1e-4) _bv.set(1, 0, 0); _bq2.setFromUnitVectors(_bZ, _bv.normalize()); }
              _bq2.toArray(K.qr, i * 4);
            }
          }
        } else {
          // resting: settle onto its side, lie there ~6 s, then sink into the ground
          _bq.fromArray(K.q, i * 4).slerp(_bq2.fromArray(K.qr, i * 4), Math.min(1, dt * 18)).toArray(K.q, i * 4);
          K.pos[p + 1] = K.gy[i] + K.r;
          const fade = Math.max(0, (K.t[i] - 6) / 1.5);
          if (fade >= 1) { K.st[i] = 0; continue; }
          K.pos[p + 1] -= fade * K.r * 2.5; scale = 1 - fade * 0.6;
        }
        _bm.compose(_bv.set(K.pos[p], K.pos[p + 1], K.pos[p + 2]), _bq.fromArray(K.q, i * 4), _bs.setScalar(scale));
        K.m.setMatrixAt(i, _bm);
        hi = i;
      }
      // inactive slots below the highest live one are drawn as nothing
      if (hi >= 0) for (let i = 0; i < hi; i++) if (!K.st[i]) K.m.setMatrixAt(i, _bm.makeScale(0, 0, 0));
      K.m.count = hi + 1; K.m.visible = hi >= 0;
      if (hi >= 0) K.m.instanceMatrix.needsUpdate = true;
    }
  }
}
