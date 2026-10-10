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
- [ ] Getting in: head through the roof, wrong posture
- [x] Wheels: traffic wheels roll at each vehicle's own wheel size (autos, buses and lorries were wrong); the shards round the wheels were the model import (fixed)
- [x] Vehicle models incomplete up close: the importer's simplifier tore spikes and holes into dense panels (Scorpio, Dzire, Brezza, Ertiga, Maruti 800...); the near LOD now keeps seams, small trim and panel borders. Re-imported. (Thar scan: still a little rough at the wheels)
- [x] Two-wheeler rider vanishes when hit (always thrown as a body now; no get-up animation exists yet)
- [ ] Traffic car floating in the air (parked by a pole)
- [x] Bus tilted on a kerb after a crash and stays there (a player crash is an incident now: towed away)

## Police and traffic
- [x] Police start a chase when their own car hits you (fault check: whoever drove into whom)
- [x] Police checking points (a Bolero on the verge with its lights, a barricade on the edge, two officers in khaki)
- [x] Traffic police at busy junctions (an officer in khaki on a podium under a white umbrella at the corner)
- [x] Accidents: a recovery truck with a jib hoists the wrecks and tows them away; a traffic officer waves traffic past; crashes the player causes get the same response
- [x] Traffic with purpose: every vehicle has a trip to a real place (autos short fares, cars further, lorries to towns and markets), turns towards it at junctions, pulls in on arrival, then sets off on the next
- [x] Police jeep = Mahindra Bolero, white with KERALA POLICE on the doors and a light bar (the roof figure: cab seat fixed earlier)

## People
- [x] Clothing: men in plain shirts over dark trousers, khaki or a white mundu, black hair; women in sarees; no kurtas or western dress in crowds, drivers or riders
- [ ] More women's models: churidar / salwar (only two saree models now)
- [ ] Riders: helmets (Kerala law), no turbans

## Roads and world
- [x] Kannur is the starting area (story, garages, races moved there)
- [x] Canals: walled channels, not water lying on the road
- [x] Dual carriageway median: kerbed divider, no trench
- [x] Flyovers meet the road across tile edges; traffic under a flyover stays below
- [ ] Roads: thick tar look, seamless joins (no ledges or slab edges where roads meet)
- [ ] Wide canals / rivers mapped as water areas (polygons): same treatment as the canal lines
- [ ] Kannur QA: every main road, the bridges (Valapattanam), the hills, Payyambalam beach, the rivers
- [ ] Median ends: a brown earth strip runs into the junction past the median's end
- [ ] Ride every road and fix what is found
