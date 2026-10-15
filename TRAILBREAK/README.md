# TRAILBREAK

A co-op off-road driving game that runs in the browser. You and up to three friends take old 4x4s into Ashwood
Valley: mountain trails, a river with fords, a mud bog, a rock garden, snow on the peaks. Together you find the
valley's 15 survey beacons, and you winch each other out when one of you gets stuck.

Nothing to install for players: they open the server's address in Chrome, Edge or Firefox.

- **Engine:** three.js (WebGL2), everything procedural: the valley is generated identically on every client from a
  fixed seed, and the trucks, trees, rocks and buildings are built from code. No model or texture downloads.
- **Physics:** written for off-roading, running at 480 Hz (see [The physics](#the-physics)).
- **Server:** Node.js 18+ with no npm dependencies. Static files, http and https on one port, and WebSocket rooms.

## Quick start

| Platform | How |
|---|---|
| Windows | Install Node.js 18+ and double-click `start.bat` |
| Linux / macOS | `./start.sh` or `node server.js` |

The server prints every address players can use (`http://localhost:3000` on this PC, `http://192.168.x.x:3000` on
the LAN). Open it, enter a name, pick a truck and a paint colour, and press **Drive**.

- **Playing together:** leave the room code empty to start a new room. Press Esc in the valley for the invite link
  (`http://host:3000/?room=K7QMP`) and send it to your friends. Rooms hold 4 drivers (`multiplayer.maxPlayers` in
  `config.json`). A link keeps working after a server restart: the room is created again by whoever arrives first.
- **Alone:** **Drive alone (offline)** needs no connection after the page has loaded. Your beacon progress is kept in
  the browser.
- **Steering wheel or gamepad on another PC:** browsers only give controllers to secure pages, so open
  `https://host:3000` instead (the same port). The certificate is self-made, so the first time choose
  *Advanced > Proceed*.

Options: `node server.js --port 8080`, `--no-https`, `--no-multiplayer`, or edit `config.json`.

## Host it online (Render)

The repository's `render.yaml` has a `trailbreak` web service. On <https://render.com>: **New > Blueprint**, pick this
repository, **Apply**. Open the `https://trailbreak-xxxx.onrender.com` address it shows and share room links from
there. Free services sleep after ~15 minutes idle; the first visit afterwards takes 30-60 s.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake (hold brake when stopped to reverse) | W / S | RT / LT |
| Steer | A / D | Left stick |
| Handbrake | Space | A |
| Transfer case HIGH / LOW (nearly stopped) | L | D-pad up |
| 2WD / 4WD | 4 | D-pad left |
| Diff locks: open, rear, front + rear | X | D-pad down |
| Disconnect the front anti-roll bar | B | |
| Gearbox AUTO / MANUAL (manual: Shift up, Ctrl down) | G | |
| Winch: hook the nearest tree or friend ahead / unhook | F | X |
| Winch in / pay out (hold) | E / Q | RB / LB |
| Recover (back on the wheels) | R | B |
| Back to the ranger station | Backspace | |
| Camera: chase, far, bonnet, cab (drag to look around) | C | Y, right stick |
| Headlights | H | D-pad right |
| Map | M | View |
| Chat | Enter | |
| Pause, invite link, settings | Esc | Start |
| Controls | F1 | |

Steering wheels are detected by name and get the full steering range; keys and thumbsticks get a steering assist
(full lock at walking pace, gentler at speed) that you can turn off in the pause menu. On phones and tablets,
on-screen controls appear: steering on the left, pedals on the right, buttons for the winch, recovery, range, locks,
camera, map and menu (play in landscape).

## The physics

Everything that makes off-roading off-roading is simulated, not faked:

- **Chassis:** a 6-DOF rigid body with an inertia tensor, gravity, air drag, and collision points on its hull: the
  belly can get high-centred on a rock, the roof lands on the ground when it goes over.
- **Beam axles:** each axle is a heavy unsprung body with its own heave and roll. When one wheel climbs a rock the
  other is pushed down (articulation), and the wheels stay square to the axle. Leaf springs sit inboard of the
  wheels, dampers are stiffer in rebound than in bump, limit straps stop the droop, bump stops are progressive, and
  the front anti-roll bar can be disconnected for more articulation at the cost of more lean.
- **Tyres:** each tyre finds the ground with rays around its tread, so it meets a ledge on its front face and climbs
  it. It is a radial spring. Its grip comes from a transient model (bristle deflections with relaxation lengths,
  combined slip on a friction ellipse, load sensitivity): a parked truck holds on a slope instead of creeping, and
  wheelspin or braking eats cornering grip.
- **Drivetrain:** engine torque curve, idle governor and rev limiter. A torque converter with stall multiplication
  and a lockup clutch feeds a 3- or 4-speed automatic (or manual), then a two-speed transfer case, part-time 4WD and
  open or locked differentials. They are solved as exact constraints every substep. So with open diffs the wheel
  in the air or on ice gets all the power and the truck sits there, and locking the diffs gets you out. In low range
  the truck crawls at idle and the engine holds it back downhill.
- **Ground:** 10 surfaces (grass, dirt, gravel, rock, mud, sand, snow, road, riverbed, ice), each with its own grip
  and force curve. Firm ground peaks then falls off. Loose ground keeps pulling at high slip, and in it the tyre
  sinks to the depth its contact pressure can hold up (pressure-sinkage). A spinning tyre digs itself deeper. Ruts
  stay in the ground for the next truck, and friends' trucks press their ruts into your valley too.
- **Water:** buoyancy and drag on the hull, extra rolling resistance, wading depth.
- **Winch:** a steel line with a stall-limited motor (line speed falls with load). Hook a tree to pull yourself
  out, or hook a friend's truck: your truck holds on its brakes and theirs feels the line tension.

The behaviours are checked by tests (`npm test`): ride height and weight on the tyres, holding on a 25 degree
slope, sliding in mud, acceleration, low range climbing 30 degrees, open versus locked diffs on split friction,
climbing a ledge, steering and body roll, tipping on a side slope, ruts and digging, the winch, and the room server.

## Ashwood Valley

About 2 km across: the ranger station where everyone starts, the old valley road, trails up the Corrie Range to the
snowy summit, the river from the north-west gorge to the south-east with three fords, Mirror Lake, Cattail Bog, the
rock garden and the Alder mine on the east ridge, the Pinecrest fire tower, sand washes, puddles that hold water and
mud, and thick woods. Survey beacons show as orange light beams; drive up to one to survey it for the whole room.

## Project layout

```
server.js, server/        static host + https + WebSocket rooms (rooms.js)
src/physics/              Vehicle (chassis, axles, tyre contact, winch, water), Tire, Drivetrain, Surfaces, trucks
src/world/                WorldGen (the valley), World (ground for the physics), Deform (ruts), MapData, Noise
src/render/               Renderer, Sky, Terrain (LOD patches), Vegetation, Rocks, Water, Landmarks, TruckModel,
                          Effects (particles, winch line)
src/core/                 Game (the loop), Input, CameraRig
src/audio/, src/net/, src/ui/   sound, multiplayer client, HUD and maps
public/preview.html       developer view: ?cam=x,y,z&look=x,y,z&mods=Vegetation,Water,...
test/                     node --test suites
```

## Credits

Engine sounds: see `public/assets/audio/CREDITS.md` (Freesound, CC BY 4.0). three.js is MIT licensed
(`public/vendor/three/LICENSE`). Everything else is original.
