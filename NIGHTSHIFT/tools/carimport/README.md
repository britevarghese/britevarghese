# Real-car model import

NIGHTSHIFT's licensed real cars (BMW, Subaru, Mazda, Porsche, Nissan, Toyota, Honda, Chevrolet, Audi,
Ferrari, McLaren, Lamborghini) are defined in `src/vehicles/VehicleCatalog.js` with real-world specs and a
**CC BY 4.0** source model on Sketchfab. Until a car's model is imported, the game shows a stand-in (one of
the original NIGHTSHIFT cars stretched to the real car's dimensions) and the garage says so.

## Import the models

1. Create a free Sketchfab account and copy your API token from <https://sketchfab.com/settings/password>.
2. From the `NIGHTSHIFT` folder:

   ```bash
   npm install                                   # once: glTF-Transform, meshoptimizer, sharp...
   SKETCHFAB_API_TOKEN=your_token node tools/import-cars.mjs
   ```

   Windows (cmd): `set SKETCHFAB_API_TOKEN=your_token` then `node tools\import-cars.mjs`.

Useful options:

| Option | Meaning |
|---|---|
| `--only bmw_m3_e30,audi_r8_v10` | just these cars |
| `--force` | re-import cars that are already imported |
| `--src bmw_m3_e30=C:\Downloads\bmw.glb` | use a model you downloaded yourself (`.glb`, `.gltf` or the Sketchfab `.zip`) |
| `--max-texture 1024` | smaller textures (default 2048) |
| `--out DIR --no-manifest` | dry run into another folder |

Downloads are cached in `.cache/cars/<id>/`; a per-car log is written to `.cache/cars/report.json`.

## What the converter does (`tools/carimport/process.mjs`)

- bakes every mesh into world space, drops animations/cameras/floors/studio props
- orients the car (+Z forward, +X left, Y up), scales it to the real length, puts the tyres on y = 0
- finds the four wheels (round, ground-touching tyre components, then everything inside each tyre) and
  splits them into hub-centred `wheel_FL/FR/RL/RR` groups (`spin` + static `fixed` calipers) so they rotate
  and steer; works even when the wheels are merged into the body mesh
- classifies materials: body `paint` (recolourable, "factory" keeps the original), `glass` (transmission
  converted to cheap alpha glass so the interior shows), `headlight`/`taillight` (emissive), `caliper`
- merges geometry per material (few draw calls), simplifies to ~120k triangles (LOD0) and ~15k (LOD1, no
  interior) with meshoptimizer, re-encodes textures as WebP, compresses geometry (EXT_meshopt_compression)
- adds markers for lights, exhausts (nitro flames) and the bumper / hood / cockpit cameras

If a model comes out backwards or on its side, add `import: { flip: true }` or `import: { up: 'z' }` to the
car in `VehicleCatalog.js` (the log says which heuristics it used). Check the result in the garage.

## Licensing

The models are CC BY 4.0: attribution is shown in the garage and written to
`public/assets/models/cars/CREDITS.md`. Car names, shapes and badges are trademarks of their manufacturers;
this is fine for a private, non-commercial project, but distributing or selling the game with them would
need permission from the manufacturers.
