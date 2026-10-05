import bpy
import os
import sys

argv = sys.argv
argv = argv[argv.index("--") + 1:] if "--" in argv else []
if len(argv) != 2:
    raise SystemExit("usage: convert_fbx.py input.fbx output.glb")

src, dst = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=src, use_anim=True, automatic_bone_orientation=False)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_yup=True
)
if not os.path.exists(dst) or os.path.getsize(dst) < 20:
    raise RuntimeError("GLB export failed")
