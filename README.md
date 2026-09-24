# STRIKEPOINT

![overview](docs/screenshots/overview.jpg)

A browser-based, realistic-looking modern military FPS in the spirit of large-scale Conquest shooters
(original content — no third-party game assets). Three.js client + Node.js server-authoritative multiplayer,
tuned to run on low-end GPUs.

```
npm install        # installs deps and downloads the default rigged soldier (three.js example asset)
npm start          # http://localhost:3000   (BOTS=8 per team by default; PORT=3000)
npm test           # unit + WebSocket integration tests
npm run assets     # (optional) re-download and re-optimize all CC0 source assets into client/assets/
```

Open the page, pick a callsign/quality, **JOIN BATTLE**, choose a kit and spawn point, **DEPLOY**.
Open a second browser tab/computer on the same server to play together; bots fill both teams.

## Controls
WASD move · Shift sprint · Space jump · C crouch · Z prone · RMB aim down sights · LMB fire · R reload ·
1/2 or wheel switch weapon · G grenade · **V first/third person** · Tab scoreboard · T/Enter chat · F3 asset debug

## Game
* **Conquest**: flags A / B / C, capture by standing in the zone (more soldiers = faster), 300 tickets per team,
  each death costs a ticket, holding more flags bleeds the enemy. Round restarts 15 s after a team hits 0.
* **Kits**: Assault (automatic carbine, pistol, 2 frags) · Recon (4× scoped bolt-action rifle, pistol, 1 frag).
* **Server-authoritative**: the server owns ammo, fire rate, damage, hit detection (lag-compensated hitscan
  against capsule hitboxes; walls/cover block shots; headshot multipliers; range falloff), grenades (simulated
  bounce + line-of-sight blast), capture, tickets, respawn, chat rate limiting and movement sanity checks.
* **Bots**: A* navigation over a nav grid built from the collision world, objective selection, line-of-sight
  perception, reaction time, converging aim error, burst fire, stance changes, grenades.

## Visual architecture (asset-driven — no primitive soldiers/guns)
| Layer | File |
|---|---|
| Asset manifest (candidate files, sockets, overrides) | `client/assets/asset-manifest.json` |
| Asset manager (GLTFLoader, cache, SkeletonUtils clone, HDRI, texture sets, **loud missing-asset errors**) | `client/js/core/AssetManager.js` |
| Weapon normalization + sockets (rightGrip, leftGrip, stock, muzzle, opticEye) + real optic glass/reticle | `client/js/weapons/WeaponModel.js` |
| Skeleton discovery / bone + clip mapping | `client/js/character/BoneMap.js` |
| Character rig: anim blending, speed-synced locomotion, crouch via leg IK, prone, death, aim spine, head look, stock-to-shoulder, **two-bone arm IK to the weapon grips**, finger curl, alignment validation | `client/js/character/CharacterRig.js`, `IK.js` |
| First-person viewmodel (same character arms + weapon), hip↔ADS interpolation to the optic eye point, scope picture-in-picture with reticle, sway/bob/recoil/reload/switch | `client/js/player/Viewmodel.js` |
| World: PBR splat terrain + outer landscape, roads, modular buildings with interiors & stairs, instanced props, vegetation LOD0/LOD1/impostors + streamed grass, flags, skyline | `client/js/world/*` |
| Lighting: HDRI IBL + sky, sun with texel-snapped soft shadows, hemisphere fill, fog, ACES | `client/js/render/Renderer.js` |
| Effects (pooled particles, tracers, decals, per-surface impacts, explosions, smoke) · spatial audio (synthesized) · HUD | `client/js/fx`, `client/js/audio`, `client/js/ui` |

### Debug scenes
`/debug/character`, `/debug/weapon?w=bolt_rifle`, `/debug/character-weapon?view=side`, `/debug/ads?w=bolt_rifle`,
`/debug/scale` — isolated renders of the real assets with socket markers (green = right grip, blue = left grip,
magenta = stock, yellow = muzzle, red = optic eye) and an attachment report
(`rightGripOffset`, `leftGripOffset`, `stockToShoulder`, `muzzleAlignDeg`). Asset diagnostics (meshes, materials,
textures, skeletons, bones, animations, nodes) are printed to the browser console.

### Using your own models
Put GLBs in `client/assets/user/` (see the README there) — e.g. `characters/soldier.glb`,
`characters/fsb_operator.glb`, `weapons/ss2_v5_assault_rifle.glb`. They override the defaults automatically;
if a file listed nowhere can be found the game logs `FAILED TO LOAD …` instead of silently drawing primitives.
Convert your own `.blend` files with `blender -b file.blend --python scripts/blend2glb.py -- out.glb`.

### Default assets & licenses
* Props, weapons (bolt-action rifle with PU-style scope, service pistol, grenade), trees, grass, shrubs, rocks,
  PBR textures and the sky HDRI: **Poly Haven, CC0** — fetched and optimized by `scripts/build-assets.mjs`
  (meshoptimizer simplification, foliage thinning, opacity-map baking, WebP textures).
* Default soldier: three.js example `Soldier.glb` (Mixamo) — downloaded at install time, not redistributed.

### Performance (LOW / MEDIUM presets)
Instanced props/vegetation, tree LOD0 → LOD1 → baked billboard impostors, distance-streamed grass, chunked
terrain with frustum culling, shared materials/texture sets, single shared GLB per asset with skeleton-aware
cloning, reduced-rate animation for distant soldiers, pooled particles/decals/tracers, texel-snapped shadow
cascade around the camera (LOW: 1024² / 38 m, MEDIUM: 2048² / 70 m), LOW renders at 0.8× resolution.

### Visual test tooling
`scripts/shot.mjs` (debug scenes) and `scripts/gameshot.mjs` (scripted in-game camera tour, run the server with
`DEV_TELEPORT=1`) capture screenshots with headless Chromium; `docs/screenshots/` holds the latest captures.
