# STRIKEPOINT

![overview](docs/screenshots/overview.jpg)

A browser-based, realistic-looking modern military FPS in the spirit of large-scale Conquest shooters
(original content — no third-party game assets). Three.js client + Node.js server-authoritative multiplayer,
tuned to run on low-end GPUs.

```
npm install        # installs deps and downloads the default rigged soldier (three.js example asset)
npm start          # http://localhost:3000  (PORT, BOTS=6 per team in the default rooms)
npm run share      # host from your PC and get a public https link for friends anywhere (no account needed)
npm test           # unit + WebSocket integration tests
npm run assets     # (optional) re-download and re-optimize all CC0 source assets into client/assets/
```

## Playing together (rooms)
* **Server browser** lists the public rooms: one always-on room per map (`OUTSKIRTS`, `HARBOR`, `VALLEY`, `ZULU`,
  and the battle royale room `FIRESTORM`) plus any public room players created. Double-click to join.
* **Create room**: pick a map, bots per team (0–16), max players (2–32), optional password, private (hidden from the
  browser) and map rotation. You get a 6-letter **room code**.
* **Invite**: share `https://<your-host>/?room=CODE` — the deploy screen shows the link with a COPY button, or press
  **I** in game. Friends opening the link land on *Join by code* with the code filled in.
* Each room is an independent server-authoritative match (own map, bots, tickets). Empty rooms sleep; private
  rooms close 2 minutes after the last player leaves. With rotation on, the room moves to the next map after each
  round and everyone is carried over automatically.

## Maps
| Map | Size | Flags | Character |
|---|---|---|---|
| **Outskirts** | 336 m | 3 | ruined town crossroads between an industrial yard and a depot, mixed ranges |
| **Harbor Docks** | 300 m | 4 | container terminal on the water: tight container lanes, open quay, warehouse row |
| **Dry Valley** | 384 m | 3 | big hills, winding road, farm, village and fortified hilltop — long sightlines |
| **Checkpoint Zulu** | 184 m | 3 | small walled military compound — fast close-quarters infantry |
| **Kestrel Airbase** | 464 m | 4 | abandoned airfield: hangar row, control tower, fuel depot, radar hill around an open runway |
| **Old Town** | 320 m | 4 | dense historic town: narrow streets, market, church square, train station, mill — close quarters |
| **Kaskar Ridge** | 400 m | 3 | mountain pass: hill village, quarry, fortified ridge line above a gorge road — long sightlines |
| **Firestorm Island** | 840 m | — | **battle royale**: town, villages, farm, industrial yard, military base, radio station, checkpoint |

Maps are plain data in `shared/maps/*.js` (roads, flags, bases, buildings, props, terrain relief, vegetation,
lighting/fog). Server (collision, nav grid, bots) and browser (rendering) generate the same world from it —
add a file there and register it in `shared/map.js` to create a new map.

## Hosting on the internet
| Option | How |
|---|---|
| **Your own PC, instantly** | `npm run share` → prints a public `https://….trycloudflare.com` link (Cloudflare quick tunnel). Works behind routers/NAT; the link lives while the window is open. |
| **Render.com** | Push this repo to GitHub → Render → *New + → Blueprint* → select the repo (`render.yaml`, Docker). |
| **Fly.io** | `fly launch --copy-config --no-deploy && fly deploy` (`fly.toml`). |
| **Any VPS / Docker host** | `docker build -t strikepoint . && docker run -p 80:3000 strikepoint` (put HTTPS in front, e.g. Caddy). |

The client automatically uses `wss://` on HTTPS. Pick a region close to your players: combat is lag-compensated
(the server rewinds targets by each player's ping, up to 250 ms) and remote players are interpolated, so games
across countries stay playable.
Server hardening: per-IP connection cap (`MAX_CONN_PER_IP`, default 8), per-socket message rate limit, room
creation rate limit (5 per 10 min per IP, max 40 rooms), room passwords compared in constant time, sanitised names
and chat, 16 KB max message size, gzip for all text assets.

## Controls
**Phones / tablets (touch, landscape):** left thumb = floating joystick (push to the top rim to sprint) · drag the
right half of the screen to look · hold **FIRE** (drag it to aim while shooting) · **AIM** toggles sights ·
JUMP / CRCH / PRONE / R (reload) / G (grenade) / ⇄ (swap weapon) · top: 👁 third person, ☰ scoreboard, 💬 chat,
❚❚ pause (look sensitivity, invite link, leave room). Deploying goes fullscreen + landscape. Force touch UI on any
device with `?touch=1`.

**Keyboard & mouse:** WASD move · Shift sprint · Space jump · C crouch · Z prone · RMB aim down sights · LMB fire · R reload ·
1/2 or wheel switch weapon · **PgUp / PgDn sight zeroing** · G grenade · **V first/third person** · Tab scoreboard · T/Enter chat · F3 asset debug ·
battle royale: **Space** jump / open parachute · **E** pick up · **H** heal · **M** island map

## Game
* **Conquest**: flags A / B / C, capture by standing in the zone (more soldiers = faster), 300 tickets per team,
  each death costs a ticket, holding more flags bleeds the enemy. Round restarts 15 s after a team hits 0.
* **Battle royale** (Firestorm Island, room `FIRESTORM` or create a room on that map):
  1. **Warm-up** — the match starts 25 s after the first player joins (bots fill the lobby; `ROYALE_BOTS`, `ROYALE_LOBBY`).
  2. **Transport plane** flies a random line across the island (chase camera, flight path on the island map).
     **SPACE / JUMP** to jump once it is over land; anyone still aboard is thrown out at the far coast.
  3. **Freefall** (look down to dive, steer with WASD/stick) → **SPACE** opens the ram-air **parachute**
     (auto-opens at 55 m).
  4. Everyone lands with a pistol and no spare ammo. **Loot** lies inside every building and next to crates, containers
     and wrecks: AR-15, bolt rifle, pistol, ammo boxes, **armor plate kits** (absorb 60 % of hits, 100 max),
     **med kits** (**H**: 3.2 s, +50 HP) and frag grenades. **E** / PICK picks up (swapping drops your old weapon).
  5. The **ring of fire** closes in five stages (wall of flames, 1.5 → 12 HP/s outside); the next safe zone is shown on
     the minimap and on the island map (**M**). **Supply drops** parachute into the next zone (red smoke) with rifles,
     armor and med kits.
  6. **No respawns** — fallen soldiers drop everything they carried; you get your placement and spectate the survivors.
     Last one standing wins, then the next match starts in the same room.
  Everything is server-authoritative (jump window, air-speed limits, pickup range, armor, healing, ring damage).
  Royale bots pick a drop zone along the flight path, loot what they need, run from the ring and fight everyone.
* **Ballistics** (`shared/ballistics.js`, simulated by the server): every bullet is a projectile with the real muzzle
  velocity of its cartridge, air drag, gravity drop and a maximum range; it takes time to arrive (a sniper round needs
  ~0.2 s for 150 m) and each flight segment is lag-compensated against where targets were at that moment.

  | Weapon | Muzzle velocity | Max range | Zeroing (PgUp / PgDn) | Drop at 200 m* |
  |---|---|---|---|---|
  | AR-15 carbine (5.56 mm) | 910 m/s | 700 m | 50 · 100 · 200 · 300 m | ≈ 20 cm |
  | M-38 bolt rifle (7.62 mm) | 830 m/s | 1200 m | 100 · 200 … 800 m | ≈ 19 cm |
  | P-17 pistol (9 mm) | 360 m/s | 220 m | 25 · 50 m | ≈ 1.7 m |

  \* with the default (shortest) zero. Tracers fly at the bullet's speed, impacts appear when it lands, bullets
  passing within ~4 m of you make a supersonic crack. Damage falls off with distance; headshots multiply it.
* **Scopes**: fully aimed through a magnified optic you get a full-screen scope (real ~7° field of view for 4×)
  rendered from the camera itself, so the reticle centre is exactly where the bullet goes. The reticle has mil marks
  for leading movers and **bullet-drop marks** computed from the ballistics for your zeroing (hold "4" on a target at
  400 m). Breathing sway moves the aim — hold **Shift** to steady it for ~4 s.
* **Lag compensation**: every shot carries the moment your screen was showing, so the server checks the bullet against
  where targets really were on your screen (plus the bullet's flight time).
* **Hit feedback**: hits are confirmed by the server when the bullet actually reaches the target — X marker on the
  crosshair with the damage number (gold = headshot, red = kill, distance for long shots) and a hit sound; the
  crosshair turns red while it is on an enemy; the victim sees the damage direction.
* **Movement physics** (`shared/world.js`): real gravity (9.81 m/s²), ≈ 0.55 m standing jump, identical at any frame
  rate (fixed 120 Hz sub-steps, exact integration); momentum is kept in the air with only light air control; chained
  jumps lose height; hard landings slow you briefly; falls above 3.2 m cause damage (≈ 10 m is lethal).
* **Kits**: Assault (automatic carbine, pistol, 2 frags) · Recon (4× scoped bolt-action rifle, pistol, 1 frag).
* **Server-authoritative**: the server owns ammo, fire rate, damage, hit detection (lag-compensated hitscan
  against capsule hitboxes; walls/cover block shots; headshot multipliers; range falloff), grenades (simulated
  bounce + line-of-sight blast), capture, tickets, respawn, chat rate limiting and movement sanity checks.
* **Bots** play like people: A* navigation with smooth steering and turning (no snapping), sprint only on long clear
  stretches, walk and glance around near danger; in a fight they settle into one firing position, stop to shoot at range,
  close in when out of their weapon's range, fire controlled bursts, run to real cover when hurt, then peek; they
  search where they last saw you and watch approach routes while holding a flag. Line-of-sight perception, reaction
  time, converging aim error, bullet-drop hold-over and target leading, grenades.
* **AI Zone** (lobby tab): play with a soldier commanded by a **language model**. Set the provider, **base URL,
  model and API key** — *Anthropic (Claude)* uses the official Anthropic SDK (default model `claude-opus-5`),
  *OpenAI-compatible* covers OpenRouter, Groq, Together, vLLM, LM Studio and similar `/chat/completions` endpoints.
  Every few seconds the model gets a battlefield report (flags, tickets, its health/ammo, teammates, spotted
  enemies, radio messages) and answers with orders — go to flag, move, follow a player, attack, hold, take cover,
  change stance, say something on the radio; the bot brain executes them. Talk to it with **T** ("Claude, follow
  me", "take B"). *TEST CONNECTION* checks the settings first. The key is kept only in the server's memory for the
  room's lifetime; AI rooms are private. For local models on your own PC run the server with `AI_ALLOW_LOCAL=1`
  (otherwise only public `https://` endpoints are accepted).

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
| Transport plane (lofted fuselage, airfoil wings, turboprops with spinning props, painted panel lines, nav lights) | `client/js/royale/TransportPlane.js` |
| Effects (pooled particles, tracers, decals, per-surface impacts, explosions, smoke) · spatial audio (**recorded CC0 gunshots** with per-shot variation, distance muffling, speed-of-sound delay; synthesized foley) · HUD | `client/js/fx`, `client/js/audio`, `client/js/ui` |

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
* Gunshots: real recordings from *The Free Firearm Sound Library* (OpenGameArt, **CC0**) — see
  `client/assets/audio/README.md`.

### Graphics cards (laptops with NVIDIA / AMD / Intel Arc)
* The game asks the browser for the **high-performance GPU** and the menu shows which GPU it really got
  (e.g. `NVIDIA GeForce RTX 3060 Laptop GPU · dedicated graphics card`).
* The quality preset is picked from that GPU: **ULTRA** (RTX 20–50 series, Radeon RX 6600+), **HIGH** (other GeForce
  GTX/RTX, Radeon RX, Intel Arc A/B, Apple M Pro/Max), MEDIUM (MX / Iris Xe / Radeon 680M–780M / Apple M), LOW
  (other integrated), VERY LOW (phones, software rendering). A **USE HIGH/ULTRA** button appears if your saved
  setting is below what the card can do.
* HIGH / ULTRA: 4096² shadows refreshed every frame over 80 / 110 m, 640 / 820 m view distance, denser grass and
  farther tree detail, 8× / 16× anisotropic filtering, up to 1.5× / 2× render resolution, 1024² sniper scope.
* **Dual-GPU laptops** often run the browser on the integrated chip anyway. The menu then shows step-by-step fixes:
  Windows *Settings → System → Display → Graphics → your browser → High performance*, NVIDIA Control Panel
  (*Program Settings → chrome.exe → High-performance NVIDIA processor*) / AMD Adrenalin, plug in the charger,
  restart the browser. If hardware acceleration is off it says how to turn it on.
* If the laptop switches GPU or the driver resets mid-game, the page rejoins the same room automatically.
* In game (**Esc**): switch preset (VERY LOW … ULTRA), render scale (AUTO keeps the frame rate, or fixed 50–200 %),
  view distance (150–1000 m), FPS / GPU counter.
* Still showing Intel after choosing the NVIDIA card in Windows? Chrome keeps running in the background — quit it
  completely (⋮ → Exit, and turn off *Continue running background apps*), or add `--force_high_performance_gpu` to the
  Chrome shortcut's *Target*, or set `chrome://flags/#use-angle` to *D3D11on12*. `chrome://gpu` shows the GPU in use.

### Performance (VERY LOW … ULTRA presets)
Instanced props/vegetation, tree LOD0 → LOD1 → baked billboard impostors, distance-streamed grass, chunked
terrain with frustum culling, shared materials/texture sets, single shared GLB per asset with skeleton-aware
cloning, pooled particles/decals/tracers.
* **Dynamic resolution**: the render scale drops automatically when frames take longer than ~22 ms and recovers
  when there is headroom (the FPS counter shows the current `res %`).
* **Shadows**: texel-snapped cascade around the camera, re-rendered only every 2nd (MEDIUM) / 3rd (LOW) frame;
  VERY LOW has no shadow pass, no grass and shorter fog/draw distance (default on phones).
* **Soldiers**: frustum-culled animation (off-screen = 4 Hz), distance-based animation rate, finger IK only up close.
* **No hitches**: all shaders are compiled during loading; the camera far plane ends at the fog; minimap at 12 Hz.
* **Network**: adaptive interpolation buffer (grows with measured jitter), 20 Hz snapshots.
* `?perf=1` shows per-system CPU time per frame (also `window.__perf`).

### Playtest
`npm run playtest:royale` (server running with `DEV_TELEPORT=1 ROYALE_LOBBY=50`) plays a battle royale match in a real
browser: lobby, plane, jump, freefall, parachute, landing, loot pickup, armor, island map, death, placement, spectating.
`npm run playtest:mobile -- <map>` does the same on an emulated phone with real multi-touch events (24 checks).
`npm run playtest -- <map>` (server running with `DEV_TELEPORT=1 BOTS=0`) drives a real browser client plus a second
network client through ~30 checks: movement, stances, jump, weapon switch, ADS + firing with server damage, reload, kill,
kill feed/score, death/deploy/respawn, grenade, chat, third person, scoreboard.

### Visual test tooling
`scripts/shot.mjs` (debug scenes) and `scripts/gameshot.mjs` (scripted in-game camera tour, run the server with
`DEV_TELEPORT=1`) capture screenshots with headless Chromium; `docs/screenshots/` holds the latest captures.
