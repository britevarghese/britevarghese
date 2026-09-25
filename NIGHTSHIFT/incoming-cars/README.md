# Drop real car models here

If a Sketchfab token can't be set up, download the models yourself and put the files in this folder.
The importer matches each file to its car by name, so Sketchfab's own file names are fine.

1. Sign in to Sketchfab (free account) and open each link below.
2. Click **Download 3D Model**, then choose **glTF** (or **GLB**). You get a .zip or .glb file.
3. Put the files in this `incoming-cars` folder (on GitHub: open the folder, then **Add file → Upload files**).
   GitHub's web upload takes files up to 25 MB. For bigger ones, use GitHub Desktop, or the Sketchfab token route instead.
4. Tell Claude the files are there. It runs `node tools/import-cars.mjs`, which converts them, shrinks them, and swaps them into the game.

All models are **CC BY 4.0**. Credit is shown in the garage and written to `public/assets/models/cars/CREDITS.md`.

| Car | Sketchfab model | Author | Car id |
|---|---|---|---|
| BMW M3 (E30) | [[FREE] BMW M3 E30](https://sketchfab.com/3d-models/ac3c7013434e403e8faff87948caf422) | TinoD2 | `bmw_m3_e30` |
| Subaru Impreza WRX STi (GC8) | [Subaru Impreza WRX STi Version VI (GC8)](https://sketchfab.com/3d-models/457f01e7e8d14b088e3f092c1be9e75c) | Car2022 | `subaru_wrx_sti_gc8` |
| Mazda RX-7 (FD) | [Mazda RX-7 FD](https://sketchfab.com/3d-models/d35ff630df614771b82e7b2f59035b1e) | Lexyc16 | `mazda_rx7_fd` |
| Porsche 911 Turbo (930) | [FREE 1975 Porsche 911 (930) Turbo](https://sketchfab.com/3d-models/8568d9d14a994b9cae59499f0dbed21e) | lionsharp | `porsche_930_turbo` |
| Nissan Skyline GT-R (R34) | [Nissan Skyline R34 GT-R](https://sketchfab.com/3d-models/ff8fb2251dfa4bb9979e7022c5a6666c) | Lexyc16 | `nissan_skyline_r34` |
| Toyota Supra Turbo (A80) | [Toyota Supra MK IV (1994)](https://sketchfab.com/3d-models/eb9bb1eb41db431cb078088ae1ce45f8) | TinoD2 | `toyota_supra_mk4` |
| Honda NSX (NA1) | [Honda NSX 1990](https://sketchfab.com/3d-models/1cc15628a00a4739a6b6c01128927c8d) | Lexyc16 | `honda_nsx_na1` |
| BMW M4 Coupé (F82) | [BMW M4 F82 Razor 2014](https://sketchfab.com/3d-models/25d00f20b8cf4828bd934acb31e0aae4) | heynic (www.vecarz.com) | `bmw_m4_f82` |
| Nissan GT-R (R35) | [Nissan Skyline GTR r35](https://sketchfab.com/3d-models/7b142ea3376e4811a326256c59bbc7a2) | BlackSnow02 | `nissan_gtr_r35` |
| Chevrolet Corvette Stingray (C8) | [2019 Chevrolet Corvette C8 Stingray](https://sketchfab.com/3d-models/790c40ccff6843eab0b7b4bd18421ff8) | Haris3D | `chevrolet_corvette_c8` |
| Porsche 911 GT3 | [Porsche 911 GT3](https://sketchfab.com/3d-models/78d5c47ab2554c2592b7e499179a0792) | ChevroletSS | `porsche_911_gt3` |
| Audi R8 V10 performance quattro | [2021 Audi R8 V10 Performance Quattro (Type 4S)](https://sketchfab.com/3d-models/8dd1c237238244d1a2a49d764d321b87) | supercarmodels | `audi_r8_v10` |
| Ferrari F40 | [Ferrari f40](https://sketchfab.com/3d-models/52a66c41cfcd4f999fb1b1c49bf24d70) | BlackSnow02 | `ferrari_f40` |
| McLaren Senna | [McLaren Senna Free](https://sketchfab.com/3d-models/ea3e43a6eb004853a87fe9c58422eb96) | BlackSnow02 | `mclaren_senna` |
| Lamborghini Centenario LP 770-4 | [Lamborghini Centenario LP-770 Interior SDC](https://sketchfab.com/3d-models/d679af35b5694301a185c7454a700c73) | Lambo_SC04 | `lamborghini_centenario` |
| Lamborghini Huracán Twin Turbo | [Lamborghini Huracan Twin Turbo [LOST]](https://sketchfab.com/3d-models/1d3809ea5a6749d9864ec4c32511d716) | BlackSnow02 | `lamborghini_huracan_tt` |
