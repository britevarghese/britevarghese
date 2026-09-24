// Pooled combat effects: muzzle flash, tracers, surface-specific impacts (dust/chips, sparks, splinters, dirt,
// grass, blood mist), bullet-hole decals, grenade explosions (flash, fireball, smoke, dust, debris), ambient smoke.
import * as THREE from 'three';

function softTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); draw(g, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const puffTex = softTexture((g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
  // break the perfect circle with noise blobs
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`; g.beginPath(); g.arc(Math.random() * s, Math.random() * s, Math.random() * 10, 0, 7); g.fill(); }
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

const SURF = {
  concrete: { color: 0xb8b2a8, n: 7, speed: 2.2, size: 0.35, chips: 0xcfc8bc, life: 1.1 },
  dirt: { color: 0x7d6a52, n: 8, speed: 2.8, size: 0.45, chips: 0x5b4a38, life: 1.3 },
  sand: { color: 0xb7a17a, n: 8, speed: 2.4, size: 0.45, chips: 0x9a8560, life: 1.3 },
  rock: { color: 0x9a948a, n: 6, speed: 2.4, size: 0.3, chips: 0x777168, life: 1.0 },
  wood: { color: 0x8a6c4a, n: 4, speed: 2.0, size: 0.22, chips: 0xa98456, life: 0.8, splinters: true },
  metal: { color: 0x9a9a9a, n: 2, speed: 1.2, size: 0.12, sparks: true, life: 0.5 },
  rubber: { color: 0x333333, n: 2, speed: 1, size: 0.15, life: 0.5 },
  flesh: { color: 0x6a1010, n: 4, speed: 1.4, size: 0.2, life: 0.35, blood: true },
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
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTex }, scale: { value: innerHeight / 2 }, fogColor: { value: new THREE.Color(0xb9c3c9) }, fogFar: { value: 500 } },
      vertexShader: `attribute float psize; attribute float palpha; varying float vA; varying vec3 vC; varying float vFog; uniform float scale;
        void main(){ vC = color; vA = palpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(psize * scale / max(-mv.z, 0.5), scale * 0.5); vFog = clamp(-mv.z / 450.0, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; varying float vA; varying vec3 vC; varying float vFog;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(mix(vC, fogColor, vFog*0.8), t.a * vA); if (gl_FragColor.a < 0.01) discard; }`,
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
      this.emit(x + n[0] * 0.05, y + n[1] * 0.05, z + n[2] * 0.05, n[0] * sp + (Math.random() - 0.5) * 1.2, n[1] * sp + Math.random() * 0.8, n[2] * sp + (Math.random() - 0.5) * 1.2, s.color, s.size * (0.6 + Math.random() * 0.8), s.life * (0.6 + Math.random() * 0.6), { grow: 2.2, alpha: s.blood ? 0.7 : 0.55, drag: 3.5, grav: 0.25 });
    }
    if (s.chips || s.splinters) for (let i = 0; i < 4 * k; i++) {
      this.emit(x, y, z, n[0] * 3 + (Math.random() - 0.5) * 4, n[1] * 3 + Math.random() * 3, n[2] * 3 + (Math.random() - 0.5) * 4, s.chips, 0.04, 0.6, { grow: 0, alpha: 1, drag: 0.5, grav: 9.8 });
    }
    if (s.sparks) for (let i = 0; i < 10 * k; i++) {
      this.spark(x, y, z, n[0] * 6 + (Math.random() - 0.5) * 8, n[1] * 6 + Math.random() * 5, n[2] * 6 + (Math.random() - 0.5) * 8, 0.15 + Math.random() * 0.25);
    }
    if (surface !== 'flesh' && surface !== 'dirt' && surface !== 'sand') this.decal(point, n, 0.07 + Math.random() * 0.03, this.decalMat);
    else if (surface === 'dirt') this.decal(point, n, 0.12, this.decalMat, 0.5);
    this.audio?.impact(point, surface);
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

  muzzleFlash(pos, dir, big = false) {
    const f = this.flashes.find((x) => x.t <= 0) || this.flashes[0];
    f.sp.position.set(pos.x + dir.x * 0.05, pos.y + dir.y * 0.05, pos.z + dir.z * 0.05);
    f.sp.scale.setScalar(big ? 0.55 : 0.4); f.sp.material.rotation = Math.random() * 6.28; f.t = 0.05; f.sp.visible = true;
    this.flashLight.position.copy(pos); this.flashLight.intensity = 6; this.flashT = 0.05;
    this.emit(pos.x, pos.y, pos.z, dir.x * 1.5, dir.y * 1.5 + 0.3, dir.z * 1.5, 0xa9a49c, 0.18, 0.6, { grow: 3, alpha: 0.18, drag: 2.5, grav: -0.3 });
  }

  explosion(p, camPos) {
    const [x, y, z] = p, k = this.q.particles;
    this.boomLight.position.set(x, y + 1, z); this.boomLight.intensity = 60; this.boomT = 0.25;
    for (let i = 0; i < 14 * k; i++) this.emit(x, y + 0.5, z, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 0xffa040, 1.2 + Math.random(), 0.25 + Math.random() * 0.15, { grow: 3, alpha: 0.9, drag: 5, grav: -1 });
    for (let i = 0; i < 26 * k; i++) this.emit(x + (Math.random() - 0.5), y + 0.4, z + (Math.random() - 0.5), (Math.random() - 0.5) * 7, 1 + Math.random() * 5, (Math.random() - 0.5) * 7, i % 3 ? 0x5c5550 : 0x8a7a66, 1.5 + Math.random() * 1.5, 2.5 + Math.random() * 2.5, { grow: 2.2, alpha: 0.55, drag: 2.2, grav: -0.25 });
    for (let i = 0; i < 16 * k; i++) this.emit(x, y + 0.2, z, (Math.random() - 0.5) * 14, 3 + Math.random() * 8, (Math.random() - 0.5) * 14, 0x3b332c, 0.07, 1.4, { grow: 0, alpha: 1, drag: 0.4, grav: 9.8 });
    for (let i = 0; i < 30 * k; i++) this.spark(x, y + 0.3, z, (Math.random() - 0.5) * 22, Math.random() * 14, (Math.random() - 0.5) * 22, 0.3 + Math.random() * 0.4);
    // dust ring along the ground
    for (let i = 0; i < 16 * k; i++) { const a = (i / 16) * 6.28; this.emit(x, y + 0.2, z, Math.cos(a) * 8, 0.3, Math.sin(a) * 8, 0x9c8a72, 1.2, 1.8, { grow: 2.5, alpha: 0.4, drag: 3, grav: 0 }); }
    this.decal([x, y + 0.02, z], [0, 1, 0], 4.5, this.scorchMat);
    if (camPos) { const d = Math.hypot(camPos.x - x, camPos.y - y, camPos.z - z); this.shake = Math.max(this.shake, Math.max(0, 1 - d / 35) * 1.0); }
  }

  // persistent drifting smoke from burning wrecks to sell the aftermath of combat
  addAmbientSmoke(x, y, z) { this.ambient.push({ x, y, z, acc: Math.random() }); }

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
      a.acc += dt * 2.2 * this.q.particles;
      while (a.acc > 1) { a.acc -= 1; this.emit(a.x + (Math.random() - 0.5) * 0.8, a.y + 0.8, a.z + (Math.random() - 0.5) * 0.8, 0.5 + Math.random() * 0.3, 1.2 + Math.random() * 0.6, 0.2, 0x3a3634, 1.2, 7, { grow: 4, alpha: 0.35, drag: 0.15, grav: -0.05 }); }
    }
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }
}
