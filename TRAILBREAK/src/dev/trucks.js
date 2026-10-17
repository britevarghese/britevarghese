// Developer view of one truck in the garage light: trucks.html?truck=ranger&build=crawler&yaw=0.7&pitch=0.15&dist=8
//   build: a preset id or a 14-character build code; paint: hex without #; driver=1: the driver in the seat;
//   steer=rad: the steering wheel turned
import { GaragePreview } from '../ui/GaragePreview.js';
import { truckSpec, truckBase } from '../physics/trucks.js';
import { presetBuild, PRESETS } from '../physics/Upgrades.js';
import { loadTruckAsset } from '../render/TruckAssets.js';
import { loadDriverAssets } from '../render/DriverAssets.js';

const q = new URLSearchParams(location.search);
const id = q.get('truck') || 'ranger', b = q.get('build') || 'stock';
const build = PRESETS.some((p) => p.id === b) ? presetBuild(truckBase(id), b) : b;
const spec = truckSpec(id, build);
await loadTruckAsset(spec.style);                    // (a model body: loaded before the truck is built)
if (q.has('driver') && q.get('driver') !== 'drawn') await loadDriverAssets();
const view = new GaragePreview(document.getElementById('c'));
view.showDriver = q.has('driver');                   // (driver=1: the driver in the seat; steer=rad: the wheel turned)
view.show(spec, '#' + (q.get('paint') || 'b5532c'));
if (q.get('steer') && view.model.steeringWheel) {
  // turned there smoothly (the hands taking new grips on the way), as the game would
  const to = Number(q.get('steer'));
  for (let i = 1; i <= 90; i++) { view.model.steeringWheel.rotation.z = to * i / 90; view.model.driver?.update(view.model.steeringWheel.rotation.z, 1 / 60); }
}
view.spin = false;
if (q.get('yaw')) view.yaw = Number(q.get('yaw'));
if (q.get('pitch')) view.pitch = Number(q.get('pitch'));
if (q.get('dist')) view.dist = Number(q.get('dist'));
if (q.get('focus')) view.focusY = Number(q.get('focus'));
if (q.get('dirt')) view.model.setDirt(Number(q.get('dirt')));
if (q.get('eye')) {
  // from the driver's seat (eye=1, or eye=x,y,z in the design frame): look=yaw (rad, + to the left), down=pitch
  const e = q.get('eye') === '1' ? spec.eye : q.get('eye').split(',').map(Number), lk = Number(q.get('look') || 0), dn = Number(q.get('down') || 0.15);
  const cam = view.camera, y = e[1] + (spec.raise || 0);
  view.resize();
  cam.fov = Number(q.get('fov') || 70); cam.near = 0.02; cam.updateProjectionMatrix();
  cam.position.set(e[0], y, e[2]);
  cam.lookAt(e[0] + Math.sin(lk) * Math.cos(dn), y - Math.sin(dn), e[2] + Math.cos(lk) * Math.cos(dn));
  view.renderer.render(view.scene, cam);
} else view.frame(0);
const info = view.renderer.info.render;
document.getElementById('info').textContent = `${spec.name} ${spec.buildCode} raise ${(spec.raise * 100).toFixed(1)} cm, ${info.triangles} tris, ${info.calls} calls`;
window.view = view;
window.__ready = true;
