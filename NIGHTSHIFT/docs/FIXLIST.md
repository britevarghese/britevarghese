# NIGHTSHIFT fix list

Everything reported in play-testing, worked through one at a time. Each item is ticked when it is fixed and checked in
the game. Newly found problems go at the end of their section.

## Driving and vehicles
- [x] Stolen vehicles: turning and acceleration (all eleven types tested; the get-in took 6-8 s with the controls dead: now ~3-5 s, gas finishes it)
- [x] Autorickshaw: colour changes when you get in (livery kept); its own single-cylinder sound (and diesel sounds for jeeps, lorries, buses)
- [x] Steering wheels (Logitech G29 / G920 / G923, Thrustmaster, Fanatec, Moza...): the game read every controller as
  an Xbox pad, so a wheel steered with a thumbstick's curve and dead zone and its pedals did nothing (and could turn
  the camera). A wheel is known by its name: linear steering, and its pedals learnt the first time it's plugged in
  (a panel asks for the accelerator, then the brake; each wheel reports them its own way), kept per wheel; paddles
  for nitrous and horn, never the car's reset; the d-pad for the menus. Settings > Controls shows the wheel and sets
  the pedals up again. (No force feedback: browsers don't offer it)
- [x] Budget wheels (Nitho Drive Pro V200, PXN, Hori...): the pedals still did nothing. Such a wheel doesn't give its
  make: in D-Input mode it's a 'USB Gamepad' with the pedals on any axes (or both on one, accelerator one way, brake
  the other), in X-Input mode an Xbox pad with them on the triggers or a stick. A controller that isn't a known
  gamepad and isn't laid out as one is taken for a wheel now, and the setup learns the wheel and both pedals from
  whatever moves (an axis or an analogue button, resting at either end, a pedal that reads 0 until first pressed),
  showing what it sees. Any controller can be set up from Settings > Controls > SET UP WHEEL (an X-Input wheel looks
  like an Xbox pad: a note says so when one is plugged in); until it is, a wheel's pedals are read where a pad has
  its triggers
- [x] Settings > Controls said 'None connected' with the wheel plugged in, and SET UP WHEEL stayed grey. Two causes:
  browsers give controllers only to secure pages (https, or http://localhost), so a PC that opened the game at the
  server's LAN or Radmin address (http://192.168..., http://26...) could never see a wheel or gamepad; and the row
  was written once when the tab opened, while a browser shows a controller only after it is first used. The server
  now answers https on the same port (a certificate it makes itself: the browser warns once, Advanced > Proceed);
  on an http page the row says so and OPEN HTTPS goes there, taking the progress and settings along (a note says it
  once too). The row follows what the browser sees, every half second
- [x] A controller test page (/controllers.html, linked from Settings > Controls): what the browser sees of each
  wheel or gamepad, live (every axis and button), whether the page can see controllers at all, a checklist for when
  nothing shows (the V200's purple / orange modes and its HOME button, Windows' joy.cpl, Steam Input and other
  programs that take controllers over) and a report to copy
- [x] Autorickshaw first person: eye on the front bench, centre
- [x] Autorickshaw first person: no hands at all (the cockpit probe stopped early for autos) and no handlebar in the
  model. It has ours now, chrome with black rubber grips over the dash, turning about the raked column with the
  front wheel, the gloved hands round the grips; the seated driver holds the same grips. (The eye could also land
  outside the auto: the cab's box was measured out to the world and back, which grows with the heading)
- [x] Bus / lorry: far too slow (power tuned: bus 0-50 km/h ~7 s, top ~92 km/h)
- [x] Bus: driver seat and first-person eye at the front right of the cab
- [x] Car first person: eye kept ~0.75 m from the wheel/dash, a little lower under the roof
- [x] Getting in: head kept down under the door top and roof until the hips are in (checked: an auto, an Ertiga)
- [x] Getting in looked broken: the head nodded and swung, the body dived in head first, the camera jumped.
  - The pose kept its hips target in a scratch vector that the arm and leg IK wrote over. The body dropped through
    the floor for a frame, and the walking camera jumped to the car's middle and back.
  - The "look at" turned the top of the head toward the target instead of the face, so the head nodded 30-45°
    down: at the door handle, and at the wheel the whole drive. It turns the face now (yaw, then pitch, the neck
    taking a third), within ±75° and 35° down to 25° up.
  - The animation mixer rewrites only the bones whose clip value changed. While the sit-down clip held still, the
    spine's duck added up frame on frame and folded the body double, about 70°. Every person's bones now go back
    to the mixer's own pose before it runs.
  - The sit-down clip's last frame was a standing pose, and the stand-up clip's a seated one (as was the landing
    clip's). The driver popped up out of the seat and dropped back at the end. Those frames are dropped on load.
  - The head ducks under each car's own roof and door frame, measured across its width. It starts on the way to
    the frame and straightens once inside (BMW: head top 1.13 m under a 1.16 m frame).
  - The feet were planted on the car body's underside, 17 cm up, so they stood on air. Getting out ended on
    tiptoe and dropped into the walk. Both now use the real ground beside the door and the standing clip's hip
    height.
  - The sequence runs a little slower (about 2.1 s from the door). The gas pedal hurries the legs in and the door
    shut, rather than skipping them.
- [x] Driver's head through the roof of low cars. The seat height came from the car's highest point: on the 930
  that is 1.65 m, above its 1.23 m roof, so the head stood 18 cm out of the roof; the Huracan, Senna and F40 showed
  the hair or more.
  - The seat now sits under the roof measured right over it.
  - In the lowest cars the driver lies back as a sports seat does (F40 about 40°).
  - Checked: 930, Huracan, Senna, F40, BMW E30 and GT-R. Every head is under its roof (at most 3 cm into the roof's
    own thickness, from 19 cm through it).
- [x] An error in one part of a frame's update skipped the rest of the frame, drawing included, so the picture froze
  while it lasted. The frame is drawn anyway now. (One such error: a two-wheeler's riders were listed as empty
  while their shaders compiled, which threw every frame at start-up.)
- [x] Wheels: traffic wheels roll at each vehicle's own wheel size (autos, buses and lorries were wrong); the shards round the wheels were the model import (fixed)
- [x] Vehicle models incomplete up close: the importer's simplifier tore spikes and holes into dense panels (Scorpio, Dzire, Brezza, Ertiga, Maruti 800...); the near LOD now keeps seams, small trim and panel borders. Re-imported. (Thar scan: still a little rough at the wheels)
- [x] Two-wheeler rider vanishes when hit (always thrown as a body now; no get-up animation exists yet)
- [x] Traffic car floating in the air (parked by a pole): parked cars hung half off raised roads, drains and embankments; now they stand where all four wheels are level (further onto the road, or not parked there), tilted to the ground, never through a pole, wall or stall (checked: 0 of 1,765 parked cars over a drop, five areas)
- [x] Bus tilted on a kerb after a crash and stays there (a player crash is an incident now: towed away)
- [x] First-person driver's hands: black leather riding gloves with hard knuckles and jacket sleeves (a real rigged
  model, Sketchfab, CC BY) at ten to two: the back of the hand to the driver, fingers wrapped round the rim, thumbs
  along it, the forearm turning with the hand, all following the wheel
- [x] Driving into the sea or a river off the road: the water drags the car back (it drove on the sea at speed)
- [x] Hands not on the steering wheel (gripping air above it, or sunk in the dash): the wheel's place was guessed
  from one ray. Each model's own wheel is now found in its geometry (the ring in front of the driver), the hands
  go on its rim, the driver sits square behind it, and the wheel turns with the steering (it stood still while
  the hands went round it). Found in every car with a modelled wheel; where none is found (the Bolero) ours is
  fitted
- [x] First-person grip as drivers really hold a wheel (driving-school 9 and 3, the 'sports grip' of driving games):
  hands near a quarter to three, the palm round the outside of the rim, fingers wrapped behind it, the thumb along
  it; push-pull steering (the hands follow the wheel a little, then the rim slides through them; hand over hand
  swung an arm across the view). The wheel itself turns with the steering
- [x] First-person jacket sleeves bulky (the source model's are ~1.5 times an arm across): drawn in towards the arm's
  bones, the upper arm to 72%, the forearm 72% at the elbow to 92% at the cuff (still over the glove's)
- [x] Bus and lorry first person: the eye ~0.8 m above the driver's seat (it sat just under the cab roof); a bigger,
  flatter wheel (their low-detail cabins have none to find); the hands shown (a rule meant for photo mode turned them
  off whenever the camera was 3 m from the vehicle's middle: a bus driver always is)
- [x] KSRTC bus: our wheel stood beside the model's own white one. Its rim is found now (the search reached only
  a metre ahead of the eye, and its low-detail rim has ~35 points): the hands are on the bus's own wheel, which turns
- [x] Buses and lorries, first person: the driver's eyes are put behind the vehicle's own wheel, or ~1 m behind the
  windscreen and 1.3 m over the cab floor where it has none (the Kerala private bus looked at its passengers' seat
  backs from the middle of the bus; the lorry's eye could fall into the chassis), looking down a little more so the
  wheel and the hands show; the seated driver sits there too
- [x] Private bus: a left-hand-drive model (its wheel and dials on the left, the driver on the right with ours):
  mirrored into a right-hand-drive bus, its doors on the kerb side
- [x] Lorry: the windscreen and side windows were painted into the cab's texture, opaque: their dark glass is
  see-through now (the ALL INDIA PERMIT strip and the frames stay)
- [x] Mini-truck: its hands gripped the headlight (the only ring in front of the driver: the cab is an empty shell);
  it gets our wheel. Its seated driver sat on the cab roof (lorry seat heights): inside now
- [x] Mini-truck: the model's windscreen and side glass were opaque grey (its author named the glass materials
  something else): first person saw little. They're glass now, see-through from the cab and outside
- [x] Autos with a wheel in the air at the road's edge (up to 0.44 m over a drain or a ditch): an auto stands on its
  three wheels, its body on the plane through them, and may tilt further before it is held up (0.45 m, was 0.25 m).
  A scan of the traffic round Kannur for a minute: 9 with a wheel over 0.25 m in the air, now 2 (0.32 m, beside a
  junction whose roads the map leaves apart)
- [x] Vehicles floating at junctions, by culverts and on bridge ramps (an auto on a lawn's edge, an SUV in a jam): the
  physics took a road's centre-line height, or a neighbour road's shoulder up to a metre higher, where the strip is
  drawn tilted or lower. Wheels now sit on the road exactly as drawn (each strip read row by row)
- [x] Junction steps: a road ending on another without a shared point in the map (the point dropped from the main
  road's line, or the side road ending just short of it) kept a level of its own: a culvert's deck ended 0.27 m over
  the main road, and in the Kannur tile 40 such junctions had a step over 10 cm (15 over 40 cm, the worst 2.5 m). The
  side road now eases onto the main road's settled level: 4 left over 10 cm (beside ramps, which keep their own level)
- [x] Steps where a road crosses from one 2 km tile to the next (44-60 cm at one): one tile had sunk its edge as
  water and the other hadn't, and each took the road's level from its own ground. At the edge both take the survey
  they share. The ground there no longer pokes up through a road in a cutting (it was left as surveyed on the edge
  rows: now held under the road from that shared level, alike in both tiles)
- [x] Scorpio: green whatever its paint, its windows opaque black and its whole trim glowing red with the brake
  lights. The model gives ten different materials one name (the windows and the black plastic among them, drawn as
  one), calls its body colour 'primary' and its high stop lamp 'glass'. Renamed by what each one is as the model
  loads: it takes its paint (the prologue's black Scorpio is black), the windows are glass, only the tail lamps glow
- [x] Canal bridge parapets stood 12 cm onto the carriageway (their road face inside the road's edge): moved just off it
- [x] Traffic vehicles with panels missing (a Scorpio's doors and front see-through): parts made of single faces were
  drawn one side only; they are drawn both sides now, as the model has them

## Police and traffic
- [x] Police start a chase when their own car hits you (fault check: whoever drove into whom)
- [x] Police checking points (a Bolero on the verge with its lights, a barricade on the edge, two officers in khaki)
- [x] Traffic police at busy junctions (an officer in khaki on a podium under a white umbrella at the corner)
- [x] Accidents: a recovery truck with a jib hoists the wrecks and tows them away; a traffic officer waves traffic past; crashes the player causes get the same response
- [x] Traffic with purpose: every vehicle has a trip to a real place (autos short fares, cars further, lorries to towns and markets), turns towards it at junctions, pulls in on arrival, then sets off on the next
- [x] Police jeep = Mahindra Bolero, white with KERALA POLICE on the doors and a light bar (the roof figure: cab seat fixed earlier)

- [x] Traffic police run their junction: palm raised to the way held, the other arm waving the other way on, the
  signals following his phases (the queue that's waiting gets its turn); one officer at most, at some busy
  junctions, only once that part of town is built (they stood in the empty void before)
- [x] Checking points stop vehicles: one officer waves a vehicle down, it pulls in, the other walks to its window,
  checks the papers and waves it on. The player too: stop for the check (a stolen car is spotted), or drive through
  and they come after you. The jeep and the barricade are solid
- [x] A jam (three or more vehicles stuck 20 s): an officer walks in and lets one way through at a time, then leaves
- [x] Narrow-street head-on jams re-tested (six runs of 3-4 minutes in Kannur): no head-on lockups. A pile-up of a
  dozen autos for minutes near the start was a lane with no way on: one-way carriageways ending a few metres short
  of the road they run into (the map's pieces sharing no point there), so the first to reach the end stopped for
  good. They run on into the nearest lane starting just ahead, on road all the way (11 such ends round Kannur, now 0)
- [x] Police (and racers, story drivers) drove 1.7 m off their lane on average, often over the centre line: every
  route was shifted 2.6 m to the right (a rule for roads whose route is the centre line); Kerala's routes are the
  keep-left lanes themselves. Followed as they are now: 0.4 m off on average
- [x] Police and other AI drivers ran into trees, poles and walls: they cut bends and junction corners (steering for
  a point across the inside, 1.3-1.5 m off the lane), went back on the throttle at full lock while still turning,
  came at the first of two sharp opposite corners at 55 km/h (the pair counted as one gentle bend), and drifted a
  metre off the lane. They look less far ahead on a bend, never aim across the verge, hold the corner's speed until
  lined up, judge each sharp corner on its own and steer back onto the lane line. A drive test by the same driver,
  ~10 km round Kannur, now leaves the road or hits something at one place only (a tight junction turn straight
  onto a narrow canal bridge)
- [x] AI routes (police, racers, story drivers) cut across corners at junctions: the route dropped every lane point
  within 6 m of the last one, so where one lane ends and the next begins it ran straight across, a metre off the
  lane, and a car on it met the end of a canal bridge's parapet just past the junction. Only points on top of one
  another are merged now. Out of a sharp junction turn the AI also sped up at full lock and swung wide: it waits
  until it's straightened (and slows when a metre or more off its lane); a bridge's parapets keep a little further
  from a junction. A drive test round Kannur (three runs, ~9 km) now has no crashes or runs off the road;
  Thalassery, Mattannur and Taliparamba (one run each) a few scrapes and slips at under 20 km/h (the one looked at:
  a junction turn too sharp for the car's lock)
- [x] AI cars stopped with the brake held drove off backwards: in this game the brake at a standstill is reverse
  gear (a police car parked at a roadblock crept back; one with no route reversed away at up to 35 km/h). They
  stand on the handbrake now
- [x] Full-detail traffic cars cost up to 400k triangles each (the Scorpio; a Dzire 280k, an Ertiga or an 800 200k),
  and up to 8 of them were drawn that way at once on High (12 on Ultra), shadows on top. The nearest cars still get
  full detail, within a triangle budget per quality level (High: 1M; a short drive peaked at 1.0M, was 1.33M)
- [x] AI cars (police, racers, story drivers) ran wide at junctions, at more than a third of a town's sharp turns:
  lanes meet across a junction a few metres apart at right angles - a turn of 3-4 m radius - and a car turns no
  tighter than about 4.7 m at its lock, so it went over the far kerb or into a wall. A route's sharp corners are
  rounded now to an arc the car can steer (a corner split between one lane's end and the next one's start, or a lane
  starting with a hook, taken as one corner; a bend drawn with many points left alone); an arc that would cut the
  kerb's corner, or sweep the car's front corner off the far side, is moved across until it doesn't, the car easing
  over in the last few metres before it, as a driver swings out. The car also ran a few points ahead of itself along
  a curve drawn with close points (it moved on 5 m short of every point, and cut the curve by 1.4 m), and now aims out
  by what steering for a point ahead cuts off a curve. A route no longer drops a lane's start 1.4 m on from the last
  lane's end (it ran a car's width off the lane for 100 m, into a house's wall), and one starting 25 m ahead no longer
  reads as the car being 2 m off it (it steered hard into a wall). Every sharp turn in four towns driven from 30 km/h,
  clean: 77 of 135 -> 120 (Kannur 16 -> 33 of 38, Thalassery 24 -> 33, Mattannur 21 -> 29 of 31, Taliparamba
  16 -> 25 of 28; most of the rest turn back sharper than 120 degrees, which wants a three-point turn). The lorry in
  'Lorry War', stuck in the drain 0.8 km into its route, now drives all 7.6 km of it; a race's rival that stopped
  dead against a canal's parapet finishes

- [x] Hitches while driving into new country (a tile's build stalling a frame): every step of a tile's build timed
  on a drive (headless, its CPU about half a desktop's). The worst were the ground's mesh (up to a quarter of a second:
  its normals by three's general routine), the first street of a tile (a long road's kerbs in one go, a sixth of a
  second), a tile's roads or walls merged at once (an eighth), the canals' mask (a seventh) and the canopy shade (a
  twelfth). Now the normals are worked out straight from the arrays (several times faster), the long loops pause when
  the frame's share is used, the merges copy a few parts at a time with a pause between, the mask is drawn, read and
  turned over in pieces. The minimap's 5 km picture was redrawn whole (every road, waterway and house of up to 25
  tiles, ~35 ms) each time a tile arrived: now a tile that arrives is drawn in on its own, and a new picture for where
  you've got to is drawn behind the scenes, two tiles a frame, then swapped in. Frames over 40 ms on the same drive
  21 -> 11, the worst 269 -> ~170 ms; what's left comes in pairs with every system slowed at once: the garbage
  collector (the build's churn of JS arrays, still to cut down) and shaders compiling (in the test, without a GPU)

## People
- [x] Clothing: men in plain shirts over dark trousers, khaki or a white mundu, black hair; women in sarees; no kurtas or western dress in crowds, drivers or riders
- [x] More women: four saree models (two new: yellow and rose), and churidars (a kurta-coloured top over leggings) on the two women avatars; models with their origin at the waist now come out the right size
- [x] Riders: helmets (riders wear baked helmets; the 'turban' was a helmet on the old kurta models, which no longer ride)
- [x] Characters torn into spikes up close (hands, faces, hair, clothes; the 'blocky' hands at the wheel): the map's
  coordinates run to 200 km and the GPU skinned in float32 there (~1-2 cm steps). Skinning is now worked out about
  the camera: every character smooth
- [x] People sitting in mid-air on the road, hands on a wheel that wasn't there (by a mission marker): the drivers of
  the traffic, seated by a system run apart from the drawing of the cars, which froze with the game while the cars
  drew on. They are seated now right after the traffic is drawn, every frame and whatever the game is doing, and
  only in a vehicle drawn that frame (none in a replay's; a multiplayer guest's traffic gets its drivers too)
- [x] A mission's light column filled the screen yellow when the car stood on the marker: the columns (missions,
  races, garages, contacts, businesses) are brightest at the foot and fade up into the sky, and fade out as the
  camera comes within ~9-30 m (a contact's or business's within ~4-20 m); the ring on the ground stays
- [x] People flying off when hit (and riders thrown from bikes): the ragdoll was started with its limbs' motion for
  1/60 s and stepped at half the frame time, so a person left at twice the car's speed at 60 fps and nearly five
  times at 144 fps (50 km/h: hips 5.8 m up, 45 m away). It steps at a fixed 1/120 s now: hips 1.4 m up, at rest
  ~10 m on, at any frame rate; the feet don't grip the road in the first instant (the body toppled where it stood);
  a fast car carries a person over its bonnet instead of firing them ahead at its own speed
- [x] On foot, the camera sat right behind the character's head indoors and against walls (the bank's vault and
  cash racks hidden), and could end up behind an electric pole or a tree. Up close it now goes over the right
  shoulder and looks on past it; the line to the character is checked every quarter metre, so a pole or a trunk
  brings the camera in front of it at once (easing back out after); low walls and counters below it don't count

## Roads and world
- [x] The game hung for a moment every so often while driving: building each new 2 km piece of the map ran some
  steps in one go (grading the roads up to 0.7 s, the ground maps 0.2 s, merging a district's walls 0.1 s, the
  street edges 0.25 s, the lanes kept clear of walls 0.1 s). They pause every few milliseconds now and the world
  spreads them over frames. Ninety seconds of driving round Kannur (this test machine, slower than a gaming PC):
  worst frame 0.74 s -> 0.15 s, time lost to stalls 9.6 s -> 3.2 s, the slowest 1% of frames 82 -> 55 ms; the roads
  come out exactly the same
- [x] Still hanging, worst at the start: (1) when the traffic models finished loading (often mid-drive) all 17
  vehicle types were made ready at once, a freeze of seconds (5 s on this machine): each is made ready a few
  milliseconds at a time now, in the background; (2) every material's shader was compiled the first frame it was
  drawn, a stall of a tenth of a second and more each on a PC: the menu's first frame compiled ~50 at once, the first
  frame of a drive 28, each new tile up to a dozen. They are compiled in the background (behind the loading screen,
  'Preparing graphics...', and before each tile, vehicle type, rider, tree model, parked scooter and person is first
  drawn); mid-drive compiles 22-33 -> 4 (the shadow pass's own). Tile meshes merge on a fast path, the terrain's
  index buffers are written straight into one typed array
- [x] A gaming laptop detected as VERY LOW: the first-launch benchmark timed the world being built and the shaders
  compiling, and the auto-quality governor saved every level it took off while driving (each slow start lowered it
  for good). The benchmark draws only, after the shaders are compiled; the governor's drops hold for that session,
  not in the first 40 s of a drive or while a tile is building; earlier detections are measured again. The main menu
  says which graphics the browser uses, and what to change when it is the built-in chip or software
- [x] The start area was built twice: the menu's first frame had its camera at the map's origin, and the world,
  streaming round the camera, dropped the tiles the loading screen had just built; they were built again after
  PLAY. The world streams round the player now. (Trees were made solid only round the starting point too: they
  follow the player now)
- [x] Kannur is the starting area (story, garages, races moved there)
- [x] Canals: walled channels, not water lying on the road
- [x] Dual carriageway median: kerbed divider, no trench
- [x] Flyovers meet the road across tile edges; traffic under a flyover stays below
- [x] Roads: seamless joins: where two roads overlap away from their shared point the lesser one tucks under the main road (drawn and driven), no slab edge or ledge
- [x] Narrow water areas (canals, rivers, ponds, temple tanks mapped as polygons): cut out of the ground, walled, a bed, the physics drops into them; never under a road
- [x] Kannur QA: every main road, the bridges (Valapattanam), the hills, Payyambalam beach, the rivers
  - [x] Valapattanam: NH66 crossed the river as a causeway at water level (the water under the road was read as a string of little culverts); now one bridge about 6 m over the water. Canal walls no longer stand in open river water
  - [x] Rivers: every road over water in the region scanned (Kannur, Valapattanam, Kattampally, Thalassery,
    Mattannur, Iritty): the Kattampally backwater roads lay half a metre over the water, now bridges ~4 m up;
    a long bridge slopes from bank to bank instead of standing at the higher bank's level
  - [x] Payyambalam beach: sand, palms, the sea; no glitches
  - [x] Hills (Iritty): steep stretches are the real grades; looked at with the new trees
  - [x] Areca palms: the real palm model, slimmer; grass tufts: thin blades of their own (they were palm leaflets)
- [x] Median ends: the gap between the halves by a junction is paved, level with them (it was bare earth)
- [x] Sea, rivers and backwaters: live water, waves running across it in several trains, the surface heaving with
  them, lighter crests, the sky reflected at low angles (it was a flat sheet); worked about the camera so the waves
  stay smooth 200 km from the map's origin
- [ ] Ride every road and fix what is found
  - [x] Test drives (a careful driver following the lanes, Kannur, Valapattanam, Thalassery, Mattannur, Iritty) found:
    lanes 3.2 m wide on narrow two-way streets (cars drove with a wheel on the verge, scraping the edge walls);
    compound walls cut across the street where they stepped back from it; corner walls and canal parapets
    right in a junction's mouth (no room to turn); houses on cls 7 streets left standing in the lane; the inner
    lane of a one-way road with no way on at some junctions. All fixed
  - [x] AI drivers (police): took 90-degree junction turns at 70 km/h (a turn drawn with several points read as
    several gentle ones; the corner judged from the wrong place; soft braking) and circled a corner point they
    had passed: corners are judged by their real radius and braked for in time
  - [x] Bumps where roads meet: a side road meeting a junction at another level eases in over a longer stretch
    (a gentle curve, not a dip); canal bridges' ramps rounded off at the foot and the top. Kannur 74 -> 55,
    Thalassery 44 -> 29, Valapattanam 53 -> 38; no steps, no floating road. What remains is mostly the gentle
    crest of a small canal bridge
  - [x] Roundabouts were not level: the ring (mapped in pieces) took each arm's height where it joined, 0.74 m up
    and down between two arms 8 m apart. The ring is one level now, its junctions at the ring's level, the arms
    easing onto it
  - [x] A canal bridge whose head is right at a junction dipped 1.5 m in a V there (a ramp crossing another road is
    brought down to it, meant for a ramp passing over a street): by the water it stays up, the side road climbing
    to meet it. Kannur's humps (the same inspector) 77 -> 72; 60 of those are small canal-bridge crests
  - [x] A road running along a canal or a creek (the waterway's line drawn over the road's centre) was read as a
    bridge and lifted on a deck: 1.8 m with a steep ramp by a junction (the one reported, in Kannur), and up to 6-7 m
    for 200 m where a main road's drains, joined up, passed for a river. A crossing has water on both sides of the
    road for a good part of the way over; a road with the water along one side stays on its ground, with the canal
    wall beside it. Mapped bridges and the river bridges stay. Kannur's humps (the same inspector) 72 -> 21,
    Thalassery and Valapattanam 14 and 26; no steps, no new floats
  - [x] Kannur's two worst humps (taken for a footbridge's short ramps): a service road mapped as a bridge over
    another road, lifted 5 m on ramps of 27 % between two junctions 18 m apart. A bridge with no room for ramps a
    car can drive (15 %) crosses at the ground now; a bridge over a road in a tunnel is no flyover either
  - [x] Humps where a road climbing a hillside ends at a junction: a road's level is smoothed along it, and near its
    end the shortened window's mean lay below the road on a climb (a side road met the road at the top of a slope
    2 m under it: a 4.4 m hump to the next junction 7 m on). Near the ends a straight line is fitted instead. Up in
    the hills a road beside a pond also no longer dips into the pond's sunk bed. Humps (the same inspector): Kannur
    21 -> 8, Thalassery 14 -> 7, Valapattanam 26 -> 18; Kannur and the 8 tiles round it 263 -> 132, steep stretches
    64 -> 35, roads banked off the ground 8 -> 0; worst hump 4.4 m -> 1.5 m. Bridges and flyovers as before; no
    steps, no new floats
  - [x] Steps where a road crosses from one 2 km tile into the next (the inspector looked at one tile at a time and
    never saw them): 33 of the 169 crossings round Kannur met their other half a step apart, up to 1.08 m. A
    junction near the edge eased the road's end to its level, a drain right at the edge held it at the bank's level
    (the neighbour may not see the drain), a junction exactly on the edge took an average only one tile had. The
    end at the edge stays at the level both tiles share now: all 169 meet exactly (Thalassery's too). Roads along a
    tile's edge follow the survey smoothly (straight pieces between its points made a sharp crest every 62.5 m on a
    hill). Kannur and the 8 tiles round it 132 -> 113 humps; Kannur 7, Thalassery 6, Valapattanam 17
  - [x] Roads on hills standing on a slab in the air: the ground under and beside a road is kept below its surface,
    and that limit was taken from any point of the road within 14.5 m: on a road climbing at 15 % the ground under
    it was held at its level 13 m further down the hill, 2 to 3 m below it. From the road's nearest point now: roads
    more than 0.6 m above the ground under them, Kannur and the 8 tiles round it, 610 -> 174 (what is left: two roads
    at different levels a few metres apart, on an embankment between them, and at tile edges)
  - [x] Sharp knees and steps at junctions: a road in OSM's pieces eased to a junction on one piece only (a junction
    3.6 m from the joint was a 1 m step up a 29 % slope); a lane coming down a hill over the main road's drain met it
    flat (held at the drain's bank); two junctions a few metres apart on a hillside took levels 1.2 m apart. Kannur
    and the 8 tiles round it 113 -> 102 humps; no steps; every tile edge still meets exactly
  - [x] Jolts on hill roads (a test drive in Iritty: three at 68 km/h on the Thalassery-Coorg highway). The ground
    between a terrain cell's corners stood up to 0.67 m over the road, every cell or so along it: a road through a
    cell's near side has the far corner up to 22 m off, past the band kept under the road, and on a hillside that
    corner held the cell's surface up over the carriageway (the car rode up it; grass over the tarmac). Now over every
    carriageway, every 2 m and five points across, the ground's triangle is kept under the road, the corners holding
    it up lowered by just enough (the high ones, not those beside the road). And where a side road climbing away from
    a junction overlapped the main road's lane higher up (a 0.36 m step on the main road), the main road's own surface
    rules on its carriageway. The same drive: no jolts; that stretch's grade smooth (6-7 %, no 20-35 % kicks)
- [x] Realistic trees: real coconut palm, banana and broadleaf models (Sketchfab, CC BY) within ~90 m of the camera, with leaf-cut shadows; the generated plants beyond. (Junction-height priority was tried for the remaining road humps: more humps, reverted)
- [x] Houses standing a little into a narrow road (OSM's outlines and our road widths don't quite agree; one more than
  a metre in was already left out): a car keeping its lane ran into a house's corner. Moved back off the road, up to
  2 m, to stand 0.3 m clear of it. Round Mattannur, buildings onto a carriageway or within 1.3 m of a lane 18 -> 1
- [x] T junctions drawn without a shared point (a side road ending part-way along a road, or the point simplified out
  of the through road) were no junction to anything that keeps clear of one: a canal's parapet ran right up to a
  side road's mouth, and a car turning in caught it. Found now by the side road's end lying on the other road
- [x] Steps where a side road meets another road (every lane and junction turn checked for a jump in height: up to
  0.53 m round Iritty). A side road was brought to the junction's level only on the other road's centre line: coming
  down a hillside it met the main road's edge half a metre up, and the main road's surface, which rules on its own
  carriageway, left that as a drop off the kerb. It is held at the other road's level right across that road's
  half-width now - at the other road's own height where it reaches its edge (a highway falling past a slanting
  junction) - and eases into its grade beyond; road strips have a point every 2.5 m near their junctions (drawn every
  8 m, the strip ran straight through that bend). And two roads' points 0.31 m apart across a metre's boundary - a
  link road's start and the highway's point - were no junction at all: points within 0.6 m are one now. Iritty:
  flagged spots 22 -> 12, the worst 53 -> 14 cm (bar a 13 m link between the highway's two carriageways, 0.95 m apart
  in height); Kannur 81 -> 54, worst 46 -> 29 cm. Tile edges still meet exactly
- [x] Where two roads of the same kind meet, the one passing through stays level across the other one's width too
  (OSM splits a road at every junction and the straight pieces are graded as one road: at a fork the two lanes
  overlapped at different grades, a 0.25 m step). Not past a link road; and only as far towards the next junction as
  leaves room to climb to it (two T junctions 7 m apart and 0.64 m different, levelled at both, had a 15 % ramp
  between, 0.29 m under the road forking off). Kannur: flagged spots 54 -> 40; Iritty 12 -> 10. All 12 missions pass
- [x] More junction steps: a road ending on another without a shared point was levelled to that one's height before
  that one was graded, which then moved it (a main road ending on a lane met it 0.2 m up); and where such an end
  ran on just over the other's line it was a crossing as well, each road brought to the other's old height (0.28 m
  apart). The road it ends on now stays at the height it was met at, levelled across it like at a shared point, and
  a crossing found that way is levelled across too. At a narrow fork the levelling runs on for as long as the two
  carriageways overlap (two branches 30 degrees apart were 0.17 m different 8 m out) - not where a highway's two
  carriageways part (they're levelled side by side already). Kannur's worst step 29 -> 13 cm
- [x] A side road crossing a divided highway climbed 0.95 m across the median, from one carriageway to the other (a
  0.33 m jolt on the link between them): the two carriageways were tied together only loosely, the junctions along
  them kept the heights taken before that and pulled them apart again, and the link counted as much as the highway
  at its ends. The carriageways are graded level with each other now, the junctions move with them, and a link meets
  the road it links at that road's level. Iritty's crossing 0.33 -> 0.13 m; no step over 13 cm in Kannur or Iritty
- [x] A road running along a map tile's edge is that tile's alone, and its carriageway over the line was nothing to
  the tile there: grass under a car's wheels (off-road drag), no road to traffic (a car in that lane counted as off
  it), to police checkpoints, people on the pavement or an AI working out its way round a corner. Near an edge the
  next tile's roads count too. AI junction turns round Kannur: 29 -> 30 of 33 clean (the rest are acute, 106-140
  degrees)
- [x] Bridges and their ramps (Thalassery, the road over the railway): a side road passing 6.5 m under the bridge
  was joined to it in the map, and the lanes joined them too - traffic and routes turned off the deck and dropped
  onto the road below, or drove up a wall the other way. Lanes are joined only where the roads meet at a height now.
  A lane ending on the bridge's approach brought the approach down to it, a 0.3 m dip in the main road; it climbs to
  meet the approach now, level across it along its slope (no road can pass under a ramp less than 3.5 m up: a road
  ending on one climbs to it, not left 1.7 m below its side). Thalassery's worst junction step 20 -> 19 cm, the
  5.7 m one gone; Kannur, Iritty unchanged; tile edges still meet exactly
- [x] Scanned Thalassery, Mattannur and all of Iritty with every tile round them built (the road scan, and the check
  that roads meet across tile edges, had been reading tiles still being built, or not loaded at all), and fixed:
  - a canal bridge running off a tile's edge was held up at the edge (as a river bridge is: the neighbour sees the
    river too) where the neighbour didn't see the canal - the road met its other half 0.72 m lower. Only a river's
    bridge is held up at the edge now
  - a road's lane running over the tile's edge (a road meeting the edge at a slant) stood on the next tile's ground,
    0.13 m under the road: the road's surface counts there too, where the next tile has no road of its own
  - a highway mapped as a bridge, left on the ground (no room for its ramps), crossed a street at the street's own
    level, not as a junction: 0.24 m apart where the street left its carriageway. Crossings of such bridges are
    junctions now; one raised over the other still isn't
  - a lane forking off a highway that falls 10 % there was held flat beside it (the fork rule above) and stood 1 m
    over it while still on its carriageway: a fork follows the other road's slope now
  Worst steps: Kannur 13, Iritty 37 (a lane climbing 3.9 m in 21 m from the highway up to a road on the hillside,
  the junctions at its two ends leaving it little room; was 52), Thalassery 14, Mattannur 10 cm. All tile edges
  across the four towns meet exactly
- [x] AI junction turns where the route reached the corner through a short hop in line with the lane before it (one
  lane's end to the next one's start, 3.9 m): the turn was rounded within that hop, 2 m across - tighter than a car
  can steer - and the car swung its nose 1.5 m off the road. The room for the arc is the straight run up to the corner
  now, and of the two (that and the pieces next to the corner) the one that keeps to the road better is used; not
  for an acute turn to the left, the kerb's side, where the wider arc cut across the corner's walls. Junction turns
  round Thalassery: 32 -> 35 of 35 clean; Kannur 30 of 33 (three acute turns left). The Lorry War lorry's longest
  stop 2 -> 0.3 s. Taliparamba scanned too: worst step 12 cm, tile edges meet within 1.3 cm

## Story
- [x] The story begins like GTA's: a prologue, 'The Kayal Job', starts on a new game in Kerala (Esc skips a scene;
  the pause menu skips the prologue, or plays it again later). A cold open in a black Scorpio down the road from Kayal
  Mercantile Bank, Kannur: Leena (she plans it) beside you, Sajan (the guns) behind, the camera cutting between them
  as they talk, each looking at whoever speaks. You walk to the bank with them, Kathakali masks go on at the door;
  Sajan's shot into the ceiling, everyone down, the old guard thinks better of his gun. The manager out of his cabin,
  the cashier with the second key (two keys, as in every Indian bank), the strongroom door swings, the bag filled rack
  by rack; the silent alarm, the bell and a clock running down. Out with the bag: police jeeps, Sajan splits off
  through the market, Leena gets in beside you and keeps talking (looking back at the jeeps) until you lose them;
  then Babu's workshop in Thavakkara, where the car disappears and chapter 1 starts
  - [x] The bank is a real building on a main road near the start with an open front (one behind a compound wall
    and gate could not be walked into); its board, glass doors and an ATM are put up outside, and walking in builds
    the branch: hall, counter, cabin, strongroom, staff and customers, its windows daylight from inside
  - [x] The scenes' cameras stay inside the car's cabin and keep clear of walls, the car and other people; the dark
    windows clear while the camera looks in through the windscreen; game notices wait until a scene is over
  - [x] The strongroom's racks hold bundles of notes (stacked edges, a paper band and a stamp on each) instead of
    plain coloured blocks; the gold-loan packets on the top shelf stay plain envelopes
- [x] Chapter 1 follows on from the prologue: Babu, Leena, Sajan and Firoz talked as if they'd never met you ("So you
  are the new driver Leena talked about"). Now the bank job is in the papers, the Scorpio is green with a Mangalore
  number, Leena's thirty-two lakhs need washing (so Firoz, and whose hawala the pickup carries: SI Mathew's), and
  Shibu goes about saying the Kayal job was his. The last line of the story said Ernakulam; it's Kannur
- [x] Sajan is picked up in person in 'Puzhathi Pickup' (he was an invisible passenger): he waits at the kerb by the
  railway gate, watches your car come, walks round to the passenger door when you stop and gets in (the car held
  until the door shuts), rides through the chase looking back at the jeeps, gets out and follows you if you walk
  off and back in when you return; at Leena's he gets out and walks over to her. Driving off without him fails it
- [x] A contact stays for the last words when a job ends with them (Leena vanished the moment the mission passed);
  lines from someone standing with you aren't phone calls
- [x] A contact's briefing is staged as in GTA: you were left sitting in the car while they talked at the windscreen,
  both of you frozen (a scene doesn't run the game). Now you're out of the car and standing face to face with them,
  both breathing and shifting, whoever speaks gesturing, the heads turned to each other; the shots cut line by
  line: a wide one from the side to open, then over the listener's shoulder onto whoever speaks, a close one when
  they go on talking, all from one side of the two of you, clear of walls and the car. Game tips wait till it's
  over; afterwards you're on foot by your car and the contact stays where they stood while you're about
- [x] A job that ends with the contact (a car brought to Babu, Anitha or Rajan; Sajan back to Leena; the Thar and the
  white Scorpio) closes the same way: out of the car, the last words face to face, then MISSION PASSED (they were
  subtitles while you sat in the car). Someone else with something to say stands with the contact: Sajan just
  dropped off, Leena at Firoz's and at the finale in Chala; everyone looks at whoever's talking. A job that ends
  elsewhere keeps its phone call
- [x] The walking camera went inside a car beside you (getting out after a scene, the seats seen through the roof):
  it keeps out of the cars round you as out of walls
- [x] Contacts stood in odd places on Kerala's roads: Leena on a dual carriageway's median (the pavement was found by
  stepping across the road from the lane, as for traffic on the right). Across the road is kept where it works (Babu
  at his workshop's door), but a median sends them to the lane's own side, and a place right at a big junction to
  the nearest pavement round it, off the road and clear of walls
- [x] Every mission played through by a test (the driving done by teleports, the AI cars watched over their whole
  routes). Found and fixed:
  - [x] 'Spice Route': the pickup you tail stood facing the way it came, for good, 3 km in. Its route was made
    before the roads round two of its places had loaded, so a place was taken as a junction a kilometre off and the
    route went there and back. A mission car's route now waits (up to 15 s) until the roads at every place on it
    are there, and a place the route would have to turn round at is left out
  - [x] Routes (missions, races, the GPS, police) don't turn right round at a junction unless there's no other way,
    and take an acute turn (a Y-junction taken backwards) only when it saves a good deal; a race's or a mission's
    route goes on through each place the way it came in. (A lane's last metre hooks into the junction's centre: the
    turn is judged over the last and first 6 m, or every right turn looked like turning round)
  - [x] A mission car stuck out of sight is put back on its own route a little ahead, facing along it (it was set
    on the nearest lane, which could run the other way)
  - [x] Lorries and buses on mission routes keep to the main roads where they can, avoid acute junction turns and
    roads that bend too tight for them, take corners a quarter slower and aim out to the outside of a sharp turn.
    An AI car on the throttle and not moving now backs off and tries again (a lorry wanting a slow corner speed
    never counted as stuck). Still: in 'Lorry War' the only way out of Attadappa bends 100 degrees in 6 m; the lorry
    leaves the road there and stays in the roadside drain (easy to ram: the job still passes)
  - [x] ...that lorry wasn't off the road: every vehicle turning at walking pace on full lock was braked by its own
    front tyres (below 5 m/s the model held the body from swinging out about the rear axle, so both axles slid, and
    below 1 m/s it read the wheels as sliding sideways). It stopped dead in the bend for 14 s, throttle on. Slow turns
    roll round now: it takes that bend at 16 km/h, its longest stop on the whole 7.6 km 2 s
  - [x] A mission's AI vehicle was put down wherever the roads had loaded when its step began: with the way between
    not built yet, the 'Lorry War' lorry started 1.5 km along its route, by a 110-degree corner it couldn't take from
    a standstill, and sat in the drain for good. It waits for its route to start at its place now (a minute at most)
  - [x] A mission car not put in place yet (its roads not loaded, kilometres off) left the objective with no marker
    and no GPS: both now show the way to the place meanwhile
  - [x] 'press E' for a contact's mission stayed on screen through the whole mission
  - [x] The yellow destination marker stood at sea level: in Kerala its ring was under the road (18 m down at
    Puzhathi), only the top of the beam showing. It stands on the ground now
  - [x] A race against a story rival lined you both up 1.8 m either side of the lane's centre: him half on the
    verge on a narrow road. He's in the lane now, you beside him in the other
  - [x] A mission's 'go to' a place kilometres off was put on the nearest road loaded when the step began, not
    necessarily its own: Chirakkal's spot ended 60 m from any road, the marker in a field and the step never done.
    It's worked out again once that place's roads are in
