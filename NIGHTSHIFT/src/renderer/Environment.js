// Environment: time-of-day controller, sky dome (gradient + stars + moon + clouds), fog,
// sun/moon light with player-following shadows, procedural reflection cubemap, and weather
// (clear / cloudy / rain with GPU-friendly rain streaks and wet roads).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, rng } from '../core/util.js';
import { moonTex, cloudTex, radialGlow } from './Textures.js';

// keyframes by hour
const KEYS = [
  { h: 0, skyTop: '#02040b', skyHor: '#1e1c28', glow: '#4a2c1a', sun: '#8fa8e0', sunI: 0.28, hemiS: '#26334d', hemiG: '#3a2a1a', hemiI: 0.95, fog: '#0a0e16', exp: 1.31, night: 1 },
  { h: 5.2, skyTop: '#060a18', skyHor: '#2a2436', glow: '#5a3020', sun: '#8fa8e0', sunI: 0.25, hemiS: '#23304a', hemiG: '#0a0a0e', hemiI: 0.6, fog: '#141824', exp: 1.25, night: 0.9 },
  { h: 6.5, skyTop: '#3a5a8a', skyHor: '#e8a070', glow: '#ff9a50', sun: '#ffb070', sunI: 1.6, hemiS: '#8aa0c0', hemiG: '#3a3028', hemiI: 0.9, fog: '#9a8a88', exp: 1.12, night: 0.35 },
  { h: 9, skyTop: '#3a6ab0', skyHor: '#b8cce0', glow: '#fff0d0', sun: '#fff2dc', sunI: 2.6, hemiS: '#bccbe0', hemiG: '#7a6a56', hemiI: 1.45, fog: '#a8b8c8', exp: 1.15, night: 0 },
  { h: 13, skyTop: '#2e62b0', skyHor: '#c0d4e8', glow: '#ffffff', sun: '#ffffff', sunI: 3.0, hemiS: '#c2d0e2', hemiG: '#806e58', hemiI: 1.5, fog: '#b0c0d0', exp: 1.15, night: 0 },
  { h: 17, skyTop: '#3a5c98', skyHor: '#e0c0a0', glow: '#ffc080', sun: '#ffd0a0', sunI: 2.2, hemiS: '#b0b8d0', hemiG: '#6a5440', hemiI: 1.3, fog: '#b0a8a0', exp: 1.06, night: 0.05 },
  { h: 18.6, skyTop: '#2a2c58', skyHor: '#f07848', glow: '#ff6a30', sun: '#ff8a50', sunI: 1.3, hemiS: '#6a6090', hemiG: '#2a2020', hemiI: 0.8, fog: '#6a5058', exp: 1.19, night: 0.5 },
  { h: 19.8, skyTop: '#0a0e24', skyHor: '#3a2a40', glow: '#a04830', sun: '#9ab0e0', sunI: 0.35, hemiS: '#2a3450', hemiG: '#0a0a10', hemiI: 0.6, fog: '#161826', exp: 1.25, night: 0.9 },
  { h: 24, skyTop: '#02040b', skyHor: '#1e1c28', glow: '#4a2c1a', sun: '#8fa8e0', sunI: 0.28, hemiS: '#26334d', hemiG: '#3a2a1a', hemiI: 0.95, fog: '#0a0e16', exp: 1.31, night: 1 },
];
export const TIME_PRESETS = { morning: 7.2, day: 13, evening: 18.7, night: 23.3 };

const c1 = new THREE.Color(), c2 = new THREE.Color(), _envTop = new THREE.Color();
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
      const r = 15500; // beyond the farthest mountains, so peaks hide the stars behind them
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
    this.moon.scale.setScalar(1700); this.moon.renderOrder = -8;
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialGlow('rgba(255,250,235,1)', 'rgba(255,200,140,0.35)'), fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(2800); this.sunSprite.renderOrder = -8;
    this.scene.add(this.moon, this.sunSprite);
    // cloud layer (big textured plane high above, follows camera)
    const ct = cloudTex();
    ct.repeat.set(9, 9);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0.4, fog: false, depthWrite: false, color: 0x303848 });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), this.cloudMat);
    this.clouds.rotation.x = Math.PI / 2;
    this.clouds.position.y = 1500; this.clouds.renderOrder = -7; this.clouds.frustumCulled = false;
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
    // the cubemap also drives diffuse ambient: a pure zenith blue turns every road navy, so the
    // upper sky here is the average radiance of the dome (zenith blended toward the horizon)
    const top = '#' + _envTop.copy(C.skyTop).lerp(C.skyHor, night > 0.5 ? 0.15 : 0.55).getHexString();
    for (let f = 0; f < 6; f++) {
      const cv = document.createElement('canvas'); cv.width = cv.height = n;
      const ctx = cv.getContext('2d');
      if (f === 2) { // +Y sky
        ctx.fillStyle = top; ctx.fillRect(0, 0, n, n);
        if (night < 0.5) {
          const gg = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n * 0.7);
          gg.addColorStop(0, 'rgba(255,250,240,0.3)'); gg.addColorStop(1, 'rgba(255,250,240,0)');
          ctx.fillStyle = gg; ctx.fillRect(0, 0, n, n);
        }
      } else if (f === 3) { // -Y ground
        ctx.fillStyle = night > 0.5 ? '#0b0b0d' : '#3a3a3c'; ctx.fillRect(0, 0, n, n);
      } else {
        const g = ctx.createLinearGradient(0, 0, 0, n);
        g.addColorStop(0, top);
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
  // Rain: every drop is simulated (falls at ~9 m/s, drifts with the wind) and drawn as a short streak
  // along its velocity relative to the viewer over a camera exposure, so it slants toward you when you
  // drive and stretches with speed. Streaks taper (bright head, faint tail) and vary in length and
  // brightness. One LineSegments draw call; positions are rewritten each frame (a few thousand drops).
  _buildRain() {
    this.rainMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, fog: true, depthWrite: false });
    this.rainGroup = new THREE.Group();
    this.scene.add(this.rainGroup);
    this.wind = { x: 0, z: 0, t: 0 };
    this._rebuildRainCount();
  }
  _rebuildRainCount() {
    for (const c of [...this.rainGroup.children]) { c.geometry.dispose(); this.rainGroup.remove(c); }
    const N = this.preset.rainDrops;
    const R = rng(7);
    this.rainBox = { w: 34, h: 16 };
    const d = (this.drops = { n: N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), v: new Float32Array(N), len: new Float32Array(N), });
    const col = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) {
      d.x[i] = (R() - 0.5) * this.rainBox.w; d.z[i] = (R() - 0.5) * this.rainBox.w; d.y[i] = R() * this.rainBox.h;
      d.v[i] = 7.5 + R() * 2.5;          // terminal velocity of 1-3 mm drops
      d.len[i] = 0.6 + R() * 0.8;        // streak length spread
      const b = 0.45 + R() * 0.55;       // brightness spread; tail fades to a quarter
      col.set([0.74 * b, 0.8 * b, 0.9 * b, 0.19 * b, 0.21 * b, 0.25 * b], i * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.LineSegments(g, this.rainMat);
    m.frustumCulled = false;
    this.rainGroup.add(m);
    this.rainLines = m;
  }

  _updateRain(dt, cam, vel) {
    const d = this.drops, B = this.rainBox, W = B.w, half = W / 2;
    const w = this.wind;
    // gusting wind
    w.t += dt;
    w.x = Math.sin(w.t * 0.13) * 1.6 + Math.sin(w.t * 0.71) * 0.5;
    w.z = Math.cos(w.t * 0.09) * 1.2 + Math.sin(w.t * 0.53) * 0.4;
    const vx = vel?.vx || 0, vz = vel?.vz || 0;
    const pos = this.rainLines.geometry.attributes.position.array;
    const count = Math.min(d.n, Math.ceil(d.n * Math.min(1, this.rain * 1.1)));
    const bottom = cam.y - 5, top = bottom + B.h;
    const EXPO = 0.055; // s: how far a drop travels while the "shutter" is open (motion-blur length)
    for (let i = 0; i < count; i++) {
      let y = d.y[i] - d.v[i] * dt;
      let x = d.x[i] + w.x * dt, z = d.z[i] + w.z * dt;
      // keep the drop field centred on the camera (wraps any distance, e.g. after a teleport)
      if (y < bottom || y > top) y = bottom + (((y - bottom) % B.h) + B.h) % B.h;
      if (x - cam.x > half || x - cam.x < -half) x = cam.x - half + (((x - cam.x + half) % W) + W) % W;
      if (z - cam.z > half || z - cam.z < -half) z = cam.z - half + (((z - cam.z + half) % W) + W) % W;
      d.x[i] = x; d.y[i] = y; d.z[i] = z;
      // relative velocity to the viewer -> streak direction and length
      const k = EXPO * d.len[i];
      let tx = (w.x - vx) * k, ty = -d.v[i] * k, tz = (w.z - vz) * k;
      // drops right at the lens would read as giant slashes: shrink them
      const near = Math.hypot(x - cam.x, z - cam.z, y - cam.y);
      if (near < 2.5) { const f = near / 2.5; tx *= f; ty *= f; tz *= f; }
      const o = i * 6;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z;
      pos[o + 3] = x - tx; pos[o + 4] = y - ty; pos[o + 5] = z - tz;
    }
    this.rainLines.geometry.setDrawRange(0, count * 2);
    this.rainLines.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------------------ update
  update(dt, focus, force = false, viewPos = null) {
    if (this.mode === 'cycle') this.hour = (this.hour + dt * (24 / (48 * 60))) % 24; // 48 real minutes per game day (GTA pace)
    else if (this.mode === 'real') { const d = new Date(); this.hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
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
    const changed = force || Math.abs(night - (this.state.night ?? -1)) > 0.002 || Math.abs(prevCloud - this.cloud) > 0.002 || Math.abs(prevRain - this.rain) > 0.002 || this.mode === 'cycle' || (this.mode === 'real' && Math.abs(this.hour - (this._lastRealHour ?? -9)) > 0.01);
    if (this.mode === 'real' && changed) this._lastRealHour = this.hour;
    this.state.night = night;
    this.state.hour = this.hour;

    // sun direction: rises east (+x), sets west
    const sunAng = ((this.hour - 6) / 12) * Math.PI;
    // mid-latitude path: the sun peaks ~57° up (not overhead), so buildings throw shadows across streets
    const sunDir = new THREE.Vector3(Math.cos(sunAng), Math.sin(sunAng) * 0.78, 0.5).normalize();
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
    // long-range atmosphere: the far city (CityImpostor) and the landscape fill in past the streamed chunks,
    // so fog no longer has to hide the view distance; rain and night still close it in
    this.scene.fog.density = 0.00024 * (1 + this.rain * 2.6 + this.cloud * 0.3) * (night > 0.5 ? 1.3 : 1) * (vd < 500 ? 2.2 : 1);
    this.renderer.toneMappingExposure = lerp(a.exp, b.exp, t);
    this.sky.position.copy(focus); this.stars.position.copy(focus);
    this.starMat.opacity = clamp(night * 1.2 - 0.2, 0, 1) * (1 - this.cloud * 0.9);
    this.moon.position.copy(focus).addScaledVector(moonDir, 15000);
    this.moon.material.opacity = clamp(night, 0, 1) * (1 - this.cloud * 0.7);
    this.sunSprite.position.copy(focus).addScaledVector(sunDir, 15000);
    this.sunSprite.material.opacity = clamp(1 - night * 1.5, 0, 1) * (sunDir.y > -0.05 ? 1 : 0) * cloudDim;
    this.clouds.position.set(focus.x, 1500, focus.z);
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
      this.rainMat.opacity = Math.min(0.85, 0.3 + this.rain * 0.5) * (night > 0.5 ? 0.9 : 1);
      this._updateRain(dt, viewPos || focus, this.viewVel);
    }
    this.state.rain = this.rain; this.state.wetness = this.wetness; this.state.cloud = this.cloud;
  }
}
