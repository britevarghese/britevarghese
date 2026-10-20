// WebGL renderer, scene, camera, sun and sky light, fog and shadows that follow the player; on 'high' and 'medium'
// graphics the frame goes through post-processing (render/Post.js: motion blur, bloom, a filmic grade).
import * as THREE from 'three';
import { Sky } from './Sky.js';
import { Post } from './Post.js';
import { Probe } from './Probe.js';

// The haze (every material's fog, replacing three.js's): the air between the camera and what it sees scatters light
// toward the eye (Beer-Lambert: a share 1 - exp(-optical depth) of the colour becomes the haze's), and the air thins
// with height (an exponential atmosphere, 300 m scale height above the sea): valleys are hazier than the hilltops,
// and looking down into one from a pass shows it so. Looking toward the sun the haze glows with it. The scene's
// FogExp2 density is the haze at sea level per metre; a plain Fog (the garage) keeps its near-far ramp.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vFogView;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogView = mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float fogAmount() {
    #ifdef FOG_EXP2
      vec3 w = (vec4(vFogView, 0.0) * viewMatrix).xyz;          // camera to point, in the world
      float k = w.y / 300.0;
      float along = abs(k) > 1e-3 ? (1.0 - exp(-k)) / k : 1.0;   // (the air thinning along the ray)
      return 1.0 - exp(-fogDensity * exp(-max(cameraPosition.y, -50.0) / 300.0) * length(w) * along);
    #else
      return smoothstep(fogNear, fogFar, -vFogView.z);
    #endif
  }
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  vec3 fogC = fogColor;
  #ifdef FOG_SUN
    float fogMu = max(dot(normalize(vFogView), directionalLights[0].direction), 0.0);
    fogC += directionalLights[0].color * (pow(fogMu, 10.0) * 0.07 + pow(fogMu, 3.0) * 0.012);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogC, fogAmount());
#endif`;
// (lit materials know the sun: the first directional light)
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin + '\n#if NUM_DIR_LIGHTS > 0\n#define FOG_SUN\n#endif\n';

// The sun's shadow in two cascades: the wide map (the sun's own, 140 m across) and a near one (40 m across round what
// the camera follows, its texels under a third the size: the truck's shadow and the leaves' under it sharp), cast by a
// second sun that gives no light of its own. Where the near map covers, its shadow; faded into the wide one's at its
// edge. (Only where two directional lights cast shadows: the game's world; the garage's one sun is as it was.)
THREE.ShaderChunk.shadowmap_pars_fragment += `
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
  float sunShadow() {
    vec3 p = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
    float edge = max( abs( p.x - 0.5 ), abs( p.y - 0.5 ) ) * 2.0;
    bool inNear = edge < 1.0 && p.z <= 1.0;
    float wide = 1.0;
    if ( !inNear || edge > 0.8 ) wide = getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] );
    if ( !inNear ) return wide;
    float near = getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] );
    return mix( near, wide, smoothstep( 0.8, 1.0, edge ) );
  }
#endif`;
const DIR_SHADOW = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
const CASCADES = THREE.ShaderChunk.lights_fragment_begin.includes(DIR_SHADOW);
if (CASCADES) {
  THREE.ShaderChunk.lights_fragment_begin = THREE.ShaderChunk.lights_fragment_begin.replace(DIR_SHADOW, `
    #if ( UNROLLED_LOOP_INDEX == 0 ) && NUM_DIR_LIGHT_SHADOWS > 1
      directLight.color *= ( directLight.visible && receiveShadow ) ? sunShadow() : 1.0;
    #elif ( UNROLLED_LOOP_INDEX != 1 ) || NUM_DIR_LIGHT_SHADOWS < 2
      ${DIR_SHADOW}
    #endif`);
} else console.warn('shadows: three.js\'s light chunk has changed; one shadow cascade only');

export class Renderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.tabIndex = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.2, 9000);
    this.camera.position.set(0, 120, 0);

    this.sky = new Sky(this.scene);
    this.envOn = true;
    this.envAt = -1e9;
    this.scene.environmentIntensity = 0.75;
    this.fog = new THREE.FogExp2(0xc9d6e2, 0.00038 * 0.45);
    this.scene.fog = this.fog;

    this.hemi = new THREE.HemisphereLight(0xc5d6ee, 0x52503a, 0.8);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    // the near cascade's sun (no light: its colour stays black; added after the sun, so the sun stays the first)
    this.sunNear = new THREE.DirectionalLight(0x000000, 0);
    this.sunNear.castShadow = CASCADES;
    this.sunNear.shadow.mapSize.set(2048, 2048);
    const nc = this.sunNear.shadow.camera;
    nc.left = -20; nc.right = 20; nc.top = 20; nc.bottom = -20; nc.near = 10; nc.far = 600;
    this.sunNear.shadow.bias = -0.0003;
    this.sunNear.shadow.normalBias = 0.02;
    this.scene.add(this.sunNear);
    this.scene.add(this.sunNear.target);
    this.focus = new THREE.Vector3();
    this.hour = 16.5;
    this.setTime(this.hour);
    // post-processing, where the browser can draw into floating-point targets; subject: the player's truck model (it
    // moves with the camera: the motion blur leaves it sharp; on 'high' it reflects the world round it, render/Probe.js)
    this.post = Post.supported(this.renderer) ? new Post(this.renderer) : null;
    this.postOn = !!this.post;
    this.probe = null;
    this.probeOn = !!this.post;
    this.subject = null;

    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /**
   * A map's air: how thick the haze is (fog density) and how much of the sky is cloud (0.47 fair; lower, more cloud):
   * Kerala's humid hills are hazier and cloudier than Ashwood's.
   */
  setAtmosphere({ fog = 0.00038, cover = 0.47 } = {}) {
    // (the maps' haze was set for a squared-exponential fog; the haze above is plain exponential, which this makes
    // about as thick two kilometres out and clearer near to)
    this.fog.density = fog * 0.45;
    this.sky.uniforms.uCover.value = cover;
    this.sky.envDirty = true;
  }

  setTime(hour) {
    this.hour = hour;
    const s = this.sky.setTime(hour);
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.moon = s.el < 1;
    if (this.moon) {
      // after dusk a cool moonlight from high in the south-west keeps the hills readable
      this.sun.color.set(0x9db4ff);
      this.sun.intensity = 0.55 * Math.min(1, (1 - s.el) / 6);
    }
    this.hemi.color.copy(s.hemiSky);
    this.hemi.groundColor.copy(s.hemiGround);
    // the sky's environment map gives most of the sky light; the hemisphere light keeps the shadows from going black
    this.hemi.intensity = s.hemiI * (this.envOn ? 0.45 : 1);
    this.fog.color.copy(s.fog);
    this.renderer.setClearColor(s.fog);
    this.night = s.el < 2;
    this.dark = Math.min(1, Math.max(0, (3 - s.el) / 6));      // (0 by day, 1 when the sun is 3 degrees down)
    return s;
  }

  /** Graphics level: 'high' | 'medium' | 'low' (resolution and shadow detail). */
  setQuality(q) {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 1.75) : q === 'medium' ? Math.min(dpr, 1.25) : Math.min(dpr, 1) * 0.85);
    const size = q === 'low' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose(); this.sun.shadow.map = null;
    }
    // (the near cascade on 'high' and 'medium': on 'low', the one wide map)
    this.cascades = CASCADES && q !== 'low';
    this.sunNear.castShadow = this.cascades && this.renderer.shadowMap.enabled;
    this.postOn = !!this.post && q !== 'low';
    if (this.postOn) this.post.setQuality(q);
    this.probeOn = !!this.post && q === 'high';
    if (!this.probeOn) this.probe?.detach();
    this.resize();
  }

  setShadows(on) {
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.sunNear.castShadow = on && (this.cascades ?? CASCADES);
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Keep the sun's shadow box centred on what we look at (snapped to texels so shadows don't shimmer). */
  updateSun(focus) {
    const d = this.moon ? this._moonDir || (this._moonDir = { x: -0.45, y: 0.75, z: 0.5 }) : this.sky.sunDir;
    const texel = 140 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fy = Math.round(focus.y / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + d.x * 300, fy + Math.max(0.15, d.y) * 300, fz + d.z * 300);
    this.sun.target.updateMatrixWorld();
    // the near cascade: the same sun, its box snapped to its own (smaller) texels
    const tn = 40 / this.sunNear.shadow.mapSize.x;
    const nx = Math.round(focus.x / tn) * tn, ny = Math.round(focus.y / tn) * tn, nz = Math.round(focus.z / tn) * tn;
    this.sunNear.target.position.set(nx, ny, nz);
    this.sunNear.position.set(nx + d.x * 300, ny + Math.max(0.15, d.y) * 300, nz + d.z * 300);
    this.sunNear.target.updateMatrixWorld();
  }

  render() {
    const now = performance.now();
    const gap = (now - (this.lastRender ?? now)) / 1000;
    this.frameDt = Math.min(0.1, gap);
    if (gap > 0.25) this.camera.userData.cut = true;     // (after a long stall, such as a hidden tab: no motion to blur)
    this.sky.update(this.frameDt);
    this.lastRender = now;
    // the sky's light, made again (at most a few times a second) when the time of day changes
    if (this.envOn && this.sky.envDirty && now - this.envAt > 300) {
      this.scene.environment = this.sky.environment(this.renderer);
      this.envAt = now;
    }
    this.sky.follow(this.camera);
    if (this.postOn) this.post.render(this.scene, this.camera, this.frameDt ?? 1 / 60, this.subject?.root);
    else this.renderer.render(this.scene, this.camera);
    // a face of the world round the player's truck, for its reflections (after the frame: its shadows are drawn)
    if (this.probeOn && this.subject) {
      this.probe ||= new Probe();
      if (this.probe.model !== this.subject) this.probe.attach(this.subject, this.scene.environmentIntensity);
      this.probe.update(this.renderer, this.scene);
    }
  }
}
