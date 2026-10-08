// Kerala garages: workshops at real places round Kochi where the player can change cars, tune and paint (the
// garage screen), and where they wake up after being busted. Each one stands at a place from the map's list
// and is moved onto the nearest road once the tiles round it have loaded; a green ring marks the forecourt.
import * as THREE from 'three';

const GARAGES = [
  ['Vyttila', 'Vyttila Motors'],
  ['Kaloor', 'Kaloor Auto Works'],
  ['Edappally', 'Edappally Garage'],
  ['Fort Kochi', 'Fort Kochi Workshop'],
  ['Thrippunithura', 'Hill Palace Garage'],
];

export class KeralaGarages {
  constructor(world, scene) {
    this.world = world;
    const P = world.index?.places || [];
    this.list = [];
    for (const [place, name] of GARAGES) {
      const p = P.filter((q) => q[1] === place).sort((a, b) => Math.hypot(a[3], a[4]) - Math.hypot(b[3], b[4]))[0];
      if (p) this.list.push({ id: 'kl_' + place.toLowerCase().replace(/\W+/g, '_'), name, place, x: -p[3], z: p[4], heading: 0, snapped: false });
    }
    this.group = new THREE.Group();
    scene.add(this.group);
    const beam = new THREE.CylinderGeometry(2.2, 2.2, 90, 16, 1, true).translate(0, 45, 0);
    const ring = new THREE.RingGeometry(6, 7.5, 40).rotateX(-Math.PI / 2);
    const mat = (o) => new THREE.MeshBasicMaterial({ color: 0x3dff9a, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    for (const g of this.list) {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(beam, mat(0.12)), new THREE.Mesh(ring, mat(0.7)));
      m.visible = false;
      g.marker = m; this.group.add(m);
    }
  }

  update(cam) {
    for (const g of this.list) {
      const d = Math.hypot(g.x - cam.x, g.z - cam.z);
      if (!g.snapped && d < 1200) {
        // a side road off the main road is a forecourt; the main road itself will do
        const s = this.world.roadSpot?.(g.x, g.z, 6);
        if (s && Math.hypot(s.x - g.x, s.z - g.z) < 400) { g.x = s.x; g.z = s.z; g.heading = s.yaw; g.snapped = true; }
      }
      g.marker.visible = d < 700;
      if (g.marker.visible) g.marker.position.set(g.x, this.world.layout.groundHeight(g.x, g.z, 999) + 0.08, g.z);
    }
  }

  nearest(x, z) {
    let best = null, bd = Infinity;
    for (const g of this.list) { const d = Math.hypot(g.x - x, g.z - z); if (d < bd) { bd = d; best = g; } }
    return best ? { g: best, d: bd } : null;
  }
}
