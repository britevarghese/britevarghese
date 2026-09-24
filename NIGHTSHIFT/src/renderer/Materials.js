// Shared material library for the world. A handful of materials are reused by every chunk
// (keeps draw calls & shader programs low). Night/wetness state updates these in place.
import * as THREE from 'three';
import * as TX from './Textures.js';
import { lerp } from '../core/util.js';

export class Materials {
  constructor(preset) {
    this.preset = preset;
    const lowEnd = preset.textureSize <= 256;
    const A = TX.asphalt();
    this.asphaltTex = A;
    this.road = new THREE.MeshStandardMaterial({
      name: 'road', map: A.map, normalMap: lowEnd ? null : A.normalMap, roughnessMap: A.roughnessMap, roughness: 1, metalness: 0,
      normalScale: new THREE.Vector2(0.6, 0.6), color: 0xffffff, envMapIntensity: 0.4,
    });
    const S = TX.concrete(4, 3, 150);
    this.sidewalk = new THREE.MeshStandardMaterial({ name: 'sidewalk', map: S.map, normalMap: lowEnd ? null : S.normalMap, roughness: 0.92, color: 0xb8b4ac, envMapIntensity: 0.3 });
    const C = TX.concrete(1, 9, 175);
    this.curb = new THREE.MeshStandardMaterial({ name: 'curb', map: C.map, roughness: 0.85, color: 0xc8c4bc });
    this.concreteWall = new THREE.MeshStandardMaterial({ name: 'concreteWall', map: TX.concrete(2, 13, 140).map, normalMap: lowEnd ? null : TX.concrete(2, 13, 140).normalMap, roughness: 0.9, color: 0x9a9690 });
    this.facades = TX.FACADE_DEF.map((def, i) => {
      const F = TX.facade(i);
      return new THREE.MeshStandardMaterial({
        name: 'facade_' + def.name, map: F.map, emissiveMap: F.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1,
        roughnessMap: F.ormMap, metalnessMap: F.ormMap, roughness: 1, metalness: 1,
        normalMap: lowEnd ? null : F.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), envMapIntensity: def.metal ? 1.2 : 0.6,
      });
    });
    // far/LOD version: no normal/roughness maps (cheaper)
    this.facadesFar = TX.FACADE_DEF.map((def, i) => {
      const F = TX.facade(i);
      return new THREE.MeshLambertMaterial({ name: 'facadeFar_' + def.name, map: F.map, emissiveMap: F.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1 });
    });
    const SF = TX.storefront();
    this.storefront = new THREE.MeshStandardMaterial({ name: 'storefront', map: SF.map, emissiveMap: SF.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.3, roughness: 0.35, metalness: 0.2 });
    const N = TX.neonAtlas();
    this.neon = new THREE.MeshBasicMaterial({ name: 'neon', map: N.map, color: 0xffffff, toneMapped: false, transparent: false });
    this.markings = new THREE.MeshStandardMaterial({
      name: 'markings', map: TX.markingsAtlas(), transparent: true, roughness: 0.6, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, envMapIntensity: 0.3,
    });
    const RF = TX.roofTex();
    this.roof = new THREE.MeshStandardMaterial({ name: 'roof', map: RF.map, normalMap: lowEnd ? null : RF.normalMap, roughness: 0.95, color: 0x8a8a8a });
    const SH = TX.shingles();
    this.shingles = [0x5a3a30, 0x3a3e44, 0x4a4038, 0x2e3a30, 0x5e5048, 0x383030].map((c, i) => new THREE.MeshStandardMaterial({ name: 'shingles' + i, map: SH.map, normalMap: lowEnd ? null : SH.normalMap, roughness: 0.9, color: c }));
    this.grass = new THREE.MeshStandardMaterial({ name: 'grass', map: TX.grass().map, roughness: 1, color: 0xffffff });
    const D = TX.dirt();
    this.dirt = new THREE.MeshStandardMaterial({ name: 'dirt', map: D.map, normalMap: lowEnd ? null : D.normalMap, roughness: 1 });
    this.water = new THREE.MeshStandardMaterial({ name: 'water', color: 0x0a1418, roughness: 0.08, metalness: 0.3, normalMap: TX.waterNormal(), normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 1.4 });
    const CT = TX.containerTex();
    this.container = new THREE.MeshStandardMaterial({ name: 'container', map: CT.map, normalMap: lowEnd ? null : CT.normalMap, roughness: 0.7, metalness: 0.4, vertexColors: false });
    this.metal = new THREE.MeshStandardMaterial({ name: 'metal', color: 0x4a4e54, roughness: 0.45, metalness: 0.8 });
    this.darkMetal = new THREE.MeshStandardMaterial({ name: 'darkMetal', color: 0x1e2226, roughness: 0.5, metalness: 0.7 });
    this.paintedMetal = new THREE.MeshStandardMaterial({ name: 'paintedMetal', color: 0x2a4a3a, roughness: 0.55, metalness: 0.5 });
    this.yellowMetal = new THREE.MeshStandardMaterial({ name: 'yellowMetal', color: 0xd09a18, roughness: 0.5, metalness: 0.4 });
    this.plastic = new THREE.MeshStandardMaterial({ name: 'plastic', color: 0x1a1a1a, roughness: 0.6 });
    this.orange = new THREE.MeshStandardMaterial({ name: 'orange', color: 0xff5a10, roughness: 0.6 });
    this.white = new THREE.MeshStandardMaterial({ name: 'white', color: 0xdddddd, roughness: 0.6 });
    this.bark = new THREE.MeshStandardMaterial({ name: 'bark', color: 0x3a2c22, roughness: 1 });
    // leaf cards are emitted front+back with crown-space normals, so single-sided is correct
    this.leaves = new THREE.MeshStandardMaterial({ name: 'leaves', map: TX.leaves(), alphaTest: 0.4, roughness: 0.85, color: 0xd4e4c0 });
    this.lampHead = new THREE.MeshBasicMaterial({ name: 'lampHead', color: 0xffe6b8, toneMapped: false });
    this.lampHeadCool = new THREE.MeshBasicMaterial({ name: 'lampHeadCool', color: 0xd8e8ff, toneMapped: false });
    // rooftop water tanks and storefront awnings
    this.tankWood = new THREE.MeshStandardMaterial({ name: 'tankWood', map: TX.concrete(1, 21, 120).map, roughness: 0.95, color: 0x6a4c36 });
    this.awning = new THREE.MeshStandardMaterial({ name: 'awning', map: TX.awningAtlas(), roughness: 0.9, side: THREE.DoubleSide });
    // aviation obstruction lights on tall roofs (blink driven by WorldManager)
    this.beacon = new THREE.MeshBasicMaterial({ name: 'beacon', color: 0xff1a0a, toneMapped: false });
    this.glassDark = new THREE.MeshStandardMaterial({ name: 'glassDark', color: 0x0c1218, roughness: 0.05, metalness: 0.6, envMapIntensity: 1.3 });
    // additive light pools on the ground (fake street lighting)
    this.lightPool = new THREE.MeshBasicMaterial({
      name: 'lightPool', map: TX.lightPool(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexColors: false, opacity: 0.55, fog: true,
    });
    // wet reflection streaks
    this.streak = new THREE.MeshBasicMaterial({
      name: 'streak', map: TX.streak(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, opacity: 0.0,
    });
    this.glow = new THREE.SpriteMaterial({ map: TX.radialGlow(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, color: 0xffd8a0 });
    this.signalRed = new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false });
    this.signalYellow = new THREE.MeshBasicMaterial({ color: 0xffa010, toneMapped: false });
    this.signalGreen = new THREE.MeshBasicMaterial({ color: 0x20ff80, toneMapped: false });
    this.signalOff = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 });
  }

  // called by Environment on time/weather change
  applyEnvironment(state) {
    const night = state.night;
    // interior lights are nearly invisible in daylight, glow at night
    const lit = Math.max(0, night);
    for (const m of this.facades) m.emissiveIntensity = 0.012 + lit * 0.8;
    for (const m of this.facadesFar) m.emissiveIntensity = 0.012 + lit * 0.8;
    this.storefront.emissiveIntensity = 0.03 + lit * 0.6;
    this.neon.color.setScalar(0.35 + night * 1.6);
    const lamps = night > 0.35 ? 1 : 0.15;
    this.lampHead.color.setRGB(1.0 * lamps * 2.4, 0.9 * lamps * 2.4, 0.72 * lamps * 2.4);
    this.lampHeadCool.color.setRGB(0.85 * lamps * 2.2, 0.92 * lamps * 2.2, 1.0 * lamps * 2.2);
    this.lightPool.opacity = Math.max(0, night - 0.3) * (0.36 + state.wetness * 0.15);
    this.lightPool.visible = night > 0.32;
    // wet roads: lower roughness, stronger env reflection, darker albedo
    const w = state.wetness;
    const wetOK = this.preset.wetReflections;
    this.road.roughnessMap = w > 0.3 ? this.asphaltTex.wetRoughnessMap : this.asphaltTex.roughnessMap;
    this.road.roughness = lerp(1, 0.55, w);
    this.road.color.setScalar(lerp(1, 0.62, w));
    this.road.envMapIntensity = lerp(0.35, wetOK ? 1.6 : 0.8, w);
    this.road.needsUpdate = true;
    this.sidewalk.roughness = lerp(0.92, 0.5, w); this.sidewalk.color.setHex(0xb8b4ac).multiplyScalar(lerp(1, 0.7, w));
    this.markings.roughness = lerp(0.6, 0.42, w);
    // road paint is far from pure white (and dims when wet) — keeps lamp-lit dashes from blowing out
    this.markings.color.setScalar(lerp(0.78, 0.6, w));
    this.streak.opacity = wetOK ? w * Math.max(0, night - 0.3) * 0.9 : 0;
    this.streak.visible = this.streak.opacity > 0.01;
    this.glow.opacity = Math.max(0, night - 0.3) * 1.2;
  }
}
