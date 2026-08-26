"""Build the licensed Italian Flat scene into a MeshTour demo bundle.

The input is Blender's "Italian Flat" Cycles demo by Flavio Della Tommasa.
Download it from https://download.blender.org/demo/cycles/flat-archiviz.blend
before running this script. The source scene contains its CC-BY notice as a
packed README text block; the generated bundle adds a machine-readable copy.

Usage:
  blender -b flat-archiviz.blend --python build_italian_flat_demo.py -- \
    --output-dir apps/demo/public/tours/italian-flat --mode all

Modes:
  panoramas  Render an equirectangular 16-bit PNG for each configured viewpoint.
  top        Render a baked orthographic top view for the overview camera.
  proxy      Export the web proxy GLB, tour.json, attribution, and manifest.
  all        Render first, then export the remaining files (default).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import bpy


@dataclass(frozen=True)
class TourNode:
    node_id: str
    name: str
    # Blender coordinates: X right, Y depth, Z up.
    location: tuple[float, float, float]
    initial_yaw: float


NODES = (
    # Five captures follow the apartment's open circulation line. They stay
    # clear of the dining table, sofa, lounge chair, pouf, and stair edge so
    # both adjacent and direct point-to-point moves remain visually plausible.
    TourNode("kitchen", "Kitchen & Dining", (4.10, 3.20, 1.62), 2.04),
    TourNode("living", "Living Room", (3.40, 5.35, 1.62), -0.295),
    TourNode("lounge", "Library Lounge", (3.35, 8.75, 1.62), -2.075),
    TourNode("living-window", "Living Window", (0.981, 6.042, 1.62), 0.0),
    TourNode("kitchen-window", "Kitchen Window", (0.828, 1.759, 1.62), 0.0),
)

# Shared floor anchors for navigation markers, keyed by their destination.
# Every panorama reuses this same set and hides the marker for its current node.
LINK_TARGET_ANCHORS: dict[str, tuple[float, float, float]] = {
    "kitchen": (3.688, 0.0, -3.142),
    "living": (3.4, 0.0, -5.35),
    "lounge": (3.932, 0.0, -9.193),
    "living-window": (0.981, 0.0, -6.042),
    "kitchen-window": (0.828, 0.0, -1.759),
}

# Per-capture alignment offset authored against the proxy wireframe. Blender's
# equirectangular camera output is a quarter-turn from the exported Y-up mesh.
PANORAMA_YAW = -1.570796326794898
TOP_VIEW_BOUNDS = (0.0, 0.0, 6.98, 9.899)
TOP_VIEW_MAX_Z = 2.7

TREE_PREFIX = "Mantissa_Japanese_Maple_001"
SOURCE_SHA256 = "0027fcbd73411cce7f49b3d86c22c03d18980e22641083da9d8ba82d9fc94e25"
STRUCTURAL_NAMES = {
    "Floor Basement Floor",
    "Skirting",
    "Stair",
    "Stair Cover",
    "Wall Basement Floor",
}
STRUCTURAL_PREFIXES = ("Door", "Sliding Door")
CEILING_PREFIXES = ("Ceiling", "Roof")

# Each group becomes one joined, decimated mesh. The object name is the
# interaction id consumed by MeshTour, while the source contours retain the
# silhouettes needed for occlusion, highlighting, and projective transitions.
INTERACTABLE_GROUPS: dict[str, tuple[str, ...]] = {
    "int_kitchen": ("Kitchen", "Fridge"),
    "int_dining_table": ("Table Kitchen",),
    # Cushions/pillows are part of the sofa interaction target. Keeping them in
    # a separate visual-only group would let the first ray hit mask the sofa.
    "int_sofa": ("Sofa", "Pillows", "Pillow", "Object007", "Object008"),
    "int_rug": ("Chocofur_Rug_12",),
    "int_lounge_chair": ("Poliform_JANE_armchair_large",),
    "int_pouf": ("Pouf_rounded_3types_002",),
    "int_tv": ("TV",),
}

# Non-interactive furniture remains painted on the fallback panorama sphere.
# Add important non-interactive occluders here when a longer camera path needs
# their silhouettes to contribute stronger parallax.
VISUAL_PROXY_GROUPS: dict[str, tuple[str, ...]] = {
    # Retain the silhouettes that shape parallax while walking between the
    # five captures. These remain non-interactive but prevent large pieces of
    # furniture from being painted onto the walls/floor during transitions.
    "visual_dining_chairs": (
        "Circle",
        "Plane.003",
        "Plane.004",
        "Plane.005",
        "Plane.006",
        "Plane.007",
        "Plane.008",
        "Retopo_Mesh",
        "Superficie_Unisci2",
        "Sweep1",
    ),
    "visual_library": ("Structure", "Panel", "mesh_0", "mesh_1", "mesh_2", "mesh_3"),
    "visual_side_tables": ("Table", "New_Works_Kizu_Table_Lamp_Small_mat1"),
}

# Maximum base polygons retained across each matched source group. Blender's
# triangulation roughly doubles these counts in the exported proxy; budgeting
# per group prevents multi-part sofas/chairs from multiplying the mobile cost.
PROXY_GROUP_TARGETS = {
    "int_kitchen": 500,
    "int_dining_table": 350,
    "int_sofa": 1_000,
    "int_rug": 300,
    "int_lounge_chair": 400,
    "int_pouf": 350,
    "int_tv": 500,
    "visual_dining_chairs": 2_400,
    "visual_library": 1_600,
    "visual_side_tables": 800,
    "int_floor": 500,
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--mode", choices=("all", "panoramas", "top", "proxy"), default="all")
    parser.add_argument("--width", type=int, default=8192)
    parser.add_argument("--top-width", type=int, default=2048)
    parser.add_argument("--samples", type=int, default=256)
    parser.add_argument("--node", action="append", dest="nodes")
    parser.add_argument("--save-clean-blend")
    parser.add_argument(
        "--property-configurator",
        action="store_true",
        help="Export int_floor alongside the existing kitchen target for Italian Flat v4.",
    )
    return parser.parse_args(argv)


def remove_expensive_exterior_trees() -> int:
    trees = [obj for obj in bpy.data.objects if obj.name.startswith(TREE_PREFIX)]
    for obj in trees:
        bpy.data.objects.remove(obj, do_unlink=True)
    return len(trees)


def disable_compositor() -> None:
    scene = bpy.context.scene
    scene.use_nodes = False
    scene.render.use_compositing = False
    scene.render.use_sequencer = False


def configure_cycles(width: int, samples: int) -> str:
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.resolution_x = width
    scene.render.resolution_y = width // 2
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.render.use_file_extension = True
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.01
    scene.cycles.preview_samples = min(samples, 32)
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 4
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 8
    scene.render.image_settings.color_depth = "16"
    scene.render.image_settings.compression = 15
    # Blender 4.3+ exposes the AgX look names without the historical prefix.
    if "Medium High Contrast" in {item.name for item in scene.view_settings.bl_rna.properties["look"].enum_items}:
        scene.view_settings.look = "Medium High Contrast"

    backend = "CPU"
    try:
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        enabled = 0
        for device in preferences.devices:
            if device.type in {"METAL", "GPU"}:
                device.use = True
                enabled += 1
            elif device.type == "CPU":
                device.use = False
        if enabled:
            scene.cycles.device = "GPU"
            backend = "METAL"
    except (KeyError, TypeError, RuntimeError) as error:
        print(f"MESHTOUR_NOTICE=Metal unavailable, using CPU ({error})")
    return backend


def ensure_panorama_camera() -> bpy.types.Object:
    camera_data = bpy.data.cameras.get("MeshTour_Panorama")
    if camera_data is None:
        camera_data = bpy.data.cameras.new("MeshTour_Panorama")
    camera_data.type = "PANO"
    camera_data.panorama_type = "EQUIRECTANGULAR"
    camera = bpy.data.objects.get("MeshTour_Panorama")
    if camera is None:
        camera = bpy.data.objects.new("MeshTour_Panorama", camera_data)
        bpy.context.scene.collection.objects.link(camera)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.scene.camera = camera
    return camera


def render_panoramas(output: Path, width: int, samples: int, selected: set[str] | None) -> None:
    pano_dir = output / "pano"
    pano_dir.mkdir(parents=True, exist_ok=True)
    backend = configure_cycles(width, samples)
    camera = ensure_panorama_camera()
    print(f"MESHTOUR_RENDER_BACKEND={backend}")

    for index, node in enumerate(NODES, start=1):
        if selected is not None and node.node_id not in selected:
            continue
        camera.location = node.location
        bpy.context.scene.render.filepath = str(pano_dir / f"{node.node_id}.png")
        print(f"MESHTOUR_RENDER={index}/{len(NODES)}:{node.node_id}")
        bpy.ops.render.render(write_still=True)


def render_top_view(output: Path, width: int, samples: int) -> None:
    """Render the furnished basement orthographically with the upper storey removed."""
    from mathutils import Vector

    overview_dir = output / "overview"
    overview_dir.mkdir(parents=True, exist_ok=True)
    backend = configure_cycles(width, samples)
    scene = bpy.context.scene
    min_x, min_y, max_x, max_y = TOP_VIEW_BOUNDS
    extent_x = max_x - min_x
    extent_y = max_y - min_y
    scene.render.resolution_x = width
    scene.render.resolution_y = round(width * extent_y / extent_x)
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.quality = 92

    camera_data = bpy.data.cameras.get("MeshTour_Top") or bpy.data.cameras.new("MeshTour_Top")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = extent_y
    camera_data.clip_start = 0.1
    camera_data.clip_end = 100
    camera = bpy.data.objects.get("MeshTour_Top")
    if camera is None:
        camera = bpy.data.objects.new("MeshTour_Top", camera_data)
        scene.collection.objects.link(camera)
    camera.location = ((min_x + max_x) / 2, (min_y + max_y) / 2, 15)
    camera.rotation_euler = (0, 0, 0)
    scene.camera = camera

    hidden: list[tuple[bpy.types.Object, bool]] = []
    for obj in scene.objects:
        if obj.type != "MESH" or obj.name.startswith("Spot"):
            continue
        min_z = min((obj.matrix_world @ Vector(corner)).z for corner in obj.bound_box)
        # Source transforms contain small float drift around the 2.7 m storey
        # boundary (the upper slab is commonly 2.69999...). Keep a narrow
        # tolerance while preserving the ceiling-mounted Spot fixtures.
        if min_z >= TOP_VIEW_MAX_Z - 0.05:
            hidden.append((obj, obj.hide_render))
            obj.hide_render = True

    scene.render.filepath = str(overview_dir / "top.jpg")
    print(
        f"MESHTOUR_TOP_RENDER={scene.render.resolution_x}x{scene.render.resolution_y}:"
        f"{backend}:hidden={len(hidden)}"
    )
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        for obj, was_hidden in hidden:
            obj.hide_render = was_hidden


def object_matches(name: str, patterns: tuple[str, ...]) -> bool:
    return any(name == pattern or name.startswith(f"{pattern}.") for pattern in patterns)


def copy_mesh_object(source: bpy.types.Object, collection: bpy.types.Collection) -> bpy.types.Object:
    clone = source.copy()
    clone.data = source.data.copy()
    clone.animation_data_clear()
    clone.name = f"proxy_{source.name}"
    clone.data.materials.clear()
    collection.objects.link(clone)
    return clone


def make_decimated_group(
    name: str,
    sources: list[bpy.types.Object],
    collection: bpy.types.Collection,
    target_for_group: int,
) -> bpy.types.Object | None:
    """Join simplified copies while retaining the sources' actual contours."""
    clones: list[bpy.types.Object] = []
    eligible_sources = [
        source
        for source in sources
        if not source.hide_render and len(source.data.polygons) > 0
    ]
    source_polygon_count = sum(len(source.data.polygons) for source in eligible_sources)
    group_ratio = min(1.0, target_for_group / max(1, source_polygon_count))
    for index, source in enumerate(eligible_sources):

        world_matrix = source.matrix_world.copy()
        clone = source.copy()
        clone.data = source.data.copy()
        clone.animation_data_clear()
        clone.parent = None
        clone.matrix_world = world_matrix
        clone.name = f"proxy_{name}_{index:02d}_{source.name}"
        clone.data.materials.clear()
        clone.modifiers.clear()
        clone.constraints.clear()
        collection.objects.link(clone)

        if group_ratio < 1:
            modifier = clone.modifiers.new("MeshTour Decimate", "DECIMATE")
            modifier.ratio = max(0.005, group_ratio)
            modifier.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = clone
            clone.select_set(True)
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            clone.select_set(False)
        clones.append(clone)

    if not clones:
        return None

    bpy.ops.object.select_all(action="DESELECT")
    for clone in clones:
        clone.select_set(True)
    bpy.context.view_layer.objects.active = clones[0]
    if len(clones) > 1:
        bpy.ops.object.join()
    joined = clones[0]
    joined.name = name
    joined.data.name = f"{name}_mesh"
    joined.data.materials.clear()
    if joined.data.validate(clean_customdata=False):
        print(f"MESHTOUR_PROXY_REPAIRED={name}")
    joined.data.update()
    joined.select_set(False)
    return joined


def build_proxy_collection(property_configurator: bool = False) -> bpy.types.Collection:
    old = bpy.data.collections.get("MeshTourProxy")
    if old is not None:
        for obj in list(old.objects):
            bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.collections.remove(old)

    collection = bpy.data.collections.new("MeshTourProxy")
    bpy.context.scene.collection.children.link(collection)

    for source in bpy.context.scene.objects:
        if source.type != "MESH":
            continue
        structural_names = STRUCTURAL_NAMES - ({"Floor Basement Floor"} if property_configurator else set())
        if (
            source.name in structural_names
            or source.name.startswith(STRUCTURAL_PREFIXES)
            or source.name.startswith(CEILING_PREFIXES)
        ):
            copy_mesh_object(source, collection)

    groups = {**INTERACTABLE_GROUPS, **VISUAL_PROXY_GROUPS}
    if property_configurator:
        groups["int_floor"] = ("Floor Basement Floor",)
    for name, patterns in groups.items():
        matches = [
            source
            for source in bpy.context.scene.objects
            if source.type == "MESH" and object_matches(source.name, patterns)
        ]
        if property_configurator and name == "int_kitchen":
            # The projected finish layer contains cabinet fronts only. Keeping
            # unrelated kitchen pieces out prevents joined proxy triangles
            # from sampling finish pixels onto worktops and carcasses.
            matches = [
                source
                for source in matches
                if any(
                    slot.material is not None and slot.material.name == "Anta Cucina"
                    for slot in source.material_slots
                )
            ]
        make_decimated_group(name, matches, collection, PROXY_GROUP_TARGETS[name])

    return collection


def export_proxy(output: Path, property_configurator: bool = False) -> dict[str, int]:
    collection = build_proxy_collection(property_configurator)
    bpy.ops.object.select_all(action="DESELECT")
    objects = list(collection.objects)
    for obj in sorted(objects, key=lambda item: item.name):
        if obj.type == "MESH":
            print(f"MESHTOUR_PROXY_OBJECT={obj.name}:{len(obj.data.polygons)}")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    mesh_dir = output / "mesh"
    mesh_dir.mkdir(parents=True, exist_ok=True)
    path = mesh_dir / "apartment.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="NONE",
        export_cameras=False,
        export_lights=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    polygons = sum(len(obj.data.polygons) for obj in objects if obj.type == "MESH")
    return {"objects": len(objects), "polygons": polygons, "bytes": path.stat().st_size}


def to_tour_position(location: tuple[float, float, float]) -> list[float]:
    x, y, z = location
    return [round(x, 3), round(z, 3), round(-y, 3)]


def write_tour_config(output: Path) -> None:
    config = {
        "version": 1,
        "name": "Italian Flat Demo",
        "units": "meters",
        "assets": {
            "basePath": "./tours/italian-flat/",
            "mesh": {"url": "mesh/apartment.glb?v=7", "draco": True},
        },
        "rendering": {
            "previewSuffix": "_1k.jpg",
            "fullSuffix": "_4k.ktx2",
            "background": "#0b0b0e",
            # Project both panoramas through the proxy while moving the camera
            # between capture points. Per-source depth maps reject surfaces
            # that were hidden from either panorama camera.
            "transition": "walk",
        },
        "interactables": {
            "namePrefix": "int_",
            # Keep semantic picking/click events without drawing a hover tint.
            "highlight": {"color": "#fff4dc", "opacity": 0},
        },
        "spatial": {
            "overview": {
                "bounds": {"min": [0, -9.899], "max": [6.98, 0]},
                "floorY": 0,
                # Older proxy builds omit the source ceiling. The engine only
                # generates this thin slab when no ceiling/roof object exists.
                "ceiling": {
                    "y": 2.7,
                    "thickness": 0.08,
                    "bounds": {"min": [0, -9.899], "max": [6.98, 0]},
                },
                "topView": {
                    "url": "overview/top.jpg",
                    "bounds": {"min": [0, -9.899], "max": [6.98, 0]},
                },
            },
            "measurementColor": "#ffffff",
            "measurements": [
                {
                    "id": "apartment",
                    "label": "Apartment",
                    "bounds": {"min": [0, 0, -9.899], "max": [6.98, 2.7, 0]},
                    "axes": ["width", "depth"],
                    "defaultVisible": True,
                    "color": "#58d3f7",
                    "alwaysOnTop": True,
                    "offset": 0.28,
                },
                {
                    "id": "sofa",
                    "label": "Sofa",
                    "target": "int_sofa",
                    "axes": ["width", "depth", "height"],
                },
                {
                    "id": "dining-table",
                    "label": "Dining table",
                    "target": "int_dining_table",
                    "axes": ["width", "depth", "height"],
                },
                {
                    "id": "lounge-chair",
                    "label": "Lounge chair",
                    "target": "int_lounge_chair",
                    "axes": ["width", "depth", "height"],
                },
                {
                    "id": "pouf",
                    "label": "Pouf",
                    "target": "int_pouf",
                    "axes": ["width", "depth", "height"],
                },
            ],
        },
        "configurables": [
            {
                "id": "sofa-finish",
                "label": "Sofa finish",
                "interactable": "sofa",
                "default": "original",
                "variants": [
                    {"id": "original", "label": "Original grey", "swatch": "#57504d"},
                    {
                        "id": "terracotta",
                        "label": "Terracotta",
                        "swatch": "#a85f43",
                        "layers": {
                            "living": "layers/sofa/terracotta/living_4k.png",
                            "lounge": "layers/sofa/terracotta/lounge_4k.png",
                            "living-window": "layers/sofa/terracotta/living-window_4k.png",
                            "kitchen-window": "layers/sofa/terracotta/kitchen-window_4k.png",
                        },
                    },
                    {
                        "id": "ivory-boucle",
                        "label": "Ivory bouclé",
                        "swatch": "#e7dcc9",
                        "layers": {
                            "living": "layers/sofa/ivory-boucle/living_4k.png",
                            "lounge": "layers/sofa/ivory-boucle/lounge_4k.png",
                            "living-window": "layers/sofa/ivory-boucle/living-window_4k.png",
                            "kitchen-window": "layers/sofa/ivory-boucle/kitchen-window_4k.png",
                        },
                    },
                    {
                        "id": "forest-velvet",
                        "label": "Forest velvet",
                        "swatch": "#315b3b",
                        "layers": {
                            "living": "layers/sofa/forest-velvet/living_4k.png",
                            "lounge": "layers/sofa/forest-velvet/lounge_4k.png",
                            "living-window": "layers/sofa/forest-velvet/living-window_4k.png",
                            "kitchen-window": "layers/sofa/forest-velvet/kitchen-window_4k.png",
                        },
                    },
                ],
            },
            {
                "id": "rug-finish",
                "label": "Rug finish",
                "interactable": "rug",
                "default": "original",
                "variants": [
                    {"id": "original", "label": "Original grey", "swatch": "#777370"},
                    {
                        "id": "sand-wool",
                        "label": "Sand wool",
                        "swatch": "#bea47b",
                        "layers": {
                            "living": "layers/rug/sand-wool/living_4k.png",
                            "lounge": "layers/rug/sand-wool/lounge_4k.png",
                            "living-window": "layers/rug/sand-wool/living-window_4k.png",
                            "kitchen-window": "layers/rug/sand-wool/kitchen-window_4k.png",
                        },
                    },
                    {
                        "id": "sage-weave",
                        "label": "Sage weave",
                        "swatch": "#789071",
                        "layers": {
                            "living": "layers/rug/sage-weave/living_4k.png",
                            "lounge": "layers/rug/sage-weave/lounge_4k.png",
                            "living-window": "layers/rug/sage-weave/living-window_4k.png",
                            "kitchen-window": "layers/rug/sage-weave/kitchen-window_4k.png",
                        },
                    },
                    {
                        "id": "charcoal-geometric",
                        "label": "Charcoal geometric",
                        "swatch": "#41464d",
                        "layers": {
                            "living": "layers/rug/charcoal-geometric/living_4k.png",
                            "lounge": "layers/rug/charcoal-geometric/lounge_4k.png",
                            "living-window": "layers/rug/charcoal-geometric/living-window_4k.png",
                            "kitchen-window": "layers/rug/charcoal-geometric/kitchen-window_4k.png",
                        },
                    },
                ],
            },
            {
                "id": "lounge-chair-style",
                "label": "Lounge chair style",
                "interactable": "lounge_chair",
                "default": "original",
                "variants": [
                    {"id": "original", "label": "Original", "swatch": "#4d4645"},
                    {
                        "id": "moss-velvet",
                        "label": "Moss velvet",
                        "swatch": "#486347",
                        "layers": {
                            "living": "layers/chair/moss-velvet/living_4k.png",
                            "lounge": "layers/chair/moss-velvet/lounge_4k.png",
                            "living-window": "layers/chair/moss-velvet/living-window_4k.png",
                            "kitchen-window": "layers/chair/moss-velvet/kitchen-window_4k.png",
                        },
                    },
                    {
                        "id": "cognac-leather",
                        "label": "Cognac leather",
                        "swatch": "#a45f2d",
                        "layers": {
                            "living": "layers/chair/cognac-leather/living_4k.png",
                            "lounge": "layers/chair/cognac-leather/lounge_4k.png",
                            "living-window": "layers/chair/cognac-leather/living-window_4k.png",
                            "kitchen-window": "layers/chair/cognac-leather/kitchen-window_4k.png",
                        },
                    },
                ],
            },
        ],
        "links": [
            {"to": target, "position": list(position), "hideAtTarget": True}
            for target, position in LINK_TARGET_ANCHORS.items()
        ],
        "nodes": [
            {
                "id": node.node_id,
                "name": node.name,
                "position": to_tour_position(node.location),
                "panorama": {
                    "url": f"pano/{node.node_id}",
                    "yaw": PANORAMA_YAW,
                },
                "initialView": {
                    "yaw": round(node.initial_yaw, 6),
                    "pitch": -0.03,
                },
            }
            for node in NODES
        ],
        "hotspots": [
            {
                "id": "sofa_materials",
                "position": [2.45, 0.618, -6.872],
                "type": "custom",
                "title": "Sofa finish",
                "payload": {"configurableId": "sofa-finish"},
            },
            {
                "id": "rug_materials",
                "position": [3.384, 0.003, -7.466],
                "type": "custom",
                "title": "Rug finish",
                "payload": {"configurableId": "rug-finish"},
            },
            {
                "id": "chair_materials",
                "position": [4.06, 0.37, -6.565],
                "type": "custom",
                "title": "Lounge chair style",
                "payload": {"configurableId": "lounge-chair-style"},
            },
            {
                "id": "kitchen_finishes",
                "node": "kitchen",
                # Authored on the worktop inside the Kitchen point's opening view.
                "position": [1.823, 0.835, -0.494],
                "type": "info",
                "title": "Kitchen finishes",
                "body": "Scene markers respect wall occlusion; the persistent point bar remains available at every angle.",
            },
        ],
        "start": "living",
    }
    (output / "tour.json").write_text(
        json.dumps(config, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def write_attribution(output: Path) -> None:
    text = """# Attribution

The visual scene used by this MeshTour demo is **Italian Flat** by
**Flavio Della Tommasa (malapixel.com)**, distributed by Blender as a demo
file and marked `CC-BY` in the source `.blend` file.

- Source: https://www.blender.org/download/demo-files/
- Download: https://download.blender.org/demo/cycles/flat-archiviz.blend
- Retrieved: 2026-08-17
- Source SHA-256: 0027fcbd73411cce7f49b3d86c22c03d18980e22641083da9d8ba82d9fc94e25
- License family: Creative Commons Attribution (CC BY)
- Changes: four high-polygon exterior trees removed; five repositioned
  panorama cameras; dedicated orthographic top render; high-sample 4K render
  derivatives; expanded furniture
  proxy geometry; file conversion and compression for web delivery; native-4K
  transparent Cycles layers for configurable sofa, rug, and lounge-chair
  finishes, including procedurally adjusted material colors and patterns.

The MeshTour source code remains MIT-licensed. The rendered demo images and
derived proxy retain the source scene's CC-BY requirements.
"""
    (output / "ATTRIBUTION.md").write_text(text, encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_manifest(output: Path, proxy_stats: dict[str, int] | None) -> None:
    files = []
    for path in sorted(output.rglob("*")):
        relative = path.relative_to(output)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.is_file() and path.name != "manifest.json":
            files.append(
                {
                    "path": relative.as_posix(),
                    "bytes": path.stat().st_size,
                    "sha256": sha256(path),
                }
            )
    manifest = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "source": {
            "name": "Italian Flat",
            "author": "Flavio Della Tommasa",
            "license": "CC-BY",
            "url": "https://download.blender.org/demo/cycles/flat-archiviz.blend",
            "sha256": SOURCE_SHA256,
        },
        "blenderVersion": bpy.app.version_string,
        "proxy": proxy_stats,
        "files": files,
    }
    (output / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def main() -> None:
    args = parse_args()
    output = Path(args.output_dir).resolve()
    output.mkdir(parents=True, exist_ok=True)
    removed = remove_expensive_exterior_trees()
    disable_compositor()
    print(f"MESHTOUR_REMOVED_TREES={removed}")

    if args.save_clean_blend:
        bpy.ops.wm.save_as_mainfile(filepath=str(Path(args.save_clean_blend).resolve()))

    selected = set(args.nodes) if args.nodes else None
    if selected is not None:
        unknown = selected - {node.node_id for node in NODES}
        if unknown:
            raise ValueError(f"Unknown node ids: {', '.join(sorted(unknown))}")

    if args.mode in {"all", "panoramas"}:
        render_panoramas(output, args.width, args.samples, selected)

    if args.mode in {"all", "top"}:
        render_top_view(output, args.top_width, args.samples)

    proxy_stats = None
    if args.mode in {"all", "proxy"}:
        proxy_stats = export_proxy(output, args.property_configurator)
        write_tour_config(output)
        write_attribution(output)
    write_manifest(output, proxy_stats)
    print(f"MESHTOUR_OUTPUT={output}")


if __name__ == "__main__":
    main()
