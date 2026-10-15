// Developer view of one truck in the garage light: trucks.html?truck=ranger&build=crawler&yaw=0.7&pitch=0.15&dist=8
//   build: a preset id or a 14-character build code; paint: hex without #
import { GaragePreview } from '../ui/GaragePreview.js';
import { truckSpec, truckBase } from '../physics/trucks.js';
import { presetBuild, PRESETS } from '../physics/Upgrades.js';

const q = new URLSearchParams(location.search);
const id = q.get('truck') || 'ranger', b = q.get('build') || 'stock';
const build = PRESETS.some((p) => p.id === b) ? presetBuild(truckBase(id), b) : b;
const spec = truckSpec(id, build);
const view = new GaragePreview(document.getElementById('c'));
view.show(spec, '#' + (q.get('paint') || 'b5532c'));
view.spin = false;
if (q.get('yaw')) view.yaw = Number(q.get('yaw'));
if (q.get('pitch')) view.pitch = Number(q.get('pitch'));
if (q.get('dist')) view.dist = Number(q.get('dist'));
if (q.get('focus')) view.focusY = Number(q.get('focus'));
if (q.get('dirt')) view.model.setDirt(Number(q.get('dirt')));
view.frame(0);
const info = view.renderer.info.render;
document.getElementById('info').textContent = `${spec.name} ${spec.buildCode} raise ${(spec.raise * 100).toFixed(1)} cm, ${info.triangles} tris, ${info.calls} calls`;
window.view = view;
window.__ready = true;
