# NIGHTSHIFT fix list

Everything reported in play-testing, worked through one at a time. Each item is ticked when it is fixed and checked in
the game. Newly found problems go at the end of their section.

## Driving and vehicles
- [x] Stolen vehicles: turning and acceleration (all eleven types tested; the get-in took 6-8 s with the controls dead: now ~3-5 s, gas finishes it)
- [x] Autorickshaw: colour changes when you get in (livery kept); its own single-cylinder sound (and diesel sounds for jeeps, lorries, buses)
- [x] Autorickshaw first person: eye on the front bench, centre
- [x] Bus / lorry: far too slow (power tuned: bus 0-50 km/h ~7 s, top ~92 km/h)
- [x] Bus: driver seat and first-person eye at the front right of the cab
- [x] Car first person: eye kept ~0.75 m from the wheel/dash, a little lower under the roof
- [x] Getting in: head kept down under the door top and roof until the hips are in (checked: an auto, an Ertiga)
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
- [x] Vehicles floating at junctions, by culverts and on bridge ramps (an auto on a lawn's edge, an SUV in a jam): the
  physics took a road's centre-line height, or a neighbour road's shoulder up to a metre higher, where the strip is
  drawn tilted or lower. Wheels now sit on the road exactly as drawn (each strip read row by row)

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

## People
- [x] Clothing: men in plain shirts over dark trousers, khaki or a white mundu, black hair; women in sarees; no kurtas or western dress in crowds, drivers or riders
- [x] More women: four saree models (two new: yellow and rose), and churidars (a kurta-coloured top over leggings) on the two women avatars; models with their origin at the waist now come out the right size
- [x] Riders: helmets (riders wear baked helmets; the 'turban' was a helmet on the old kurta models, which no longer ride)
- [x] Characters torn into spikes up close (hands, faces, hair, clothes; the 'blocky' hands at the wheel): the map's
  coordinates run to 200 km and the GPU skinned in float32 there (~1-2 cm steps). Skinning is now worked out about
  the camera: every character smooth

## Roads and world
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
- [x] Realistic trees: real coconut palm, banana and broadleaf models (Sketchfab, CC BY) within ~90 m of the camera, with leaf-cut shadows; the generated plants beyond. (Junction-height priority was tried for the remaining road humps: more humps, reverted)
