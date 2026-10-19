// The dealer's showroom, for the 3D view of a car being chosen: a dark room with a glossy floor that shows the car
// standing in it (drawn again upside down under a floor you half see through), the car on a turntable ringed with
// light, strips of light along the ceiling and the back wall, and a studio's reflections for the paint.
import * as THREE from 'three';

/** Reflections for the paint: a dark room, long bright strips overhead and at the sides, prefiltered. */
function showroomEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(24, 10, 24), new THREE.MeshBasicMaterial({ color: 0x15171b, side: THREE.BackSide }));
  room.position.y = 4;
  scene.add(room);
  const strip = (w, h, x, y, z, rx, ry, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k * 0.98, k * 0.94), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0);
    scene.add(m);
  };
  for (const x of [-3, 0, 3]) strip(0.5, 16, x, 8.9, 0, Math.PI / 2, 0, 9);
  strip(16, 0.4, 0, 3.2, -11.9, 0, 0, 4);
  strip(0.5, 6, -11.9, 3, -2, 0, Math.PI / 2, 3);
  strip(0.5, 6, 11.9, 3, 3, 0, -Math.PI / 2, 3);
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(scene, 0.03).texture;
  pm.dispose();
  scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return env;
}

/**
 * Build the showroom into a preview's scene (GaragePreview, its lights already there). Returns { reflect(model) },
 * which puts the car's reflection under the floor (call it again for each car shown).
 */
export function buildShowroom(scene, renderer) {
  scene.background = new THREE.Color(0x0b0d10);
  scene.environment = showroomEnvironment(renderer);
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0x0b0d10, 14, 30);
  const g = new THREE.Group();
  // the floor: black polished stone, its reflection seen through it
  const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 64), new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.18, metalness: 0.2, transparent: true, opacity: 0.86 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.renderOrder = 1;
  g.add(floor);
  // the turntable: a low disc, its edge a ring of light
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.65, 0.04, 96), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.3, metalness: 0.5, transparent: true, opacity: 0.9 }));
  disc.position.y = 0.02; disc.receiveShadow = true; disc.renderOrder = 1;
  g.add(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.66, 0.018, 8, 160), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.45) }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.04;
  g.add(ring);
  // the ceiling's light strips and the back wall: dark panels between upright strips of light
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.15, 2.05) });
  for (const x of [-2.6, 0, 2.6]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 9), glow);
    s.position.set(x, 6.2, -1);
    g.add(s);
  }
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 9), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0.1 }));
  wall.position.set(0, 4.5, -9);
  g.add(wall);
  for (const x of [-7.5, -4.5, 4.5, 7.5]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.05), glow);
    s.position.set(x, 3.6, -8.95);
    g.add(s);
  }
  scene.add(g);
  let mirror = null;
  return {
    /** The car again, upside down under the floor: its reflection in it. */
    reflect(model) {
      if (mirror) { scene.remove(mirror); mirror = null; }
      if (!model) return;
      mirror = model.root.clone();
      mirror.scale.y = -1;
      mirror.position.y = -model.root.position.y;
      mirror.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
      scene.add(mirror);
    },
  };
}
