"""Render native-resolution configurable material layers for Italian Flat.

The official room remains available to Cycles for light, reflections and
shadows, but only the selected configurable object is visible to camera rays.
Every output is a panorama-aligned, transparent RGBA PNG.

Usage:
  blender -b flat-archiviz.blend \
    --python assets-pipeline/scripts/render_italian_flat_material_layers.py -- \
    --output-root apps/demo/public/tours/italian-flat/layers \
    --width 4096 --samples 64
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

TARGETS: dict[str, tuple[str, ...]] = {
    "sofa": ("Sofa", "Pillows"),
    "rug": ("Chocofur_Rug_12",),
    "chair": ("Poliform_JANE_armchair_large",),
}

VARIANTS: dict[str, tuple[str, ...]] = {
    "sofa": ("terracotta", "ivory-boucle", "forest-velvet"),
    "rug": ("sand-wool", "sage-weave", "charcoal-geometric"),
    "chair": ("moss-velvet", "cognac-leather"),
}

TREE_PREFIX = "Mantissa_Japanese_Maple_001"

# Normalized equirectangular bounds. The low-resolution `--no-border` mode is
# useful when adding another target: measure its alpha bounds once, add a safe
# margin here, then all finish variants reuse the same bounds.
RENDER_BORDERS: dict[tuple[str, str], tuple[float, float, float, float]] = {
    ("sofa", "living"): (0.27, 0.51, 0.00, 0.46),
    ("sofa", "lounge"): (0.00, 0.26, 0.00, 0.55),
    ("rug", "living"): (0.28, 0.68, 0.09, 0.39),
    # The lounge view crosses the panorama seam, so retain the full width but
    # restrict Cycles to the rug's narrow vertical band.
    ("rug", "lounge"): (0.00, 1.00, 0.03, 0.38),
    ("chair", "living"): (0.51, 0.68, 0.15, 0.37),
    ("chair", "lounge"): (0.90, 1.00, 0.25, 0.44),
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--target", action="append", dest="targets")
    parser.add_argument("--variant", action="append", dest="variants")
    parser.add_argument("--node", action="append", dest="nodes")
    parser.add_argument("--suffix", default="_4k")
    parser.add_argument("--no-border", action="store_true")
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

    looks = {item.name for item in scene.view_settings.bl_rna.properties["look"].enum_items}
    if "Medium High Contrast" in looks:
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
    data = bpy.data.cameras.get("MeshTour_Material_Layer")
    if data is None:
        data = bpy.data.cameras.new("MeshTour_Material_Layer")
    data.type = "PANO"
    data.panorama_type = "EQUIRECTANGULAR"
    camera = bpy.data.objects.get("MeshTour_Material_Layer")
    if camera is None:
        camera = bpy.data.objects.new("MeshTour_Material_Layer", data)
        bpy.context.scene.collection.objects.link(camera)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.camera = camera
    return camera


def target_objects(target: str) -> list[bpy.types.Object]:
    patterns = TARGETS[target]
    objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and object_matches(obj.name, patterns)
    ]
    if not objects:
        raise RuntimeError(f'Italian Flat target "{target}" was not found')
    return objects


def configure_camera_visibility(target: str) -> list[str]:
    selected = set(target_objects(target))
    for obj in bpy.context.scene.objects:
        if hasattr(obj, "visible_camera"):
            obj.visible_camera = obj in selected
        if obj in selected:
            obj.hide_render = False
    return sorted(obj.name for obj in selected)


def principled(material: bpy.types.Material) -> bpy.types.Node:
    if material.node_tree is None:
        raise RuntimeError(f'Material "{material.name}" has no node tree')
    node = material.node_tree.nodes.get("Principled BSDF")
    if node is None:
        node = next(
            (entry for entry in material.node_tree.nodes if entry.bl_idname == "ShaderNodeBsdfPrincipled"),
            None,
        )
    if node is None:
        raise RuntimeError(f'Material "{material.name}" has no Principled BSDF')
    return node


def tinted_copy(
    source_name: str,
    variant_name: str,
    tint: tuple[float, float, float, float],
    roughness: float | None = None,
) -> bpy.types.Material:
    source = bpy.data.materials.get(source_name)
    if source is None or source.node_tree is None:
        raise RuntimeError(f'Material "{source_name}" was not found')
    material = source.copy()
    material.name = f"MeshTour_{variant_name}_{source_name}"
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = principled(material)
    base = shader.inputs.get("Base Color")
    if base is None:
        raise RuntimeError(f'Material "{source_name}" has no Base Color input')

    source_socket = base.links[0].from_socket if base.links else None
    source_color = tuple(base.default_value)
    for link in list(base.links):
        links.remove(link)
    tint_node = nodes.new("ShaderNodeMixRGB")
    tint_node.name = f"MeshTour {variant_name} Tint"
    tint_node.blend_type = "MULTIPLY"
    tint_node.inputs[0].default_value = 1.0
    tint_node.inputs[2].default_value = tint
    if source_socket is not None:
        links.new(source_socket, tint_node.inputs[1])
    else:
        tint_node.inputs[1].default_value = source_color
    links.new(tint_node.outputs[0], base)

    roughness_input = shader.inputs.get("Roughness")
    if roughness is not None and roughness_input is not None and not roughness_input.links:
        roughness_input.default_value = roughness
    return material


def add_geometric_pattern(material: bpy.types.Material) -> None:
    assert material.node_tree is not None
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = principled(material)
    base = shader.inputs["Base Color"]
    source_socket = base.links[0].from_socket
    links.remove(base.links[0])

    coordinates = nodes.new("ShaderNodeTexCoord")
    voronoi = nodes.new("ShaderNodeTexVoronoi")
    voronoi.feature = "DISTANCE_TO_EDGE"
    voronoi.distance = "EUCLIDEAN"
    voronoi.inputs["Scale"].default_value = 18.0
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.025
    ramp.color_ramp.elements[0].color = (0.18, 0.2, 0.22, 1.0)
    ramp.color_ramp.elements[1].position = 0.08
    ramp.color_ramp.elements[1].color = (0.72, 0.74, 0.76, 1.0)
    mix = nodes.new("ShaderNodeMixRGB")
    mix.name = "MeshTour Geometric Weave"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.62
    links.new(coordinates.outputs["Generated"], voronoi.inputs["Vector"])
    links.new(voronoi.outputs["Distance"], ramp.inputs["Fac"])
    links.new(source_socket, mix.inputs[1])
    links.new(ramp.outputs["Color"], mix.inputs[2])
    links.new(mix.outputs[0], base)


def restore_materials(
    originals: dict[bpy.types.Object, list[bpy.types.Material | None]],
) -> None:
    for obj, materials in originals.items():
        for slot, material in zip(obj.material_slots, materials, strict=False):
            slot.material = material


def apply_sofa(variant: str) -> None:
    specs = {
        "terracotta": ((1.25, 0.42, 0.20, 1.0), 0.75),
        "ivory-boucle": ((1.35, 1.16, 0.92, 1.0), 0.88),
        "forest-velvet": ((0.22, 0.72, 0.34, 1.0), 0.68),
    }
    material = tinted_copy("Fabric_Sofa", variant, *specs[variant])
    for obj in target_objects("sofa"):
        if not (obj.name == "Sofa" or obj.name.startswith("Sofa.")):
            continue
        for slot in obj.material_slots:
            if slot.material is not None and slot.material.name in {"Fabric_Sofa", "Fabric"}:
                slot.material = material


def apply_rug(variant: str) -> None:
    specs = {
        "sand-wool": ((1.38, 1.08, 0.72, 1.0), 0.9),
        "sage-weave": ((0.58, 0.88, 0.55, 1.0), 0.88),
        "charcoal-geometric": ((0.48, 0.5, 0.54, 1.0), 0.86),
    }
    material = tinted_copy("Carpet Grey", variant, *specs[variant])
    if variant == "charcoal-geometric":
        add_geometric_pattern(material)
    for obj in target_objects("rug"):
        for slot in obj.material_slots:
            slot.material = material


def apply_chair(variant: str) -> None:
    objects = target_objects("chair")
    if variant == "moss-velvet":
        replacements = {
            "Velvet": tinted_copy("Velvet", variant, (0.3, 0.78, 0.36, 1.0), 0.62),
            "Wood": tinted_copy("Wood", variant, (0.48, 0.25, 0.11, 1.0), 0.5),
            "Red Leather": tinted_copy("Red Leather", variant, (0.55, 0.25, 0.12, 1.0), 0.42),
        }
    else:
        leather = tinted_copy("Red Leather", variant, (1.2, 0.54, 0.2, 1.0), 0.38)
        replacements = {
            "Velvet": leather,
            "Wood": tinted_copy("Wood", variant, (0.32, 0.17, 0.09, 1.0), 0.48),
            "Red Leather": leather,
        }
    for obj in objects:
        for slot in obj.material_slots:
            if slot.material is not None and slot.material.name in replacements:
                slot.material = replacements[slot.material.name]


def apply_variant(target: str, variant: str) -> None:
    if target == "sofa":
        apply_sofa(variant)
    elif target == "rug":
        apply_rug(variant)
    else:
        apply_chair(variant)


def main() -> None:
    args = parse_args()
    output_root = Path(args.output_root).resolve()
    selected_targets = args.targets or list(TARGETS)
    selected_nodes = args.nodes or list(NODES)
    unknown_targets = set(selected_targets) - set(TARGETS)
    unknown_nodes = set(selected_nodes) - set(NODES)
    if unknown_targets:
        raise ValueError(f"Unknown targets: {', '.join(sorted(unknown_targets))}")
    if unknown_nodes:
        raise ValueError(f"Unknown nodes: {', '.join(sorted(unknown_nodes))}")

    remove_expensive_exterior_trees()
    backend = configure_render(args.width, args.samples)
    camera = ensure_panorama_camera()
    configurable_objects = {
        obj for target in TARGETS for obj in target_objects(target)
    }
    original_materials = {
        obj: [slot.material for slot in obj.material_slots] for obj in configurable_objects
    }
    print(f"MESHTOUR_RENDER_BACKEND={backend}")

    for target in selected_targets:
        variants = [
            variant
            for variant in VARIANTS[target]
            if args.variants is None or variant in args.variants
        ]
        for variant in variants:
            restore_materials(original_materials)
            apply_variant(target, variant)
            visible = configure_camera_visibility(target)
            print(f"MESHTOUR_LAYER_OBJECTS={target}:{','.join(visible)}")
            destination = output_root / target / variant
            destination.mkdir(parents=True, exist_ok=True)
            for node_id in selected_nodes:
                camera.location = NODES[node_id]
                border = RENDER_BORDERS.get((target, node_id))
                bpy.context.scene.render.use_border = border is not None and not args.no_border
                if bpy.context.scene.render.use_border:
                    min_x, max_x, min_y, max_y = border
                    bpy.context.scene.render.border_min_x = min_x
                    bpy.context.scene.render.border_max_x = max_x
                    bpy.context.scene.render.border_min_y = min_y
                    bpy.context.scene.render.border_max_y = max_y
                bpy.context.scene.render.filepath = str(
                    destination / f"{node_id}{args.suffix}.png"
                )
                print(
                    f"MESHTOUR_LAYER_RENDER={target}:{variant}:{node_id}:"
                    f"{args.width}x{args.width // 2}"
                )
                bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
