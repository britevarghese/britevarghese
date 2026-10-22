// The lines painted on a map's tarmac (its roads with lanes: world/WorldGen.js's trails with `lanes`): the edge lines,
// dashed lines between the lanes that go the same way, and down the middle a double yellow line on a four-lane
// highway or a dashed white one on a two-lane road; a runway's dashed centre line, edge lines and the bars across its
// thresholds. Strips a few centimetres over the ground, drawn just in front of it.
import * as THREE from 'three';
import { HASH21 } from './ShaderHash.js';
import { spline } from '../world/WorldGen.js';

const WHITE = [0.86, 0.86, 0.82], YELLOW = [0.85, 0.62, 0.12];
const STEP = 1.5;                       // (m along a road between the strips' corners)

/**
 * A road's line every `step` m, and how far along it each point is: carried straight on past its ends by r.extend
 * ([start, end] m: an open-world road crossing a seam, drawn up to the edge of its map's square, render/WorldView.js),
 * the distance running from minus the start's extension.
 */
export function roadLine(r, step) {
  const P = spline(r.points, step);
  const [e0, e1] = r.extend || [0, 0];
  const on = (a, b, len) => { const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, out = []; for (let d = step; d <= len + 1e-6; d += step) out.push([a[0] + (a[0] - b[0]) / l * d, a[1] + (a[1] - b[1]) / l * d]); return out; };
  if (e0) P.unshift(...on(P[0], P[1], e0).reverse());
  if (e1) P.push(...on(P[P.length - 1], P[P.length - 2], e1));
  const S = [-(Math.floor(e0 / step + 1e-6) * step)];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { P, S };
}

/** A fragment past the map's square (uHalf; its own frame) is not drawn: the next map draws its side of a seam. */
export const SQUARE_CLIP = 'if (max(abs(vSq.x), abs(vSq.y)) > uHalf) discard;';

export class RoadMarkings {
  constructor(world, scene) {
    const roads = (world.data.trails || []).filter((t) => t.lanes !== undefined);
    if (!roads.length) return;
    const pos = [], col = [], idx = [];
    // (past the map's square, where a road runs on over a seam, the height at its edge: the rest isn't drawn)
    const E = world.half, H = (x, z) => world.terrain(Math.max(-E, Math.min(E, x)), Math.max(-E, Math.min(E, z))) + 0.035;
    // one line: offset o (m, + to the right of the way it runs), half-width hw, colour, dashes (dash, gap: m) or solid,
    // over [s0, s1] of its length
    const line = (P, S, o, hw, c, dash = null, s0 = 0, s1 = Infinity) => {
      let prev = null;
      for (let i = 0; i < P.length; i++) {
        const s = S[i];
        const on = s >= s0 && s <= s1 && (!dash || (((s % (dash[0] + dash[1])) + dash[0] + dash[1]) % (dash[0] + dash[1])) < dash[0]);
        if (!on) { prev = null; continue; }
        const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
        let tx = b[0] - a[0], tz = b[1] - a[1];
        const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const rx = -tz, rz = tx;                                       // (to the right, the way the road runs)
        const x0 = P[i][0] + rx * (o - hw), z0 = P[i][1] + rz * (o - hw), x1 = P[i][0] + rx * (o + hw), z1 = P[i][1] + rz * (o + hw);
        const v = pos.length / 3;
        pos.push(x0, H(x0, z0), z0, x1, H(x1, z1), z1);
        col.push(...c, ...c);
        if (prev !== null) idx.push(prev, prev + 1, v, prev + 1, v + 1, v);
        prev = v;
      }
    };
    for (const r of roads) {
      const { P, S } = roadLine(r, STEP);
      const W = r.width, L = S[S.length - 1];
      if (r.runway) {
        line(P, S, 0, 0.45, WHITE, [30, 20], 60, L - 60);                 // the centre line
        for (const sgn of [1, -1]) line(P, S, sgn * (W - 1.2), 0.45, WHITE);
        // the threshold bars at each end: stripes along the runway, across most of its width
        for (let k = -6; k <= 6; k++) { if (!k) continue; const o = k * (W - 2) / 6.5; line(P, S, o, 0.7, WHITE, null, 6, 36); line(P, S, o, 0.7, WHITE, null, L - 36, L - 6); }
        continue;
      }
      if (!r.lanes) { for (const sgn of [1, -1]) line(P, S, sgn * (W - 0.35), 0.1, WHITE); continue; }   // (a taxiway: its edges)
      for (const sgn of [1, -1]) line(P, S, sgn * (W - 0.45), 0.08, WHITE);                          // the edge lines
      if (r.lanes >= 4) {
        for (const sgn of [1, -1]) line(P, S, sgn * 0.16, 0.06, YELLOW);                               // the double yellow
        for (const sgn of [1, -1]) line(P, S, sgn * W / 2, 0.075, WHITE, [4.5, 7.5]);                   // the lane lines
      } else line(P, S, 0, 0.07, WHITE, [3, 6]);                                                         // the centre
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, j) => (j % 3 === 1 ? 1 : 0)), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    // worn paint: rubbed off in patches by the tyres and the weather, the asphalt showing through (and the dirt on it,
    // render/RoadWear.js, lying over it)
    const half = world.half;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHalf = { value: half };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec2 vSq;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvSq = transformed.xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${SQUARE_CLIP}`)
        .replace('#include <common>', `#include <common>
varying vec3 vWPos;
varying vec2 vSq;
uniform float uHalf;
${HASH21}
float mh(vec2 p) { return hash21(p); }
float mn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mh(i), mh(i + vec2(1, 0)), u.x), mix(mh(i + vec2(0, 1)), mh(i + vec2(1, 1)), u.x), u.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float wear = smoothstep(0.5, 0.85, mn(vWPos.xz * 1.6)) * 0.7 + mn(vWPos.xz * 7.0) * 0.2;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025), clamp(wear, 0.0, 0.85));`);
    };
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
}
