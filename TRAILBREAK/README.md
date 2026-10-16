# TRAILBREAK

A co-op off-road driving game that runs in the browser. You and up to three friends take old 4x4s into one of two
maps: **Ashwood Valley** (mountain trails, a river with fords, a mud bog, a rock garden, snow on the peaks) or the
**Kerala Ghats** (tea estates on misty hills, a waterfall, flooded paddy fields, red laterite tracks through rubber and
coconut, a granite dome). Together you find each map's 15 survey beacons, and you winch each other out when one of you
gets stuck.

Nothing to install for players: they open the server's address in Chrome, Edge or Firefox.

- **Engine:** three.js (WebGL2). Each map is generated identically on every client from a fixed seed, and the
  trucks, boulders and buildings are built from code. The ground wears photo-scanned textures (grass, pine-needle
  forest floor, trail dirt, gravel, rock, mud, sand, snow, river stones; for Kerala red laterite, granite, red mud,
  the leaf litter and the roads: 9 MB in all), blended per metre by their height maps. The trees are ten real species
  (game models, 5 MB): the full model close up, and beyond that a picture of it rendered when the game starts. Meadow grass grows in tufts around you, the sky has drifting clouds and stars, and
  everything is lit by (and the paint and water reflect) that sky. Water is as clear or as muddy as it is deep.
- **Physics:** written for off-roading, running at 480 Hz (see [The physics](#the-physics)).
- **Server:** Node.js 18+ with no npm dependencies. Static files, http and https on one port, and WebSocket rooms.

## Quick start

| Platform | How |
|---|---|
| Windows | Install Node.js 18+ and double-click `start.bat` |
| Linux / macOS | `./start.sh` or `node server.js` |

The server prints every address players can use (`http://localhost:3000` on this PC, `http://192.168.x.x:3000` on
the LAN). Open it, enter a name, pick a map, a truck and a paint colour, set it up in the **Garage** if you like,
and press **Drive**.

- **Playing together:** leave the room code empty to start a new room on the map you picked. Press Esc in the game
  for the invite link (`http://host:3000/?room=K7QMP&map=kerala`) and send it to your friends: whoever joins a room
  drives its map. Rooms hold 4 drivers (`multiplayer.maxPlayers` in
  `config.json`). A link keeps working after a server restart: the room is created again by whoever arrives first.
- **Alone:** **Drive alone (offline)** needs no connection after the page has loaded. Your beacon progress on each
  map is kept in the browser.
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
| Garage (parts are fitted at the station; at the garage it first mends any damage) | U | |
| Disconnect the front anti-roll bar | B | |
| Gearbox AUTO / MANUAL (manual: Shift up, Ctrl down) | G | |
| Winch: hook the nearest tree or friend ahead / unhook | F | X |
| Winch in / pay out (hold) | E / Q | RB / LB |
| Recover: back on the wheels, or back to dry ground when stuck | R | B |
| Call your friends for a tow (they see where you are) | T | |
| Fit the spare in place of a flat tyre (stopped) | Y | |
| Events: start one at its start line (with friends: open a race, or join one); twice to give up | J | Right stick press |
| Back to the ranger station (broken down: the tow truck takes it into the workshop) | Backspace | |
| Camera: chase, far, bonnet, cab (drag to look around) | C | Y, right stick |
| Headlights | H | D-pad right |
| Map (zoom, pan, set a route, fast travel; or tap the minimap) | M | View |
| Chat: the room's messages, quick phrases (or the chat button) | Enter | |
| Voice chat: join it, then mute and unmute your mic (push-to-talk: hold it) | V | the mic button |
| Pause, invite link, settings | Esc | Start |
| Controls | F1 | |

**The map** (M, the MAP button, or a tap on the minimap) works like Forza's: drag to move about, the wheel, a pinch
or + and - to zoom, the buttons to centre on your truck and to show or hide the events, beacons, places, trail names
and friends. Tap anything on it, or any spot on the ground, for what it is and **Set route**: the satnav plots the
quickest way there by road and trail (src/game/Route.js), straight across country where that is quicker, and shows it
on the map, on the minimap, on the compass and as a line of chevrons on the ground ahead; it plots it again when you
leave it, and a route to a friend follows them. **Fast travel** takes you to the station, the garage, an event's
start line, a beacon you have found or a friend (not in the middle of a run). While the map is open your truck stands
on its handbrake.

**Chat** (in a room): Enter, or the chat button beside the mic, opens the room chat: everything said since you
joined, a line to type in (Enter sends, Esc closes) and quick phrases to send with a tap (Follow me, Need a tow!,
Race?, GG...). While it is closed the latest lines float up beside the minimap, the button counts what you haven't
read, and what a friend says shows in a bubble over their truck for a few seconds.

**Voice chat** (in a room): press V, or the mic button under the players list, to join it; the browser asks for the
microphone once. Then V mutes and unmutes you, or, with push-to-talk picked in the pause menu, you talk while you hold V
(or the button). The pause menu's Voice chat panel has the rest: open mic or push-to-talk, mute your mic, mute
everyone, the voices' volume, and for each player a mute and a volume, with how they are connected. The players list
shows a mic beside everyone in the voice chat, green while they talk. Each pair of players links directly (WebRTC,
through Google's public STUN servers), so a friend can see your internet address, as in any peer-to-peer voice chat;
where two networks can't link directly, the audio goes through the game server instead (16 kHz, 64 kbit/s, only while
talking). Talking needs the https:// address (or localhost); without a microphone you can still listen. Voices stay on
while the game is paused or in another tab: mute everyone to silence them.

Every truck sounds like its own kind of engine: real recordings, cut into single firings, played back at the rate the
game's engine fires (src/audio/engine-worklet.js, an AudioWorklet). The exhaust and the block keep their real
resonances at any revs, because each firing plays as recorded, only spaced to the new revs; on throttle and off it
draws on firings recorded pulling and slowing. The banks (public/assets/audio/engines/*.grains.*, built by
`tools/sounds/build_grains.py` from `tools/sounds/sources.json`):

| Bank | Recording | Trucks |
| --- | --- | --- |
| `d4` | Toyota Hilux turbo-diesel four (the top of the revs from a VW TDI) | Thar diesel |
| `d4t` | VW 1.9 TDI turbo-diesel four | Defender 110 |
| `d6` | Ram 5.9 Cummins turbo-diesel six (the top of the revs from the TDI) | Bruiser, Rhino, Drover's TD swap |
| `d8` | Ford F-350 turbo-diesel V8 (the top of the revs from the TDI) | Hummer H1 |
| `v6` | Acura 3.2 V6, a mic at the exhaust while driving | Wrangler, Bronco |
| `v8` | 1978 Cadillac 425 V8 (the top of the revs from the V6) | Ranger, Hauler, the V8 swaps |
| `v8m` | a cammed V8 | tuned V8s, the Wrangler's 392 HEMI |
| `i6` | Jaguar E-type 4.2 straight six | Mule, Drover |
| `i4` | Suzuki Jimny four | Gecko, Trekker, Thar petrol |

On top: the starter (a motor chopped by the compression strokes, slower and heavier on a diesel; the engine turning
over on it), the turbo on turbo engines (its whistle spools up with boost and winds down after a lift), and the gearbox
and transfer case whining under load, louder in low range and in reverse. Without AudioWorklet the engine falls back
to recorded loops crossfaded by rpm and throttle.

The sound goes off while the game is paused, in the garage, the dealer and the events list, and whenever the game's
tab is hidden (another tab, or the browser minimised); it comes back when you drive on.

While you drive, the HUD shows the transfer case range, 2WD or 4WD, the lockers (or LSD), the gearbox (AUTO or STICK,
with M when you shift yourself) and the tyre pressure. ENGINE OFF / FLOODED appears when water has got into the intake
(press the throttle to start it again). The coolant temperature shows once the radiator leaks, and what is broken
(FLAT FL, AXLE R, STEERING, SPRING, ENGINE 60%) shows beside it: see [Damage](#damage).

Steering wheels are detected by name and get the full steering range; keys and thumbsticks get a steering assist
(full lock at walking pace, gentler at speed) that you can turn off in the pause menu. On phones and tablets,
on-screen controls appear: steering on the left, pedals on the right, buttons for the winch, recovery, range, locks,
camera, map and menu (play in landscape).

## Damage

Trucks can break the way real ones do (physics/Damage.js). How much is the **Damage** setting (Esc menu):

- **Cosmetic** (the default): crashes only show. The panels take a few shallow dents (a dozen at most, never deeper
  than 6 cm), the windscreen cracks and the windows shatter, a headlamp can break; nothing mechanical goes. No leaks or
  overheating, no bent steering, broken springs, snapped shafts or flat tyres, and the engine never seizes or stalls:
  upside down it keeps running, and with water in the intake it only coughs and loses power until it breathes again.
- **Forgiving**: it takes a proper crash to break anything (about twice the speeds below), a holed
  radiator leaks slowly, an overheating or oil-starved engine runs rough and loses power but never seizes, and water
  in the intake stalls it rather than bending a rod (unless it is revving flat out). Tie rods only bend in a big hit,
  and then only a little.
- **Realistic**: what follows, so drive like it's yours.


- **Crashes and roll-overs** dent the body where it hits (closing faster than about 8 km/h; steel bumpers and rock
  sliders shrug off what would crease a fender or a sill), crack the windscreen and then shatter it, smash headlamps.
- **The radiator:** a front hit holes it. The coolant runs out over a few minutes, the temperature climbs, the engine
  loses power (steam pours from the grille) and, driven on, seizes. Stop and it cools.
- **The oil pan:** high-centring hard on a rock with no skid plates cracks it, and the engine wears out.
- **Steering:** a front tyre slammed into a rock or a tree bends the tie rod: the truck pulls to one side and you
  drive with the steering wheel off centre.
- **Suspension:** a hard landing blows the dampers (the corner bounces) and cracks the main leaf (it sags).
- **Tyres:** a sharp rock at speed can cut a sidewall; aired down hard, a big side load pulls a tyre off its bead
  (beadlocks hold it). A flat runs on its rim, low and draggy. You carry one spare: stop and press **Y**.
- **Axle shafts:** hammering ledges at full throttle with the lockers in, so the tyres hop and bite, can snap a shaft.
  That wheel turns free; with an open diff its whole axle stops driving (engage 4WD to get home).
- **The engine:** water into the intake above about 1300 rpm bends a rod (at idle it only stalls); upside down it
  starves and stops (press the throttle to restart it once it is back on its wheels).

A seized engine or an axle that can't drive puts up the **Broken down** panel: call your friends for a tow (they
hook your bumper and winch, or drag you to the station garage) or call the tow truck (Backspace), which takes the truck
into the station workshop, where the mechanics mend everything and hand you the bill (an engine rebuild is the big
one). Broken down anywhere at the station, U brings the workshop out to you. Driving into the station garage and
opening it (U) mends everything too. Your friends see your dents, your glass, your lamps, your flat tyres and your
steam.

## Money, the dealer and events

Each driver has a career, kept in their own browser: money, the trucks and parts they own, their best times. You
start with $2,500. **For now every truck and every garage part is free**: pick any of the nine in the lobby or at the
dealer and drive it, and fit it with anything in the garage at no charge (`FREE_TRUCKS` and `FREE_PARTS` in
`src/game/Career.js` turn the dealer's and the garage's prices back on). The truck you pick in the lobby turns in 3D above
the list, in its build and paint (drag to turn it); at the dealer, tap any truck to see it the same way.

- **Earning:** surveying a beacon pays a $600 bounty (friends in the room get a share when you find one), towing a
  friend out pays a rescue fee, and events pay prize money.
- **Spending:** the dealer (pause menu, or the truck list in the lobby) sells nine trucks, from the $4,500 Gecko to
  the $42,000 Rhino (see [The trucks](#the-trucks)); the garage prices every part and bills only for parts you haven't
  bought for that truck (once bought, a part is yours to fit and take off again). Repairs and the tow truck cost money,
  and can run you into the red (down to -$5,000): a truck is never left broken.

**Events** (pause menu > Events, or the chequered flags on the map): each map has four. Drive to a start line and
press **J**. The truck is lined up and counted down; drive through the gates in order to the finish. Beat the par
times for a medal: each medal level pays once (bronze, then silver, then gold come to the gold prize), and every
finish pays a little.

Ashwood Valley:

| Event | What it asks for | Par (gold / silver / bronze) |
|---|---|---|
| Summit Hill Climb | 1.3 km of switchbacks up 260 m from the Summit Ford to the lookout | 3:15 / 3:55 / 4:50 |
| Cattail Bog Dash | a run-up, then the length of the bog flat out | 20.5 / 25 / 32 s |
| Rock Garden Trials | a slalom of tight gates up through the boulders; each hard knock of the body is +5 s | 1:10 / 1:30 / 2:00 |
| Sand Wash Drag | 100 m of soft sand: power, and the right tyre pressure (air down) | 9.4 / 10.8 / 12.8 s |

Kerala Ghats:

| Event | What it asks for | Par (gold / silver / bronze) |
|---|---|---|
| Kurinji Hill Climb | 760 m up 140 m from the tea factory, the jeep track through the estates to Kurinji Top | 1:50 / 2:15 / 2:45 |
| Paddy Field Dash | across five flooded paddy fields and over their bunds, the mud dragging harder the faster you go | 28.5 / 35 / 45 s |
| Anapara Rock Trials | tight gates through the boulders at the foot of the granite dome and up its slab; +5 s a knock | 0:58 / 1:15 / 1:40 |
| Kadavu River Run | 150 m flat out down the river's shallows and through the ford | 10.5 / 12.5 / 15.5 s |

With friends in the room, J opens a race instead: they get a message and 15 seconds to press J, which lines them up
beside you; everyone's clock starts together (the server's), and the places pay out (1st $2,500, 2nd $1,200, 3rd
$600, 4th $300, more for the hill climb and less for the drag). The par times came from driving each course in every
stock truck with a simple robot driver (`node` scripts against the real world and physics).

## Stuck?

When the truck is upside down, in deep water or going nowhere, a panel offers the ways out: flip it upright where it
lies, go back to the last firm, dry ground you drove on, call your friends for a tow, or go back to the station.

- **Call for a tow (T):** your friends get a message with where you are, a red **!** on their compass and a ring on
  their map. When one gets within winch range, the game tells them how: point the bumper at your truck, **F** to hook
  it (the line goes to your nearer recovery point, front or rear), hold **E** to pull. Their truck holds on its brakes
  while it pulls.
- **Winch yourself out on a friend:** while you are calling for a tow, hook your friend's truck and winch in. Their
  truck becomes the anchor and holds still; yours comes out (a little throttle helps).
- **Alone:** hook a tree with the winch, or **R**.

## The trucks

Real trucks with real 3D models (the Mahindra Thar you start in, the Jeep Wrangler Rubicon, the Ford Bronco, the Hummer
H1 and the Land Rover Defender 110) and the original designs, each built to the real numbers of the kind of truck it is, from a one-ton micro 4x4 to a
six-ton portal-axle expedition truck. Every one takes every part in the garage.

| Truck | Price | Kind | Wheelbase | Weight | Engine | Gearbox | Low range / axles | Stock tyres | Under the diffs | Approach / departure / breakover |
|---|---|---|---|---|---|---|---|---|---|---|
| Gecko | $4,500 | micro 4x4 | 2.03 m (80") | 1050 kg | 1.3 four, 101 Nm | 5-speed manual | 1.65 / 5.38 | 205/75R15 (27") | 20 cm | 41 / 31 / 32 degrees |
| Mule | $6,500 | open utility 4x4 | 2.12 m (83") | 1300 kg | 4.2 six, 268 Nm | 3-speed manual | 2.03 / 3.54 | 30x9.5R15 | 22 cm | 46 / 30 / 35 degrees |
| Trekker | $8,000 | compact pickup | 2.62 m (103") | 1480 kg | 2.4 four, 175 Nm | 5-speed manual | 2.28 / 4.10 | 31x10.5R15 | 21 cm | 31 / 27 / 29 degrees |
| Ranger | $9,500 | compact two-door wagon | 2.34 m (92") | 1760 kg | 5.0 V8, 318 Nm | 3-speed automatic | 2.46 / 4.10 | 31x10.5R15 | 21 cm | 43 / 30 / 32 degrees |
| Land Rover Defender 110 | $13,000 | the 110 station wagon on coils, with its bull bar and side steps | 2.79 m (110") | 2050 kg | 2.5 turbo-diesel four, 203 Nm | 5-speed manual | 2.74 / 4.10 | 31x10.5R15 | 20 cm | 42 / 28 / 28 degrees |
| Mahindra Thar | $15,500 | the 2020 Thar LX hard top: independent front, five-link rear, rear auto-locker (MLD) and front brake locking | 2.45 m (96") | 1850 kg | mHawk 2.2 turbo-diesel four, 300 Nm | 6-speed manual | 2.48 / 4.27 | 255/65 R18 (31") | 21 cm | 39 / 31 / 30 degrees |
| Jeep Wrangler | $18,000 | the JK Rubicon two-door: lockers both ends, brake traction control, a 4:1 Rock-Trac low range, a front sway bar that disconnects | 2.42 m (95") | 2000 kg | 3.6 Pentastar V6, 353 Nm | 5-speed automatic | 4.0 / 4.10 | LT255/75 R17 (32") | 22 cm | 34 / 33 / 34 degrees |
| Ford Bronco | $21,000 | the Badlands four-door with the Sasquatch package: independent front, five-link rear, lockers both ends, brake traction control | 2.95 m (116") | 2380 kg | 2.7 EcoBoost twin-turbo V6, 563 Nm | 10-speed automatic | 3.06 / 4.70 | 315/70 R17 (35") | 29 cm | 43 / 35 / 32 degrees |
| Hauler | $14,500 | three-quarter-ton pickup | 3.34 m (131") | 2250 kg | 6.6 V8, 410 Nm | 4-speed manual, 6.55:1 granny | 1.96 / 4.10 | 33x12.5R15 | 20 cm | 35 / 24 / 25 degrees |
| Drover | $16,000 | big six-cylinder wagon | 2.73 m (107") | 2150 kg | 4.2 six, 285 Nm | 4-speed automatic | 1.96 / 4.10 | 31x10.5R15 | 19 cm | 34 / 25 / 30 degrees |
| Bruiser | $24,000 | one-ton crew-cab pickup | 3.96 m (156") | 3350 kg | 5.9 turbo-diesel six, 570 Nm | heavy-duty 5-speed, 5.61:1 granny | 2.72 / 4.10 | 33x12.5R15 | 20 cm | 36 / 29 / 25 degrees |
| Hummer H1 | $32,000 | the H1 Alpha hard top, the civilian Humvee: independent suspension at both ends on geared hubs, tyre inflation from the cab, Torsen rear, brake traction control | 3.30 m (130") | 3650 kg | 6.6 Duramax turbo-diesel V8, 705 Nm | Allison 5-speed automatic | 2.72 / 5.24 (with the hub gears) | 37x12.50 R17 | 38 cm | 49 / 41 / 32 degrees |
| Rhino | $42,000 | portal-axle expedition truck | 3.25 m (128") | 6200 kg | 5.7 diesel six, 363 Nm | 8-speed truck box, 9:1 first | none / 7.17 | 395/85R20 (42") | 45 cm | 43 / 40 / 50 degrees |

They drive like what they are. The Gecko weighs a ton and floats over mud, but it is slow and narrow on a side slope.
The heavy trucks run their tyres harder (50 psi on the Bruiser, 55 on the Rhino: P steps down through two-thirds and
two-fifths of that to the wheels' minimum), carry stiffer tyres and stronger axle shafts, and their parts cost more to
buy and fit. The Rhino's portal axles ride the diffs high above the hubs: 45 cm under them on stock tyres. It has
lockers at both ends, onboard air and a raised intake from the factory, and wades 1.5 m. It is also slow: 0-60 km/h
takes 20 seconds and it tops out at 84 km/h.

The Thar's, the Wrangler's, the Bronco's, the Hummer's and the Defender's bodies are real 3D models (see [Credits](#credits)), converted by
`tools/cars.py` into the game's frame (narrowed to the real trucks' widths, the dense ones simplified): the
game paints it any colour, cracks its glass, lights its lamps and fits its own wheels, axles and suspension under it,
and every garage part goes on it as on the others (the lift raises the model, the tyres grow in its arches). Its front
is independent: each front wheel rides its own wishbones, and the springs carry each wheel alone. Its rear auto-locker
locks the rear axle by itself when a wheel spins below about 30 km/h (the HUD shows MLD LOCKED), and in 4WD the brakes
hold back a spinning front wheel. The mHawk diesel pulls its 300 Nm from 1,600 to 2,800 rpm; the garage has a remap,
the mStallion 2.0 turbo-petrol and the six-speed automatic for it. The Bronco and the Wrangler have traction control:
with the lockers off, the brakes hold back a wheel that spins away from the other on either axle, and when every wheel
spins, the engine is throttled back until they bite. The Bronco's
ten-speed automatic (as the garage's six-speed) reads the grade: it holds its gear while a climb slows the truck, and
skips straight down several gears when it must.

The other models are built from code: body panels with real wheel arches, opening seams, glass you can see the interior
through (the steering wheel turns), a ladder frame with the engine, gearbox, transfer case, tank and exhaust under it,
leaf or coil springs and shocks that flex with the axles (and the Rhino's portal hubs and spring towers), brake and
reverse lamps, and every garage part on the truck.

## The garage

Open it from the start screen, or press U while driving (out on the trail, fitting parts takes the truck back to
the station garage). Pick parts one by one or start from a ready-made build (Weekend trail, Rock crawler, Mud bogger,
Overlander). The truck turns on a stand in front of you with its parts on it, and the numbers show what they change
against stock: clearances, approach, departure and breakover angles, wheel travel, wading depth, the angle it tips at,
crawl ratio, power, top speed, weight and centre of gravity. Builds are kept per truck in the browser, and your
friends see your build.

Every part changes the physics, the way it does on a real truck:

- **Lift (2", 4", 6" long travel):** raises the body, the belly, the bumpers and the centre of gravity, but not the
  diffs (only bigger tyres lift those). Makes room for bigger tyres. The long-travel kit has soft springs and much more
  articulation, and leans a lot more on side slopes.
- **Tyres (27" to 46", from the factory size up to what the tallest lift clears):** more clearance under the diffs, better angles, they roll over bigger rocks and sink less.
  They also weigh more, add rotating inertia and gear the truck taller: 35s on stock gears are slow off the line until
  you re-gear. Tyres too big for the lift rub, and the bump stops are extended to stop them hitting the body.
- **Tread:** all-terrain, mud-terrain (more grip in mud, snow and grass, a little less on rock and road, louder) or
  bias-ply mud tyres (the most in the bog, poor on rock and tarmac), each with its own rolling resistance.
- **Wheels and air:** steel wheels can be aired down to 14 psi, beadlocks to 6. Aired down, the footprint gets longer
  and wider, so the tyre floats over sand and mud instead of digging in, and wraps over rock; on firm ground it rolls
  harder and steers vaguely. Without a compressor you can only air back up at the station.
- **Axle gears (3.54 to 7.17), 4:1 crawl box, gearbox (seven, from a 3-speed automatic to an 8-speed truck box):** the
  crawl ratio, from 21:1 on a stock Mule to 258:1 on a Rhino with the crawl box (walking pace at idle, and slower). The
  manual gearboxes have no torque converter: no creep, and in low range the engine holds the truck back down steep
  hills.
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
- **Ground:** 11 surfaces (grass, dirt, gravel, rock, mud, sand, snow, road, riverbed, ice, and Kerala's tea), each
  with its own grip and force curve. Firm ground peaks then falls off. Loose ground keeps pulling at high slip, and in
  it the tyre sinks to the depth its contact pressure can hold up (pressure-sinkage). A spinning tyre digs itself
  deeper. The soil sinks under the load a tyre carries, not under each jolt of it, so a fast truck doesn't hammer
  itself into its own ruts; wet mud also drags harder the faster you plough through it. Ruts stay in the ground for the
  next truck (where soft ground meets firm, a rut runs out up a ramp), and friends' trucks press their ruts into your
  ground too.
- **Water:** buoyancy and drag on the hull, extra rolling resistance, and the air intake: water there chokes the
  engine (on Cosmetic damage it keeps running on a third of its power; on Forgiving and Realistic it stops until it
  is out again).
- **What the tyres throw up:** a spinning tread flings clods and wet drops of mud along its tangent at its speed
  round the hub (a rolling one sheds some in mud), sand goes up in a spray of grains, dust rolls up behind on dry
  ground. In water each tyre splashes as it drives in, throws a rooster tail off the tread and sheets out to the
  sides, the nose pushes up a bow wave, and foam and ripple rings spread behind on the surface as it is drawn. All of
  it is lit by the sun and the sky (render/Effects.js), and you see it round your friends' trucks too.
- **Winch:** a steel line with a stall-limited motor (line speed falls with load). Hook a tree to pull yourself
  out, or hook a friend's truck: your truck holds on its brakes and theirs feels the line tension.
- **Steering kickback:** the forces on the front tyres turn the wheels about their kingpins (a tyre shoved back by a
  rock or a ledge acts at the scrub radius, side forces act behind the kingpin and centre the wheel). The sudden part
  kicks the steering wheel (you see it in the cab) and turns the road wheels a little against your grip, as on
  a real beam-axle truck. With **Vibration** on (pause menu), a gamepad rumbles with the shake of the ground, the buzz
  of gravel and rock, mud judder and hard hits; an Android phone buzzes; the camera trembles. Browsers can't drive a
  steering wheel's force-feedback motor, so wheels don't rumble.

The ground is checked against what real 4x4s do on it (`test/surfaces.test.mjs`): a stock truck in low range climbs
about 35 degrees of rock, 30 of dirt or gravel, 25 of grass, 12-15 of soft sand, mud or snow (several degrees more
aired down to 15 psi) and 4 of ice; it stops from 50 km/h in about 13 m on the road, 17 m on grass and 100 m on ice;
soft sand and mud drag like a brake. Down a steep hill in low range the gearbox holds first and the engine holds the
truck back (a granny-geared four-speed crawls down at walking pace).

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
rock garden and the Alder mine on the east ridge, the Pinecrest fire tower, the sand wash, puddles that hold water and
mud, and thick woods. Survey beacons show as orange light beams; drive up to one to survey it for the whole room.

The trails are built like real ones: the beds are graded (cut into the rises and built up over the dips, at most
3 m) to about 19 degrees where the hill allows, switchbacks climb the steep ground (the Summit Trail's were laid out
by a search over the land for the gentlest way up, with bends a long truck can take), the fords' banks are cut down
in ramps, and puddles only lie where the ground is level. A stock truck in low range can drive every trail; the last
pitches onto the summit are the steepest (about 25 degrees, on gravel).

## Kerala Ghats

The Western Ghats, about 2 km across and 450 m from the paddy fields up to the tops. Everyone starts at the Ponmala
Forest Station in the midland valley, among village houses with red tiled roofs and coconut palms. The Ponmala river
comes off the high ranges in the north-east, tumbles down the escarpment through the forest in the Thoovanam cascade,
and winds across the valley to the south-west: its floor is terraced into flooded paddy fields (bunds between the
plots, the roads across them on embankments), and below the village it runs broad and shallow over the Kadavu ford.
The Estate Road climbs the escarpment in hairpins through the shola (the evergreen forest) to the Ponmala tea factory
and the estate bungalow; above them tea bushes cover the hills along the contours, clipped waist high with paths
between the rows, shola fills the hollows and grassland the tops, with the lookout on Kurinji Top and the mast on
Tower Hill. To the west a rubber estate grows in rows; to the east rises Anapara, a granite dome with a field of
boulders at its foot; to the south are a laterite quarry (its ramp down the west face, rain standing in its floor)
and the Ponmala reservoir. A chai stall stands by the river where the Thoovanam Pool track leaves the road.

The ground plays as it looks: a truck can push into the tea, slowly, flattening a lane through the bushes; the paddy
fields are soft red mud under a hand of water, and their bunds jolt the springs; the tracks are red laterite, the
dome bare granite, and a rut in mud runs out onto firm ground up a ramp, not against a wall. The air is humid, so the
hills fade into haze sooner, and the dust and the mud the tyres throw are red. There is no snow.

## Project layout

```
server.js, server/        static host + https + WebSocket rooms (rooms.js)
src/physics/              Vehicle (chassis, axles, tyre contact, winch, water), Tire, Drivetrain, Surfaces, trucks,
                          Upgrades (the garage's parts and what each does to the physics)
src/world/                WorldGen (a map's world, from its definition), World (ground for the physics), Deform
                          (ruts), Noise
src/world/maps/           the maps: index (the list), ashwood, kerala (each one's land, river, trails, beacons,
                          buildings, events and its own generator hooks: Kerala's tea, paddies and quarry)
src/render/               Renderer, Sky, Terrain (LOD patches), Vegetation, Tea (the estates' rows of bushes), Rocks,
                          Water, Landmarks and KeralaBuildings, TruckModel
                          (chassis, axles, wheels, parts) and TruckBodies (the newer trucks' bodies), Effects
                          (particles, winch line), EventCourse (start banners, gates)
src/core/                 Game (the loop), Input, CameraRig
src/game/                 Career (money, trucks, parts, best times), Events (the courses, runs, medals, races),
                          EventPlay (events in the game: start lines, countdown, clock, prizes, races with friends)
src/audio/, src/net/, src/ui/   sound, multiplayer client, HUD and maps, the garage (Garage, GaragePreview)
public/preview.html       developer view: ?cam=x,y,z&look=x,y,z&mods=Vegetation,Water,...
public/trucks.html        developer view of one truck: ?truck=hauler&build=overland (a preset or a build code)
test/                     node --test suites
```

## Credits

Truck models: the Mahindra Thar, "THAR 4X4" by MB_Mahesh; the Jeep Wrangler, "Jeep Wrangler 3D Model" by Suyog modak;
the Ford Bronco, "Bronco Car Animation (Red)" by neshallads; the Hummer H1, "Hummer H1 (Retry School)" by Voxel_CG;
the Land Rover Defender 110, "Land Rover Defender 110" by
meeww; on Sketchfab, CC BY 4.0, see
`public/assets/trucks/CREDITS.md` (converted with `tools/cars.py`). Engine sounds: see `public/assets/audio/CREDITS.md`
(Freesound, CC0 and CC BY 4.0; built with `tools/sounds/build_grains.py`). Ground textures: CC0 scans from Poly
Haven and ambientCG, see `public/assets/ground/CREDITS.md` (packed with `tools/ground.py`). Tree models: pine, fir,
spruce, birch, coconut palm, oak (as mango), elm (as rubber), banana and bamboo by evolveduk, and the jungle tree by
kobaltsecond6c7d6150917a4267, on Sketchfab, CC BY 4.0, see `public/assets/trees/CREDITS.md` (converted with
`tools/trees.py`). three.js
is MIT licensed (`public/vendor/three/LICENSE`). Everything else is original.
