# Vehicle model credits

The 31 vehicle models in this folder come from [Sketchfab](https://sketchfab.com). Every one of them is licensed
**CC BY 4.0** ([Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)): you may
use, change and share them, commercially too, as long as you credit the author, link the source and the licence, and say
that they were changed. Each author and licence below was checked against Sketchfab on 2026-11-26; where an author has
renamed their account since the model was downloaded, the old name is given too.

They were converted for the TRAILBREAK game (`TRAILBREAK/tools/cars.py` on the `claude/sweet-volta-hxo6tl` branch of
this repository), so none of them is the author's original file. **Changed in every model:** turned to face +Z, scaled
to the real vehicle's wheelbase and set in metres with the origin on the ground, midway between the axles; **the road
wheels, axles, springs, shocks and brake discs taken off** (the game fits its own wheels on its physics); every mesh and
material renamed for the part it is, the author's name after a colon: `paint:`, `glass:`, `screen:` (the windscreen),
`head:`/`head_l:`/`head_r:`, `tail:`, `reverse:`, `amber:`, `trim:` and `rim:` (one wheel's rim, kept apart for the game
to copy to all four: centred on the origin, a radius of 1, facing +X; the Suburban, `hauler`, keeps none, the game
fitting steel wheels); the glass made see-through; the paint plain for the game to colour
(white where the author's paint was part of a texture, else the author's colour); dense parts simplified; the textures
resized and re-encoded as WebP, embedded in each `.glb`. The changes particular to each model are listed under the
table.

## Files

- `<id>.glb`: the model, binary glTF 2.0, its textures embedded. It uses the `EXT_texture_webp` extension (all of
  them) and `KHR_mesh_quantization` (some of them): three.js's GLTFLoader reads both; some other tools need a converter.
- `<id>.json`: what the converter measured, which the game reads with it. Most useful outside the game: `wheels` (FL,
  FR, RL, RR, each wheel's centre `c` [x, y, z], radius `r` and width `w`, in metres: where the author's wheels were, to
  put wheels back), `rim` (the kept rim's real `radius` and `width`), `wheelbase`, `track`, `bbox` and `heads`/`tails`
  (the lamps' centres). `scale` is the factor the author's model was scaled by: the `.glb` is already in metres. The rest
  (`bumperF`, `frame`, `cabin`, `steering`, `roofMap` and so on) places the game's own parts on the body.

## Models

| File | Vehicle | Original model | Author | Source | Licence |
|---|---|---|---|---|---|
| `thar.glb` | Mahindra Thar | THAR 4X4 | [MB_Mahesh](https://sketchfab.com/MB_Mahesh) | [sketchfab.com/3d-models/…66ee970b](https://sketchfab.com/3d-models/thar-4x4-66ee970b18014c98a1750064b65657b0) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `wrangler.glb` | Jeep Wrangler | Jeep Wrangler 3D Model | [Suyog modak](https://sketchfab.com/Suyogmodak) | [sketchfab.com/3d-models/…531f1205](https://sketchfab.com/3d-models/jeep-wrangler-3d-model-531f120594d946be8cd9d87b5095f856) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `bronco.glb` | Ford Bronco | Bronco Car Animation (Red) | [neshallads](https://sketchfab.com/neshallads) | [sketchfab.com/3d-models/…0f5a7d85](https://sketchfab.com/3d-models/bronco-car-animation-red-0f5a7d85d82540ab9436527fb8bbe4f7) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `hummer.glb` | Hummer H1 | Hummer H1 (Retry School) | [Voxel_CG](https://sketchfab.com/voxel_cg) | [sketchfab.com/3d-models/…580511d3](https://sketchfab.com/3d-models/hummer-h1-retry-school-580511d3b2df43f2bd2edda79655428c) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `shepherd.glb` | Land Rover Defender 110, the 2026 model | Land Rover Defender 110 | [hartwelkisaka](https://sketchfab.com/hartwelkisaka) | [sketchfab.com/3d-models/…0048bbc9](https://sketchfab.com/3d-models/land-rover-defender-110-0048bbc91b0f4c4289533e08de716806) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `hummerev.glb` | GMC Hummer EV | GMC Hummer EV 2022 | [Unn Tech](https://sketchfab.com/unntech) (downloaded as Unn Interativa) | [sketchfab.com/3d-models/…b686365d](https://sketchfab.com/3d-models/gmc-hummer-ev-2022-b686365d37a94cbdbb3a01d169f5a0de) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `mule.glb` | Willys MB | Willys Jeep UN | [SpatialNeglect](https://sketchfab.com/jeandiz) (downloaded as Mateusz Woliński (jeandiz)) | [sketchfab.com/3d-models/…133bed35](https://sketchfab.com/3d-models/willys-jeep-un-133bed35638e47fc8bacf12319ee369a) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `ranger.glb` | UAZ Hunter | UAZ Hunter expedition | [zhe_kan](https://sketchfab.com/zhe_kan) | [sketchfab.com/3d-models/…e6db8a23](https://sketchfab.com/3d-models/uaz-hunter-expedition-e6db8a23a6c8406a8ad876f1c7a3290f) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `bruiser.glb` | Ram 2500 Power Wagon | Dodge Ram 2500 | [VanuaG](https://sketchfab.com/VanuaG) | [sketchfab.com/3d-models/…b4259af6](https://sketchfab.com/3d-models/dodge-ram-2500-b4259af6d85d472b8fde9517bcd38154) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `hauler.glb` | Chevrolet K20 Suburban | 1970 Truck | [Raphael Escamilla](https://sketchfab.com/Raffey) | [sketchfab.com/3d-models/…e0953a2c](https://sketchfab.com/3d-models/1970-truck-e0953a2cfb7349dab78fa363fe6545e8) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `trekker.glb` | Ford Ranger Raptor | Ford ranger raptor | [haraldina](https://sketchfab.com/haraldina) | [sketchfab.com/3d-models/…fffd6f07](https://sketchfab.com/3d-models/ford-ranger-raptor-fffd6f07668a467095718c5e062348e2) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `gecko.glb` | Lada Niva | Lada Niva | [Greg McKechnie](https://sketchfab.com/mckechniegreg6) | [sketchfab.com/3d-models/…26ebf587](https://sketchfab.com/3d-models/lada-niva-26ebf5872bce4ff4ad2baee41882d6b2) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `drover.glb` | Mitsubishi Pajero | Mitsubishi Pajero 4WD [FREE / GAMEREADY] | [rileylane](https://sketchfab.com/rileylane) | [sketchfab.com/3d-models/…bec38f58](https://sketchfab.com/3d-models/mitsubishi-pajero-4wd-free-gameready-bec38f586d9349ee9c1f295b6f5569cb) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `rhino.glb` | Mercedes-Benz Unimog U1300L | Unimog Truck | [Levi Giovani](https://sketchfab.com/levigiovani) | [sketchfab.com/3d-models/…72caf995](https://sketchfab.com/3d-models/unimog-truck-72caf995b6064890b7bc62371cc79f36) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `roxx.glb` | Mahindra Thar Roxx | Mahindra - Thar Roxx | [ansari_studios](https://sketchfab.com/ansari_studios) | [sketchfab.com/3d-models/…f85210fe](https://sketchfab.com/3d-models/mahindra-thar-roxx-f85210fe98774b7fab1199d8ee151ead) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `cybertruck.glb` | Tesla Cybertruck | Tesla Cybertruck | [TAIGA-ZOE](https://sketchfab.com/TAIGA-ZOE) | [sketchfab.com/3d-models/…8950fc17](https://sketchfab.com/3d-models/tesla-cybertruck-8950fc178e254c9198b2a8555ef1590a) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `gclass.glb` | Mercedes-AMG G 63 | Mercedes Benz G-class W263 | [Lexyc16](https://sketchfab.com/Lexyc16) | [sketchfab.com/3d-models/…1a2a52b1](https://sketchfab.com/3d-models/mercedes-benz-g-class-w263-1a2a52b16cad4e618af347461817895c) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `m4csl.glb` | BMW M4 CSL | BMW M4csl | [Mpgs.studio3DModels](https://sketchfab.com/mpgs.studio) (downloaded as Mpgs Studios) | [sketchfab.com/3d-models/…b53782a0](https://sketchfab.com/3d-models/bmw-m4csl-b53782a00cc240a191d5d7d005af1423) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `amggt.glb` | Mercedes-AMG GT S | Mercedes-Benz AMG-GT 2015 | [MMC Works](https://sketchfab.com/mmcworks) | [sketchfab.com/3d-models/…4d9e0a8c](https://sketchfab.com/3d-models/mercedes-benz-amg-gt-2015-4d9e0a8cf9a844149bf6630da83eb97b) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `c8.glb` | Chevrolet Corvette Stingray | Chevrolet Corvette | [Waven](https://sketchfab.com/wavenquack24) | [sketchfab.com/3d-models/…10695785](https://sketchfab.com/3d-models/chevrolet-corvette-1069578531e441fd895f919487eaf4f3) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `huracan.glb` | Lamborghini Huracán LP 610-4 | Lamborghini huracan | [jkazulyblanco](https://sketchfab.com/jkazulyblanco) | [sketchfab.com/3d-models/…dc5d8c92](https://sketchfab.com/3d-models/lamborghini-huracan-dc5d8c922ada44cc87d4bd4f7d147929) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `r8.glb` | Audi R8 V10 plus, widebody | Audi R8 | [wallon](https://sketchfab.com/realwallon) | [sketchfab.com/3d-models/…e17e438f](https://sketchfab.com/3d-models/audi-r8-e17e438f076f4427a58d93aa779edaed) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `m3e30.glb` | BMW M3 E30 | [FREE] BMW M3 E30 | [Martin Trafas](https://sketchfab.com/TinoD2) | [sketchfab.com/3d-models/…ac3c7013](https://sketchfab.com/3d-models/free-bmw-m3-e30-ac3c7013434e403e8faff87948caf422) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `nsx.glb` | Honda NSX | Honda NSX 1990 | [Lexyc16](https://sketchfab.com/Lexyc16) | [sketchfab.com/3d-models/…1cc15628](https://sketchfab.com/3d-models/honda-nsx-1990-1cc15628a00a4739a6b6c01128927c8d) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `p930.glb` | Porsche 911 Turbo, 930 | FREE 1975 Porsche 911 (930) Turbo | [Lionsharp Studios](https://sketchfab.com/lionsharp) | [sketchfab.com/3d-models/…8568d9d1](https://sketchfab.com/3d-models/free-1975-porsche-911-930-turbo-8568d9d14a994b9cae59499f0dbed21e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `r34.glb` | Nissan Skyline GT-R R34 | Nissan Skyline R34 GT-R | [Lexyc16](https://sketchfab.com/Lexyc16) | [sketchfab.com/3d-models/…ff8fb225](https://sketchfab.com/3d-models/nissan-skyline-r34-gt-r-ff8fb2251dfa4bb9979e7022c5a6666c) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `r35.glb` | Nissan GT-R R35 | Nissan GT-R 2008 | [PolyTigr](https://sketchfab.com/PolyTigr) | [sketchfab.com/3d-models/…c8cd27c3](https://sketchfab.com/3d-models/nissan-gt-r-2008-c8cd27c3c8cf4e2d86da031f1e98f8c8) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `rx7.glb` | Mazda RX-7 FD | Mazda RX-7 FD | [Lexyc16](https://sketchfab.com/Lexyc16) | [sketchfab.com/3d-models/…d35ff630](https://sketchfab.com/3d-models/mazda-rx-7-fd-d35ff630df614771b82e7b2f59035b1e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `senna.glb` | McLaren Senna | McLaren senna | [hartwelkisaka](https://sketchfab.com/hartwelkisaka) | [sketchfab.com/3d-models/…f3ada11a](https://sketchfab.com/3d-models/mclaren-senna-f3ada11a4618463cac2e082c008cc340) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `senna.glb` (its wheels) | McLaren Senna | McLaren senna's tire | [hartwelkisaka](https://sketchfab.com/hartwelkisaka) | [sketchfab.com/3d-models/…a2f9f367](https://sketchfab.com/3d-models/mclaren-sennas-tire-a2f9f3674e3242a082a6cf97e247d3cd) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `sti.glb` | Subaru Impreza WRX STi, GC8 | Subaru Impreza WRX 1996 | [MAC ULT ARTS](https://sketchfab.com/MACULTARTS) (downloaded as Mac CGI) | [sketchfab.com/3d-models/…0f780b01](https://sketchfab.com/3d-models/subaru-impreza-wrx-1996-0f780b0178e94ab294be62e5bd2fc07e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `supra.glb` | Toyota Supra Turbo A80 | Toyota Supra MK IV (1994) | [Martin Trafas](https://sketchfab.com/TinoD2) | [sketchfab.com/3d-models/…eb9bb1eb](https://sketchfab.com/3d-models/toyota-supra-mk-iv-1994-eb9bb1eb41db431cb078088ae1ce45f8) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

## Changes made to each model

Besides the changes made to all of them (above):

- `thar.glb` (Mahindra Thar): Narrowed 8% to the Thar's real width, its static axles, shocks and discs removed.
- `wrangler.glb` (Jeep Wrangler): Narrowed 12.5% to the JK's real track, its brake discs, spare rim and ground disc removed.
- `bronco.glb` (Ford Bronco): Narrowed 2.5% to the Sasquatch Bronco's track, its springs, shocks, arms and rear axle removed, its rims cut from its wheels.
- `hummer.glb` (Hummer H1): Narrowed 6% toward the H1's real track and width, its springs, shocks and wishbones removed, the dense parts simplified, its tan panels given the game's paint.
- `shepherd.glb` (Land Rover Defender 110, the 2026 model): Its suspension's brakes and hubs removed, the parts simplified (its cab less than the rest).
- `hummerev.glb` (GMC Hummer EV): Its wheels, brakes and the plates' logo taken off, the interior and the trim simplified.
- `mule.glb` (Willys MB): Widened 3% to the MB's real track, its static axles and drive shaft removed, its white UN paint (and markings) given the game's paint, its rims darkened, the dense parts simplified.
- `ranger.glb` (UAZ Hunter): Narrowed 5%, its axles, springs, shocks, roof rack and roof lamps removed (the game fits its own), its orange paint given the game's paint and the rest of that texture plain black, the dense parts simplified.
- `bruiser.glb` (Ram 2500 Power Wagon): Widened 5% to the Ram's real track, its wheels told apart by where they are (its parts share one texture), its orange paint given the game's paint, the headlamp and tail-lamp lenses the game's lamps.
- `hauler.glb` (Chevrolet K20 Suburban): Narrowed 9% to the Suburban's real width, its axles, springs, wheels and wheel trims taken off (the game fits steel wheels), its orange paint given the game's paint (the cream band kept).
- `trekker.glb` (Ford Ranger Raptor): Widened 2% to the Raptor's real track, its wheels, brakes, springs and headlamp LEDs taken off, the trim simplified.
- `gecko.glb` (Lada Niva): Its axles, springs and wishbones taken off, its weathered paint (and its rust and primer patches) given the game's paint, the trim simplified and the textures halved.
- `drover.glb` (Mitsubishi Pajero): Narrowed 5% to the Pajero's real width, its wheels told apart by where they are, its rusty red paint given the game's paint and its windows and lamps the game's glass and lamps (told apart by the colour of its one texture).
- `rhino.glb` (Mercedes-Benz Unimog U1300L): Widened 10% to the U1300L's real track and raised 8.7 cm onto its real 12.5 R20 tyres (the model's own are smaller), its static axles, springs and propshafts removed, its weathered cab paint given the game's paint and its windows and lamps the game's glass and lamps (told apart by the colour of its texture); the box body keeps its own white.
- `roxx.glb` (Mahindra Thar Roxx): Widened 2.7% to the Roxx's real track and width, its wheels told apart by where they are (they share the body's materials), the dark panel behind its windscreen taken out (the game's glass is see-through); its cab is empty, so the game draws its seats and dash.
- `cybertruck.glb` (Tesla Cybertruck): The 2019 show truck, scaled to the production truck's wheelbase; its wheels told apart from the suspension they share a mesh with by where they are, the suspension removed, its stainless panels given the game's paint and its black trim kept (told apart by the colour of its texture); the game fits door mirrors.
- `gclass.glb` (Mercedes-AMG G 63): Scaled to the W463 G 63's wheelbase and lowered 1.2 cm onto its real 275/50 R20 tyres, its covered spare taken off (the game hangs its own on the rear door).
- `m4csl.glb` (BMW M4 CSL): Its red pinstripes kept as trim, the mirror glass made a mirror.
- `amggt.glb` (Mercedes-AMG GT S): Lowered 2.5 cm onto the GT S's real tyres (the model's are a little larger), a one-sided badge removed.
- `c8.glb` (Chevrolet Corvette Stingray): Raised 2% to the C8's height, a box closing off its empty cabin removed (the game draws seats and a dash).
- `huracan.glb` (Lamborghini Huracán LP 610-4): Lowered 1.8 cm onto the Huracán's real tyres, its brake calipers removed.
- `r8.glb` (Audi R8 V10 plus, widebody): Its honeycomb grilles simplified.
- `m3e30.glb` (BMW M3 E30): Its brake calipers removed.
- `nsx.glb` (Honda NSX): The game draws its seats and dash.
- `p930.glb` (Porsche 911 Turbo, 930): Narrowed 3.6% and raised 2% to the 930's real width and height, its shadow plane, doubled clear-coat shell and whip antenna removed.
- `r34.glb` (Nissan Skyline GT-R R34): The game draws its seats and dash.
- `r35.glb` (Nissan GT-R R35): Its interior and engine bay simplified, its brake calipers removed.
- `rx7.glb` (Mazda RX-7 FD): Nothing more.
- `senna.glb` (McLaren Senna): The body has no wheels of its own, so four of a second model, "McLaren senna's tire" by hartwelkisaka (in the table), were set in its arches at the Senna's real sizes; the plate's text removed.
- `sti.glb` (Subaru Impreza WRX STi, GC8): Stretched 1.5% wide and 3.5% tall to the GC8's real size, the game draws its seats and dash.
- `supra.glb` (Toyota Supra Turbo A80): Its brake calipers removed.

## Crediting them

A credit for a model, wherever it is shown, can read: *"<Original model>" by <Author>
(<Source>), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); changed: converted for TRAILBREAK.*
Vehicle names and makes belong to their makers; the models are fan-made and not endorsed by them.
