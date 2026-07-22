"""Render production-quality transparent sofa panorama layers.

The input must be Blender's official Italian Flat demo source. The room remains
available to Cycles for lighting, shadows, and reflections, but only the sofa
group is visible to camera rays. The output images align exactly with the
Italian Flat Living and Lounge panoramas used by MeshTour.

Usage:
  blender -b flat-archiviz.blend \
    --python assets-pipeline/scripts/render_italian_flat_sofa_layers.py -- \
    --output-dir apps/demo/public/tours/italian-flat/layers/sofa/terracotta \
    --width 4096 --samples 256
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy


NODES = {
    "living": (3.40, 5.35, 1.62),
    "lounge": (3.35, 8.75, 1.62),
}

TREE_PREFIX = "Mantissa_Japanese_Maple_001"
SOFA_NAMES = ("Sofa", "Pillows")

# Normalized equirectangular render borders. Cycles only traces the pixels that
# can contain the sofa while Blender still writes a full-size transparent PNG.
# Coordinates use Blender's bottom-left render origin.
RENDER_BORDERS = {
    "living": (0.27, 0.51, 0.00, 0.46),
    "lounge": (0.00, 0.26, 0.00, 0.55),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--node", action="append", dest="nodes")
    return parser.parse_args(argv)


def object_matches(name: str, patterns: tuple[str, ...]) -> bool:
    return any(name == pattern or name.startswith(f"{pattern}.") for pattern in patterns)


def remove_expensive_exterior_trees() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(TREE_PREFIX):
            bpy.data.objects.remove(obj, do_unlink=True)


def configure_render(width: int, samples: int) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = width
    scene.render.resolution_y = width // 2
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 35
    scene.render.film_transparent = True
    scene.render.use_border = True
    scene.render.use_crop_to_border = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False
    scene.use_nodes = False
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.005
    scene.cycles.preview_samples = min(samples, 32)
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 8

    available_looks = {
        item.name for item in scene.view_settings.bl_rna.properties["look"].enum_items
    }
    if "Medium High Contrast" in available_looks:
        scene.view_settings.look = "Medium High Contrast"

    backend = "CPU"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        enabled = 0
        for device in preferences.devices:
            device.use = device.type in {"METAL", "GPU"}
            enabled += int(device.use)
        if enabled:
            scene.cycles.device = "GPU"
            backend = "METAL"
    except (KeyError, TypeError, RuntimeError) as error:
        print(f"MESHTOUR_NOTICE=Metal unavailable, using CPU ({error})")
    return backend


def ensure_panorama_camera() -> bpy.types.Object:
    camera_data = bpy.data.cameras.get("MeshTour_Sofa_Layer")
    if camera_data is None:
        camera_data = bpy.data.cameras.new("MeshTour_Sofa_Layer")
    camera_data.type = "PANO"
    camera_data.panorama_type = "EQUIRECTANGULAR"

    camera = bpy.data.objects.get("MeshTour_Sofa_Layer")
    if camera is None:
        camera = bpy.data.objects.new("MeshTour_Sofa_Layer", camera_data)
        bpy.context.scene.collection.objects.link(camera)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.camera = camera
    return camera


def configure_camera_visibility() -> list[str]:
    visible_names: list[str] = []
    for obj in bpy.context.scene.objects:
        is_sofa = obj.type == "MESH" and object_matches(obj.name, SOFA_NAMES)
        if hasattr(obj, "visible_camera"):
            obj.visible_camera = is_sofa
        if is_sofa:
            obj.hide_render = False
            visible_names.append(obj.name)
    if not any(name == "Sofa" or name.startswith("Sofa.") for name in visible_names):
        raise RuntimeError("Italian Flat sofa objects were not found")
    return visible_names


def make_terracotta_fabric() -> None:
    material = bpy.data.materials.get("Fabric_Sofa")
    if material is None or material.node_tree is None:
        raise RuntimeError('Material "Fabric_Sofa" was not found')
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    source = nodes.get("RGB Curves")
    if principled is None or source is None:
        raise RuntimeError("Unexpected Fabric_Sofa shader graph")

    base_color = principled.inputs.get("Base Color")
    source_color = source.outputs.get("Color")
    if base_color is None or source_color is None:
        raise RuntimeError("Unexpected Fabric_Sofa color sockets")
    for link in list(base_color.links):
        links.remove(link)

    tint = nodes.new("ShaderNodeMixRGB")
    tint.name = "MeshTour Terracotta Tint"
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 1.0
    # Linear scene-referred tint; values above 1 preserve the original fabric's
    # highlights while shifting its neutral albedo toward warm terracotta.
    tint.inputs[2].default_value = (1.25, 0.42, 0.20, 1.0)
    links.new(source_color, tint.inputs[1])
    links.new(tint.outputs[0], base_color)

    # One sofa segment uses a secondary generic `Fabric` slot. Point that slot
    # at the same upholstery shader so the configurable shell is one finish;
    # decorative pillow slots remain untouched.
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not (obj.name == "Sofa" or obj.name.startswith("Sofa.")):
            continue
        for slot in obj.material_slots:
            if slot.material is not None and slot.material.name == "Fabric":
                slot.material = material


def main() -> None:
    args = parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    selected = set(args.nodes) if args.nodes else set(NODES)
    unknown = selected - set(NODES)
    if unknown:
        raise ValueError(f"Unknown nodes: {', '.join(sorted(unknown))}")

    remove_expensive_exterior_trees()
    backend = configure_render(args.width, args.samples)
    visible = configure_camera_visibility()
    make_terracotta_fabric()
    camera = ensure_panorama_camera()

    print(f"MESHTOUR_RENDER_BACKEND={backend}")
    print(f"MESHTOUR_LAYER_OBJECTS={','.join(sorted(visible))}")
    for node_id, location in NODES.items():
        if node_id not in selected:
            continue
        camera.location = location
        min_x, max_x, min_y, max_y = RENDER_BORDERS[node_id]
        bpy.context.scene.render.border_min_x = min_x
        bpy.context.scene.render.border_max_x = max_x
        bpy.context.scene.render.border_min_y = min_y
        bpy.context.scene.render.border_max_y = max_y
        bpy.context.scene.render.filepath = str(output / f"{node_id}_4k.png")
        print(f"MESHTOUR_LAYER_RENDER={node_id}:{args.width}x{args.width // 2}")
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
