// Procedural models for the battle royale mode (no suitable CC0 meshes exist for these): a ram-air parachute
// canopy with suspension lines and the animated ring-of-fire wall (the transport plane is in TransportPlane.js).
import * as THREE from 'three';


// ---------------------------------------------------------------- ram-air parachute
// Origin = harness (soldier's shoulders); canopy ~6 m above, 8 m span, 3 m chord, 9 inflated cells.
const canopyGeoCache = {};
function canopyGeometry() {
  if (canopyGeoCache.g) return canopyGeoCache.g;
  const NS = 36, NC = 10, R = 5.4, span = 0.78, cells = 9, chord = 3.0;
  const pos = [], idx = [];
  const point = (su, cu, top) => {
    const a = (su * 2 - 1) * span;
    const t = Math.pow(Math.sin(Math.PI * Math.min(1, cu * 1.08 + 0.02)), 0.75) * 0.34 * (1 - cu * 0.35);
    const bulge = top ? Math.abs(Math.sin(su * cells * Math.PI)) * 0.1 : -Math.abs(Math.sin(su * cells * Math.PI)) * 0.04;
    const r = R + (top ? t + bulge : bulge);
    return [Math.sin(a) * r, Math.cos(a) * r - R + 6.1, (cu - 0.4) * chord];
  };
  for (const top of [true, false]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NC; j++) for (let i = 0; i <= NS; i++) pos.push(...point(i / NS, j / NC, top));
    for (let j = 0; j < NC; j++) for (let i = 0; i < NS; i++) {
      const a = base + j * (NS + 1) + i, b = a + 1, c = a + NS + 1, d = c + 1;
      if (top) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  // suspension lines: from the bottom skin at the cell ribs to the left/right risers
  const lines = [];
  for (let i = 0; i <= cells; i++) for (const cu of [0.08, 0.4, 0.75]) {
    const su = i / cells, p0 = point(su, cu, false);
    lines.push(...p0, su < 0.5 ? -0.22 : 0.22, 0.25, 0.05);
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  canopyGeoCache.g = { geo, lg };
  return canopyGeoCache.g;
}

const fabric = new THREE.MeshStandardMaterial({ color: 0x8a8d68, emissive: 0x23241a, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
const lineMat = new THREE.LineBasicMaterial({ color: 0x55544a, transparent: true, opacity: 0.4 });
export function buildCanopy(color = null) {
  const { geo, lg } = canopyGeometry();
  const g = new THREE.Group(); g.name = 'canopy';
  const mat = color ? fabric.clone() : fabric; if (color) mat.color.setHex(color);
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m);
  g.add(new THREE.LineSegments(lg, lineMat));
  return g;
}

// ---------------------------------------------------------------- ring of fire wall
export function buildRingWall() {
  const geo = new THREE.CylinderGeometry(1, 1, 1, 180, 1, true); geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    uniforms: { uTime: { value: 0 }, uRadius: { value: 500 }, uHeight: { value: 170 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime, uRadius, uHeight; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s+=a*n(p); p*=2.03; a*=0.5; } return s; }
      void main(){
        float x = vUv.x * 6.2832 * uRadius / 9.0;   // ~9 m per noise cell around the circumference
        float y = vUv.y * uHeight;                   // metres above the ring base
        float f = fbm(vec2(x, y / 7.0 - uTime * 1.7));
        float flame = smoothstep(0.25, 0.75, f * (1.35 - y / 38.0));
        vec3 fire = mix(vec3(1.0, 0.25, 0.03), vec3(1.0, 0.78, 0.3), smoothstep(0.55, 1.0, flame));
        float smoke = fbm(vec2(x * 0.5, y / 18.0 - uTime * 0.35)) * (1.0 - smoothstep(20.0, uHeight, y));
        vec3 col = mix(vec3(0.22, 0.09, 0.05) * (0.6 + smoke), fire, clamp(flame * 1.4, 0.0, 1.0));
        float a = max(flame, smoke * 0.55 + 0.12 * (1.0 - y / uHeight));
        gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'ring_of_fire'; mesh.frustumCulled = false; mesh.renderOrder = 5;
  return mesh;
}

// soft radial glow texture for loot markers
let glowTex = null;
export function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}
