// The lines painted on a map's tarmac (its roads with lanes: world/WorldGen.js's trails with `lanes`): the edge lines,
// dashed lines between the lanes that go the same way, and down the middle a double yellow line on a four-lane
// highway or a dashed white one on a two-lane road; a runway's dashed centre line, edge lines and the bars across its
// thresholds. Strips a few centimetres over the ground, drawn just in front of it.
import * as THREE from 'three';
import { spline } from '../world/WorldGen.js';

const WHITE = [0.86, 0.86, 0.82], YELLOW = [0.85, 0.62, 0.12];
const STEP = 1.5;                       // (m along a road between the strips' corners)

export class RoadMarkings {
  constructor(world, scene) {
    const roads = (world.data.trails || []).filter((t) => t.lanes !== undefined);
    if (!roads.length) return;
    const pos = [], col = [], idx = [];
    const H = (x, z) => world.terrain(x, z) + 0.035;
    // one line: offset o (m, + to the right of the way it runs), half-width hw, colour, dashes (dash, gap: m) or solid,
    // over [s0, s1] of its length
    const line = (P, S, o, hw, c, dash = null, s0 = 0, s1 = Infinity) => {
      let prev = null;
      for (let i = 0; i < P.length; i++) {
        const s = S[i];
        const on = s >= s0 && s <= s1 && (!dash || (s % (dash[0] + dash[1])) < dash[0]);
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
      const P = spline(r.points, STEP), S = [0];
      for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
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
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);
  }
}
