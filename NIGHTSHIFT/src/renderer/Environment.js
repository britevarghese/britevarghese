// Environment: time-of-day controller, sky dome (gradient + stars + moon + clouds), fog,
// sun/moon light with player-following shadows, procedural reflection cubemap, and weather
// (clear / cloudy / rain with GPU-friendly rain streaks and wet roads).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, rng } from '../core/util.js';
import { moonTex, cloudTex, radialGlow } from './Textures.js';

// keyframes by hour
const KEYS = [
  { h: 0, skyTop: '#02040b', skyHor: '#161c2a', glow: '#3a2418', sun: '#8fa8e0', sunI: 0.28, hemiS: '#1c2940', hemiG: '#07080c', hemiI: 0.55, fog: '#0a0e16', exp: 1.0, night: 1 },
  { h: 5.2, skyTop: '#060a18', skyHor: '#2a2436', glow: '#5a3020', sun: '#8fa8e0', sunI: 0.25, hemiS: '#23304a', hemiG: '#0a0a0e', hemiI: 0.6, fog: '#141824', exp: 1.0, night: 0.9 },
  { h: 6.5, skyTop: '#3a5a8a', skyHor: '#e8a070', glow: '#ff9a50', sun: '#ffb070', sunI: 1.6, hemiS: '#8aa0c0', hemiG: '#3a3028', hemiI: 0.9, fog: '#9a8a88', exp: 0.9, night: 0.35 },
  { h: 9, skyTop: '#3a6ab0', skyHor: '#b8cce0', glow: '#fff0d0', sun: '#fff2dc', sunI: 2.6, hemiS: '#a8c4e8', hemiG: '#4a4438', hemiI: 1.1, fog: '#a8b8c8', exp: 0.85, night: 0 },
  { h: 13, skyTop: '#2e62b0', skyHor: '#c0d4e8', glow: '#ffffff', sun: '#ffffff', sunI: 3.0, hemiS: '#b0cce8', hemiG: '#50483c', hemiI: 1.15, fog: '#b0c0d0', exp: 0.8, night: 0 },
  { h: 17, skyTop: '#3a5c98', skyHor: '#e0c0a0', glow: '#ffc080', sun: '#ffd0a0', sunI: 2.2, hemiS: '#a0b0d0', hemiG: '#4a3c30', hemiI: 1.0, fog: '#b0a8a0', exp: 0.85, night: 0.05 },
  { h: 18.6, skyTop: '#2a2c58', skyHor: '#f07848', glow: '#ff6a30', sun: '#ff8a50', sunI: 1.3, hemiS: '#6a6090', hemiG: '#2a2020', hemiI: 0.8, fog: '#6a5058', exp: 0.95, night: 0.5 },
  { h: 19.8, skyTop: '#0a0e24', skyHor: '#3a2a40', glow: '#a04830', sun: '#9ab0e0', sunI: 0.35, hemiS: '#2a3450', hemiG: '#0a0a10', hemiI: 0.6, fog: '#161826', exp: 1.0, night: 0.9 },
  { h: 24, skyTop: '#02040b', skyHor: '#161c2a', glow: '#3a2418', sun: '#8fa8e0', sunI: 0.28, hemiS: '#1c2940', hemiG: '#07080c', hemiI: 0.55, fog: '#0a0e16', exp: 1.0, night: 1 },
];
export const TIME_PRESETS = { morning: 7.2, day: 13, evening: 18.7, night: 23.3 };

const c1 = new THREE.Color(), c2 = new THREE.Color();
function lerpColor(a, b, t, out) { c1.set(a); c2.set(b); return out.copy(c1).lerp(c2, t); }

export class Environment {
  constructor(scene, renderer, preset) {
    this.scene = scene;
    this.renderer = renderer;
    this.preset = preset;
    this.hour = TIME_PRESETS.night;
    this.mode = 'night';
    this.weather = 'clear';
    this.targetWeather = 'clear';
    this.rain = 0; this.cloud = 0.15; this.wetness = 0;
    this.listeners = [];
    this.state = { night: 1 };
    this._colors = { skyTop: new THREE.Color(), skyHor: new THREE.Color(), glow: new THREE.Color(), sun: new THREE.Color(), hemiS: new THREE.Color(), hemiG: new THREE.Color(), fog: new THREE.Color() };

    // lights
    this.hemi = new THREE.HemisphereLight(0x1c2940, 0x07080c, 0.55);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0x8fa8e0, 0.3);
    this.sun.castShadow = preset.shadows !== 'off';
    this._configureShadow();
    scene.add(this.sun, this.sun.target);
    // fog
    scene.fog = new THREE.FogExp2(0x0a0e16, 0.002);
    this._buildSky();
    this._buildRain();
    this.envCanvasKey = '';
    this.update(0, new THREE.Vector3(), true);
  }

  onChange(fn) { this.listeners.push(fn); }

  _configureShadow() {
    const s = this.sun.shadow;
    const size = this.preset.shadowMapSize || 1024;
    s.mapSize.set(size, size);
    const r = this.preset.shadows === 'high' ? 70 : 45;
    s.camera.left = -r; s.camera.right = r; s.camera.top = r; s.camera.bottom = -r;
    s.camera.near = 1; s.camera.far = 400;
    s.bias = -0.0004; s.normalBias = 0.04;
    s.camera.updateProjectionMatrix();
    s.map?.dispose(); s.map = null;
  }

  applyPreset(p) {
    this.preset = p;
    this.sun.castShadow = p.shadows !== 'off';
    this._configureShadow();
    this._rebuildRainCount();
    this.envCanvasKey = '';
  }

  setTimeMode(mode) {
    this.mode = mode;
    if (TIME_PRESETS[mode] !== undefined) this.hour = TIME_PRESETS[mode];
    this.envCanvasKey = '';
  }
  setWeather(w) { this.targetWeather = w; }

  // ------------------------------------------------------------------ sky
  _buildSky() {
    const geo = new THREE.SphereGeometry(4000, 48, 24);
    const col = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    // stars
    const R = rng(3);
    const N = 1800;
    const sp = new Float32Array(N * 3), sc = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = R() * Math.PI * 2, e = Math.asin(0.08 + R() * 0.92);
      const r = 3800;
      sp[i * 3] = Math.cos(a) * Math.cos(e) * r; sp[i * 3 + 1] = Math.sin(e) * r; sp[i * 3 + 2] = Math.sin(a) * Math.cos(e) * r;
      const b = 0.4 + R() * 0.6; const t = R();
      sc[i * 3] = b * (t < 0.2 ? 1 : 0.85); sc[i * 3 + 1] = b * 0.9; sc[i * 3 + 2] = b * (t > 0.8 ? 1 : 0.95);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    this.starMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 1, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    this.scene.add(this.stars);
    // moon & sun sprites
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex(), fog: false, depthWrite: false, transparent: true, color: 0xffffff }));
    this.moon.scale.setScalar(420); this.moon.renderOrder = -8;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlow('rgba(255,250,235,1)', 'rgba(255,200,140,0.35)'), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(700); this.sunSprite.renderOrder = -8;
    this.scene.add(this.moon, this.sunSprite);
    // cloud layer (big textured plane high above, follows camera)
    const ct = cloudTex();
    ct.repeat.set(3, 3);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.4, fog: false, depthWrite: false, color: 0x303848 });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), this.cloudMat);
    this.clouds.rotation.x = Math.PI / 2;
    this.clouds.position.y = 600; this.clouds.renderOrder = -7; this.clouds.frustumCulled = false;
    this.scene.add(this.clouds);
  }

  _paintSky(C, sunDir) {
    const geo = this.sky.geometry;
    const pos = geo.attributes.position, col = geo.attributes.color;
    const v = new THREE.Vector3(), c = new THREE.Color();
    const cloudDim = 1 - this.cloud * 0.45;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const e = Math.max(0, v.y);
      c.copy(C.skyHor).lerp(C.skyTop, Math.pow(smoothstep(0, 0.55, e), 0.8));
      // horizon glow towards the sun + city light pollution (warm) all around at night
      const toward = Math.max(0, v.dot(sunDir));
      const g = Math.pow(toward, 6) * smoothstep(0.5, 0, e) * (1 - this.state.night * 0.6);
      c.lerp(C.glow, clamp(g, 0, 1));
      const pollution = this.state.night * smoothstep(0.25, 0, e) * 0.5;
      c.r += 0.09 * pollution; c.g += 0.055 * pollution; c.b += 0.035 * pollution;
      if (v.y < 0) c.copy(C.fog);
      c.multiplyScalar(cloudDim + (1 - cloudDim) * 0.3);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  // ------------------------------------------------------------------ reflection cubemap
  _paintEnvMap(C) {
    const n = this.preset.envMapSize;
    const night = this.state.night;
    const key = `${n}:${Math.round(night * 10)}:${Math.round(this.hour)}:${Math.round(this.cloud * 4)}`;
    if (key === this.envCanvasKey) return;
    this.envCanvasKey = key;
    const R = rng(42);
    const faces = [];
    for (let f = 0; f < 6; f++) {
      const cv = document.createElement('canvas'); cv.width = cv.height = n;
      const ctx = cv.getContext('2d');
      if (f === 2) { // +Y sky
        ctx.fillStyle = '#' + C.skyTop.getHexString(); ctx.fillRect(0, 0, n, n);
      } else if (f === 3) { // -Y ground
        ctx.fillStyle = night > 0.5 ? '#0b0b0d' : '#3a3a3c'; ctx.fillRect(0, 0, n, n);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, n);
        g.addColorStop(0, '#' + C.skyTop.getHexString());
        g.addColorStop(0.46, '#' + C.skyHor.getHexString());
        g.addColorStop(0.5, night > 0.5 ? '#1a1410' : '#6a6a68');
        g.addColorStop(1, night > 0.5 ? '#050506' : '#303032');
        ctx.fillStyle = g; ctx.fillRect(0, 0, n, n);
        // city silhouette with lit windows along the horizon
        const base = n * 0.5;
        for (let x = 0; x < n; x += n / 24) {
          const h = n * (0.04 + R() * 0.18);
          ctx.fillStyle = night > 0.5 ? '#07080a' : '#58606a';
          ctx.fillRect(x, base - h, n / 24 + 1, h);
          if (night > 0.3) {
            for (let k = 0; k < 8; k++) {
              ctx.fillStyle = R() < 0.5 ? `rgba(255,${190 + R() * 50 | 0},${120 + R() * 80 | 0},${0.6 * night})` : `rgba(180,210,255,${0.4 * night})`;
              ctx.fillRect(x + R() * n / 24, base - R() * h, Math.max(1, n / 128), Math.max(1, n / 128));
            }
          }
        }
        // street light glows (these make car paint sparkle at night)
        if (night > 0.3) {
          for (let k = 0; k < 14; k++) {
            const x = R() * n, y = base - n * (0.02 + R() * 0.08), r = n * (0.03 + R() * 0.05);
            const gg = ctx.createRadialGradient(x, y, 0, x, y, r);
            const warm = R() < 0.7;
            gg.addColorStop(0, warm ? `rgba(255,200,140,${night})` : `rgba(160,200,255,${night})`); gg.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
          }
          // a couple of overhead light bars (tunnel/lamp reflections on roofs)
          ctx.fillStyle = `rgba(255,220,170,${0.35 * night})`;
          ctx.fillRect(n * 0.3, n * 0.08, n * 0.4, n * 0.02);
        } else {
          // soft sun bounce
          const gg = ctx.createRadialGradient(n / 2, n * 0.2, 0, n / 2, n * 0.2, n * 0.6);
          gg.addColorStop(0, 'rgba(255,255,255,0.45)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gg; ctx.fillRect(0, 0, n, n);
        }
      }
      faces.push(cv);
    }
    if (this.envMap) this.envMap.dispose();
    const cube = new THREE.CubeTexture(faces);
    cube.colorSpace = THREE.SRGBColorSpace;
    cube.needsUpdate = true;
    this.envMap = cube;
    this.scene.environment = cube;
    this.scene.environmentIntensity = night > 0.5 ? 1.6 : 0.8;
  }

  // ------------------------------------------------------------------ rain
  _buildRain() {
    this.rainGroup = new THREE.Group();
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xaab4c8, transparent: true, opacity: 0.35, fog: true, depthWrite: false });
    this.scene.add(this.rainGroup);
    this._rebuildRainCount();
  }
  _rebuildRainCount() {
    for (const c of [...this.rainGroup.children]) { c.geometry.dispose(); this.rainGroup.remove(c); }
    const N = this.preset.rainDrops;
    const R = rng(7);
    this.rainBox = { w: 60, h: 34 };
    // two layers; each is a static geometry moved as a whole (zero per-drop CPU cost)
    for (let layer = 0; layer < 2; layer++) {
      const n = Math.floor(N / 2);
      const pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = (R() - 0.5) * this.rainBox.w, y = R() * this.rainBox.h, z = (R() - 0.5) * this.rainBox.w;
        const len = 0.5 + R() * 0.6;
        pos.set([x, y, z, x + 0.05, y + len, z + 0.02], i * 6);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      for (let k = 0; k < 2; k++) {
        const m = new THREE.LineSegments(g, this.rainMat);
        m.frustumCulled = false;
        m.userData = { layer, copy: k, speed: layer ? 16 : 21, offset: k * this.rainBox.h };
        this.rainGroup.add(m);
      }
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, focus, force = false) {
    if (this.mode === 'cycle') this.hour = (this.hour + dt * (24 / (24 * 60))) % 24; // 24 minutes per day
    // weather transitions
    const targetRain = this.targetWeather === 'rain' ? 1 : 0;
    const targetCloud = this.targetWeather === 'rain' ? 0.95 : this.targetWeather === 'cloudy' ? 0.75 : 0.15;
    const prevRain = this.rain, prevCloud = this.cloud;
    this.rain = damp(this.rain, targetRain, 0.35, dt);
    this.cloud = damp(this.cloud, targetCloud, 0.3, dt);
    this.wetness = damp(this.wetness, Math.max(targetRain, this.rain > 0.2 ? 1 : 0), this.rain > 0.1 ? 0.3 : 0.05, dt);
    if (force) { this.rain = targetRain; this.cloud = targetCloud; this.wetness = targetRain; }
    this.weather = this.rain > 0.5 ? 'rain' : this.cloud > 0.5 ? 'cloudy' : 'clear';

    // time of day interpolation
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].h <= this.hour) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = clamp((this.hour - a.h) / (b.h - a.h), 0, 1);
    const C = this._colors;
    for (const k of ['skyTop', 'skyHor', 'glow', 'sun', 'hemiS', 'hemiG', 'fog']) lerpColor(a[k], b[k], t, C[k]);
    const night = lerp(a.night, b.night, t);
    const changed = force || Math.abs(night - (this.state.night ?? -1)) > 0.002 || Math.abs(prevCloud - this.cloud) > 0.002 || Math.abs(prevRain - this.rain) > 0.002 || this.mode === 'cycle';
    this.state.night = night;
    this.state.hour = this.hour;

    // sun direction: rises east (+x), sets west
    const sunAng = ((this.hour - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(sunAng), Math.sin(sunAng), 0.35).normalize();
    const moonDir = new THREE.Vector3(-0.4, 0.55, -0.7).normalize();
    const lightDir = night > 0.6 ? moonDir : sunDir.y > 0.05 ? sunDir : moonDir;
    const cloudDim = 1 - this.cloud * 0.55;
    this.sun.color.copy(C.sun);
    this.sun.intensity = lerp(a.sunI, b.sunI, t) * cloudDim;
    this.sun.position.copy(focus).addScaledVector(lightDir, 200);
    this.sun.target.position.copy(focus);
    this.hemi.color.copy(C.hemiS); this.hemi.groundColor.copy(C.hemiG);
    this.hemi.intensity = lerp(a.hemiI, b.hemiI, t) * (0.75 + 0.25 * cloudDim);
    const fogC = C.fog.clone().lerp(new THREE.Color(0x3a4048), this.rain * (1 - night) * 0.5);
    this.scene.fog.color.copy(fogC);
    const vd = this.preset.viewDistance;
    this.scene.fog.density = (2.1 / vd) * (1 + this.rain * 0.9 + this.cloud * 0.15) * (night > 0.5 ? 1 : 0.8);
    this.renderer.toneMappingExposure = lerp(a.exp, b.exp, t);
    this.sky.position.copy(focus); this.stars.position.copy(focus);
    this.starMat.opacity = clamp(night * 1.2 - 0.2, 0, 1) * (1 - this.cloud * 0.9);
    this.moon.position.copy(focus).addScaledVector(moonDir, 3500);
    this.moon.material.opacity = clamp(night, 0, 1) * (1 - this.cloud * 0.7);
    this.sunSprite.position.copy(focus).addScaledVector(sunDir, 3500);
    this.sunSprite.material.opacity = clamp(1 - night * 1.5, 0, 1) * (sunDir.y > -0.05 ? 1 : 0) * cloudDim;
    this.clouds.position.set(focus.x, 600, focus.z);
    this.cloudMat.map.offset.x += dt * 0.0008; this.cloudMat.map.offset.y += dt * 0.0003;
    this.cloudMat.opacity = 0.18 + this.cloud * 0.6;
    this.cloudMat.color.copy(C.skyHor).lerp(new THREE.Color(night > 0.5 ? 0x1a1c24 : 0xcfd6e0), 0.5).multiplyScalar(night > 0.5 ? 0.9 : 1);

    if (changed) {
      this._paintSky(C, sunDir);
      this._paintEnvMap(C);
      for (const fn of this.listeners) fn(this.state, this);
    }

    // rain animation
    const vis = this.rain > 0.02;
    this.rainGroup.visible = vis;
    if (vis) {
      this.rainMat.opacity = 0.25 * this.rain + 0.05;
      this.rainGroup.position.set(Math.round(focus.x), focus.y - 6, Math.round(focus.z));
      this.rainTime = (this.rainTime || 0) + dt;
      for (const m of this.rainGroup.children) {
        const u = m.userData;
        const y = ((u.offset - this.rainTime * u.speed) % (this.rainBox.h * 2) + this.rainBox.h * 2) % (this.rainBox.h * 2) - this.rainBox.h;
        m.position.set(u.layer * 7.3, y, u.layer * 3.1);
      }
    }
    this.state.rain = this.rain; this.state.wetness = this.wetness; this.state.cloud = this.cloud;
  }
}
