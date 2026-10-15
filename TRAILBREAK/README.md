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
the LAN). Open it, enter a name, pick a truck and a paint colour, set it up in the **Garage** if you like, and press
**Drive**.

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

To play with friends anywhere, put the server on [Render](https://render.com) (free plan):

1. On <https://dashboard.render.com>: **New > Blueprint**, and **Connect** this repository (the first time, let Render
   see it on GitHub).
2. Branch: `claude/sweet-volta-hxo6tl`. **Blueprint Path:** `TRAILBREAK/render.yaml`. Then **Deploy Blueprint**.
3. When the `trailbreak` service shows **Live** (a minute or two), open its address,
   `https://trailbreak-xxxx.onrender.com`, press **Drive**, then Esc for the invite link and send it to your friends.

New commits on that branch deploy by themselves. Rooms hold 4 drivers (`multiplayer.maxPlayers` in `config.json`).
A free service sleeps after 15 minutes with nobody connected; the first visit after that takes about a minute to wake
it. While anyone is driving it stays awake. Render can restart a free service now and then: everyone gets "Lost the
connection", reloads the page, and is back in the same room (the beacons found in that room start again).

Without the Blueprint: **New > Web Service** with this repository, branch `claude/sweet-volta-hxo6tl`, root directory
`TRAILBREAK`, runtime Node, build command `node --version`, start command `node server.js`, instance type Free.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake (hold brake when stopped to reverse) | W / S | RT / LT |
| Steer | A / D | Left stick |
| Handbrake | Space | A |
| Transfer case HIGH / LOW (nearly stopped) | L | D-pad up |
| 2WD / 4WD | 4 | D-pad left |
| Diff lockers (if fitted): open, rear, front + rear | X | D-pad down |
| Tyre pressure: air down (stopped) / back up | P | |
| Garage (parts are fitted at the station) | U | |
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

In the valley the HUD shows the transfer case range, 2WD or 4WD, the lockers (or LSD), the gearbox (AUTO or STICK,
with M when you shift yourself) and the tyre pressure. ENGINE OFF / FLOODED appears when water has got into the intake.

Steering wheels are detected by name and get the full steering range; keys and thumbsticks get a steering assist
(full lock at walking pace, gentler at speed) that you can turn off in the pause menu. On phones and tablets,
on-screen controls appear: steering on the left, pedals on the right, buttons for the winch, recovery, range, locks,
camera, map and menu (play in landscape).

## The trucks

Three original designs, built to the real numbers of the classic 1970s American four-wheel drives:

| | Ranger | Hauler | Mule |
|---|---|---|---|
| Type | compact two-door wagon | three-quarter-ton pickup | open utility 4x4 |
| Wheelbase / track | 2.34 m (92") / 1.46 m | 3.34 m (131") / 1.68 m | 2.12 m (83") / 1.31 m |
| Weight (with driver, fuel) | 1760 kg | 2250 kg | 1300 kg |
| Engine | 5.0 V8, 318 Nm | 6.6 V8, 410 Nm | 4.2 straight six, 268 Nm |
| Gearbox | 3-speed automatic | 4-speed manual, 6.55:1 granny low | 3-speed manual |
| Transfer case low / axles | 2.46 / 4.10 | 1.96 / 4.10 | 2.03 / 3.54 |
| Stock tyres | 31x10.5R15 | 33x12.5R15 | 30x9.5R15 |
| Clearance under the diffs | 21.5 cm | 19.7 cm | 21.7 cm |
| Approach / departure / breakover | 43 / 30 / 32 degrees | 35 / 24 / 25 degrees | 46 / 30 / 35 degrees |

The models are built from code: body panels with real wheel arches, opening seams, glass you can see the interior
through (the steering wheel turns), a ladder frame with the engine, gearbox, transfer case, tank and exhaust under it,
leaf springs and shocks that flex with the axles, brake and reverse lamps, and every garage part on the truck.

## The garage

Open it from the start screen, or press U in the valley (out on the trail, fitting parts takes the truck back to
the station garage). Pick parts one by one or start from a ready-made build (Weekend trail, Rock crawler, Mud bogger,
Overlander). The truck turns on a stand in front of you with its parts on it, and the numbers show what they change
against stock: clearances, approach, departure and breakover angles, wheel travel, wading depth, the angle it tips at,
crawl ratio, power, top speed, weight and centre of gravity. Builds are kept per truck in the browser, and your
friends see your build.

Every part changes the physics, the way it does on a real truck:

- **Lift (2", 4", 6" long travel):** raises the body, the belly, the bumpers and the centre of gravity, but not the
  diffs (only bigger tyres lift those). Makes room for bigger tyres. The long-travel kit has soft springs and much more
  articulation, and leans a lot more on side slopes.
- **Tyres (30" to 37"):** more clearance under the diffs, better angles, they roll over bigger rocks and sink less.
  They also weigh more, add rotating inertia and gear the truck taller: 35s on stock gears are slow off the line until
  you re-gear. Tyres too big for the lift rub, and the bump stops are extended to stop them hitting the body.
- **Tread:** all-terrain, mud-terrain (more grip in mud, snow and grass, a little less on rock and road, louder) or
  bias-ply mud tyres (the most in the bog, poor on rock and tarmac), each with its own rolling resistance.
- **Wheels and air:** steel wheels can be aired down to 14 psi, beadlocks to 6. Aired down, the footprint gets longer
  and wider, so the tyre floats over sand and mud instead of digging in, and wraps over rock; on firm ground it rolls
  harder and steers vaguely. Without a compressor you can only air back up at the station.
- **Axle gears (3.54 to 5.38), 4:1 crawl box, gearbox:** the crawl ratio, from 21:1 stock to 134:1 for the rock
  crawler (walking pace at idle). The manual gearboxes have no torque converter: no creep, and in low range the engine
  holds the truck back down steep hills.
- **Differentials:** open (the wheel with the least grip gets the power), a clutch-type limited-slip rear (always on, up
  to 2.6 times the torque to the wheel with grip, a dab of brake helps it), or selectable lockers.
- **Engine:** stock, tuned (+13% torque), or a swap (the big-block weighs 45-80 kg more over the front axle).
- **Snorkel:** the stock air cleaner is under the bonnet; water over it stops the engine (drive in too fast and the
  bow wave reaches it first). The snorkel moves the intake up to the roof.
- **Winch:** 9,500 lb with steel cable, or 12,000 lb with longer, lighter synthetic rope.
- **Armour:** skid plates let the belly slide over rock, rock sliders protect the sills.
- **Light bar and roof rack:** much more light at night; the loaded rack puts 75 kg up high, and you will feel it on a
  side slope.

## The physics

Everything that makes off-roading off-roading is simulated, not faked:

- **Chassis:** a 6-DOF rigid body with an inertia tensor, gravity, air drag, and collision points on its hull: the
  belly can get high-centred on a rock, the roof lands on the ground when it goes over.
- **Beam axles:** each axle is a heavy unsprung body with its own heave and roll. When one wheel climbs a rock the
  other is pushed down (articulation), and the wheels stay square to the axle. Leaf springs sit inboard of the
  wheels, dampers are stiffer in rebound than in bump, limit straps stop the droop, bump stops are progressive, and
  the front anti-roll bar can be disconnected for more articulation at the cost of more lean.
- **Under the truck:** the diff housings and spring plates hang below the axles and touch the ground (a rock between
  the wheels stops the truck on its diff), the belly and the bumpers ride on the body.
- **Tyres:** each tyre finds the ground with rays around its tread, so it meets a ledge on its front face and climbs
  it. It is a radial spring. Its grip comes from a transient model (bristle deflections with relaxation lengths,
  combined slip on a friction ellipse, load sensitivity): a parked truck holds on a slope instead of creeping, and
  wheelspin or braking eats cornering grip.
- **Drivetrain:** engine torque curve, idle governor and rev limiter. A torque converter with stall multiplication
  and a lockup clutch feeds the automatic; the manual gearboxes have a clutch (worked for you: it slips to pull away
  and opens rather than stall). Then a two-speed transfer case, part-time 4WD and open, limited-slip or locked
  differentials. They are solved as exact constraints every substep. So with open diffs the wheel in the air or on
  ice gets all the power and the truck sits there, and locking the diffs gets you out. In low range the truck crawls
  at idle and a manual holds it back downhill.
- **Torque twist:** the propshaft's torque rolls the axle housing against the frame. Under power the right rear tyre
  goes light (with an open diff it is the one that spins: the classic one-wheel peel) and the engine rolls the body
  the other way.
- **Ground:** 10 surfaces (grass, dirt, gravel, rock, mud, sand, snow, road, riverbed, ice), each with its own grip
  and force curve. Firm ground peaks then falls off. Loose ground keeps pulling at high slip, and in it the tyre
  sinks to the depth its contact pressure can hold up (pressure-sinkage). A spinning tyre digs itself deeper. Ruts
  stay in the ground for the next truck, and friends' trucks press their ruts into your valley too.
- **Water:** buoyancy and drag on the hull, extra rolling resistance, and the air intake: water there stops the
  engine until it is out again.
- **Winch:** a steel line with a stall-limited motor (line speed falls with load). Hook a tree to pull yourself
  out, or hook a friend's truck: your truck holds on its brakes and theirs feels the line tension.

The behaviours are checked by tests (`npm test`): ride height and weight on the tyres, holding on a 25 degree
slope, sliding in mud, acceleration, low range climbing 30 degrees, open versus locked diffs on split friction,
climbing a ledge, steering and body roll, tipping on a side slope, ruts and digging (and which tyre spins), the winch,
and the room server. And the garage: a lift raises the body but not the diffs, bigger tyres slow the acceleration
and re-gearing brings it back, aired-down tyres sink less in sand, steel wheels stop at 14 psi and beadlocks go to 6,
lockers only when fitted, a limited-slip diff beats an open one, a manual doesn't creep and holds the truck downhill,
the crawler climbs a 35 degree rock slope the stock truck can't, a stock intake floods where a snorkel doesn't, tyres
too big for the lift rub, a rock between the wheels stops the stock truck on its diff but not one on 35s, and on a
tilt table the stock Mule lifts its wheels at about 38 degrees, a tall build at about 30.

## Ashwood Valley

About 2 km across: the ranger station where everyone starts, the old valley road, trails up the Corrie Range to the
snowy summit, the river from the north-west gorge to the south-east with three fords, Mirror Lake, Cattail Bog, the
rock garden and the Alder mine on the east ridge, the Pinecrest fire tower, sand washes, puddles that hold water and
mud, and thick woods. Survey beacons show as orange light beams; drive up to one to survey it for the whole room.

## Project layout

```
server.js, server/        static host + https + WebSocket rooms (rooms.js)
src/physics/              Vehicle (chassis, axles, tyre contact, winch, water), Tire, Drivetrain, Surfaces, trucks,
                          Upgrades (the garage's parts and what each does to the physics)
src/world/                WorldGen (the valley), World (ground for the physics), Deform (ruts), MapData, Noise
src/render/               Renderer, Sky, Terrain (LOD patches), Vegetation, Rocks, Water, Landmarks, TruckModel,
                          Effects (particles, winch line)
src/core/                 Game (the loop), Input, CameraRig
src/audio/, src/net/, src/ui/   sound, multiplayer client, HUD and maps, the garage (Garage, GaragePreview)
public/preview.html       developer view: ?cam=x,y,z&look=x,y,z&mods=Vegetation,Water,...
public/trucks.html        developer view of one truck: ?truck=hauler&build=overland (a preset or a build code)
test/                     node --test suites
```

## Credits

Engine sounds: see `public/assets/audio/CREDITS.md` (Freesound, CC BY 4.0). three.js is MIT licensed
(`public/vendor/three/LICENSE`). Everything else is original.
