// Isolated asset test scenes: /debug/character, /debug/weapon, /debug/character-weapon, /debug/ads, /debug/scale
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { AssetManager, describeGLTF } from './core/AssetManager.js';
import { WeaponModel } from './weapons/WeaponModel.js';
import { CharacterRig } from './character/CharacterRig.js';
import { Viewmodel } from './player/Viewmodel.js';

const mode = location.pathname.split('/').pop();
const qs = new URLSearchParams(location.search);
const info = document.getElementById('info');
const log = (s, cls) => { info.innerHTML += cls ? `<span class="${cls}">${s}</span>\n` : `${s}\n`; };
info.textContent = '';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x40464d);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 200);
const controls = new OrbitControls(camera, renderer.domElement);
const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x3a3530, 0.8);
const sun = new THREE.DirectionalLight(0xfff2e0, 2.6);
sun.position.set(3, 6, 4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 }); sun.shadow.bias = -0.0005;
scene.add(hemi, sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x7a7a78, roughness: 0.9 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
scene.add(new THREE.GridHelper(40, 40, 0x555555, 0x4a4a4a));

const assets = await new AssetManager(renderer).init();
try {
  const hd = await assets.loadHDRI(renderer); scene.environment = hd.env;
} catch (e) { log('HDRI missing: ' + e.message, 'err'); }

const marker = (color, r = 0.012) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 10; return m; };
const updaters = [];
const clock = new THREE.Clock();

function showWeaponSockets(w) {
  const colors = { rightGrip: 0x00ff44, leftGrip: 0x2288ff, stock: 0xff00ff, muzzle: 0xffee00, opticEye: 0xff2222 };
  for (const [k, c] of Object.entries(colors)) { const m = marker(c); m.position.copy(w.sockets[k]); w.root.add(m); }
  const ax = new THREE.AxesHelper(0.15); w.root.add(ax);
}

async function run() {
  if (mode === 'weapon') {
    const key = qs.get('w') || 'assault_rifle';
    const loaded = await assets.loadWeapon(key);
    const d = describeGLTF(`WEAPON ${key}`, loaded.gltf, loaded.file);
    const w = new WeaponModel(assets, loaded, { key });
    w.root.position.set(0, 1.1, 0);
    scene.add(w.root); showWeaponSockets(w);
    const vd = Math.max(0.5, w.length * 0.9); camera.position.set(vd, 1.1 + vd * 0.15, 0.02); controls.target.set(0, 1.1, 0);
    if (qs.get('view') === 'top') camera.position.set(0.01, 2.4, 0);
    if (qs.get('view') === 'front') camera.position.set(0, 1.15, -1.6);
    log(`WEAPON ${key}\nfile: ${loaded.file}\nmeshes: ${d.meshes} materials: ${d.materials} textures: ${d.textures}\nnodes: ${d.nodes.join(', ')}`);
    log(JSON.stringify(w.describe(), null, 1));
    log('green=rightGrip blue=leftGrip magenta=stock yellow=muzzle red=opticEye  axes: red=+X green=+Y blue=+Z (muzzle is -Z)');
  }
  if (mode === 'character' || mode === 'character-weapon' || mode === 'scale') {
    const key = qs.get('c') || 'soldier';
    const loaded = await assets.loadCharacter(key);
    const d = describeGLTF(`CHARACTER ${key}`, loaded.gltf, loaded.file);
    log(`=== CHARACTER ASSET ===\nfile: ${loaded.file}\nmeshes: ${d.meshes}\nmaterials: ${d.materials}\ntextures: ${d.textures}\nskeleton: ${d.skeletons}\nbones: ${d.bones}\nanimations: ${d.animations.join(', ') || 'none'}`);
    const rig = new CharacterRig(assets, loaded);
    scene.add(rig.root);
    log(`bone map: ${JSON.stringify(rig.boneReport())}`);
    log(`height: ${rig.height.toFixed(3)} m (scale ${rig.scale.toFixed(4)})`);
    camera.position.set(2.2, 1.4, -2.6); controls.target.set(0, 1.0, 0);
    if (mode === 'character') {
      rig.root.rotation.y = 0;
      rig.setState({ speed: +(qs.get('speed') || 0), stance: qs.get('stance') || 'stand' });
      updaters.push((dt) => rig.update(dt));
      if (qs.get('skeleton')) { const sh = new THREE.SkeletonHelper(rig.root); scene.add(sh); }
    } else {
      const wkey = qs.get('w') || 'assault_rifle';
      const wl = await assets.loadWeapon(wkey);
      const w = new WeaponModel(assets, wl, { key: wkey });
      rig.equip(w);
      showWeaponSockets(w);
      const aim = marker(0xffffff, 0.05); scene.add(aim);
      const stance = qs.get('stance') || 'stand';
      let t = 0;
      updaters.push((dt) => {
        t += dt;
        const pitch = qs.get('pitch') !== null ? +qs.get('pitch') : Math.sin(t * 0.7) * 0.35;
        rig.setState({ speed: +(qs.get('speed') || 0), stance, pitch, aimYaw: 0, ads: qs.get('ads') === '1', sprint: qs.get('sprint') === '1' });
        rig.update(dt);
        aim.position.copy(rig.aimTarget);
      });
      if (qs.get('skeleton')) scene.add(new THREE.SkeletonHelper(rig.root));
      const colors = [0x00ff44, 0x2288ff];
      const rh = marker(colors[0], 0.02), lh = marker(colors[1], 0.02); scene.add(rh, lh);
      updaters.push(() => { rig.bones.rightHand.getWorldPosition(rh.position); rig.bones.leftHand.getWorldPosition(lh.position); });
      setInterval(() => { const v = rig.validate(); info.dataset.valid = JSON.stringify(v); }, 1000);
      setTimeout(() => log(`=== ATTACHMENT ===\n${JSON.stringify(rig.validate(), null, 1)}`), 1500);
      const view = qs.get('view');
      if (view === 'side') camera.position.set(2.4, 1.45, 0.2);
      if (view === 'front') camera.position.set(0.3, 1.5, -2.2);
      if (view === 'close') { camera.position.set(0.9, 1.6, -0.7); controls.target.set(0.05, 1.35, -0.2); }
      if (view === 'back') camera.position.set(-0.9, 1.8, 1.6);
    }
    if (mode === 'scale') {
      const door = new THREE.Mesh(new THREE.BoxGeometry(1.3, 2.3, 0.05), new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.8 }));
      door.position.set(1.4, 1.15, 0); scene.add(door);
      const crate = await assets.loadProp('crate'); const c = crate.scene.clone(); c.position.set(-1.2, 0, 0); scene.add(c);
      const car = await assets.loadProp('car'); const cc = car.scene.clone(); cc.position.set(-3.5, 0, 0); scene.add(cc);
      camera.position.set(0, 1.6, -7); controls.target.set(-0.5, 1, 0);
      log('scale reference: door 1.3 x 2.3 m, crate, covered car');
    }
  }
  if (mode === 'ads') {
    const wkey = qs.get('w') || 'assault_rifle';
    const loaded = await assets.loadCharacter('soldier');
    const wl = await assets.loadWeapon(wkey);
    const vm = new Viewmodel(assets, loaded, wl, wkey, renderer);
    // simple target range
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.1), new THREE.MeshStandardMaterial({ color: 0xc8b89a, roughness: 0.8 }));
      t.position.set((i - 2) * 2, 0.9, -12 - i * 6); t.castShadow = true; scene.add(t);
    }
    const wall = new THREE.Mesh(new THREE.BoxGeometry(12, 4, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }));
    wall.position.set(0, 2, -45); scene.add(wall);
    controls.enabled = false;
    camera.fov = 75; camera.position.set(0, 1.64, 0); camera.lookAt(0, 1.4, -20); camera.updateProjectionMatrix();
    const adsOn = qs.get('ads') !== '0';
    let t = 0;
    updaters.push((dt) => {
      t += dt;
      const ads = adsOn;
      if (adsOn && qs.get('instant') !== '0') vm.ads = 1;
      vm.update(dt, { ads, moving: 0, sprint: false, camera, baseFov: 75, adsFov: 0.72, sunDir: sun.position.clone().normalize(), env: scene.environment });
      camera.fov = 75 * vm.fovScale; camera.updateProjectionMatrix();
    });
    renderHook = () => vm.render(renderer, scene, camera);
    log(`ADS test — weapon ${wkey}: ${JSON.stringify(vm.weapon.describe())}`);
  }
  for (const e of assets.errors) log(e, 'err');
}

let renderHook = null;
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
run().catch((e) => { log(`ERROR: ${e.message}`, 'err'); console.error(e); }).finally(() => { document.body.dataset.ready = '1'; });
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  for (const u of updaters) u(dt);
  if (controls.enabled) controls.update();
  if (renderHook) renderHook(); else renderer.render(scene, camera);
});
