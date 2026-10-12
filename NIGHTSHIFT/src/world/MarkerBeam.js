// The light column over a marker (a mission, a garage, a race, a business), as GTA draws one: brightest at its foot and
// fading away up into the sky, and fading out as the camera comes near, so a car pulled up on the marker never sits
// inside a coloured tube (a mission's column filled the whole view yellow). The ring on the ground stays.
import * as THREE from 'three';

let _fade = null;
const _p = new THREE.Vector3(), _c = new THREE.Vector3();
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// a vertical alpha gradient over the column's height (a cylinder's uv.y runs 0 at its foot to 1 at its top)
function fadeTex() {
  if (_fade) return _fade;
  const c = document.createElement('canvas'); c.width = 1; c.height = 64;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, '#000'); gr.addColorStop(0.5, '#262626'); gr.addColorStop(0.85, '#a0a0a0'); gr.addColorStop(1, '#fff');
  g.fillStyle = gr; g.fillRect(0, 0, 1, 64);
  return (_fade = new THREE.CanvasTexture(c));
}

/**
 * A marker's light column: geo an open cylinder standing on y = 0. Seen from closer than `near` metres (across the
 * ground) it is gone, from `far` and beyond at full `opacity`.
 */
export function markerBeam(geo, color, opacity, { near = 9, far = 32 } = {}) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, alphaMap: fadeTex(), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'marker_beam';
  m.onBeforeRender = (renderer, scene, cam) => {
    _p.setFromMatrixPosition(m.matrixWorld); _c.setFromMatrixPosition(cam.matrixWorld);
    mat.opacity = opacity * smooth(near, far, Math.hypot(_c.x - _p.x, _c.z - _p.z));
  };
  return m;
}
