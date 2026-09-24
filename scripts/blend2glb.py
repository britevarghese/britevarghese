"""Convert a .blend file to an optimized-ready .glb (run with Blender, headless):

    blender -b path/to/asset.blend --python scripts/blend2glb.py -- out/asset.glb

Keeps geometry, materials (Principled BSDF -> glTF PBR), textures, real-world scale and +Y-up orientation.
Afterwards run the file through the same optimizer as the built-in assets, e.g. add it to MODELS in
scripts/build-assets.mjs, or drop it into client/assets/user/... to use it as-is.
Note: grass_medium_01 and tree_small_02 are Poly Haven assets; `npm run assets` already downloads their
official glTF exports, so Blender is only needed for your own custom .blend files.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else bpy.data.filepath.replace(".blend", ".glb")

# apply modifiers / make sure everything exportable is visible
for ob in bpy.context.scene.objects:
    ob.hide_set(False)
    ob.hide_viewport = False

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_texcoords=True,
    export_normals=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
    export_skins=True,
    export_animations=True,
)
print(f"exported {out}")
