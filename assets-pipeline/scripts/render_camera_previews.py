"""Render fast workbench previews from every camera in a Blender scene.

Usage:
  blender -b scene.blend --python render_camera_previews.py -- --output-dir previews
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import bpy


def parse_args() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--width", type=int, default=640)
    parser.add_argument("--height", type=int, default=360)
    return parser.parse_args(args)


def safe_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = args.width
    scene.render.resolution_y = args.height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.use_nodes = False
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"

    # The Italian Flat source includes four multi-million-polygon exterior
    # trees. They are irrelevant to interior camera selection and make even a
    # workbench preview consume several gigabytes of memory.
    for obj in list(scene.objects):
        if obj.type == "MESH" and len(obj.data.polygons) > 500_000:
            bpy.data.objects.remove(obj, do_unlink=True)

    cameras = sorted(
        (obj for obj in scene.objects if obj.type == "CAMERA"),
        key=lambda camera: camera.name,
    )
    for index, camera in enumerate(cameras, start=1):
        scene.camera = camera
        output = output_dir / f"{index:02d}_{safe_name(camera.name)}.png"
        scene.render.filepath = str(output)
        bpy.ops.render.render(write_still=True)
        print(f"MESHTOUR_PREVIEW={output}")


if __name__ == "__main__":
    main()
