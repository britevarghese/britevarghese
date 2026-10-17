// The wear and the dirt on a map's tarmac (its roads with lanes): the asphalt bleached by the sun in places and fresher
// in others, the wheel paths of each lane polished darker and an oil-dripped strip down its middle, repair patches with
// their sealed seams, cracks filled with tar across the road and along its edges, the edge crumbling into the verge
// with red earth washed onto it, and mud carried onto the lanes from the puddles on the verges and the field gates,
// smeared down the wheel paths for some way and drying out (it lies over the painted lines too). A runway: the black
// rubber its touchdown zones collect. One strip a few centimetres over each road, drawn over the ground and the lines,
// its look all in the shader (from where each point is along and across the road); the fine detail fades out with
// distance rather than shimmer.
import * as THREE from 'three';
import { spline } from '../world/WorldGen.js';

const STEP = 2;                                   // (m along a road between the strip's rows)
const OVER = 0.7;                                 // (m past the tarmac's edge it reaches, for the crumbling edge)

/** A small seeded generator (the field gates along each road, the same on every machine). */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const hashStr = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export class RoadWear {
  constructor(world, scene) {
    const roads = (world.data.trails || []).filter((t) => t.lanes !== undefined);
    if (!roads.length) return;
    const verge = (world.data.puddles || []).filter((p) => p.verge);
    const pos = [], road = [], mud = [], idx = [];
    const H = (x, z) => world.terrain(x, z) + 0.04;
    for (const r of roads) {
      const P = spline(r.points, STEP), S = [0];
      for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
      // (a runway: its length where a road has its lanes, negative)
      const W = r.width, L = S[S.length - 1], lanes = r.runway ? -L : r.lanes;
      // the mud's sources along this road: its verge puddles (on their side), and a field gate every few hundred metres
      const src = [];
      if (!r.runway && r.lanes) {
        for (const p of verge) {
          let best = Infinity, bi = 0;
          for (let i = 0; i < P.length; i += 2) { const d = Math.hypot(P[i][0] - p.x, P[i][1] - p.z); if (d < best) { best = d; bi = i; } }
          if (best < W + p.r + 4) {
            const a = P[Math.max(0, bi - 1)], b = P[Math.min(P.length - 1, bi + 1)];
            const side = Math.sign(-(b[1] - a[1]) * (p.x - P[bi][0]) + (b[0] - a[0]) * (p.z - P[bi][1])) || 1;
            src.push({ s: S[bi], side, k: 0.75 + 0.25 * Math.min(1, p.r / 2) });
          }
        }
        const R = rng(hashStr(r.name));
        for (let s = 60 + R() * 200; s < L - 40; s += 180 + R() * 260) src.push({ s, side: R() < 0.5 ? 1 : -1, k: 0.6 + 0.4 * R() });
      }
      // how much mud lies at a point along the road, on one side or the other: thick at its source, carried on the way
      // the traffic on that side goes (and a little the other way), across to the far lanes too, thinning out. (The
      // traffic keeps left, as it does in India: the lane on a road's right, the way its points run, goes against them)
      const mudAt = (s, v) => {
        let m = 0;
        for (const q of src) {
          const ds = (q.s - s) * q.side;                               // (+: downstream of it on its own side)
          const own = v * q.side > 0 ? 1 : 0.4;
          const along = ds >= 0 ? Math.exp(-ds / 30) : Math.exp(ds / 5);
          m = Math.max(m, q.k * own * along);
        }
        return m;
      };
      const cols = [-(W + OVER), -W, -W + 0.9, -W / 2, 0, W / 2, W - 0.9, W, W + OVER];
      const base = pos.length / 3;
      for (let i = 0; i < P.length; i++) {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const rx = -tz, rz = tx;                                       // (to the right, the way the road runs)
        for (const v of cols) {
          const x = P[i][0] + rx * v, z = P[i][1] + rz * v;
          pos.push(x, H(x, z), z);
          road.push(S[i], v, W, lanes);
          mud.push(mudAt(S[i], v));
        }
      }
      const C = cols.length;
      for (let i = 0; i + 1 < P.length; i++) for (let c = 0; c + 1 < C; c++) {
        const p0 = base + i * C + c, p1 = p0 + C;
        idx.push(p0, p0 + 1, p1, p0 + 1, p1 + 1, p1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('road', new THREE.Float32BufferAttribute(road, 4));
    g.setAttribute('mud', new THREE.Float32BufferAttribute(mud, 1));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false,
      // (over the ground and over the painted lines: the mud lies on the paint too)
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6,
    });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 road;
attribute float mud;
varying vec4 vRoad;
varying float vMud;
varying vec3 vWPos;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vRoad = road; vMud = mud;
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec4 vRoad;
varying float vMud;
varying vec3 vWPos;
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float rn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rh(i), rh(i + vec2(1, 0)), u.x), mix(rh(i + vec2(0, 1)), rh(i + vec2(1, 1)), u.x), u.y); }
float rf(vec2 p) { return 0.5 * rn(p) + 0.3 * rn(p * 2.07) + 0.2 * rn(p * 4.31); }
// layers laid over one another: colour (linear), how much of the ground under it covers, roughness
#define LAY(c, k, r) { float k_ = clamp(k, 0.0, 1.0); pc = (c) * k_ + pc * (1.0 - k_); pr = (r) * k_ + pr * (1.0 - k_); pa = k_ + pa * (1.0 - k_); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec3 pc = vec3(0.0); float pa = 0.0, pr = 0.0;
{
  vec2 w = vWPos.xz;
  float s = vRoad.x, v = vRoad.y, W = vRoad.z, lanes = vRoad.w, av = abs(v);
  // how fine a detail still shows here (the size of a pixel on the road, m): finer detail fades out with distance
  float px = max(fwidth(s), fwidth(v));
  float fine = 1.0 - smoothstep(0.03, 0.12, px), mid = 1.0 - smoothstep(0.12, 0.5, px);
  // where the tarmac ends: a ragged, crumbling edge
  float edge = W + (rn(w * 1.3) - 0.5) * 0.45 + (rn(w * 4.7) - 0.5) * 0.18 * mid;
  float paved = 1.0 - smoothstep(edge - 0.04, edge + 0.04, av);
  // the asphalt's age: bleached pale by the sun in places, fresher and darker in others
  float tone = rf(w / 14.0);
  LAY(vec3(0.15, 0.142, 0.128), smoothstep(0.55, 0.85, tone) * 0.3 * paved, 0.93);
  LAY(vec3(0.006), smoothstep(0.42, 0.12, tone) * 0.22 * paved, 0.86);
  float wheel = 0.0, lp = 0.0;
  if (lanes > 0.5) {
    // each lane's wheel paths, polished darker and smoother by the tyres, and an oil-dripped strip down its middle
    float lw = 2.0 * W / lanes;
    lp = mod(v + W, lw) - 0.5 * lw;
    wheel = exp(-pow((abs(lp) - 0.85) / 0.36, 2.0)) * paved;
    LAY(vec3(0.004), wheel * 0.3, 0.55);
    float oil = exp(-pow(lp / 0.3, 2.0)) * (0.45 + 0.55 * rn(vec2(s * 0.6, v * 2.0))) * paved;
    LAY(vec3(0.003, 0.003, 0.004), oil * 0.24, 0.38);
    // repair patches: a lane's width of fresh tar, its seams sealed black
    float ci = floor(s / 27.0), h1 = rh(vec2(ci, W)), h2 = rh(vec2(ci, W + 7.1)), h3 = rh(vec2(ci, W + 3.3)), h4 = rh(vec2(ci, W + 1.9));
    float p0 = ci * 27.0 + 3.0 + h2 * 12.0, p1 = p0 + 3.0 + h3 * 7.0;
    float l0 = -W + floor(h4 * lanes) * lw + 0.25, l1 = l0 + lw - 0.5;
    float inP = step(h1, 0.38) * step(p0, s) * step(s, p1) * step(l0, v) * step(v, l1);
    LAY(vec3(0.008, 0.008, 0.009), inP * 0.7, 0.8);
    float seam = step(h1, 0.38) * (1.0 - smoothstep(0.03, 0.07, min(min(abs(s - p0), abs(s - p1)), min(abs(v - l0), abs(v - l1))))) * step(p0 - 0.1, s) * step(s, p1 + 0.1) * step(l0 - 0.1, v) * step(v, l1 + 0.1);
    LAY(vec3(0.002), seam * 0.75 * mid, 0.4);
    // cracks: across the road every so often, wandering, and a web of them along the edges, all filled with tar
    float cj = floor(s / 9.0), cs = cj * 9.0 + rh(vec2(cj, 2.0 * W)) * 9.0 + sin(v * 1.7 + cj) * 0.35;
    float across = step(rh(vec2(cj, W + 5.0)), 0.45) * (1.0 - smoothstep(0.015, 0.04, abs(s - cs))) * step(av, W - 0.3 - rh(vec2(cj, 9.0)) * W);
    float web = (1.0 - smoothstep(0.012, 0.035, abs(rn(w * 1.9) - 0.5))) * smoothstep(W - 1.7, W - 0.7, av);
    LAY(vec3(0.002), max(across, web) * 0.7 * fine * paved, 0.45);
  } else if (lanes < -0.5) {
    // a runway: the rubber the tyres leave where they touch down, black streaks down its middle
    float L = -lanes, td = max(1.0 - smoothstep(60.0, 260.0, abs(s - 140.0)), 1.0 - smoothstep(60.0, 260.0, abs(s - (L - 140.0))));
    float streak = smoothstep(0.35, 0.8, rn(vec2(s * 0.08, v * 1.6))) * (1.0 - smoothstep(4.0, 9.0, av));
    LAY(vec3(0.002), td * streak * 0.75, 0.6);
  }
  // red earth washed and blown onto the tarmac's edge, and beyond it the crumbled edge itself
  float dust = smoothstep(W - 1.4 - 0.6 * rn(w * 0.7), edge, av) * (0.45 + 0.55 * rn(w * 2.1));
  LAY(vec3(0.16, 0.085, 0.045), dust * 0.55, 0.96);
  LAY(vec3(0.11, 0.06, 0.035), (1.0 - paved) * (0.65 + 0.35 * rn(w * 3.0)), 0.97);
  // mud carried onto the lanes: down the wheel paths, smeared along the way the traffic goes, wet and dark at its
  // source and drying paler further on
  if (vMud > 0.02) {
    // (near its source a smear right across the lane, where the wheels came off the verge; further on, streaks down the
    // wheel paths)
    float streak = smoothstep(0.25, 0.7, rn(vec2(s * 0.3, v * 2.6)) * 0.65 + rn(w * 1.1) * 0.35);
    float smear = smoothstep(0.55, 0.9, vMud) * (0.55 + 0.45 * rn(w * 0.9));
    float m = max(vMud * streak * (0.4 + 0.6 * max(wheel, 0.3)), smear) * paved;
    LAY(mix(vec3(0.15, 0.08, 0.04), vec3(0.045, 0.022, 0.01), smoothstep(0.35, 0.85, vMud)), m * 1.25, mix(0.95, 0.4, smoothstep(0.3, 0.9, vMud)));
  }
  // and a film of dust over it all, here and there
  LAY(vec3(0.24, 0.15, 0.09), smoothstep(0.64, 0.92, rf(w / 6.0)) * 0.16 * paved, 0.96);
}
diffuseColor.rgb = pc / max(pa, 1e-4);
diffuseColor.a = pa;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = pr / max(pa, 1e-4);`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
}
