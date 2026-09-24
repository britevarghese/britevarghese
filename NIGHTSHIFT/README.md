# NIGHTSHIFT

An original open-world night street-racing game that runs in the browser. You drive
through the fictional city of **Port Halvern**, enter street races and lose police pursuits.
There is nothing to install for players. They open `http://SERVER_IP:3000` in Chrome, Edge
or Firefox.

- **Engine:** Three.js.
  - The default renderer is WebGL2 (validated).
  - WebGPU can be selected in *Settings → Renderer*. If the WebGPU device fails at runtime,
    the game switches back to WebGL2 by itself.
- **Assets:** everything is original.
  - Vehicles are generated GLB models, built by `tools/generate-models.mjs`.
  - Textures are generated procedurally at the resolution the quality level asks for.
  - Audio is synthesized with the Web Audio API.
  - No third-party game assets, branding or music are used.

## Quick start (host)

| Platform | How |
|---|---|
| Windows (easiest) | Run `NIGHTSHIFT_SERVER_SETUP.exe`, then **Start Nightshift Server** (Node is bundled). |
| Windows (source) | Install Node.js 18+ and double-click `start.bat` |
| Linux / macOS | `./start.sh` or `node server.js` |

The server binds to `0.0.0.0:3000` and prints every address players can use:

```
========================================
 NIGHTSHIFT SERVER
========================================
 Server started.
 LOCAL:  http://localhost:3000
 LAN:    http://192.168.1.100:3000
 RADMIN: http://26.x.x.x:3000
 PORT:   3000
========================================
```

To use a different port, run `node server.js --port 8080` or edit `config.json`. The server has
no npm dependencies. For firewall setup, Radmin VPN and troubleshooting, see
[docs/HOSTING.md](docs/HOSTING.md).

To build the Windows installer and portable zip, run `npm install` and then
`npm run installer`. This needs `makensis` and downloads a portable Node runtime. The output
goes to `dist/`.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake-reverse | W / S | RT / LT |
| Steer | A / D | Left stick |
| Handbrake (drift) | SPACE | A |
| Nitrous | SHIFT | RB |
| Camera (close, chase, far, bumper, hood, cockpit) | V | Y |
| Look around / look back | Right-mouse drag / C | Right stick / X |
| Map | M | View |
| Start event / enter garage | E (while stopped in a marker) | A |
| Reset car | R | LB |
| Pause | ESC | Start |
| Developer stats | F3 | |
| Fullscreen | F11 | |

## Gameplay

- **Free roam:** the city has downtown, the Market District, Ironworks (industrial), Dockside
  warehouses, Elm Heights (suburbs), a riverside with bridges, a tunnel, a parking deck, a
  construction zone with jumps, and a six-lane ring highway.
- **Races:**
  - Sprint, Circuit, Checkpoint, Speed Run (speed traps), Time Trial and Police Escape.
  - Checkpoints are 3D gates that must be passed in order.
  - AI opponents have mild rubber-banding.
- **Police:**
  - Units patrol, detect you and pursue you.
  - They call backup, send intercept units and set up roadblocks on the road graph at heat 4+.
  - Heat runs from 1 to 5.
  - Evading starts a cooldown. Staying slow while surrounded gets you **BUSTED**.
- **Garage:**
  - Four cars: sports, tuner, muscle and exotic.
  - Visual changes: paint, finish, secondary color, vinyl, wheels, wheel color, spoiler, hood,
    bumper kit, window tint and brake calipers. These change the 3D car.
  - Performance upgrades: engine, transmission, tires, brakes, suspension and nitrous. These
    change the physics.
- **Progress:** cash, reputation, owned cars, upgrades, race wins and settings are saved in
  `localStorage`.

## Architecture

```
server.js, server/        zero-dependency static host + optional WebSocket multiplayer foundation
public/                   index.html, CSS, vendored three.js, generated GLB models
src/core/                 Game loop, GameState, Input, Settings, SaveSystem, QualityManager, EventBus
src/renderer/             RendererManager (WebGPU/WebGL2), PostFX, Environment (time/weather/sky),
                          Materials, procedural Textures, Effects (particles, skid marks)
src/world/                CityLayout (road graph, districts), CityPlanner (buildings, props, colliders),
                          ChunkBuilder/ChunkManager (CITY_CHUNK_X_Z streaming), Props (instancing),
                          LightSystem (fake street lighting), Pedestrians
src/physics/              VehiclePhysics (tire model, weight transfer, suspension, drift assist), Collision
src/vehicles/             Vehicle, VehicleRenderer (4-wheel rig, lights, damage, customization), AIDriver, catalog
src/traffic/              LaneGraph, TrafficManager (IDM, signals, lane changes), TrafficRenderer (instanced)
src/police/ src/races/    PoliceManager, RaceManager, RaceEvents
src/camera/ src/audio/    CameraController, procedural AudioManager
src/ui/                   HUD, minimap/world map (2D), menus, settings, garage
src/networking/           NetworkClient (state replication + interpolation)
tools/                    model generator, installer build scripts
```

### Performance

- **Quality levels:** Very Low, Low, Medium, High and Ultra.
  - On first launch the game picks one automatically from a GPU heuristic plus a short
    benchmark. It never auto-selects Ultra.
  - Every setting can be overridden in Settings.
- **Streaming:** the city streams in 160 m chunks.
  - Near chunks get markings, storefronts, signs and roof detail.
  - Far chunks use cheaper facade materials.
  - Chunks outside the view distance are unloaded.
- **Instancing:** street furniture, traffic cars (per type and material), wheels, pedestrians,
  light pools, halos and particles are all InstancedMeshes, so draw calls stay low.
- **Lighting:** street lighting is faked with additive light pools and wet-road reflection
  streaks. Only the player headlights and a few police lights are real lights.

### Multiplayer

The game is single-player for now, but multiplayer is started. `node server.js --multiplayer`
enables `/ws`. The server validates every state update, clamping speed and rejecting
teleports, and broadcasts snapshots at 20 Hz. Clients interpolate the other players.

## Regenerating models

```sh
npm install        # installs three.js (dev only)
npm run models     # writes public/assets/models/*.glb
```

## Screenshots

These were captured with headless Chromium using software rendering (SwiftShader), so real GPUs will look smoother.

![Pursuit](docs/screenshots/pursuit.png)
![City at night](docs/screenshots/city-night.png)
![Rain](docs/screenshots/rain.png)
![Day](docs/screenshots/day.png)
![Garage](docs/screenshots/garage.png)
