"""Render Italian Flat v4 floor and cabinetry upgrade layers.

This script consumes the project-owned texture sources under the v4 material
folder and renders panorama-aligned RGBA layers from the licensed Italian Flat
scene. Existing room objects continue to contribute lighting and reflections.

Usage:
  blender -b flat-archiviz.blend --python render_italian_flat_property_layers.py -- \
    --output-root apps/demo/public/tours/italian-flat-v4/layers \
    --texture-root apps/demo/public/tours/italian-flat-v4/materials \
    --width 2048 --samples 32
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import render_italian_flat_material_layers as shared


NODES = {
    "kitchen": (4.10, 3.20, 1.62),
    "living": (3.40, 5.35, 1.62),
    "lounge": (3.35, 8.75, 1.62),
    "living-window": (0.981, 6.042, 1.62),
    "kitchen-window": (0.828, 1.759, 1.62),
}

TARGETS: dict[str, tuple[str, ...]] = {
    "floor": ("Floor Basement Floor",),
    "kitchen": ("Kitchen",),
}

VARIANTS: dict[str, tuple[str, ...]] = {
    "floor": ("natural-oak", "light-travertine"),
    "kitchen": ("smoked-walnut", "warm-ivory"),
}

KITCHEN_FINISH_MATERIALS = {
    "Anta Cucina",
    "MeshTour_smoked-walnut",
    "MeshTour_warm-ivory",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--texture-root", required=True)
    parser.add_argument("--width", type=int, default=2048)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--target", action="append", dest="targets")
    parser.add_argument("--variant", action="append", dest="variants")
    parser.add_argument("--node", action="append", dest="nodes")
    parser.add_argument("--suffix", default="_2k")
    return parser.parse_args(argv)


def target_objects(target: str) -> list[bpy.types.Object]:
    patterns = TARGETS[target]
    objects = [
        obj
        for obj in bpy.context.scene.objects
        if obj.type == "MESH" and shared.object_matches(obj.name, patterns)
    ]
    if target == "kitchen":
        # Only cabinet-front objects use the configurable finish. Projecting
        # unrelated worktops, carcasses, and handles through one joined proxy
        # produces triangular patches at grazing angles.
        objects = [
            obj
            for obj in objects
            if any(
                slot.material is not None and slot.material.name in KITCHEN_FINISH_MATERIALS
                for slot in obj.material_slots
            )
        ]
    if not objects:
        raise RuntimeError(f'Italian Flat property target "{target}" was not found')
    return objects


def image_material(
    name: str,
    image_path: Path,
    roughness: float,
    bump_strength: float,
    uv_scale: float = 1.0,
) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    shader = nodes.new("ShaderNodeBsdfPrincipled")
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(image_path), check_existing=True)
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    coordinates = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (uv_scale, uv_scale, 1.0)
    rgb_to_bw = nodes.new("ShaderNodeRGBToBW")
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.08
    shader.inputs["Roughness"].default_value = roughness
    links.new(coordinates.outputs["UV"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], shader.inputs["Base Color"])
    links.new(texture.outputs["Color"], rgb_to_bw.inputs["Color"])
    links.new(rgb_to_bw.outputs["Val"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    return material


def holdout_material() -> bpy.types.Material:
    material = bpy.data.materials.get("MeshTour_Holdout")
    if material is not None:
        return material
    material = bpy.data.materials.new("MeshTour_Holdout")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    holdout = nodes.new("ShaderNodeHoldout")
    links.new(holdout.outputs["Holdout"], output.inputs["Surface"])
    return material


def solid_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    shader = shared.principled(material)
    shader.inputs["Base Color"].default_value = color
    shader.inputs["Roughness"].default_value = 0.46
    return material


def apply_variant(target: str, variant: str, texture_root: Path) -> None:
    if target == "floor":
        filename = {
            "natural-oak": "natural-european-oak-basecolor.png",
            "light-travertine": "light-travertine-basecolor.png",
        }[variant]
        material = image_material(
            f"MeshTour_{variant}",
            texture_root / filename,
            0.58 if variant == "natural-oak" else 0.7,
            0.12 if variant == "natural-oak" else 0.07,
            4.0 if variant == "natural-oak" else 3.0,
        )
        for obj in target_objects(target):
            for slot in obj.material_slots:
                slot.material = (
                    material
                    if slot.material is not None and slot.material.name == "Floor"
                    else holdout_material()
                )
        return

    material = (
        image_material(
            "MeshTour_smoked-walnut",
            texture_root / "smoked-walnut-basecolor.png",
            0.42,
            0.06,
            2.0,
        )
        if variant == "smoked-walnut"
        else solid_material("MeshTour_warm-ivory", (0.78, 0.72, 0.61, 1.0))
    )
    for obj in target_objects(target):
        for slot in obj.material_slots:
            if slot.material is not None and slot.material.name == "Anta Cucina":
                slot.material = material


def configure_camera_visibility(target: str) -> list[str]:
    selected = set(target_objects(target))
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        # Keep the room available for lighting while camera holdouts cut the
        # exact foreground silhouettes into the transparent finish layer.
        if hasattr(obj, "visible_camera"):
            obj.visible_camera = True
        if hasattr(obj, "is_holdout"):
            obj.is_holdout = obj not in selected
        if obj in selected:
            obj.hide_render = False
    return sorted(obj.name for obj in selected)


def main() -> None:
    args = parse_args()
    output_root = Path(args.output_root).resolve()
    texture_root = Path(args.texture_root).resolve()
    selected_targets = args.targets or list(TARGETS)
    selected_nodes = args.nodes or list(NODES)
    unknown_targets = set(selected_targets) - set(TARGETS)
    unknown_nodes = set(selected_nodes) - set(NODES)
    if unknown_targets:
        raise ValueError(f"Unknown targets: {', '.join(sorted(unknown_targets))}")
    if unknown_nodes:
        raise ValueError(f"Unknown nodes: {', '.join(sorted(unknown_nodes))}")

    shared.remove_expensive_exterior_trees()
    backend = shared.configure_render(args.width, args.samples)
    camera = shared.ensure_panorama_camera()
    configurable_objects = {obj for target in TARGETS for obj in target_objects(target)}
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
        # Kitchen is not materially visible from the far library lounge.
        target_nodes = [node for node in selected_nodes if target != "kitchen" or node != "lounge"]
        for variant in variants:
            shared.restore_materials(original_materials)
            apply_variant(target, variant, texture_root)
            visible = configure_camera_visibility(target)
            print(f"MESHTOUR_LAYER_OBJECTS={target}:{','.join(visible)}")
            destination = output_root / target / variant
            destination.mkdir(parents=True, exist_ok=True)
            for node_id in target_nodes:
                camera.location = NODES[node_id]
                bpy.context.scene.render.use_border = False
                bpy.context.scene.render.filepath = str(
                    destination / f"{node_id}{args.suffix}.png"
                )
                print(
                    f"MESHTOUR_PROPERTY_RENDER={target}:{variant}:{node_id}:"
                    f"{args.width}x{args.width // 2}"
                )
                bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
