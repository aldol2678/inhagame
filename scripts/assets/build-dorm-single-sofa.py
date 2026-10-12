#!/usr/bin/env python3
"""Build and verify INHA WORLD's original low-poly single-seat sofa.

Run from the repository root with Blender 4.3.2:
  blender --background --python-exit-code 1 --python scripts/assets/build-dorm-single-sofa.py

Only the GLB is a runtime dependency. Blender is an offline authoring tool.
The source .blend and render proofs are reproducible build outputs; no reference
mesh, downloaded geometry, texture, external font, or decoder is required.
"""

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

import bmesh
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, default=ROOT / "apps/world/assets/furniture/dorm-single-sofa-v1.glb")
parser.add_argument("--source-dir", type=Path, default=ROOT / "scratch/sofa-asset-source")
parser.add_argument("--evidence-dir", type=Path, default=ROOT / "docs/evidence/sofa-glb-pilot")
parser.add_argument("--skip-renders", action="store_true")
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
for folder in (args.output.parent, args.source_dir, args.evidence_dir):
    folder.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
scene.unit_settings.scale_length = 1


def linear_channel(value):
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def material(name, color, roughness):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    result.use_backface_culling = True
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = tuple(linear_channel(value) for value in rgb) + (1,)
    result.diffuse_color = linear
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = linear
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = 0
    return result


fabric = material("Sofa / muted blue fabric", "#648299", 0.91)
linen = material("Sofa / soft blue linen", "#91A8B7", 0.94)
oak = material("Sofa / natural oak", "#AF8053", 0.72)
parts = []
part_specs = []


def rounded_box(name, at, size, mat, radius, segments=3, lean=0):
    """at and size use PlayCanvas X-right / Y-up / Z-backward coordinates."""
    x, y, z = at
    width, height, depth = size
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, -z, y))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("Soft upholstered corners", "BEVEL")
    bevel.width = radius
    bevel.segments = segments
    bevel.affect = "EDGES"
    bevel.profile = 0.5
    bevel.use_clamp_overlap = True
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for face in obj.data.polygons:
        face.use_smooth = True
    weighted = obj.modifiers.new("Broad planes with soft corner normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    weighted.weight = 30
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    obj.rotation_euler.x = math.radians(lean)
    obj.data.materials.append(mat)
    obj.vertex_groups.new(name=name).add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    parts.append(obj)
    part_specs.append({"name": name, "centerPlayCanvas": at, "unrotatedSize": size,
                       "bevelRadius": radius, "bevelSegments": segments, "backLeanDegrees": lean})
    return obj


# A low, floating upholstered deck keeps the pre-existing seat top at Y=.36.
rounded_box("01 upholstered lower deck", (0, .204, -.012), (.98, .108, .69), fabric, .030)
# Broad arms define the exact 1.10 m width and the frontmost Z=-.39 limit.
for side in (-1, 1):
    rounded_box("02 arm left" if side < 0 else "03 arm right",
                (side * .4725, .375, -.020), (.155, .330, .740), fabric, .057, segments=3)
# Rear shell defines the exact Y=.72 top and Z=+.39 back of the envelope.
rounded_box("04 upholstered rear shell", (0, .479, .301), (1.02, .482, .178), fabric, .056, segments=3)
rounded_box("05 separate seat cushion", (0, .303, -.071), (.800, .114, .566), linen, .037, segments=4)
# The seat remains centered at X=0 and its flat top is unchanged at Y=.36.
# Back lean gives an inviting profile without changing seat anchors or bounds.
rounded_box("06 separate back cushion", (0, .528, .187), (.800, .328, .125), linen, .044, segments=4, lean=8)


def tapered_leg(name, x, z):
    # Square oak legs with softened corners, slightly splayed out at the floor.
    # Use a custom taper rather than a dense cylinder to preserve silhouette.
    bottom = (x * 1.035, -z * 1.055, 0)
    top = (x, -z, .171)
    vertices = []
    for center, width in ((bottom, .047), (top, .066)):
        cx, cy, height = center
        vertices.extend((cx + sx * width / 2, cy + sy * width / 2, height)
                        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)))
    faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bevel = obj.modifiers.new("Subtle oak edge rounding", "BEVEL")
    bevel.width = .006
    bevel.segments = 2
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for face in mesh.polygons:
        face.use_smooth = True
    weighted = obj.modifiers.new("Oak corner normals", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=weighted.name)
    obj.data.materials.append(oak)
    obj.vertex_groups.new(name=name).add(list(range(len(obj.data.vertices))), 1, "REPLACE")
    parts.append(obj)


for xi, x in enumerate((-.385, .385)):
    for zi, z in enumerate((-.265, .255)):
        tapered_leg(f"07 oak leg {xi + 1}-{zi + 1}", x, z)

# One export mesh with three material primitives means only three draw calls.
bpy.ops.object.select_all(action="DESELECT")
for obj in parts:
    obj.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
sofa = bpy.context.object
sofa.name = "dorm_single_sofa_v1"
sofa.data.name = "dorm_single_sofa_v1_mesh"
scene.cursor.location = (0, 0, 0)
bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
sofa["assetVersion"] = 1
sofa["units"] = "meters"
sofa["frontAxis"] = "-Z (glTF / PlayCanvas)"
sofa["origin"] = "floor-center"
sofa["seatTopY"] = .36
sofa["placementBounds"] = [1.10, .72, .78]
sofa["license"] = "Original project-authored geometry; see repository LICENSE"
triangulate = sofa.modifiers.new("Stable game-ready triangulation", "TRIANGULATE")
triangulate.keep_custom_normals = True
bpy.ops.object.modifier_apply(modifier=triangulate.name)
# No UVs, textures, bones, animation, light, camera, or decoder in the asset.
while sofa.data.uv_layers:
    sofa.data.uv_layers.remove(sofa.data.uv_layers[0])
bpy.ops.wm.save_as_mainfile(filepath=str(args.source_dir / "dorm-single-sofa-v1.blend"), compress=True)
bpy.ops.export_scene.gltf(
    filepath=str(args.output), export_format="GLB", use_selection=True,
    export_yup=True, export_normals=True, export_texcoords=False,
    export_tangents=False, export_materials="EXPORT", export_extras=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_skins=False, export_morph=False, export_draco_mesh_compression_enable=False,
)


def glb_document(path):
    blob = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", blob)
    assert magic == 0x46546C67 and version == 2 and length == len(blob)
    json_length, chunk_type = struct.unpack_from("<II", blob, 12)
    assert chunk_type == 0x4E4F534A
    doc = json.loads(blob[20:20 + json_length])
    bin_offset = 20 + json_length
    bin_length, bin_type = struct.unpack_from("<II", blob, bin_offset)
    assert bin_type == 0x004E4942
    return blob, doc, blob[bin_offset + 8:bin_offset + 8 + bin_length]


blob, gltf, binary = glb_document(args.output)
primitives = [p for mesh in gltf["meshes"] for p in mesh["primitives"]]
accessors = gltf["accessors"]
triangles = sum(accessors[p["indices"]]["count"] // 3 for p in primitives)
vertices = sum(accessors[p["attributes"]["POSITION"]]["count"] for p in primitives)
minimum = [min(accessors[p["attributes"]["POSITION"]]["min"][i] for p in primitives) for i in range(3)]
maximum = [max(accessors[p["attributes"]["POSITION"]]["max"][i] for p in primitives) for i in range(3)]
size = [maximum[i] - minimum[i] for i in range(3)]
def accessor_values(index):
    accessor = accessors[index]
    view = gltf["bufferViews"][accessor["bufferView"]]
    component = {5126: "f", 5125: "I", 5123: "H", 5121: "B"}[accessor["componentType"]]
    count = {"SCALAR": 1, "VEC3": 3}[accessor["type"]]
    fmt = "<" + component * count
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    stride = view.get("byteStride", struct.calcsize(fmt))
    return [struct.unpack_from(fmt, binary, offset + row * stride) for row in range(accessor["count"])]


normal_lengths, winding_alignment = [], []
for primitive in primitives:
    positions = [Vector(value) for value in accessor_values(primitive["attributes"]["POSITION"])]
    normals = [Vector(value) for value in accessor_values(primitive["attributes"]["NORMAL"])]
    indices = [value[0] for value in accessor_values(primitive["indices"])]
    for normal in normals:
        normal_lengths.append(math.sqrt(sum(value * value for value in normal)))
    for start in range(0, len(indices), 3):
        a, b, c = indices[start:start + 3]
        face_normal = (positions[b] - positions[a]).cross(positions[c] - positions[a]).normalized()
        winding_alignment.extend(face_normal.dot(normals[index]) for index in (a, b, c))

assert triangles <= 2000, triangles
assert len(gltf["materials"]) <= 3
assert all(not mat.get("doubleSided", False) for mat in gltf["materials"])
assert len(blob) <= 150_000, len(blob)
assert len(primitives) == 3
assert not gltf.get("textures") and not gltf.get("images")
assert not gltf.get("extensionsRequired")
assert not gltf.get("animations") and not gltf.get("skins")
assert all(abs(actual - expected) < 1e-5 for actual, expected in zip(size, [1.10, .72, .78])), size
assert all(abs(actual - expected) < 1e-5 for actual, expected in zip(minimum, [-.55, 0, -.39]))
assert all(abs(value - 1) < 1e-5 for value in normal_lengths)
assert min(winding_alignment) > 0, min(winding_alignment)
assert all("matrix" not in node and "translation" not in node and "rotation" not in node and "scale" not in node for node in gltf["nodes"])

# Round-trip through Blender's independent importer before producing evidence.
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(args.output), merge_vertices=True)
imported = [obj for obj in scene.objects if obj.type == "MESH"]
assert len(imported) == 1
reimport = imported[0]
world_points = [reimport.matrix_world @ vertex.co for vertex in reimport.data.vertices]
pc_points = [(point.x, point.z, -point.y) for point in world_points]
roundtrip_min = [min(point[i] for point in pc_points) for i in range(3)]
roundtrip_max = [max(point[i] for point in pc_points) for i in range(3)]
assert all(abs(roundtrip_min[i] - minimum[i]) < 1e-5 for i in range(3))
assert all(abs(roundtrip_max[i] - maximum[i]) < 1e-5 for i in range(3))
bm = bmesh.new()
bm.from_mesh(reimport.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
bm.normal_update()
degenerate = sum(face.calc_area() < 1e-10 for face in bm.faces)
nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
signed_volume = bm.calc_volume(signed=True)
assert degenerate == 0 and nonmanifold == 0 and signed_volume > 0
remaining_faces = set(bm.faces)
components = []
while remaining_faces:
    pending = [remaining_faces.pop()]
    component = []
    while pending:
        face = pending.pop()
        component.append(face)
        for edge in face.edges:
            for neighbor in edge.link_faces:
                if neighbor in remaining_faces:
                    remaining_faces.remove(neighbor)
                    pending.append(neighbor)
    points = [vertex.co for face in component for vertex in face.verts]
    signed = sum(face.verts[0].co.dot(face.verts[1].co.cross(face.verts[2].co)) / 6
                 for face in component)
    assert signed > 0, signed
    components.append({"triangles": len(component), "signedVolume": signed,
                       "minY": min(point.z for point in points), "maxY": max(point.z for point in points)})
assert len(components) == 10
seat_components = [part for part in components if abs(part["maxY"] - .36) < 1e-5]
assert len(seat_components) == 1
bm.free()
validation = {
    "asset": "apps/world/assets/furniture/dorm-single-sofa-v1.glb",
    "generator": f"Blender {bpy.app.version_string}",
    "sourceScript": "scripts/assets/build-dorm-single-sofa.py",
    "sha256": hashlib.sha256(blob).hexdigest(),
    "bytes": len(blob), "budgetBytes": 150_000,
    "triangles": triangles, "budgetTriangles": 2000,
    "exportedVertices": vertices, "materials": len(gltf["materials"]),
    "meshes": len(gltf["meshes"]), "drawPrimitives": len(primitives),
    "textures": 0, "animations": 0, "doubleSidedMaterials": 0,
    "compression": "none; no decoder required",
    "coordinateSystem": "glTF / PlayCanvas right-handed, Y up, front -Z; meters",
    "bounds": {"min": minimum, "max": maximum, "size": size},
    "origin": [0, 0, 0], "originDescription": "Floor center, identity node transform",
    "seatTopY": .36, "seatAnchorBehavior": "Unchanged by visual-only replacement",
    "roundTrip": {"importer": f"Blender {bpy.app.version_string} glTF importer", "boundsMin": roundtrip_min,
                  "boundsMax": roundtrip_max, "degenerateTriangles": degenerate,
                  "nonManifoldEdgesAfterPositionWeld": nonmanifold, "signedVolume": signed_volume,
                  "normalLengthMin": min(normal_lengths), "normalLengthMax": max(normal_lengths),
                  "minimumVertexNormalFaceNormalDot": min(winding_alignment),
                  "watertightOutwardComponents": len(components),
                  "verifiedSeatCushionTopY": seat_components[0]["maxY"]},
    "materialsDetails": [{"name": mat["name"], **mat.get("pbrMetallicRoughness", {})} for mat in gltf["materials"]],
    "partDefinitions": part_specs,
    "originalWork": "Procedurally modeled for this project from primitives. No downloaded or private-brand model inputs.",
    "checksPassed": True,
}
(args.evidence_dir / "asset-validation.json").write_text(json.dumps(validation, indent=2) + "\n")
(args.evidence_dir / "asset-sha256.txt").write_text(validation["sha256"] + "  " + args.output.name + "\n")


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


if not args.skip_renders:
    # The render uses the actual exported-and-reimported GLB, not a concept model.
    ground = material("Render stage only", "#EEE9E0", .9)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -.003))
    bpy.context.object.name = "RENDER ONLY ground"
    bpy.context.object.data.materials.append(ground)
    world = bpy.data.worlds.new("Warm studio")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (.72, .78, .87, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = .65
    for name, location, power, light_size in (
        ("Key", (-2, 3, 4), 450, 4),
        ("Fill", (3, 1, 2), 140, 3),
        ("Rim", (0, -2, 3), 230, 2.5),
    ):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy, data.shape, data.size = power, "DISK", light_size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = location
        point_at(light, (0, 0, .35))
    camera_data = bpy.data.cameras.new("Asset verification camera")
    camera = bpy.data.objects.new("Asset verification camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 1.63
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 96
    # Some distro Blender builds omit OpenImageDenoise. This stays portable.
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    for label, location, target in (
        ("front-three-quarter", (1.7, 2.8, 1.75), (0, 0, .31)),
        ("front", (0, 3, .65), (0, 0, .35)),
        ("rear-three-quarter", (-1.8, -2.7, 1.45), (0, 0, .32)),
    ):
        camera.location = location
        point_at(camera, target)
        scene.render.filepath = str(args.evidence_dir / f"blender-{label}.png")
        bpy.ops.render.render(write_still=True)

print("SOFA_ASSET_VALIDATION " + json.dumps({key: validation[key] for key in (
    "bytes", "triangles", "exportedVertices", "materials", "drawPrimitives", "bounds", "sha256", "checksPassed")}))
