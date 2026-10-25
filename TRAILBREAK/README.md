# TRAILBREAK: Offroad Legends

**Offroad Legends** (the TRAILBREAK project) is a co-op off-road driving game that runs in the browser. You and up to three friends take old 4x4s into
one big **Open World**, 12 km across and filled edge to edge like a Forza map, driven from the sea to the snow with no
loading screen on the way (see [The open world](#the-open-world)). Every map the game had is in it, each where it
stands: **Ashwood Valley** (mountain trails, a river with fords, a mud bog, a rock garden, snow on the peaks), the
**Kerala Ghats** (tea estates on misty hills, a waterfall, flooded paddy fields, red laterite tracks through rubber and
coconut, a granite dome) and the **Konkan Coast** (8 km across, the real coast round Kashid beach in Maharashtra from
open elevation and land-cover data: a coast road by the Arabian Sea, ghat roads in hairpins up to a forested tableland,
an airstrip on top), and round them nine areas of new country: Korlai's headland with its fort and lighthouse, the
Borli valley and its lake, the Table Land's mesa, the Chalkewadi wind farm, the Koyna lake under Ashwood's pines,
the Bhimashankar jungle and its quarry, the Konkan Ghat and the Ashwood Pass, and the Deccan's farmland plateau with
the town of Shivapur, its fields, its lake and an expressway. Together you find the survey beacons, race the rallies,
and winch each other out when one of you gets stuck.

Nothing to install for players: they open the server's address in Chrome, Edge or Firefox.

- **Engine:** three.js (WebGL2). Each map is generated identically on every client from a fixed seed, the trucks are
  real 3D models, and the boulders and buildings are built from code. The ground wears photo-scanned textures (grass,
  pine-needle forest floor, trail dirt, gravel, rock, mud, sand, snow, river stones; for Kerala red laterite, granite,
  red mud, the leaf litter and the roads; for the coast clean tarmac: 9 MB in all), blended per metre by their height
  maps. The trees are ten real species (game models, 5 MB): the full model close up, and beyond that pictures of it
  rendered from eight sides when the game starts, each far tree showing the one from the side you see its model from (so
  it doesn't change shape, or lean another way, as its model takes over when you drive up).
  Meadow grass grows in tufts around you, the sky has drifting clouds and stars, and everything is lit by (and the paint
  and water reflect) that sky. Water is as clear or as muddy as it is deep.
- **Physics:** written for off-roading, running at 480 Hz (see [The physics](#the-physics)).
- **Server:** Node.js 18+ with no npm dependencies. Static files, http and https on one port, and WebSocket rooms.

## The screens

Dark glass panels over the game, an orange accent and condensed italic type (Barlow and Barlow Condensed).

- **Lobby:** the map, your name, a room code, the truck (turning in 3D above the list), its paint and the garage; Drive
  (a room for your friends), Quick match or Drive alone.
- **Driving:** a compass along the top with the degrees, the survey beacons, your friends (each with how far off,
  held at its edge when they are to the side or behind you) and the next gate on it;
  top right, whether you are online (and your ping), your name and driver level, how many are in the room, and the
  menu. Bottom left, the minimap turns with the truck (the N on its rim shows where north is; tap it for the full
  map). Bottom right, one dial: the revs round the rim (red past the redline), the speed in the middle, the gear
  under it (D and which gear in the automatic), the 2WD / 4WD / 4LO badge beside it, and the range, lockers, gearbox
  and tyre pressure under it, each with the key that works it on a keycap below (L, X, G, P; 4 in the badge; B under
  SWAY OFF, Y under what is broken, to fit the spare). Your **level** comes from all the money you have ever earned (level 2 at $1,000, 3 at
  $4,000, 4 at $9,000...), so spending never takes it down.
- **Paused (Esc):** the whole game stops where it is (your truck, its sound, the camera, the clocks; in an online
  room friends' trucks go on, theirs aren't paused, and they see yours standing still). The menu has the room and
  invite link, voice chat, the world and gameplay settings (time of day, shadows, sound, steering assist, vibration,
  graphics, damage, a steering wheel's calibration and paddles), Resume ride, and the garage, modes and races, map
  builder, dealer, back to the station and the controls.
- **Modes & races (N):** a card for each: free roam, the map builder, the party modes, the checkpoint races and the
  events, with a picture of it (rendered in the game), the par times, your best and what gold pays; Start lines you
  up, Go to the start sets the satnav. The side bar shows one kind at a time, or opens the garage or the settings.
- **Garage (U):** the parts in rows, each with what fits and what it changes against the factory part (+31% crawl
  ratio, +23% belly height...); presets; the truck turning in the middle (rotate, zoom, five views, and Photo saves a
  picture of it); under it, a grade for the build off-road (D to S, from clearance, angles, travel, wading, gearing,
  lockers and stability), power, torque and weight, and the key off-road numbers, each against stock.

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
- **Quick match:** **Quick match: play online** puts you in a public room with other players looking for a game on
  the map you picked (the fullest one with a seat free), or opens one that the next to look will join. Rooms started
  with a code stay private: only their link gets in.
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
it. While anyone is driving it stays awake. Render restarts the service now and then (and with each new commit):
everyone's game reconnects by itself, back into the same room by its code within a few seconds, each truck where it was
(the beacons found in that room start again on the server; each game keeps its own).

Without the Blueprint: **New > Web Service** with this repository, branch `claude/sweet-volta-hxo6tl`, root directory
`TRAILBREAK`, runtime Node, build command `node --version`, start command `node server.js`, instance type Free.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Throttle / brake (hold brake when stopped to reverse) | W / S | RT / LT |
| Steer | A / D | Left stick |
| Handbrake: rolling, it locks the rear wheels for a handbrake turn or a drift (see below); slower than a walk it holds the truck on any slope it can grip, the clutch held down so the throttle revs the engine and letting go launches | Space | A |
| Transfer case HIGH / LOW (nearly stopped) | L | D-pad up |
| 2WD / 4WD | 4 | D-pad left |
| Diff lockers (if fitted): open, rear, front + rear | X | D-pad down |
| Tyre pressure: air down (stopped) / back up | P | |
| Garage (parts are fitted at the station; at the garage it first mends any damage) | U | |
| Disconnect the front anti-roll bar | B | |
| Gearbox AUTO / MANUAL (manual: Shift up, Ctrl down; a steering wheel's paddles and H-shifter, below) | G | |
| Winch: hook the nearest tree or friend ahead / unhook | F | X |
| Winch in / pay out (hold) | E / Q | RB / LB |
| Recover: back on the wheels, or back to dry ground when stuck | R | B |
| Call your friends for a tow (they see where you are) | T | |
| Fit the spare in place of a flat tyre (stopped) | Y | |
| Events: start one at its start line (with friends: open a race, or join one); twice to give up | J | Right stick press |
| Back to the ranger station (broken down: the tow truck takes it into the workshop) | Backspace | |
| Camera: chase, far, front (the truck from ahead of it), side, bonnet, driver's seat, side mirror, wheel (along the front tyre and its suspension), bumper (drag to look around) | C | Y, right stick |
| Headlights | H | D-pad right |
| Map (zoom, pan, set a route, fast travel; or tap the minimap) | M | View |
| Chat: the room's messages, quick phrases (or the chat button) | Enter | |
| Voice chat: join it, then mute and unmute your mic (push-to-talk: hold it) | V | the mic button |
| Modes & races: party modes, checkpoint races, events | N | |
| Pause, invite link, settings | Esc | Start |
| Controls | F1 | |

**The map** (M, the MAP button, or a tap on the minimap) works like Forza's: drag to move about, the wheel, a pinch
or + and - to zoom, the buttons to centre on your truck and to show or hide the events, beacons, places, trail names
and friends. Tap anything on it, or any spot on the ground, for what it is and **Set route**: the satnav plots the
quickest way there by road and trail (src/game/Route.js), straight across country where that is quicker, and shows it
on the map, on the minimap, on the compass and as a line of chevrons on the ground ahead; it plots it again when you
leave it, and a route to a friend follows them. **Fast travel** takes you to a station, the garage, an event's
start line, a beacon you have found or a friend (not in the middle of a run). The **Fast travel** button on the map
(or T with the map open) lists your friends, each with how far off, then your truck's home and every map's base,
nearest first: Travel jumps there, Route sets the satnav, and a tap on the name shows it on the map. Somewhere whose
map isn't in yet (a friend who started at a far-off home) has that map built before any other, and you are taken
there the moment it is in. While the map is
open your truck stands on its handbrake.

**Friends' trucks** are drawn smoothly however their states reach you: each state is held at the time its driver's
game took it (not when the server passed it on), a state the server sends again is held once, each friend is drawn as
far behind as their states take to come (between 80 ms and 0.6 s, by how late theirs arrive), and a late state's
correction is eased in over a few frames instead of seen as a jump. When a friend first shows up far off (they may have
started at another home), you are told how far and on which map, and how to fast travel to them.

**Handbrake turns and drifts.** Rolling, Space is the rear wheels' brake alone, as a pulled lever is: steer, pull
it, and the rear wheels lock and the tail steps out while the fronts roll on and steer; let go and catch it with the
throttle and the opposite lock (on the keys the steering helps you catch it). It used to put on every brake, so the
truck mostly stopped: from 50 km/h on dirt a Thar was down to 14 km/h before its tail came out, and in 4WD it hardly
turned at all (13 degrees of slide), the transfer case locking the fronts to the locked rears. Now it comes out of the
handbrake at about 39 km/h with the tail 22 degrees out, in 2WD or 4WD. While the handbrake is pulled at speed, and
until the slide is over, the front axle's drive is let go of the rear's, as a rally car's hydraulic handbrake opens
its centre coupling. A part-time truck's transfer case can't do that; the game allows it, or the handbrake would lock
all four wheels in 4WD. The gearbox holds its gear while the rear wheels are locked, and the stability control stays
out of the way until you let go. Slower than a walk, Space is every brake and holds the truck where it is.

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

Every truck and car sounds like its own kind of engine: real recordings, cut into single firings, played back at the
rate the game's engine fires (src/audio/engine-worklet.js, an AudioWorklet). The note is where the tachometer says: a firing
for every cylinder every two turns of the crank, so a V8 at 650 rpm idles at 43 Hz. The exhaust and the block keep
their real resonances at any revs, because each firing plays as recorded, only spaced to the new revs. The firings
come in runs, in their recorded order, from where the recording's revs were nearest the game's (the game's idle plays
the recording's idle). On throttle and off it draws on firings recorded pulling and slowing, and from holds at steady
revs. A run gives way to another when it drifts from the revs, lined up on the waveform, never to a firing just
played (a few firings going round and round is what made the old sound buzz). Where the game's revs hold and the
recording's climb (a pull on a dyno), the run sways: on past the game's revs, then back through the firings it has
just played, turning at a different point each time, instead of jumping back over and over. A V10's two banks of five fire in
turn and its sound repeats every pair of firings, so its bank is cut in pairs and played at their rate. The banks
(public/assets/audio/engines/*.grains.*, built by `tools/sounds/build_grains.py` from `tools/sounds/sources.json`):

| Bank | Recording | Trucks |
| --- | --- | --- |
| `d4` | Toyota Hilux turbo-diesel four, a VW TDI revving, and a Peugeot 1.5 BlueHDi revving to its pump's 3,900 rpm cut | Thar and Thar Roxx diesels, Pajero, the UAZ's and the Niva's diesels |
| `d4t` | VW 1.9 TDI turbo-diesel four, the Peugeot BlueHDi above 2,700 rpm | Ranger Raptor |
| `d6` | Ram 5.9 Cummins turbo-diesel six (the top of the revs from the TDI) | Unimog, the Power Wagon's Cummins swap |
| `d6m` | a modern common-rail diesel at idle (a Skoda TDI: soft injection ticks, not an old truck diesel's clatter); the revs from a six, not a four: the Acura V6 pulling on the road (it fires as evenly as a straight six), filtered to the diesel's tone, and the Supra's straight six above 3,650 rpm | Defender 110 (its D350 straight six) |
| `d8` | Ford F-350 turbo-diesel V8 (the top of the revs from the TDI) | Hummer H1 |
| `v6` | Acura 3.2 V6, a mic at the exhaust while driving; above 3,650 rpm a Toyota Supra's turbo straight six (it fires as evenly) pulling on a dyno to 8,250 | Wrangler, Bronco, the Pajero's V6; the NSX, the GT-R (R35), the McLaren Senna's and the Corvette Z06's flat-plane V8s |
| `v8` | Chevrolet Caprice V8 (idle and holds), a Dodge Ram 1500 5.7 V8 pulling on the road, the V6 above 2,100 rpm, and above 3,500 rpm a supercharged GM V8 pulling on a dyno to 7,750 | K20 Suburban, the V8 swaps, the Corvette Stingray |
| `v8m` | a cammed V8 at idle, the Ram 1500's 5.7 HEMI pulling on the road, the V6 above 2,100 rpm, the supercharged GM V8 above 3,500 | Ram Power Wagon's 6.4 HEMI, tuned V8s, the Wrangler's 392 HEMI |
| `v8s` | a Land Rover 5.0 V8 at idle (a modern V8's smooth idle, not a cammed one's lope), the Ram 1500's 5.7 HEMI pulling on the road, the V6 above 2,100 rpm, the supercharged GM V8 above 3,500 | the G 63 (and its V12), the AMG GT, the Defender's OCTA V8, the M4 CSL's S63 swap |
| `v10` | Audi R8 V10 (idle, the fall from 4,100 rpm, holds from 2,100 to 4,100), cut in pairs of firings; above 4,100 rpm the supercharged GM V8's dyno pull, cut at every second firing (its pair a quarter turn to the V10's fifth: played a quarter faster than recorded) | Lamborghini Huracán, Audi R8 |
| `i6` | Jaguar E-type 4.2 straight six, the Acura V6, and above 3,650 rpm the Supra's turbo six on the dyno to 8,250 | BMW M4 CSL, Toyota Supra, Skyline GT-R (R34) |
| `f6` | a Porsche 911 flat-six at idle and revving (each bank of three beating at half the firing rate), the Jaguar six and the Acura V6 filling the revs, the Supra's six above 3,650 rpm | Porsche 911 Turbo (930) |
| `i4` | Suzuki Jimny four at idle, a Rover 216 GSi four revving to 6,900 rpm | Lada Niva, Willys MB, UAZ Hunter, the Thar's and the Roxx's petrols; BMW M3 (E30), Mazda RX-7, Subaru Impreza STi |

Most banks now have recordings up to their engines' redlines, so the top of the revs plays real firings at their own
speed (it used to play the top two percent of a recording two to three times faster: the thin buzz at full revs).
Still short: the Hummer H1's diesel (its recordings reach 2,300 rpm of its 3,300) and the Power Wagon's Cummins swap
(2,900 of 3,200): above those the top firings still play faster. No free recording of a big diesel revving higher has
turned up yet (Freesound, Wikimedia Commons, OpenGameArt, the Internet Archive).

**The Defender's six.** Its D350 is a 3.0 straight-six diesel, but its bank used to rev on a VW 1.9 TDI four (a phone
recording, and only to 2,900 of its 4,500 rpm): a four's buzz and clatter, like the old Defender's 2.2, not the new
one's six. No free recording of a six-cylinder diesel revving has turned up (two Dodge Cummins revs on Freesound are
too noisy to cut into firings), so its revs now come from sixes: the Acura V6 recorded at the exhaust while driving
(even firing, six firings in two turns, as a straight six fires) to 3,200 rpm, and the Supra's straight six from
3,650 to 5,000. They are filtered to the tone of the diesel's idle, which is still the Skoda TDI's soft ticking, and
the turbo is a diesel's (a lower whistle that spools up more slowly), not a twin-turbo petrol's. The filtering
(`match_donor` in the builder) had never actually run: it measured each firing over a 4,096-sample window, longer
than the 800 samples around a firing it was given, so every span was skipped. It now measures each firing over 512
samples and smooths over an octave (the recordings' resonances, not where the firing harmonics fall), at most 9 dB
either way. The other banks were built before the fix and are unchanged until they are rebuilt.

Where a recording has few firings at some revs (a quick sweep through them, or none at all: the Thar's diesel has
nothing between about 2,850 and 3,650 rpm, where it cruises at highway speed), the player holds to the revs nearest on
one side that it has plenty of, playing their firings at the game's rate, and goes over to the other side only when that
is clearly nearer; and a run of firings plays on while it is within 4% of the game's revs (or, in a gap, about as near
as anything is). Picking the nearest firings either side, it swung from below the gap to above it and back several
times a second: in the Thar off the throttle at 3,400 rpm (lifting off at highway speed) it changed to another stretch
of the recording 39 times a second, 9.7 of them jumps of more than 8% in the recorded revs, and the loudness fluttered
by 11% at 3 to 15 Hz; now 13 a second, 1 such jump, 3.4%. Over every engine's bank at a third and three-quarters of the
way to its redline, on and off the throttle, the flutter averages 3.4% (it was 3.6%) and is at most 7.5% (10.4%).

**Lifting off.** The gearbox keeps its gear when you lift off, as a driver coasting does: the engine holds the truck
back and its revs fall with the road speed, and the sound goes over to the overrun. It used to shift up the moment the
throttle closed (its shift point falling to 1,750 rpm): in the Thar at 122 km/h it went from 4th to 6th within a
second and a half, and with the clutch out between gears the revs fell to 1,730 and were snatched back up to 2,770,
twice (a swoop down and up each time, nothing like a real car lifting). Now it stays in 4th, the revs falling evenly from
3,520 to 2,280 over 8 s as the truck slows from 122 to 83 km/h. Off the throttle it still shifts up near the redline
(rolling faster downhill).

A big engine is louder than a small one and has more of its low end (a shelf under 140 Hz): the Power Wagon's 6.4
HEMI most of all, deep and loud, then the 392 swap, the old big-blocks and the big diesels' rumble.

On top: the starter (a motor chopped by the compression strokes, slower and heavier on a diesel; the engine turning
over on it), the turbo on turbo engines (its whistle spools up with boost and winds down after a lift), and the gearbox
and transfer case whining under load, louder in low range and in reverse. Each gear change clunks as the gear goes in;
pulling hard, an upshift cuts the engine for a moment and the exhaust cracks (a pop or two over a low boom, with a
flash of flame and a puff of smoke at the tailpipe; a diesel only chuffs), and lifting off from high revs the exhaust
crackles and pops for a moment. Without AudioWorklet the engine falls back to recorded loops crossfaded by rpm and
throttle.

The Hummer EV and the Cybertruck have no engine to hear: their drive units whine (three orders of the motor speed, each a narrow band of
noise round its pitch, so they sing and breathe like a real gearbox), the inverters hiss pulling hard and whistle at
walking pace, a deep two-note drone through the speakers (the Hummer's) rises with the speed and swells with the
power, and at walking pace they play a pedestrian warning.

The sound goes off while the game is paused, in the garage, the dealer and the events list, and whenever the game's
tab is hidden (another tab, or the browser minimised); it comes back when you drive on.

While you drive, the HUD shows the transfer case range, 2WD or 4WD (RWD or AWD on a sports car, AWD LOCK on the G 63
with its centre diff locked), the lockers (or LSD), the gearbox (AUTO or STICK,
with M when you shift yourself) and the tyre pressure. ENGINE OFF / FLOODED appears when water has got into the intake
(press the throttle to start it again). The coolant temperature shows once the radiator leaks, and what is broken
(FLAT FL, AXLE R, STEERING, SPRING, ENGINE 60%) shows beside it: see [Damage](#damage).

**A steering wheel's shifters:** its paddles change gear (pulling one puts an automatic box in manual, as a
paddle-shift automatic would; G goes back to automatic), and an H-pattern shifter puts the box in the gear its stick is
in (out of every gate: neutral; reverse only stopped). The paddles are found by the wheel's make: a Logitech (G29, G920,
G923) has the right paddle on button 5 and the left on 6, and its shifter's gates on 13 to 19; a Thrustmaster has its
paddles on 1 and 2; a wheel the browser reads as an Xbox pad has them on the bumpers. Any other, or paddles you would
rather have elsewhere: the pause menu shows the wheel and its **Gear up** and **Gear down** buttons; click one and pull
the paddle. On a wheel the paddles and the shifter do nothing else (the winch stays on E and Q).

**Calibrating a steering wheel:** many wheels pass themselves off as an Xbox pad, and the browser can't tell them from
one: such a wheel steered like a thumbstick (a dead zone, a curve, and the assist below), so a quarter turn of a 900°
wheel barely moved the car's wheels. In the pause menu, **Calibrate steering** and turn the wheel all the way left and
right, then let it back to the centre: from then on it is a wheel, and its whole turn is the car's whole lock, in
proportion (half the turn, half the lock). The game finds the axis that moved, and keeps the calibration for that
controller. It works for a wheel the game does know too, to set how far you turn it (a 900° wheel turned 270°).

**The steering wheel in the cab turns as far as yours does:** with a steering wheel, the one you see (and the driver's
hands on it) follows yours, not a car's ratio (a car's turns about 14 times the front wheels' angle, one and a quarter
turns each way to full lock, where a 270° wheel turns 135°). Set how far your wheel turns lock to lock in the pause
menu (**Rotation**: 180° to 1080°; a Logitech, Thrustmaster or Fanatec wheel starts at 900°, any other at 270°).

Steering wheels are detected by name (or calibrated): their whole travel is the whole lock. A thumbstick steers on a
curve (a third of the way over is a ninth of the lock), so a small push is a small turn. With the steering assist on
(the default) every control gets it, keys, sticks and steering wheels alike, a wheel following your hands three times
as fast as the keys (so a nudge of the wheel at 90 km/h is a gentle turn, not the spin it was without it): full lock
at walking pace, gentler at speed (the wheels ease round more slowly the faster you go, and the truck's swing
into a turn is damped, so it settles into the turn instead of lurching and wobbling). At speed it turns the wheels as
far as the front tyres grip on that ground (on a road, about 0.65 g of cornering on off-road tyres, as the real trucks
manage), but no further, so the nose doesn't plough on wide, and no further than a tall truck can take: it asks well
short of the pull that would lift the inside wheels, and stops turning in once the weight has gone over onto the
outside ones, so the Unimog and the Willys stay on their wheels with the steering snapped to full lock at 80 km/h.
When the tail slides out, it steers into the slide for you, towards where the front wheels are going, and lets go as
the car comes back, so a rear-engined Porsche 930 holds a fast bend instead of spinning. You can turn it off in the
pause menu. With it on, every truck also gets stability control, as the modern trucks have anyway: floored round a
bend, the power comes off the moment the nose starts to plough wide or the tail steps out, and comes back as the tyres
grip again, and while the truck swings round faster than you are steering, the outer front wheel is braked to turn it
back, so the truck holds the line its tyres can hold instead of spinning round. On phones
and tablets, on-screen controls appear: steering on the left, pedals on the right, buttons for the winch, recovery,
range, locks, camera, map and menu (play in landscape).

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
start with $2,500. **For now every truck and every garage part is free**: pick any of the seventeen trucks or the
fourteen sports cars in the lobby or at the dealer and drive it, and fit it with anything in the garage at no charge (`FREE_TRUCKS` and `FREE_PARTS` in
`src/game/Career.js` turn the dealer's and the garage's prices back on). The truck you pick turns in 3D in the lobby,
in its build and paint (drag to turn it).

**The showroom** (the lobby's **Choose your car**, and the dealer: each map's own, Ashwood 4x4 Sales, Ponmala Motors in
Kerala, Konkan Motors on the Konkan Coast)
is where a car is chosen. The car stands on a turntable ringed with light in a dark showroom, its reflection in the
polished floor (drag to turn it, the mouse wheel or a pinch to come closer); beside it its maker and model, how rare
it is, its price, and its figures: power and torque, and for a sports car the maker's 0-100 km/h and top speed, for a
4x4 how high it clears and how deep it wades; then the button that takes it (select it, drive it, or buy it). Under
them every car is on a rail of cards (all of them, the sports cars or the 4x4s; the arrow keys step through them).
Rarity goes by price: **common** under $20,000, **rare** under $60,000, **epic** under $130,000, **legendary** above. The
cards' pictures are drawn by `tools/thumbs.cjs` (the cars in the showroom, from the front three-quarters, each in a
colour it's known in).

- **Earning:** surveying a beacon pays a $600 bounty (friends in the room get a share when you find one), towing a
  friend out pays a rescue fee, and events pay prize money.
- **Spending:** the dealer (pause menu, or the lobby's showroom) sells seventeen trucks, from the $4,500 Lada Niva
  to the $95,000 G 63 (see [The trucks](#the-trucks)), and fourteen sports cars, from the $45,000 Impreza STi to the
  $1,150,000 McLaren Senna (see [The sports cars](#the-sports-cars)); the garage prices every part and bills only for parts you
  haven't bought for that truck (once bought, a part is yours to fit and take off again). Repairs and the tow truck cost
  money, and can run you into the red (down to -$5,000): a truck is never left broken.

**Events** (pause menu > Events, or the chequered flags on the map): Ashwood and Kerala have four each, the Konkan Coast
three. Drive to a start line and press **J**. The truck is lined up and counted down; drive through the gates in order
to the finish. Where two events start at the same line (the Kashid Ghat Rally and Coast to Snow, in the open world) one
banner carries both names, one above the other (two banners in the one place showed each other's posts and fought
over the text); J there starts the one picked last in the Events list or on the map. Beat the par times for a medal: each medal level pays once (bronze, then silver, then gold come to the
gold prize), and every finish pays a little.

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

Konkan Coast:

| Event | What it asks for | Par (gold / silver / bronze) |
|---|---|---|
| Airstrip Drag | a quarter mile flat out from a standing start down the plateau airstrip's runway | 17.5 / 20.5 / 25 s |
| Kashid Ghat Hill Climb | 3.6 km of the ghat's hairpins up 246 m from Kashid to the edge of the tableland | 3:30 / 4:35 / 5:40 |
| Kashid Beach Dash | 850 m along the middle of Kashid's soft sand: air the tyres down for it | 1:02 / 1:22 / 1:42 |

**Checkpoint races** (as in Off-Road League; pause menu > Events, or their flags on the map): circuits of laps and
point-to-point rallies along the trails, through numbered inflatable checkpoint arches (the next one glows; the finish
is chequered) with the course as a line of chevrons on the ground. The screen shows the checkpoints passed (2/10), the
lap, the clock and your best (or the gold time), with **RESTART** (Backspace) and **LEAVE** buttons; in a run, **R**
puts you back at the last checkpoint passed, facing the next, while the clock runs on.

| Race | Map | What it is | Par (gold / silver / bronze) |
|---|---|---|---|
| Bog Loop Circuit | Ashwood | two laps round the edge of the Cattail Bog, four checkpoints a lap | 4:30 / 5:25 / 6:40 |
| East Ford Rally | Ashwood | from the station round the bog, through the East Ford and up to the Rock Garden | 1:52 / 2:14 / 2:45 |
| Pinecrest Forest Sprint | Ashwood | under the old pines to the fire tower | 45 / 54 / 66 s |
| South Meadows Rally | Ashwood | down the old valley road and across the meadows to the cabin | 1:07 / 1:20 / 1:38 |
| Mirror Lake Run | Ashwood | the Mirror Lake Trail to the far shore | 49 / 58 / 72 s |
| Gorge Track Rally | Ashwood | down the Gorge Track through rock and pine | 50 / 60 / 73 s |
| Estate Road Rally | Kerala | 1.6 km of hairpins up through the tea to the factory gates | 3:40 / 4:23 / 5:22 |
| Paddy and Rubber Rally | Kerala | across the paddies on the bunds and into the rubber trees | 2:05 / 2:30 / 3:03 |
| Anapara Sprint | Kerala | east out of town to the great rock | 1:34 / 1:53 / 2:18 |
| Konkan Loop | Coast | an 11.6 km lap of the hills: south along the coast road, up the south ghat, across the plateau and down the Kashid ghat's hairpins | 10:50 / 14:00 / 17:30 |
| Coast Road Sprint | Coast | the coast road end to end, 8.9 km: round the northern headland, behind Kashid beach and down the shore | 5:40 / 7:15 / 9:00 |
| Kashid Ghat Rally | Coast | 10.4 km from Kashid over the ghat to the map's eastern edge: the hairpins, then the tableland and its valleys | 9:00 / 11:30 / 14:20 |
| Plateau Sprint | Coast | 2.5 km across the tableland from the Kashid ghat to the south ghat, past the airstrip | 1:37 / 1:58 / 2:25 |
| Konkan Ghat Road | Open world | 1.9 km of the two-lane ghat road from the coast's edge across the upland and down into Kerala | 1:57 / 2:20 / 2:53 |
| Kundalika Descent | Open world | 0.9 km off the ghat road and down the river track to the bank of the river out of Kerala | 58 / 69 / 85 s |
| Ashwood Pass Climb | Open world | 1.2 km up the pass road from the Ashwood side to the saddle | 1:19 / 1:35 / 1:58 |
| Cairn Ridge Trail | Open world | 1.2 km off the top of the pass, round the ridge to the west on the cairn trail and back to the road | 1:18 / 1:33 / 1:55 |
| Korlai Fort Run | Korlai | 1.3 km off the coast highway, out along the headland and through the old fort's two gates to the lighthouse | 2:32 / 3:03 / 3:46 |
| Mesa Climb | Table Land | 5.0 km off the highway, up the gravel road in bends onto the laterite mesa and round its rim to the top | 7:11 / 8:37 / 10:38 |
| Turbine Ridge | Chalkewadi | 2.3 km from the gate up the windfarm track onto the bare crest, under the turning blades | 3:43 / 4:28 / 5:30 |
| Koyna Lakeside | Koyna Glen | 1.6 km down through the Koyna gap and along the lake under the pines to the dam | 1:58 / 2:22 / 2:55 |
| Bhimashankar Jungle Road | Bhimashankar | 1.5 km down the jungle valley from the rest house towards Koyna | 1:45 / 2:05 / 2:35 |
| Deccan Ghat Descent | Deccan | 1.1 km off Kerala's ridge, through the gap in the escarpment and down to the expressway | 1:47 / 2:08 / 2:38 |
| Tamhini Road | Deccan | 5.6 km from Shivapur south over the farmland plateau to the world's southern edge | 7:48 / 9:21 / 11:32 |
| Timber Run | Bearwood Taiga | 1.2 km from the timber camp across the Bearwood at the ford and up the mud of the logging track to the cutting | 1:55 / 2:18 / 2:50 |
| Blackwater Crossing | Bearwood Taiga | 1.4 km round the edge of Blackwater Bog in the mud and back over the river at the west ford to the log landing (a stock UAZ needs low range up the far bank) | 2:31 / 3:01 / 3:43 |
| Lalghati Canyon Run | Lalghati Canyon | 1.3 km down the canyon floor from the base between the red walls, past the mouth of Hidden Creek and through the river at the shallows | 2:15 / 2:42 / 3:20 |
| Ledge Road Climb | Lalghati Canyon | 1.1 km up the shelf road cut along the canyon's south wall, round the bend and up the west wall to the rim, a hundred metres up | 2:05 / 2:30 / 3:05 |
| Coast to Snow | Open world | 18.6 km across the whole world, 16 checkpoints: up the Kashid ghat, over the Konkan Ghat into Kerala, through the town and the tea, up the Kurinji jeep track, over the Ashwood Pass and down to the ranger station | 26:15 / 31:29 / 38:50 |
| North Coast Highway | Open world | 10.5 km along the north of the world, 14 checkpoints: from the coast past Korlai, through Borli and the Devkund Gap, under the Chalkewadi turbines and down to the Koyna dam | 15:17 / 18:21 / 22:38 |

The races live in each map's `races` list (src/world/maps/), built by src/game/Races.js onto the trails as they are
(the world's ground isn't changed by them). The open world's are its stretches' own and one of its own across them all
(`src/world/maps/world.js`): Coast to Snow is routed by the satnav through its via points from one map to the next, and
joins the events once every map is in.

**Party modes** (Esc > Modes & races, **N**, or MODES on a phone), best in a room with friends; alone you play them
against the clock:

- **Elimination:** everyone starts in a wide circle round the station (on the coast, the airfield's apron) that holds,
  then shrinks, again and again, to nothing, behind a glowing wall (on the minimap and the map too, the next circle
  dashed). Outside it your truck loses a tenth of its health a second; at none you're out. The last truck in wins;
  alone, last as long as you can (3:37, the whole way, for gold). Every truck in the room works out the same circles
  from the match's start time.
- **King of the Hill:** race to the rise (Meadow Rise on Ashwood, Reservoir Rise in Kerala, the Ghat Viewpoint on the coast:
  the satnav shows the way) and hold it: 45 s inside its ring with nobody else in it wins (contested, nobody's time
  counts). Push them out!

**Map builder** (Esc > Map builder, or Modes & races): build your own course on the map you are on, from a camera over
it. Pick a prop from the palette (ramps, a big ramp, kickers, dirt mounds, shipping containers, crates, logs, log piles,
rocks and boulders, barrels, tyre stacks, concrete barriers, fences, mud pits, a start line and checkpoints) and click
or tap the ground to put it down: Q and E (or the turn buttons) turn it, and checkpoints face on from the last one.
With nothing picked, click a prop to pick it, drag it to move it, Del to take it away; Ctrl+Z undoes. Drag the ground
to move about, right-drag (two fingers) to turn the view, the wheel (pinch) to zoom, W A S D to move too.

Everything you put down is part of the ground at once, with the same physics as the rocks: tyres climb ramps and
launch off them, logs bump, containers stop you, mud pits rut. **Test drive** puts your truck in it; with a start line
and checkpoints it is a race (**Race it**, or in Modes & races, with medals from its length). The map you are
building is kept in the browser as you go (one per map), **My maps** keeps copies under a name, and **Share** gives
a link that opens your map for anyone (`?map=ashwood&layout=...`). In a room your friends see it as you build it,
and can build on it too; whoever joins later gets the room's map (src/game/Props.js, src/ui/Builder.js,
src/render/PropView.js).

The **Modes & races** list (Esc, N) has them all, grouped: free roam, the party modes, the checkpoint races and the
events, each with **Start** (lined up and counted down at once; with friends in the room it opens it for them to join)
and **Go to the start**.

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

Real trucks with real 3D models: the Mahindra Thar you start in and its five-door sister the Thar Roxx, the Lada Niva, the Willys MB, the UAZ Hunter, the
Chevrolet K20 Suburban, the Mitsubishi Pajero, the Jeep Wrangler Rubicon, the Ford Bronco, the Ford Ranger Raptor, the
Ram 2500 Power Wagon, the Hummer H1, the electric GMC Hummer EV, Tesla Cybertruck and BYD Yangwang U8 (the one that floats), the Land Rover Defender 110, the Mercedes-AMG G 63 and
the Mercedes-Benz Unimog U1300L, each built to its real numbers, from a one-ton jeep to a six-ton portal-axle truck.
Every one takes every part in the garage.

Each has its cab and a driver at the wheel. The steering wheels are the models' own, cut out of their dashboards so they
turn (the Thar, the Wrangler, the Raptor and the Pajero came with empty cabs: the game builds their seats, dash,
footwells and wheel). The driver is a lifelike man in a hoodie and jeans (a real 3D character), seated with his feet to
the pedals, his arms reaching the wheel and his fingers round its rim. His hands turn the wheel with the road wheels and
steer push-pull: past their reach they let go and take the rim again further back, one hand always holding, never
crossing over the top; a quick lock on the keys slides the wheel through them, and driving straight again they go back
to a quarter to three. In the cab view (C) you sit in his place and see your gloved hands on the wheel (the same driving
gloves and sleeves as NIGHTSHIFT's); from outside, you see him through the windows. The garage and the dealer show the
seat empty. He sits back in the seat, leaning against it: his hips 12 cm in front of the seat back's face (measured in
each model's own seats, `hip` in `physics/trucks.js`; in the seats the game builds, 28 cm ahead of his eyes, as they are
built). He used to be posed leaning forward with his hips 26 cm behind his eyes, which put them inside the seat back in
every car, by 6 to 54 cm; through the Cybertruck's glass roof he could be seen sitting behind his seat, between it and
the back bench (its eyes, and the cab view, are now 19 cm further forward, his head against the headrest).

| Truck | Price | Kind | Wheelbase | Weight | Engine | Gearbox | Low range / axles | Stock tyres | Under the diffs | Approach / departure / breakover |
|---|---|---|---|---|---|---|---|---|---|---|
| Lada Niva | $4,500 | the Soviet small 4x4: permanent four-wheel drive, wishbones in front and a five-link coil axle behind | 2.20 m (87") | 1290 kg | VAZ 1.7 four, 127 Nm | 5-speed manual | 1.78 / 4.68 | 175/80 R16 (26") | 20 cm | 38 / 30 / 32 degrees |
| Willys MB | $6,500 | the original jeep (1941-45): leaf springs on beam axles at both ends, a fold-down windscreen and no roof | 2.03 m (80") | 1220 kg | Go Devil 2.2 four, 142 Nm | 3-speed manual | 1.97 / 4.88 | 6.00-16 NDT (28") | 21 cm | 45 / 43 / 39 degrees |
| Ford Ranger Raptor | $22,500 | the 2019 desert runner: wishbones and long-travel Fox shocks in front, coils on a Watt's-linked axle behind, a rear locker, traction control | 3.22 m (127") | 2410 kg | EcoBlue 2.0 bi-turbo diesel, 500 Nm | 10-speed automatic | 2.72 / 4.10 | LT285/70 R17 (33") | 24 cm | 26 / 21 / 26 degrees |
| UAZ Hunter | $9,500 | the Hunter Expedition: a ladder frame, beam axles on coils in front and leaf springs behind, a bull bar, winch and side steps | 2.38 m (94") | 2000 kg | ZMZ 2.7 four, 209 Nm | 5-speed manual | 1.94 / 4.625 | 245/75 R16 M/T (31") | 20 cm | 31 / 28 / 36 degrees |
| Land Rover Defender 110 | $36,000 | the 2026 110: an aluminium monocoque, independent suspension at all four corners on air springs, a rear limited-slip diff, traction control | 3.02 m (119") | 2430 kg | D350 3.0 straight-six turbo-diesel, 700 Nm | 8-speed automatic | 2.93 / 3.31 | 255/60 R20 (32") | 22 cm | 30 / 38 / 22 degrees |
| Mahindra Thar | $15,500 | the 2020 Thar LX hard top: independent front, five-link rear, rear auto-locker (MLD) and front brake locking | 2.45 m (96") | 1850 kg | mHawk 2.2 turbo-diesel four, 300 Nm | 6-speed manual | 2.48 / 4.27 | 255/65 R18 (31") | 21 cm | 39 / 31 / 30 degrees |
| Mahindra Thar Roxx | $23,500 | the 2024 five-door Thar, AX7L 4x4 automatic: double wishbones in front, a five-link rear axle on coils, an electronic rear locker, traction control | 2.85 m (112") | about 2100 kg (Mahindra publishes no kerb weight: an estimate) | mHawk 2.2 turbo-diesel four, 370 Nm | 6-speed automatic | 2.48 / 4.27 | 255/60 R19 (31") | 21 cm | 41 / 39 / 28 degrees |
| Jeep Wrangler | $18,000 | the JK Rubicon two-door: lockers both ends, brake traction control, a 4:1 Rock-Trac low range, a front sway bar that disconnects | 2.42 m (95") | 2000 kg | 3.6 Pentastar V6, 353 Nm | 5-speed automatic | 4.0 / 4.10 | LT255/75 R17 (32") | 22 cm | 34 / 33 / 34 degrees |
| Ford Bronco | $21,000 | the Badlands four-door with the Sasquatch package: independent front, five-link rear, lockers both ends, brake traction control | 2.95 m (116") | 2380 kg | 2.7 EcoBoost twin-turbo V6, 563 Nm | 10-speed automatic | 3.06 / 4.70 | 315/70 R17 (35") | 29 cm | 43 / 35 / 32 degrees |
| Chevrolet K20 Suburban | $14,500 | the square-body three-quarter-ton wagon: leaf springs on a Dana 60 and a 14-bolt, an NP205 | 3.29 m (129.5") | 2480 kg | 6.6 V8, 410 Nm | 4-speed manual, 6.55:1 granny | 1.96 / 4.10 | LT235/85 R16 (32") | 17 cm | 34 / 21 / 27 degrees |
| Mitsubishi Pajero | $16,000 | the third-generation long-wheelbase five-door: independent suspension at all four corners, Super Select four-wheel drive, traction control | 2.78 m (109") | 2180 kg | 3.2 DI-D turbo-diesel four, 373 Nm | 5-speed automatic | 1.90 / 4.10 | 265/70 R16 (31") | 27 cm | 30 / 26 / 31 degrees |
| Ram 2500 Power Wagon | $24,000 | the crew-cab Power Wagon: coils on beam axles at both ends, lockers front and rear, a front sway bar that disconnects, traction control | 3.80 m (149") | 3280 kg | 6.4 HEMI V8, 582 Nm | 6-speed automatic | 2.64 / 4.10 | LT315/70 R17 M/T (35") | 22 cm | 32 / 25 / 29 degrees |
| Hummer H1 | $32,000 | the H1 Alpha hard top, the civilian Humvee: independent suspension at both ends on geared hubs, tyre inflation from the cab, Torsen rear, brake traction control | 3.30 m (130") | 3650 kg | 6.6 Duramax turbo-diesel V8, 705 Nm | Allison 5-speed automatic | 2.72 / 5.24 (with the hub gears) | 37x12.50 R17 | 38 cm | 49 / 41 / 32 degrees |
| GMC Hummer EV | $38,000 | the Edition 1 pickup, electric: three motors, e-lockers at both ends, independent suspension on air springs (at its raised Terrain height), traction control | 3.45 m (136") | 4110 kg | three electric motors, 746 kW (1,000 hp), ~1,400 Nm from a standstill | single-speed reduction | none / 12.5 | LT315/70 R17 (35") | 33 cm | 44 / 33 / 22 degrees |
| Tesla Cybertruck | $39,500 | the Cyberbeast, electric: three motors, a locking front differential and a rear one locked by its two rear motors, independent suspension on air springs (at its raised off-road height), traction control | 3.64 m (143") | 3190 kg | three electric motors, 630 kW (845 hp), ~930 Nm from a standstill | single-speed reduction | none / 15.02 | LT285/65 R20 (35") | 34 cm | 40 / 32 / 25 degrees |
| BYD Yangwang U8 | $48,000 | electric: four motors, one at each wheel; a sealed body that floats (its emergency float mode); independent suspension on the DiSus-P hydraulic body control (at its raised off-road height), traction control | 3.05 m (120") | 3460 kg | four electric motors, 880 kW (1,180 hp), 1,280 Nm from a standstill | single-speed reductions | none / 12.4 | 275/55 R22 (34") | 33 cm | 35 / 29 / 28 degrees |
| Mercedes-Benz Unimog U1300L | $42,000 | the 435 two-tonner with a box body: portal axles on coils at both ends, diff locks front and rear, tyre inflation from the cab | 3.25 m (128") | 6200 kg | OM 352 5.7 diesel six, 363 Nm | 8-speed truck box, 9:1 first | none / 7.17 | 12.5 R20 (42") | 46 cm | 42 / 28 / 33 degrees |
| Mercedes-AMG G 63 | $95,000 | the W463 G-Wagen: a ladder frame, coils on beam axles at both ends, permanent four-wheel drive with three diff locks (centre, front and rear), traction control | 2.85 m (112") | 2625 kg | M157 5.5 twin-turbo V8, 760 Nm | 7-speed automatic | 2.16 / 4.0 | 275/50 R20 (31") | 19 cm | 36 / 34 / 20 degrees |

They drive like what they are. The Niva weighs 1.3 tons and floats over mud, but it is slow and narrow on a side slope.
The heavy trucks run their tyres harder (45 psi on the Power Wagon, 55 on the Unimog: P steps down through two-thirds
and two-fifths of that to the wheels' minimum), carry stiffer tyres and stronger axle shafts, and their parts cost more
to buy and fit. The Unimog's portal axles ride the diffs high above the hubs: 46 cm under them on stock tyres. It has
diff locks at both ends, onboard air and its air intake high up behind the cab from the factory, and wades 1.2 m. It is
also slow: 0-60 km/h takes 21 seconds and it tops out at 85 km/h.

The **GMC Hummer EV** is electric. Its motors are geared straight to the axles (12.5:1, one gear), so it has all of its
torque from a standstill and nothing to shift: 0-100 km/h in under 4 seconds, four tons and all. There is no idle, so
it doesn't creep: it sits silent until you press the pedal. Lift off and the motors brake it, charging the battery
(one-pedal driving, stronger than an engine in gear). Its traction control is a motor's: it holds the wheels at the
slip that grips best, taking torque off the instant they spin past it and giving it back as they bite (less spin still
while the tyres are holding it round a bend), and the brakes stop any wheel spinning away from the other on its axle,
so even on grass it digs in and goes instead of spinning; in the air it holds the motors back. On its air springs the
nose rises and the tail squats as it launches, as the real truck's does. No air intake to drown: in deeper water
than its battery is sealed for (32 inches) the power is cut back instead. The dial shows its power (kW) instead of the
revs, green while it regenerates, and it sounds like an electric truck: the motors' whine rising with the speed, the
inverters, and a low hum at walking pace. The garage takes everything but a gearbox, a crawl box or a snorkel.

The **Tesla Cybertruck** (the three-motor Cyberbeast) drives the same way: 630 kW through one 15.02:1 reduction, 209 km/h
flat out, three tons on 35-inch all-terrains, both axles locked for the dirt (its front locker, and its two rear motors
holding the rear wheels together), its air springs raised. Its model is the 2019 show truck, which had cameras for
mirrors: the game fits the production truck's door mirrors (and, as the real one, no rear-view mirror). The
**BYD Yangwang U8** (featured first in the showroom) floats. Its body is sealed (buoyancy 0.75 of its hull's volume,
where the other trucks' leaky bodies have about 0.3), so in water over about 1.2 m deep it lifts off the bottom and
its emergency float mode takes over (the HUD shows AFLOAT): each wheel's own motor turns it as a paddle, W / S ahead and
astern up to about 3 km/h, A / D one side's wheels against the other's to turn it on the spot (half a turn in about
35 s). The paddles' push grows with the square of the tread's speed through the water (`floatStep` in
physics/Vehicle.js). As soon as its wheels bear on the bottom again (a seventh of its weight on them) the drivetrain has
them back and it climbs out on all four motors. Its body is the game's own (render/TruckBodies.js): the free 3D models
of the U8 are licensed for non-commercial use only, or are re-uploads of one under a different licence. The
**Thar Roxx** is the Thar stretched to five doors: 40 cm more wheelbase, the mHawk diesel turned up to 175 PS behind a
six-speed automatic, an electronic rear locker; steadier and roomier than the three-door, and heavier.

The **Mercedes-AMG G 63** has permanent four-wheel drive: a centre differential sends 40% of the drive to the front
axle and 60% to the rear, and lets them turn at their own speeds on a road. Off the road, press **4** (below about
30 km/h) to lock it (the HUD shows AWD LOCK): the axles turn together, as the part-time trucks' do in 4WD, and with the
front and rear lockers in, all four wheels pull. Its 571 PS V8 takes it to 100 km/h in about five seconds.

Every truck's body is a real 3D model (see [Credits](#credits)), converted by `tools/cars.py` into the game's frame
(scaled to the real truck's wheelbase and width, the dense ones simplified): the game paints it any colour, cracks its
glass, lights its lamps and fits its own wheels, axles and suspension under it (leaf or coil springs and shocks that
flex with the axles, wishbones on the independent ones, the Unimog's portal hubs), and every garage part goes on it (the
lift raises the model, the tyres grow in its arches). `tools/racks.py` measures each body's roof and bed rails: a roof
rack's towers and the light bar's brackets stand on the roof where it is, a bed rack's legs clamp onto the pickup's
rails.

The Thar's front is independent: each front wheel rides its own wishbones, and the springs carry each wheel alone. Its
rear auto-locker locks the rear axle by itself when a wheel spins below about 30 km/h (the HUD shows MLD LOCKED), and in
4WD the brakes hold back a spinning front wheel. The mHawk diesel pulls its 300 Nm from 1,600 to 2,800 rpm; the garage
has a remap, the mStallion 2.0 turbo-petrol and the six-speed automatic for it. The Bronco and the Wrangler have
traction control: with the lockers off, the brakes hold back a wheel that spins away from the other on either axle
(but not the outer wheel rolling further round a bend), and when every wheel spins, the engine is throttled back until
they bite, sooner while the tyres are also turning the truck. The Bronco's ten-speed automatic (as the garage's
six-speed) reads the grade: it holds its gear while a climb slows the truck, and skips straight down several gears when
it must.

## The sports cars

Fourteen sports cars and supercars, on real 3D models (see [Credits](#credits)), for the Konkan Coast's roads and
highway (and for anyone who wants to take a Lamborghini up a mud track): the BMW M4 CSL, the Mercedes-AMG GT S, the
Chevrolet Corvette Stingray (C8), the Lamborghini Huracán, the Audi R8 V10 plus (in a widebody kit), the BMW M3 (E30),
the Honda NSX, the Porsche 911 Turbo (930), the Nissan Skyline GT-R (R34), the Nissan GT-R (R35), the Mazda RX-7 (FD),
the McLaren Senna, the Subaru Impreza WRX STi and the Toyota Supra (A80). The lobby and the dealer list them under
**Sports cars**, with the maker's 0-100 km/h time and top speed.

| Car | Price | Layout | Wheelbase | Weight | Engine | Gearbox | Factory tyres | The maker: 0-100 km/h, top speed | In the game: 0-100, 100-0 |
|---|---|---|---|---|---|---|---|---|---|
| Subaru Impreza WRX STi (GC8) | $45,000 | front engine, all-wheel drive (40:60 through a centre diff), right-hand drive | 2.52 m | 1345 kg | EJ20 2.0 turbo flat-four, 280 PS, 353 Nm | 5-speed manual | 205/55 R15 | 4.9 s, 250 km/h | 5.3 s, 38 m |
| Mazda RX-7 (FD) | $52,000 | front-mid engine, rear-wheel drive | 2.43 m | 1325 kg | 13B-REW twin-rotor Wankel, twin turbos, 255 PS, 294 Nm | 5-speed manual | 225/50 ZR16 | 5.3 s, 250 km/h | 5.8 s, 38 m |
| Chevrolet Corvette Stingray (C8) | $75,000 | mid engine, rear-wheel drive, the Z51 package | 2.72 m | 1730 kg | LT2 6.2 V8, 495 hp, 637 Nm | 8-speed dual-clutch | 245/35 ZR19 · 305/30 ZR20 | 3.5 s, 312 km/h | 4.1 s, 36 m |
| BMW M3 (E30) | $88,000 | front engine, rear-wheel drive, a limited-slip diff | 2.56 m | 1275 kg | S14 2.3 four, 200 PS, 240 Nm | 5-speed dog-leg manual | 205/55 VR15 | 6.7 s, 235 km/h | 7.2 s, 38 m |
| Mercedes-AMG GT S | $90,000 | front-mid engine, rear transaxle, rear-wheel drive | 2.63 m | 1645 kg | M178 4.0 twin-turbo V8, 510 PS, 650 Nm | 7-speed dual-clutch | 265/35 ZR19 · 295/30 ZR20 | 3.8 s, 310 km/h | 4.2 s, 36 m |
| Toyota Supra Turbo (A80) | $98,000 | front engine, rear-wheel drive, right-hand drive | 2.55 m | 1585 kg | 2JZ-GTE 3.0 twin-turbo six, 326 PS, 427 Nm | 6-speed manual | 235/45 ZR17 · 255/40 ZR17 | 4.9 s, 285 km/h | 5.5 s, 38 m |
| Honda NSX (NA1) | $105,000 | mid engine, rear-wheel drive, right-hand drive | 2.53 m | 1440 kg | C30A 3.0 VTEC V6, 274 PS, 284 Nm | 5-speed manual | 205/50 ZR15 · 225/50 ZR16 | 5.7 s, 270 km/h | 6.3 s, 36 m |
| Nissan GT-R (R35) | $120,000 | front engine, rear transaxle, all-wheel drive (ATTESA E-TS) | 2.78 m | 1815 kg | VR38DETT 3.8 twin-turbo V6, 485 PS, 588 Nm | 6-speed dual-clutch | 255/40 ZRF20 · 285/35 ZRF20 | 3.5 s, 310 km/h | 4.0 s, 39 m |
| BMW M4 CSL | $135,000 | front engine, rear-wheel drive | 2.86 m | 1700 kg | S58 3.0 twin-turbo six, 550 PS, 650 Nm | 8-speed automatic | 275/35 R19 · 285/30 R20 Cup 2 R | 3.7 s, 307 km/h | 3.9 s, 32 m |
| Porsche 911 Turbo (930) | $145,000 | rear engine, rear-wheel drive | 2.27 m | 1215 kg | 3.0 turbo flat-six, 260 PS, 343 Nm | 4-speed manual | 205/55 VR16 · 225/50 VR16 | 5.5 s, 250 km/h | 6.0 s, 35 m |
| Audi R8 V10 plus (widebody) | $165,000 | mid engine, quattro all-wheel drive | 2.65 m | 1630 kg | 5.2 V10, 610 PS, 560 Nm | 7-speed dual-clutch | 245/30 R20 · 305/30 R20 | 3.2 s, 330 km/h | 3.5 s, 37 m |
| Lamborghini Huracán LP 610-4 | $230,000 | mid engine, all-wheel drive | 2.62 m | 1610 kg | 5.2 V10, 610 PS, 560 Nm | 7-speed dual-clutch | 245/30 R20 · 305/30 R20 | 3.2 s, 325 km/h | 3.5 s, 39 m |
| Nissan Skyline GT-R (R34) | $280,000 | front engine, all-wheel drive (ATTESA E-TS), right-hand drive | 2.67 m | 1635 kg | RB26DETT 2.6 twin-turbo six, 280 PS (about 320 in fact), 440 Nm | 6-speed manual | 245/40 ZR18 | 4.9 s, 260 km/h | 5.4 s, 39 m |
| McLaren Senna | $1,150,000 | mid engine, rear-wheel drive, 800 kg of downforce at 250 km/h | 2.67 m | 1385 kg | M840TR 4.0 twin-turbo V8, 800 PS, 800 Nm | 7-speed dual-clutch | 245/35 R19 · 315/30 R20 Trofeo R | 2.8 s, 340 km/h | 3.3 s, 29 m |

(The weights are with fuel and a driver; the game's times are from a standstill on a flat road, a little slower than
the makers', who launch on warm, rubbered-in surfaces. Every car's top speed in the game is within 6% of its maker's.)

They drive as they are built:

- **Rear-wheel drive** (the BMWs, the AMG, the Corvette, the NSX, the 930, the RX-7, the Supra, the Senna): the rear
  wheels take all the drive, the front ones only steer.
- **All-wheel drive** (the Huracán, the R8, both GT-Rs, the STi): a centre differential splits the drive between the
  axles (40% to the front on the STi, 30% on the Huracán and the R8, 10% on the GT-Rs) and a coupling holds the axles
  together, sending more of it to the axle that grips when the other spins: they pull away on gravel, grass or ice where
  a rear-wheel-drive car spins its tyres.
- **Gearboxes:** a dual-clutch box changes up with no break in the drive: the next gear's clutch takes over at once,
  and the ignition is cut for an instant while the revs drop to the new gear. Pulling away, the manual and dual-clutch
  cars use **launch control**: the clutch slips at the revs where the engine pulls hardest (fewer at part throttle) and
  takes up the drive as the car catches up with them. The M4's automatic locks its torque converter from first gear.
  **Traction control** holds the driven tyres near the slip that grips best.
- **Downforce:** the wings and the floor press the car onto the road with the square of its speed, front and rear
  separately: the Senna makes 800 kg of it at 250 km/h, more than half its weight.
- **Low:** a hand's width under the floor (12 cm): anything taller grounds them.
- **Lights:** the models' own headlamps light up at night.

**The garage** fits a road car with a road car's parts: summer performance tyres or track semi-slicks (or all-terrain
tyres for gravel, as the 911 Dakar and the Huracán Sterrato have), forged alloys, a 2" lift, a limited-slip diff, its
tuned engine and its engine swaps (the M4's S63 V8, the Corvette's Z06 LT6, the RX-7's three-rotor 20B, the Supra's
big single turbo...), the axle ratios its maker offered, its gearbox and the others a road car could take, and a roof
rack. Its tyres stay its own size (front and rear as it came). No lockers, crawl box, snorkel, armour, winch or light
bar: they are a truck's. The ready-made builds are **Track day** (semi-slicks, a limited-slip diff and the engine tuned),
**Safari** (raised 2" on all-terrain tyres, a roof rack) and **Flat out** (the strongest engine, semi-slicks and the
limited-slip diff).

Every car has its cabin and the driver at the wheel, and the steering wheel turns. The Huracán, the GT-R (R35) and
the Senna keep the cockpits their models came with. The other eleven (and the G 63) came with cockpits unfinished,
half-built or empty, so their own is taken out (`layout.interior.cut` in their `tools/cars/<id>.json`: the regions
inside the doors and behind the windscreen, as it curves back at its sides) and the game builds one, fitted to what was
measured of each car (the foot and top of its windscreen, its windows' sill, how far in its doors are) and to where the
driver sits (`src/render/Cockpit.js`): a dashboard under the windscreen, with the instruments where the driver sees them
through the top of the wheel (on the dash face under a brow, or in a pod on the dash where the wheel stands higher)
and live (the revs, the speed, the gear: analog dials, the big centre rev counter of the RX-7, the Supra and the 930,
or a screen in the modern cars), the centre stack (a screen, or a radio and its dials), vents, the console with its
gear lever (a stick, or a selector), door cards, bucket seats (and a bench behind them in the 2+2s and saloons), the
roof lined, the pillars trimmed, sun visors and a leather sports wheel (with paddles where the car has them), each in
the colours of the real car's (the 930's tan leather, the STi's blue cloth, the M3's grey with the M stripes, the M4
CSL's red stripes). From the driver's seat the body's inside is trim, not paint, and the side glass is clear (it caught
the sky white).

**The mirrors** work from the driver's seat: the rear-view mirror and both door mirrors show what is behind, each a
picture drawn from where the driver's eye is reflected behind its glass (through the glass's own rectangle, so the
whole picture lands on it), set as a driver sets them. They are small pictures, drawn one mirror a frame (every other
frame on medium graphics; on low the glass stays dark), and only from the driver's seat (`src/render/Mirrors.js`). The
door mirrors' glass was found in each model (the part standing out from the side ahead of the door, its face turned
back). `python3 -I tools/cockpits/interiors.py .` measures every car (`cabmeasure.py`, `mirrors.py`) and writes its
`layout.interior` into `tools/cars/<id>.json` and `public/assets/trucks/<id>.json`. Every 4x4 has them too
(`tools/cockpits/truckmirrors.py`, the glass measured off each model the same way): the Unimog its two on each side,
the Willys its one round mirror on a stalk, and where a model has none (the Thar's mirrors, the rear-view mirror of the
Wrangler, H1, UAZ, Ranger Raptor and Pajero) a housing is built for it, on an arm or a stalk.

## The garage

Open it from the start screen, or press U while driving (out on the trail, fitting parts takes the truck back to
the station garage). Pick parts one by one or start from a ready-made build (Weekend trail, Rock crawler, Mud bogger,
Overlander; a sports car has its own: see [The sports cars](#the-sports-cars)). The truck turns on a stand in front of you with its parts on it, and the numbers show what they change
against stock: clearances, approach, departure and breakover angles, wheel travel, wading depth, the angle it tips at,
crawl ratio, power, top speed, weight and centre of gravity. Builds are kept per truck in the browser, and your
friends see your build.

Every part changes the physics, the way it does on a real truck:

- **Lift (2", 4", 6" long travel):** raises the body, the belly, the bumpers and the centre of gravity, but not the
  diffs (only bigger tyres lift those). Makes room for bigger tyres. The long-travel kit has soft springs and much more
  articulation, and leans a lot more on side slopes.
- **Tyres (27" to 46", from the factory size up to what the tallest lift clears; a sports car keeps its own):** more clearance under the diffs, better angles, they roll over bigger rocks and sink less.
  They also weigh more, add rotating inertia and gear the truck taller: 35s on stock gears are slow off the line until
  you re-gear. Tyres too big for the lift rub, and the bump stops are extended to stop them hitting the body.
- **Tread:** all-terrain, mud-terrain (more grip in mud, snow and grass, a little less on rock and road, louder) or
  bias-ply mud tyres (the most in the bog, poor on rock and tarmac), each with its own rolling resistance. A sports car
  takes summer performance tyres or track semi-slicks (the most grip on a dry road, and they let go sooner past their
  peak; hopeless on anything loose), or all-terrains.
- **Wheels and air:** steel wheels can be aired down to 14 psi, beadlocks to 6 (a sports car's forged alloys, on
  low-profile tyres, to 26). Aired down, the footprint gets longer
  and wider, so the tyre floats over sand and mud instead of digging in, and wraps over rock; on firm ground it rolls
  harder and steers vaguely. Without a compressor you can only air back up at the station.
- **Axle gears (3.54 to 7.17), 4:1 crawl box, gearbox (sixteen, from a 3-speed manual to a 10-speed automatic and an
  8-speed truck box; a sports car has the axle ratios its maker offered and sixteen sports gearboxes of its own, from
  the 930's four-speed to dual-clutch boxes with six to eight speeds):** the crawl ratio, from 28.7:1 on a stock Willys MB to 258:1 on a Unimog with the crawl box
  (walking pace at idle, and slower). The manual gearboxes have no torque converter: no creep, and in low range the
  engine holds the truck back down steep hills.
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
  there are anti-roll bars at both ends (most 4x4s have one at the back too: 60% of the front's where a truck's spec
  gives none). The front one can be disconnected for more articulation at the cost of more lean.
- **Suspension geometry:** the links that locate the axles (radius arms, four-links, leaves; wishbones) are angled
  so part of a braking or driving tyre's pull reaches the body through them instead of the springs. The nose dives
  less under the brakes (anti-dive, 35% on a beam axle, 25% on wishbones) and the tail squats less on the power
  (anti-squat, 60% and 50%), as a real truck's do.
- **Measured against real trucks** (a test driver on the flat, `npm test` keeps them to it):

  | | Trucks (off-road) | Sports cars | Real |
  | --- | --- | --- | --- |
  | Bounce (ride frequency) | 1.4 to 1.8 Hz | 2.1 to 2.3 Hz | 1 to 1.5 Hz SUVs, 1.5 to 2.5 Hz sports cars |
  | Damping (share of critical) | 0.2 to 0.5 | 0.3 to 0.4 | 0.2 to 0.4 |
  | Body roll in a turn | 6.6 to 8.5 degrees per g | 1.7 to 4.3 | 5 to 8 SUVs, 1.5 to 4 sports cars |
  | Nose dive braking at 0.8 g | 1.8 to 2.9 degrees | 1.2 at 1.3 g | 2 to 4 degrees |
  | Squat launching flat out | 1.4 to 1.7 degrees | 0.7 | 1 to 2 degrees |

  Each truck's anti-roll bars were set by driving it round a steady turn: 7.5 degrees of lean per g for the modern
  4x4s and pickups, 7 for the wide, low Hummer H1, 8.5 for the old, tall or narrow ones (the Unimog, the UAZ, the
  Willys, the Niva). They had been leaning 8 to 10.6.
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
  at idle and a manual holds it back downhill. The sports cars drive the rear wheels alone, or all four through a
  centre differential that splits the torque between the axles and a coupling that limits their difference (the G 63's
  centre diff locks solid); a dual-clutch box shifts with no break in the drive, a launch control holds the clutch at
  the engine's strongest revs pulling away, and their wings and floors press them down, front and rear, with the
  square of the speed.
- **Trees and things in the way:** a trunk meets the truck stiff, as its crumple zones do, so a heavy truck stops in
  a short crush instead of sinking into the tree, and the trunk rubs past rather than being climbed. Whether it gives
  way is the bending the truck puts on it (each push times its height up the trunk) against what green wood of that
  thickness takes: young trees and banana plants snap at walking pace, a coconut palm, rubber tree or birch goes to a
  truck at town speeds (a heavy one sooner), a dead snag easily, and the big pines, mango trees and forest giants
  stand. It falls the way it was pushed, its stump left standing. Young trees grow along the trails' edges and in the
  woods round them; fences, trail markers and signs line the trails, barrels, crates and woodpiles stand by the
  buildings, and each goes flying when hit. What is knocked down stays down, for everyone in the room.
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
  is out again). The water lifts the hull in the middle of its part under water, so a truck deep enough to float sits
  level: heeled over, its low side, deeper in, is lifted back. Drag meets the area the flow does (the front going
  ahead, the side going sideways), so a truck driven into a pond pushes a bow wave and slows hard, nose down.
- **What the tyres throw up:** a spinning tread flings clods and wet drops of mud along its tangent at its speed
  round the hub (a rolling one sheds some in mud), sand goes up in a spray of grains, dust rolls up behind on dry
  ground. In water each tyre splashes as it drives in, throws a rooster tail off the tread and sheets out to the
  sides, the nose pushes up a bow wave, and foam and ripple rings spread behind on the surface as it is drawn. All of
  it is lit by the sun and the sky (render/Effects.js), and you see it round your friends' trucks too.
- **Wet mud:** mud is drawn wet, darker and glossy, wetter in places, and the ground at the water's edge is wet too.
  The ruts are wetter still, with mud pushed up in ridges either side, and in the deep ones water stands, filling
  the hollows first and mirroring the sky. The sky they and the rivers, lakes and pools mirror is the sky alone (the
  scene's environment map), so toward the horizon, where the hills and trees would stand in it, less of it shows: a
  pool seen across the ground was a pale sheet of the bright horizon, the river a silvery one. Close to the camera, ground with ruts in it is drawn at the ruts' own
  25 cm grid (from Medium graphics up), so each rut has its walls and its floor (render/Terrain.js). Steep rock (a
  road's cut through the hill on the Ashwood Pass, Cairn Ridge's faces) is lit in relief: its beds in ledges a metre
  or so apart and of uneven thickness, wavering along the hill, each jutting out over a shaded recess at its foot and
  leaning back to a shelf, broken by joints into blocks (Kerala's granite hardly: each map's `rockBeds`). It used to be
  a smooth bank with a picture of rock on it. The
  relief evens out with distance (its edges drawn wider where a pixel is bigger) and where a face is seen edge on, so
  no ledge glints as a white line or a scatter of sparks. Seen from afar (80 m and more), a steep slope shows the
  gullies the rain has worn down it, a few metres to tens across, running downhill, lit and shaded across the slope:
  out there a mountainside was a smooth grey bank, the ground's grid too coarse for them. (Both are reckoned along
  the world's own axes, not along each face: a frame turned with the face was unsteady kilometres from the origin and
  scrambled them into a maze of scratches.)
- **The picture** (High and Medium graphics; render/Post.js): drawn in high dynamic range, its edges smoothed by
  multisampling (4x, 2x on Medium), then finished as a racing game's is. At speed what the camera rushes past streaks
  along its path, the nearer the longer (the verge and the road's edge, hardly the hills: over a 1/90 s shutter, half
  the 1/45 s it was, which smeared the roadside and even the start banners at 110 km/h), and the whole picture
  smears as the camera swings round; your own truck stays sharp, and so does the cab from the driver's seat. The
  brightest light (the sun, its glints on paint, chrome and water, lamps at night) blooms into what is round it. A
  filmic tone curve, a little more contrast and colour, cool shadows and warm highlights and a soft vignette finish
  it. The haze thickens with distance and thins with height (valleys are hazier than the hilltops) and glows toward
  the sun. On High your truck's paint, glass and chrome reflect the world round it, the road, the trees and the sky
  going by (a small cube map drawn a face a frame, render/Probe.js), not the sky alone. The sun's shadows come in two
  cascades: a wide map 140 m across, and on High and Medium a near one 40 m across round your truck with texels under
  a third the size, so its shadow and the dappled leaves' round it are sharp (render/Renderer.js).
- **Far trees:** on High every tree within 160 m is its full model (85 m before; 60 m on Medium, 38 on Low), and
  beyond that a picture of its model on a card, taken when the game starts. The pictures carry the shade the model has
  where it stands: its inner crown and low branches, and its trunk under the crown in the crown's shadow (without it
  every trunk out there was pale against the dark of the woods, and a row of the coast's evergreen giants read as
  cut-outs, pale cones under flat discs). Only the models within 85 m of the camera cast shadows, as all of them did
  before they went out to 160 m (each is drawn twice more for its shadow, once into each shadow map), and the ones
  further out leave out their twigs: the smallest of their bark's triangles, a tenth of its area and as much as half
  their number, under a pixel out there (side by side with the whole models at 100 to 200 m, no different to see).
  Measured with the models out to 160 m instead of 85: on the coast road 4.6 M triangles a frame instead of 3.0 M, in
  Kerala's forest 10.3 M instead of 6.1 M, the shadows as they were (the 470 trees past 85 m there are 2.8 M triangles,
  4.0 M with their twigs). No kind of tree runs out of models anywhere tried.
- **Cameras round the truck:** the chase camera sits 7.4 m behind it, looking a little down on it (lower than it
  was, so the truck stands in the picture rather than the ground ahead); the far one at 13 m; the front view looks
  back at the truck from 7.2 m ahead of it and the side view from 6.6 m off its flank, each following it round as the
  chase does (src/core/CameraRig.js).
- **Leaves in the way:** from the chase cameras, leaves and branches between the camera and your truck dither away
  (as in Forza), wider by the camera, where one twig would fill the view, and stopping 2 m short of the truck, so the
  bushes it pushes through stay. A tree fern over a track in Kerala's tea used to fill the whole picture as you drove
  under it. Not from the seats and mounts on the truck, nor in the mirrors (render/Vegetation.js seeThrough).
- **Headlights** (H, and on by themselves at night): each lamp throws a wide cone that lights the verges and the road
  close in, and between them a narrow soft beam aimed 50 m down the road, as a dipped headlamp sends most of its light
  just under the horizon. The wide cones alone lit an asphalt road for a few metres and no further (out there their
  light meets the road edge on, and asphalt is dark); now the road shows 40 to 60 m ahead. The beam falls off slowly
  with distance, so a bank right in front of the truck doesn't glare white, and it dims by half for each broken lamp.
  The road paint is retroreflective, as real road paint is (glass beads in it): the centre dashes and edge lines in
  the beams shine back down the road ahead, less the further off and where the paint is worn (render/RoadMarkings.js).
- **The land past the maps** is wooded as the map beside it is (each map's `farWoods`: the coast's open country, the
  ghats' and Kerala's forest, the pass's and Ashwood's in between), in broad tracts with clearings and ragged edges,
  drawn crown by crown: some 8 m across, their tops in the sun and the gaps in shade, lighter and darker, yellower and
  bluer, evening out to their mean colour where a crown is under a pixel. It used to be smooth bare slopes there, grass
  and pink-brown rock, beside the ghat's forest of trees; now the woods climb the steep slopes too (to 48°), the bare
  rock is only on the steeper faces, and it is a grey of the rock's own brightness (the coast's red-brown laterite read
  pink through the haze) (render/Terrain.js farCover).
- **Graphics level:** if the frame rate stays under 30 fps for two 4-second spells running, the game steps the
  graphics down a level (and says so), and once it runs at 55 fps or more for 12 s it steps back up toward the level
  you chose (not again if the last step up was soon stepped down). Only for the session: it used to keep the lowered
  level as your setting, so one slow spell (the open world building its maps on a first visit) left the game on Low,
  with its ground textures and trees, for good. Anyone whose level was lowered that way, and who never picked one,
  gets High back once.
- **Winch:** a steel line with a stall-limited motor (line speed falls with load). Hook a tree to pull yourself
  out, or hook a friend's truck: your truck holds on its brakes and theirs feels the line tension.
- **Steering kickback:** the forces on the front tyres turn the wheels about their kingpins (a tyre shoved back by a
  rock or a ledge acts at the scrub radius, side forces act behind the kingpin and centre the wheel). The sudden part
  kicks the steering wheel (you see it in the cab) and turns the road wheels a little against your grip, as on
  a real beam-axle truck. With **Vibration** on (pause menu), a gamepad rumbles with the shake of the ground, the buzz
  of gravel and rock, mud judder and hard hits; an Android phone buzzes; the camera trembles. Browsers can't drive a
  steering wheel's force-feedback motor, so wheels don't rumble.

The ground is checked against what real 4x4s do on it (`test/surfaces.test.mjs`): a stock truck in low range climbs
about 35 degrees of rock, 30 of dirt, gravel or grass, 12-15 of soft sand, mud or snow (several degrees more aired
down to 15 psi) and 4 of ice; it stops from 50 km/h in about 12 m on the road, 13-14 m on dirt or grass and 100 m on
ice; grass grips like packed dirt but its turf drags, so flat out a truck is 15-20% slower on it than on dirt (a
Ranger 97 km/h instead of 120); soft sand and mud drag like a brake. Down a steep hill in low range the gearbox holds first and the engine holds the
truck back (a granny-geared four-speed crawls down at walking pace).

The behaviours are checked by tests (`npm test`): ride height and weight on the tyres, holding on a 25 degree
slope, sliding in mud, acceleration, low range climbing 30 degrees, open versus locked diffs on split friction,
climbing a ledge, steering and body roll, tipping on a side slope, ruts and digging (and which tyre spins), the winch,
and the room server. And the garage: a lift raises the body but not the diffs, bigger tyres slow the acceleration
and re-gearing brings it back, aired-down tyres sink less in sand, steel wheels stop at 14 psi and beadlocks go to 6,
lockers only when fitted, a limited-slip diff beats an open one, a manual doesn't creep and holds the truck downhill,
the crawler climbs a 35 degree rock slope the stock truck can't, a stock intake floods where a snorkel doesn't, tyres
too big for the lift rub, a rock between the wheels stops the stock truck on its diff but not one on 35s, and on a
tilt table the stock Willys MB lifts its wheels at about 38 degrees, a tall build at about 25.

## Ashwood Valley

About 2 km across: the ranger station where everyone starts, the old valley road, trails up the Corrie Range to the
snowy summit, the river from the north-west gorge to the south-east with three fords, Mirror Lake, Cattail Bog, the
rock garden and the Alder mine on the east ridge, the Pinecrest fire tower, the sand wash, puddles that hold water and
mud, and thick woods. Survey beacons show as orange light beams; drive up to one to survey it for the whole room.
(The beams are soft columns of light, brightest through their middle and faded out as you come up to them: drawn as an
even tube of light, close up one stood as a hard-edged slab across the view, plain to see at night.)

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
between the rows (none on a bank steeper than 40 degrees, a road's cut: the rows stacked there into green bars
standing out of it), shola fills the hollows and grassland the tops, with the lookout on Kurinji Top and the mast on
Tower Hill. To the west a rubber estate grows in rows; to the east rises Anapara, a granite dome with a field of
boulders at its foot; to the south are a laterite quarry (its ramp down the west face, rain standing in its floor)
and the Ponmala reservoir. A chai stall stands by the river where the Thoovanam Pool track leaves the road.

The ground plays as it looks: a truck can push into the tea, slowly, flattening a lane through the bushes; the paddy
fields are soft red mud under a hand of water, and their bunds jolt the springs; the tracks are red laterite, the
dome bare granite, and a rut in mud runs out onto firm ground up a ramp, not against a wall. The air is humid, so the
hills fade into haze sooner, and the dust and the mud the tyres throw are red. There is no snow.

## Konkan Coast

A real place: 8 km by 8 km of the Konkan coast of Raigad, Maharashtra, round Kashid beach (18.44 N, 72.92 E), sixteen
times the other maps' 2 km. Its ground is the real ground, from open data (`tools/konkan.py`): the heights from the
SRTM survey (a sample every 30 m, smoothed and drawn through bicubically), and what covers every 10 m of it from ESA's
WorldCover (forest, grass, paddy, villages, bare sand, water). The Arabian Sea along the west, its floor shelving away
from the waterline; Kashid's long crescent of pale sand between two wooded headlands, the village behind it among
coconut palms and paddy fields, red laterite earth; then the escarpment, forest climbing two hundred and fifty metres
to the tableland of the Phansad hills (up to 330 m), cut by deep valleys, with a reservoir in one of them to the north.
SRTM's coastline is blocky and lies out to sea in places, so the coast is WorldCover's: the land is shaped down to the
waterline over its last 150 m (a beach where WorldCover sees sand, a steeper shore elsewhere), and the waterline itself
is smoothed out of WorldCover's 10 m squares. The villages' 141 houses and 24 chai stalls stand where WorldCover sees
built-up land, facing the nearest road. Beyond the map's edge the real land and sea go on, from the same survey every
40 m, out to 12 km.

The roads are routed over that ground (`tools/konkan.py roads`, into `src/world/maps/coastRoads.js`): the least costly
way on a 10 m grid, a step costing its length and more for its grade (steeply past the road's limit) and the fall
across it, never across water; then the line is pulled smooth except where that would make it steeper than its limit,
so the hairpins stay where the slope needs them. Everyone starts at Kashid Motor Station, where the ghat leaves the
coast road. The Coast Road (9.0 km, two lanes) runs the length of the map by the sea, round the northern headland and
behind Kashid beach and down the shore to the south. The Kashid Ghat (10.4 km) climbs from the village in hairpins
(down to 9 m round) to the edge of the tableland, 260 m up, with a lookout over the sea, and crosses it to the map's
eastern edge; the South Ghat (7.6 km) climbs out of the paddy valley to the south. The Plateau Road (2.5 km) joins the
two across the top, past the airstrip: a 1.1 km runway levelled into the laterite, a taxiway and apron, a radio mast.
The coast road, the south ghat, the plateau road and the Kashid ghat make the Konkan Loop, 11.6 km. For the 4x4s the
Ridge Track (3.9 km of dirt) leaves the ghat along a ridge and drops into the valley past the reservoir to the map's
northern edge.

The forest is thick along the roads (what you see from them) and thinner away from them, where the ground's own
colour carries the woods: about 225,000 trees in all, the evergreen giants, mango and jack, bamboo in the hollows, and
coconut groves along the shore. The roads are worn asphalt with mud on the verges; the beach is soft sand, where airing
down pays. The sea is one sheet over the map's water and out to the horizon. The map is generated on a 2 m grid (the
others on 1 m): in Node it builds in about 13 s; in a test here, headless Chromium without a graphics card took 17 s
to load it (Kerala 14 s) and about 345 MB of JavaScript memory. Every map's shaders are compiled together before the
first frame (in parallel where the browser can), not one by one as each is first drawn.

## The open world

The game's one map (the lobby offers no other): the Konkan Coast, the Kerala Ghats and Ashwood Valley in one world
12 km across (`src/world/maps/world.js`), with eleven stretches of new country filling it round them, so it is land
from edge to edge, as a Forza map is: drive from Kashid beach up the ghat, across the upland, into Kerala's tea hills
and over the pass to Ashwood's snow, or north along the coast highway past Korlai's fort to the wind farm and Koyna's
lake, or south down the Deccan escarpment to the fields and the town, all without a loading screen. The satnav plots
a way between any two places in it by road and track (from the coast's station to Ashwood's: 18.6 km).

**Where you start** depends on what you drive (`src/world/homes.js`): each kind of car has a home suited to it, and its
map is built first (after the maps it is laid onto), so the game starts there. The heavy trucks (the Unimog, the UAZ
Hunter, the K20) start at the Bearwood Timber Camp in the taiga; the rock crawlers (the Wrangler, the Bronco, the
Ranger Raptor) at Lalghati Base in the canyon; the Defender and the Willys at the Ashwood Ranger Station; the G 63 and
the Niva at the Pass Hut; the Thar Roxx and the Pajero at the Ponmala Forest Station in Kerala; the Power Wagon at the
Ghat Dhaba; the Hummer H1 at the Bhimashankar Rest House; the Hummer EV and the Cybertruck at Shivapur Motors; the
Thar at Kashid Motor Station; the U8 on Kashid beach, by the sea it can swim in; and the sports cars on the North Coast
Highway at Korlai. Drivers who share a home each get a bay of their own, side by side or in rows: the yard is searched
for dry, level ground clear of trees, posts, rocks and buildings, and a bay another truck is in is left to it. The same
goes for a station you are towed back to or travel to.

**Open country and mud.** The new stretches' woods stand in stands with open ground between them (the taiga, Koyna
Glen, Bhimashankar and the pass thinned to between a third and a half of the trees they had), and every stretch with
ground level enough by its tracks has open **mud fields** (`mudFields` on a map, so many a km of track;
`src/world/WorldGen.js`): broad flats of churned mud 50 to 120 m across that a track runs through or a dirt road runs
beside, a shallow lumpy dish with pools standing in its low spots and no trees on it. The open world's maps have more
besides (each its own random numbers, so the standalone maps are built as they were):

- **Rock fields** (`rockFields`, so many a km): outcrops 35 to 80 m across beside the tracks and roads, bare rock
  heaved up a metre or two in lumps, big boulders strewn over it and only small ones, bedded down, on the track
  through it. No trees grow on them.
- **Muddy stretches** (`mudTracks`, the share of a track's length): 40 to 120 m of a level track churned to mud, its
  verges too, the ruts sunk deeper and water standing in them every 15 to 30 m; on a dirt or gravel road, its verges
  and shoulders. Kept off the river, so a ford stays as deep as it was.
- **Loose rocks** (`looseRocks`, so many times the usual): boulders scattered over the open ground, kept clear of the
  roads and the tracks.

All of it is kept off the race courses, so the par times hold, and comes as close as 50 m to a home station. Walking
every road and track in 10 m steps, before and after:

| Map | mud within 40 m, before → after | boulders within 40 m, before → after |
| --- | --- | --- |
| Konkan Coast | 1% → 27% | 14% → 46% |
| Kerala | 7% → 35% | 18% → 58% |
| Ashwood | 9% → 46% | 34% → 62% |
| Kashid Ghat | 5% → 31% | 22% → 45% |
| The Pass | 0% → 16% | 61% → 75% |
| Korlai | 29% → 47% | 11% → 48% |
| Borli Valley | 6% → 45% | 8% → 55% |
| The Table Land | 4% → 49% | 18% → 60% |
| Chalkewadi | 2% → 34% | 6% → 57% |
| Bhimashankar | 0% → 44% | 10% → 49% |
| Koyna Glen | 4% → 31% | 19% → 52% |
| The Deccan | 8% → 29% | 16% → 48% |
| Bearwood Taiga | 77% → 84% | 9% → 60% |
| Lalghati Canyon | 61% → 89% | 65% → 76% |

**Worn tracks.** The open world's tracks (`wornTracks` on a map; `src/world/Worn.js`) are worn into the land the way
years of trucks wear a jeep track, as the tracks in MudRunner or Expeditions are, not laid on it like a road:

- **The bed** sinks 10 to 25 cm below its verges, which come up to it over 3 m rather than a smooth 6 m ramp (where it
  is cut into a slope or built up over a drop, over the whole 6 m still). It follows the lie of the land more closely
  along its length, but is still graded, so it is never steeper than a stock truck climbs, and it lies level across.
- **Two ruts** run where the wheels go, 1.6 m apart, each 60 cm across. They wander from side to side down the track
  and are 5 to 15 cm deep on earth, a little deeper in mud (where trucks press their own ruts deeper as they pass),
  shallow on gravel and hardly there on rock. The spoil stands a little proud beside them.
- **Potholes** cross the track here and there.

The ruts are too fine for the ground's grid, so they are reckoned at each point from the track's line, the same for the
physics (the wheels drop into them) and the drawn ground. The terrain's shader draws the track a pixel at a time
(`src/render/Terrain.js`): the ruts pressed dark and smooth, with tread marks, and water standing along them in the mud;
the hump between them grown over in clumps of grass, with grass tufts standing on it (`src/render/Grass.js`); the bare
earth trodden browner; and the verge's grass reaching in to a ragged edge instead of a line. Where a track runs on into
the next map, its ruts run straight down the middle at an even depth, so the two maps' ruts meet.

**Rocky hills.** A rocky hill's rock is not a smooth bank with a picture of rock on it. The open world's bare rock
(`rockRelief` on a map; `src/world/Bedrock.js`) is built as geology builds it: an outcrop's outline is set by its
joints and its steps by its bedding (Migoń and others, on the tors of central Europe).

- **Beds:** the rock lies in beds a metre or so thick, their planes wavering over the hill. Where they come out on a
  slope, each stands out as a ledge over the recess at the foot of the bed above. A face goes up in ledges up to a
  metre and a half deep; a gentler slab crosses in low stair steps of 10 to 20 cm, the slickrock steps a rock-crawling
  trail is rated by.
- **Joints:** two sets of near-vertical cracks, each bed with its own spacing, cut the rock into blocks; the cracks
  wander a little, as real ones do, rather than ruling the rock into a grid. On a slab, each block stands a little
  proud of or sunk below the next, and the cracks between them are open.
- **Where it is real:** the relief is in the ground itself. The wheels climb its steps, and the drawn ground's
  vertices are moved by it out to about 70 m. The terrain's shader lights every pixel of the rock from the same
  function: its noise is copied bit for bit in JavaScript and checked against the GPU's to under a tenth of a
  millimetre. On a track over the rock it is worn down to a third.
- **Tors:** on each map's most prominent crests stand free-standing stacks of the blocks the joints and beds part the
  rock into. Two or three blocks a column, the lower ones broader, rise from bare rock on the rounded top (1 to 4 a
  map).
- **Clitter:** the blocks a tor has shed lie strewn in trails down the slope below it.
- **Talus:** at the foot of each rock face, the stones it has shed lie in an apron, thickest close under the face,
  the bigger ones rolled farther out.

All of it keeps off the tracks, the courses, the buildings and the beacons, and is drawn from its own random numbers,
so the maps on their own are built as they were. Driving on it costs the physics about half a millisecond more a frame.

The country is laid out as the real country round Kashid is: the stretches north of the coast and the Deccan to the
south stand on the same real elevation data as the coast (its bake carries the heights 12 km out, every 40 m), their
own features made on top of it; the roads through them are routed over the ground (`tools/routeroads.mjs`, below).

- **Korlai** (1.8 km, north of the coast, on the sea): the coastal plain carried north, and Korlai's headland out
  into the Arabian Sea, a ridge with sheer sides. Along its crest stands the old Portuguese **fort**: 150 m of
  curtain walls with merlons, standing on the ground all along, round bastions at the corners and along both sides,
  gateways at either end with the road through them, and the gable of its ruined church inside; the lighthouse
  stands at the tip. The bazaar behind Revdanda beach, and the creek's mud flats.
- **Borli Valley** (1.8 km): a broad valley under a wooded ridge, Supegaon lake in it.
- **The Table Land** (1.8 km): a laterite ridge, and on it a mesa, sheer-sided and flat-topped, a gravel road up onto
  it and a track round its top; the coast highway goes through the ridge at Devkund Gap.
- **Chalkewadi** (1.8 km): the high ridges over the coast's north-east corner, bare to the wind, and along their
  crests ten **wind turbines**, 62 m towers with 31 m blades, all facing into the monsoon wind from the west-south-west
  and turning, each at its own pace, a red light on each for aircraft.
- **Koyna Glen** (2 km, under Ashwood): a long lake in a deep valley, held behind an earth dam, pine and fir up its
  sides; the Koyna road comes down off Chalkewadi through a gap in its west ridge and along the shore to the dam, and
  the Pinecrest trail climbs from the dam to Ashwood; the Glen Head Track climbs north out of it over the ridge.
- **Bearwood Taiga** (2 km, the far north, over the ridge at the head of Koyna Glen; `src/world/maps/taiga.js`):
  logging country in the manner of the mud-and-timber truck games, open ground under a big sky: stands of dark spruce,
  pine and fir with wide clearings, meadows and old cuttings between them (about 24,000 trees, a lone one here and
  there), the tracks' verges cleared 20 m back, the wet ground all but bare (a birch, a dead snag), the Bearwood river
  winding west across a boggy basin, and its ground in Ashwood's textures (brown mud, not the coast's red laterite),
  dark and muted. The Timber Road comes
  over the ridge from the glen to the **Bearwood Timber Camp** on a terrace above the river: the garage, a **sawmill**
  (an open shed on posts under a tin roof, the saw bench and its blade, a log deck, a heap of sawdust, stacked boards)
  and the log yard. The Bearwood Ford Track crosses the river and climbs to the cutting in the far woods; the
  Blackwater Track runs round the bog and back across the river at the west ford to the log landing; the Deep Ford
  Track crosses it between them; the Lookout Track climbs a knoll to a watchtower. **Log piles** (stacked in a pyramid,
  pale cut ends, stakes either side, solid to drive into) stand at the camp, the landing and the cutting.

  All the going those games have, each its own ground under the tyres (`src/physics/Surfaces.js`), measured on the
  generated map and driven on the physics:

  | Going | Where | What it does to a truck |
  |---|---|---|
  | Gravel | the Timber Road, all of it (a trail can be laid with its own surface: `surface` on a route) | fast and loose: less grip than dirt, slides in the bends |
  | Deep mud | the tracks across the wet ground (a fifth of the map is mud), mud holes on their level stretches | the tyres sink up to 0.36 m and dig in when they spin; the faster you plough, the harder it drags |
  | Mud fields | nine open flats of churned mud 60 to 100 m across that the tracks run through, pools standing in their low spots | the whole field to plough across, or round its edge; no trees on them |
  | The Mud Pit | by the camp: a borrow pit dug a metre down, 0.36 m of water over the mud | a Thar, a Wrangler and a UAZ all wallow through at walking pace (90 m in 32 to 38 s), 0.6 m down |
  | Swamp | Blackwater Bog: its lowest third under black pools up to 0.4 m deep, the tracks kept dry round it | mud under water: the tyres sink and slip, and the water drags |
  | Shallow fords | the Bearwood Ford and the west ford, 0.4 m over a riverbed of stones | wet but firm; the banks up out of them are steep (the west ford's north bank: a stock UAZ needs low range) |
  | Deep ford | the Deep Ford, 1.02 m over the ford's bed and deeper either side of it | a stock air intake (0.95 m) goes under: a stock Thar or Wrangler gets across with its engine choked to 35% of its power (cosmetic damage, the default; on the stricter settings it stalls); with the snorkel (garage) it pulls at full power; the Yangwang U8's intake is at 1.72 m |
  | Shallows and sand | the Bearwood Shallows above the ford, ankle deep (0.24 m) over gravel for 120 m, a sand bar on the inside bank | the river to drive along; soft sand that sinks and drags |
  | Rock | the Boulder Field on Lookout Hill's flank: 343 boulders up to 2.8 m on bare rock | the grippiest ground there is, the boulders to crawl over in low range |
  | Steep climbs | the Lookout Track (31%), the ford banks | low range and lockers |
  | Open ground | the clearings and meadows between the stands | drive anywhere: across country between the tracks |

  Beacons mark the Mud Pit, the Deep Ford, the Boulder Field and the Shallows.

- **Lalghati Canyon** (2 km, west of the taiga and north of Chalkewadi; `src/world/maps/canyon.js`): red rock country in
  the manner of those games' canyon maps. The Bearwood leaves the taiga across its west edge (at its own level, 66 m)
  and runs west through a broad canyon it has cut 110 to 125 m down into a plateau of red sandstone, its floor wide
  open (280 to 340 m across between the walls), then north out of the world. Its walls stand in ledges, beds of harder rock 8 to 13 m deep over steep faces of softer (the generator steps
  the ground, the terrain shader draws the beds and their joints, and the map's tint colours the strata in bands of
  cream, orange and deep red with a darker varnish); fallen blocks lie at their feet. Its own ground set
  (`public/assets/ground/canyon.json`): a sandstone scan for the rock, cracked red earth, red sand, and the coast's red
  mud, grass and stones; its own trees (`canyon` in `src/render/Vegetation.js`): acacias spreading their flat crowns
  (about 5,000 trees in all, a few by the water, scattered over the floor and the ledges, none on the cliff faces), thor (the candelabra spurge) in the rocks, and dead trees; reeds stand
  along the waters' edges and out into the shallows (a map's `reeds`, `src/render/Grass.js`). Its air is clear and warm,
  the colours rich. **Lalghati Base** stands on the floor where the canyon opens to the taiga.

  | Place | What it is |
  |---|---|
  | The canyon floor | the river between sand and shingle bars, red mud flats spreading out from it where it floods (7% of the map is mud, six open mud fields among them), acacias here and there; the Gorge Track up it from the taiga, through the river in the **Lal Shallows** at the bend (spread wide, knee deep) and on north along the east bank |
  | Hidden Creek | a side canyon off the south side, 45 m across, its creek knee deep (0.43 m) in a channel down the middle and across the main floor to the river, the track up beside it, to the **Hidden Pool** under a dry fall at its head |
  | Red Pool | a box canyon off the north side, across the river at the ford, a waterhole in the reeds under its end wall |
  | The Ledge Road | a shelf cut along the south wall, round the bend and up the west wall, 1.16 km at 9% from the floor to the rim, 5 m wide with room either side, the wall above it and a drop of 50 m on the other side |
  | The plateau | slickrock and red sand, dry washes, domes of rock; the Rim Track along it round the bend to the **Rim Lookout** over the canyon |
  | The escarpment and the bench | the plateau's south edge, a wall down to the bench below, broken where a ramp of fallen rock comes down (the Chimneys Road's hairpins); on the bench the **Mud Flats** (red mud, standing water in its low spots) and the **Chimneys**, three sandstone buttes |

  (The generator's river banks ramp up out of the water so a truck can climb out anywhere; a river between cliffs,
  `river.cliffs`, keeps its 12 m ramp and leaves its canyon's walls standing beyond it.)

- **Bhimashankar** (2 km, between the coast, the Konkan Ghat and the pass): evergreen jungle on ranges either side of
  a valley, the Bhimashankar road up it from the Konkan Ghat to Koyna, and the Bhor quarry in the hills east of it, a
  pit cut in benches with a ramp down into it at one even grade.
- **The Deccan** (4 km, south of the Konkan Ghat and Kerala): the plateau below the escarpment, from the real ground.
  The Konkan Ghat's river runs on across it (at the level it leaves the ghat) and out of the world; Shivapur, a town
  of streets and houses on a terrace above the river; fields in parcels on two grids (the valley's, turned with it,
  and the uplands', squarer), each sown with its crop (mustard, cane, wheat, sunflower, millet, ploughed or fallow);
  Shivsagar lake out on the plain; a four-lane expressway along the valley; the Kerala ghat road down through a gap in
  the escarpment; and the Tamhini road south over the plateau to the world's southern edge.
- **The Konkan Ghat** (2 km, east of the coast): the coast's tableland carried on east, its broad upland falling to
  the river that comes out of Kerala (the same river, at the same level, running on across it and out of the world)
  and rising into Kerala's forested ridges. The **Konkan Ghat Road** (2.1 km of two-lane tarmac) carries the Kashid
  ghat road on from the coast's edge, down through the gap in the ridges into Kerala (and on, its two lanes and their
  lines with it, to the paddy and rubber track); the **Kundalika River Track**
  leaves it for the riverbank. Ghat Dhaba (a chai stall and a bus stop) stands by the road.
- **The Ashwood Pass** (2 km, north of Kerala): a range of ridges with a saddle through it. The **Ashwood Pass Road**
  (2.1 km) climbs from Kerala's tea plateau (276 m) and drops through the saddle to Ashwood's valley (82 m); the
  **Cairn Ridge Trail** loops off it over the ridge to the west. A hut and a flag at the top. Snow lies on its
  ridges above 390 m on the Ashwood side; its snow line rises towards Kerala (570 m at the seam), so Kerala's green
  ridges, laid onto its southern edge, stay green on both sides of the join.

**Each stretch's air.** A stretch can have its own (`air` in its map: fog density, cloud cover, the sun's strength and
the colour saturation): the taiga's fog closes in to a few hundred metres under an overcast sky, the light flat and
the colours muted. It comes on as you drive in, blended from 100 m outside the stretch to 260 m inside it, and goes
again as you leave (`airAt` in `src/world/OpenWorld.js`, set on the renderer each frame: `setAir` in
`src/render/Renderer.js`); everywhere else the world's own air is as it was.

**The new country's roads** are routed over its ground (`tools/routeroads.mjs`, written to
`src/world/maps/countryRoads.js`; run it again after changing a stretch's ground or a road's waypoints): between each
two of a road's waypoints, the cheapest way over a grid of the ground (5 m, the Deccan's 8 m; 16 ways out of each
point), as a road builder would lay it, costing its length, more for every percent of grade and much more past the
road's own, its turns, water and the world's open edges; then smoothed. Where a road reaches the edge of its stretch it
carries straight on across it for its last 45 m, the way the road beyond it goes (a hand-laid spur of an old map) or
square across the edge (both sides routed): all 16 roads that cross from one area into another do it with no turn at
the join (within 9°; the North Coast Highway first doubled back on itself where Korlai meets Borli, a 152° turn). A
waypoint can mark a leg to lay straight (the fort road through its two gates). The roads are then laid on graded
ground, as the stretches' roads are.

**Joins between different grids.** The new stretches are on 2 m grids (on a 1 m grid the Deccan's 4 km square alone
would hold 16.8 million points). Where one is laid onto a map on a 1 m grid (Ashwood, Kerala, the Konkan Ghat and the
pass), that map's edge is made straight between every other point, the ones the stretch has too, easing back to its
own ground over 4 m (`coarserEdges` in `src/world/BigWorldGen.js`): the stretch is drawn and driven straight between
its points, and the finer edge stood up to 1.76 m off that line between them (Koyna's edge against Ashwood's), a
crack in the ground. And where two maps share one edge of a stretch (the Konkan Ghat and Kerala along the Deccan's
north), each one's edge is carried on past its end only where no other takes over: Kerala's, carried 260 m past its
corner, folded the Deccan's ground along the Konkan Ghat's seam in a crease 13 m deep; now 1.9 m. At a corner, where
two edges' bands meet, the ground is the two neighbours' carried in together, each by how near its edge is (laid on
one after the other, the second took over and its edge was pulled back to the first's a few metres in): the worst
crease across any seam, measured over 12 m, was 8.1 m (Koyna's corner with Ashwood and Bhimashankar) and is now 3.6 m,
on the crest of a ridge.

Each map is generated as it is when it is driven alone, in its own frame, and stands at its own place in the world.
Where a road leaves one, its edge ridge is cut down to a pass and a spur of road runs out through it (built after the
map's own trails, so its trees and boulders fall where they always do): the coast's ghat road carried on east, a road
west out of Kerala off the paddy and rubber track, a road north off the Kurinji jeep track, and Ashwood's old valley
road south. The stretches are generated after the maps either side of them and laid onto their edges: their ground
gives way to the neighbour's over the last 220 m, carried on at the neighbour's own slope, and once everything is cut
into it the edge is the neighbour's height at every point, so nothing steps where two maps meet (the stretches are on
1 m grids, as Kerala and Ashwood are, so the points along a seam are the same points). What is carried in is the
neighbour's edge averaged along it, over more of it the further in (half as far either way as it is in, up to 80 m):
its hills and valleys run on into the stretch, but not its every hummock, drawn out straight across the band into
furrows with bare rock down their sides (over the first 120 m in from the Kerala and Ashwood seams the ground's
unevenness across 4 m was 1.7 to 2.2 m, and is now 0.17 to 0.42 m; the stretches' own ground away from the seams has
0.18 to 0.5 m). Towards Kerala their steep ground is grown over as Kerala's is, bare rock only on the sheerest faces
(on the whole of the Konkan Ghat, and on the pass for 210 m in from the seam, giving way over as far again): rock
covered up to 68% of the land next to Kerala, and now 0 to 13%, as on Kerala's side (up to 17%). Their roads are laid on graded
ground: the ground along each line smoothed and kept within the road's grade, cut into the rises and built up over the
dips as deep as that takes, its ends held to the roads they meet, and the land laid onto it with banks either side
(no stretch of the roads between the maps is steeper than 16%, measured over 10 m). In Node the whole world builds in
about 25 s, and a test (`test/world.test.mjs`) checks the seams, the grades across them, the river at the Kerala seam,
the satnav's route from the coast to Ashwood, and a truck driving over each join on the real physics.

**Loading like Forza.** The maps are built in Web Workers, several at once (`src/world/WorldLoader.js`,
`worldWorker.js`), the coast first: the game starts as soon as the coast is ready, and the others join the world while
you drive, each stretch as soon as the maps either side of it are in. A map that comes in is drawn by its own
renderers (`src/render/WorldView.js`: its terrain, trees, grass, water, rocks, buildings, road markings and what
breaks, in a group at its centre), its colours baked a few milliseconds at a time between frames; until then its
ground is the far land, and nobody gets near it before it is there. Every map is kept in the browser's storage
(IndexedDB, under a fingerprint of the generator's code and the coast's data: a change to either builds them afresh),
so the next visit skips building them. In a test here (headless Chromium drawing in software, without a graphics card,
much slower than a real computer), the open world was first ready to drive 126 s after the click on the first visit
and 37 s on the next, with the other four maps all in 39 s after that; the Konkan Coast alone took 99.5 s on the same
machine. Measured again after the changes below: 56 s on the first visit (20 s of it building the coast in its worker)
and 34 s on the next, of which 22 s, either way, is the software renderer compiling the shaders (a graphics card does
that in a few seconds). With the world filled out to twelve maps: ready to drive 136 s after the click on the first
visit, and on a later one ready in 58 s with all twelve in 58 s after that; with every map in and drawn, the browser
held 660 to 760 MB of JavaScript memory.
With every map in, the browser held about 680 MB of JavaScript memory before the changes below; measured the same way
(every map in, a frame drawn in each), 763 MB before them and 560 MB after. Most of what it holds now is the maps' own
grids (heights, surfaces and water, which the physics reads): the ground textures' pixels are let go once the graphics
card has them (they held 130 MB), the colour of the land far off is kept on a 2 m grid rather than a 1 m one, and the
water, road wear and road markings of each map let go of their arrays once they are on the card.

What comes in while you drive is kept light on the page's own thread. The young trees and roadside things of a map are
placed in its worker (and kept with it in storage), not when it joins; its ground textures are decoded and packed in
a worker too (`src/render/groundWorker.js`); the maps that grow the same set of trees share one set of tree models
and one set of their pictures for far off (the Ghat and Kerala the coast's, the pass Ashwood's), and the water's
ripples are made once for all of them; its parts are built a step at a time with the game running between them; and
its shaders are compiled in the background (`compileAsync`) before it is shown, so its first frame on screen doesn't
wait for them. The trees' shaders no longer differ by species (the height of a crown is a uniform), so every map's
trees share the same few. A map the camera has left (beyond 2.6 km of its square) puts its tree models away and shows
every tree as its card again (until then the models it had round the camera stayed drawn: 0.33 M triangles of the
coast's trees, seen from the pass 3 km off). In the same software-drawing test, the page's own thread was busy for 45 s while the other
four maps came in, and 32 s after these changes (most of what is left is drawing Ashwood's tree pictures, which a
graphics card does in a moment).

At run time (`src/world/OpenWorld.js`) the world answers as one map does, in world coordinates: the ground, the water,
the trees and what breaks go to whichever map's square holds the point. Its beacons, buildings, roads, events, races
and party modes are every map's (each map's events where they are on it; the party modes once per map: Elimination ·
Kerala and so on). Around it all, one more terrain draws the far land: each map's own landform carried on past its
edge, met to its edge, blended between maps (each map's weighted as the inverse square of how far off it is, so the
far land meets every map's edge to within 0.3 m: a blend that gave a map 200 m off nearly the weight of the one at
hand left the far land up to 139 m above or below a map's edge, a sheet of land hanging in the air with the sky
showing under it). Along a map's edge where no map lies beyond, the far land also runs 12 m on under the map's
square, sunk below its ground: seen from afar, along a crest at the edge, the map's ground and the far land each left a
pixel here and there to the other by a hair, and the sky showed through them in a dotted white line. What a room shares carries the map: a tree knocked down in Kerala is
`kerala:t123`; a beacon's number is its map's place in the world times 100 and its own.

Where a stretch meets a map whose ground has textures of another set (the ghat and the pass, at Kerala), the stretch's
own give way to that map's over the last 160 m, so both sides of the seam are textured alike; and every stretch's
land takes on its neighbours' colours towards their seams, the same kind of ground against the same kind (gravel
against gravel, grass against grass): the neighbour's tint over each against the stretch's own, smoothed along the
seam, gives a factor that fades over the same 160 m. Far off, where the colour of the land stands for the textures,
each kind of ground there is coloured as the textures show it close up (the neighbour's set's colour, as far as they
have given way to it), so the land looks the same from near and far. The first way of matching the seams took the
land's average colour either side, which took on what differs in the land itself: by Kerala, where its forest floor
meets the stretches' grass, it darkened the pass road's gravel to 0.73 of the brightness of the same gravel on
Kerala's side, and seen from a distance it turned the stretches' grass brown and their rock mauve (the factor took
30 to 40% off the green and none off the blue). Now the gravel is within 6%; measured along the seams, the land
either side is as bright within 5% where it is the same land (the coast and the Ghat, the pass and Ashwood), and where
it is not, the difference is what is there: next to Kerala the stretches' open grass is 1.2 to 1.3 times as bright as
Kerala's forest floor, which its trees stand over. Each map's ground is shaded at its edge with the ground across the
seam (its neighbour's, or the far land's until that comes in), so the seams show no line of shading either.

**Roads across the seams.** A road that runs out of one map into the next is paved a few metres on past the edge (its
line carried straight on, `extend` in `world/maps/world.js`), and each map's road surface, lane lines and wear are cut
off at its own square: where a road crosses a seam at an angle (the coast's ghat road meets the Konkan Ghat's at 36°)
neither side's tarmac stops short of the other's, and the lines and the wear run on across the join. The Kerala spur
to the pass is gravel, as the pass road it runs on into is. The repairs in the two-lane roads' asphalt are patches inside one
lane (a darker, fresher square of tarmac with a ragged dark seam of sealant round it), kept clear of the edge lines. The station and the workshop are the nearest ones: towed
home, a truck goes back to the yard of the map it is on.

**Events across the world.** The stretches have races of their own (the Konkan Ghat Road and the Kundalika Descent on
the Konkan Ghat; the Ashwood Pass Climb and the Cairn Ridge Trail on the pass; and one or two in each of the new
areas, the events table above), and once every map is in, the **North Coast Highway** (10.5 km from the coast to the
Koyna dam: the robot driver's Wrangler 15:17, Thar 15:41, Ranger 16:01) and **Coast to
Snow** join them: 18.6 km from Kashid beach to Ashwood's ranger station, the whole world in one rally. A careful
robot driver on the real physics finished it in every stock truck tried (Thar 26:32, Wrangler 26:15, Ranger 27:14),
and its par times come from those runs, as the other races' do. (The Ranger, the longest of them, first grounded at
the corner from Kerala's estate road onto the Kurinji jeep track by the tea factory, where the road is cut into the
slope a metre and a half below the yard's edge: in the open world that corner is a short track of graded ground, the
Factory Turn, and all three trucks take it.) If a friend opens it before the whole world is in on your side, the chat
says so: it can be joined once every map is in.

## Project layout

```
server.js, server/        static host + https + WebSocket rooms (rooms.js)
src/physics/              Vehicle (chassis, axles, tyre contact, winch, water), Tire, Drivetrain, Surfaces, trucks,
                          Upgrades (the garage's parts and what each does to the physics)
src/world/                WorldGen (a map's world, from its definition), World (ground for the physics), Deform
                          (ruts), Noise; the open world: BigWorldGen (its maps, the stretches laid onto their
                          neighbours), OpenWorld (one ground of them all), WorldLoader and worldWorker (built in
                          workers, kept in the browser's storage)
src/world/maps/           the maps: index (the list, and each map's grids: its size and cell), ashwood, kerala,
                          coast (each one's land, river, trails, beacons, buildings, events and its own generator
                          hooks: Kerala's tea, paddies and quarry; the coast's real ground, sea, villages and forest),
                          coastRoads (the coast's routed roads), world (the open world: where each map stands, its
                          passes and spurs, the Konkan Ghat and the Ashwood Pass), north, east and deccan (the new
                          country round them), country (what those share: fields, planting, their routed trails),
                          seams (a stretch laid onto its neighbours, roads on graded ground), countryRoads (their
                          routed roads, generated) and routed (what the router routes); src/world/Fort.js (Korlai
                          fort's plan, drawn and collided with alike)
tools/konkan.py           the Konkan Coast's ground from open data (fetch, bake into public/assets/maps/coast) and
                          its roads (routed over it)
tools/routeroads.mjs      the new country's roads, routed over its ground
src/render/               Renderer, Sky, Terrain (LOD patches), WorldView (the open world: each map's renderers, the
                          far land), Vegetation, Tea (the estates' rows of bushes), Rocks,
                          Water (and the coast's sea), RoadMarkings and RoadWear (the coast's lane lines; the wear,
                          cracks and mud on its tarmac), Landmarks and
                          KeralaBuildings, TruckModel (chassis, axles, wheels, parts), Person and Hands (the driver,
                          his hands on the wheel; DriverAssets loads him, Driver draws one while he loads), TruckAssets
                          (each truck's real model) and TruckBodies (built-in bodies that stand in while a model loads),
                          Effects (particles, winch line), EventCourse (start banners, gates), Post (motion blur,
                          bloom and the grade), Probe (the reflections on the player's truck)
src/core/                 Game (the loop), Input, CameraRig
src/game/                 Career (money, trucks, parts, best times), Events (the courses, runs, medals, races),
                          EventPlay (events in the game: start lines, countdown, clock, prizes, races with friends)
src/audio/, src/net/, src/ui/   sound, multiplayer client, HUD and maps, the garage (Garage, GaragePreview)
public/index.html, css/   the screens and their icons; public/assets/fonts (Barlow), public/assets/ui (the lobby's
                          picture and the Modes & races cards' pictures, rendered in the game)
public/preview.html       developer view: ?cam=x,y,z&look=x,y,z&mods=Vegetation,Water,...
public/trucks.html        developer view of one truck: ?truck=hauler&build=overland (a preset or a build code)
test/                     node --test suites
```

## Credits

Truck models: the Mahindra Thar, "THAR 4X4" by MB_Mahesh; the Lada Niva, "Lada Niva" by Greg McKechnie; the Willys MB,
"Willys Jeep UN" by Mateusz Woliński (jeandiz); the UAZ Hunter, "UAZ Hunter expedition" by zhe_kan; the Chevrolet K20
Suburban, "1970 Truck" by Raphael Escamilla (Raffey); the Mitsubishi Pajero, "Mitsubishi Pajero 4WD" by rileylane; the
Ford Ranger Raptor, "Ford ranger raptor" by haraldina; the Ram 2500 Power Wagon, "Dodge Ram 2500" by VanuaG; the Jeep
Wrangler, "Jeep Wrangler 3D Model" by Suyog modak; the Ford Bronco, "Bronco Car Animation (Red)" by neshallads; the
Hummer H1, "Hummer H1 (Retry School)" by Voxel_CG; the Land Rover Defender 110, "Land Rover Defender 110" by
hartwelkisaka; the GMC Hummer EV, "GMC Hummer EV 2022" by Unn Interativa; the Mahindra Thar Roxx, "Mahindra - Thar Roxx" by ansari_studios; the Tesla Cybertruck, "Tesla Cybertruck" by TAIGA-ZOE; the Mercedes-Benz Unimog U1300L, "Unimog
Truck" by Levi Giovani; the Mercedes-AMG G 63, "Mercedes Benz G-class W263" by Lexyc16. Sports cars: the BMW M4 CSL,
"BMW M4 CSL" by Mpgs Studios; the Mercedes-AMG GT S, "Mercedes-Benz AMG-GT 2015" by Márcio Meireles (MMC Works); the
Corvette, "Chevrolet Corvette" by Waven; the Huracán, "Lamborghini huracan" by jkazulyblanco; the R8, "Audi R8" by
wallon; the M3, "[FREE] BMW M3 E30" by Martin Trafas; the NSX, "Honda NSX 1990" by Lexyc16; the 930, "FREE 1975
Porsche 911 (930) Turbo" by Lionsharp Studios; the R34, "Nissan Skyline R34 GT-R" by Lexyc16; the R35, "Nissan GT-R
2008" by TGRRRR (PolyTigr); the RX-7, "Mazda RX-7 FD" by Lexyc16; the Senna, "McLaren senna" and "McLaren senna's
tire" by hartwelkisaka; the STi, "Subaru Impreza WRX 1996" by Mac CGI; the Supra, "Toyota Supra MK IV (1994)" by
Martin Trafas. All on Sketchfab, CC BY 4.0, see `public/assets/trucks/CREDITS.md` (converted with `tools/cars.py`).
The driver: "indian man" by madmak21199 and his gloved hands, "Hand With Gloves" by teenjust500, on Sketchfab, CC BY
4.0, see `public/assets/driver/CREDITS.md` (converted for NIGHTSHIFT; the meshoptimizer decoder, MIT, is in
`public/vendor/three/addons/libs`). The Konkan Coast's ground: elevation from SRTM 1 arc-second, courtesy of the U.S.
Geological Survey (NASA/NGA; public domain), via the AWS Terrain Tiles (Mapzen); land cover © ESA WorldCover project
2021 / contains modified Copernicus Sentinel data (2021) processed by the ESA WorldCover consortium, CC BY 4.0; see
`public/assets/maps/coast/CREDITS.md`. Engine sounds: see `public/assets/audio/CREDITS.md` (Freesound, CC0, CC BY 3.0
and 4.0; built with `tools/sounds/build_grains.py`). Ground textures: CC0 scans from Poly Haven and ambientCG, see
`public/assets/ground/CREDITS.md` (packed with `tools/ground.py`). Tree models: pine, fir, spruce, birch, coconut palm,
oak (as mango), elm (as rubber), banana, bamboo, acacia and the old dead tree by evolveduk, the jungle tree by
kobaltsecond6c7d6150917a4267, and the candelabra spurge (as thor) by PlantCatalog, on Sketchfab, CC BY 4.0, see `public/assets/trees/CREDITS.md` (converted with `tools/trees.py`). three.js is MIT licensed
(`public/vendor/three/LICENSE`). Type: Barlow and Barlow Condensed by The Barlow Project Authors, SIL Open Font License
1.1 (`public/assets/fonts/OFL.txt`). Icons: most are Material Icons by Google, Apache License 2.0. The lobby's and the
cards' pictures are rendered in the game. Everything else is original.
