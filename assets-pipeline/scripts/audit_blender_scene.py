"""Write a machine-readable audit of a Blender scene.

Usage:
  blender -b scene.blend --python audit_blender_scene.py -- --output audit.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(args)


def rounded_vector(values: Vector) -> list[float]:
    return [round(float(value), 4) for value in values]


def scene_bounds() -> dict[str, list[float]] | None:
    corners: list[Vector] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or not obj.visible_get():
            continue
        corners.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not corners:
        return None
    minimum = Vector((min(point[i] for point in corners) for i in range(3)))
    maximum = Vector((max(point[i] for point in corners) for i in range(3)))
    return {
        "min": rounded_vector(minimum),
        "max": rounded_vector(maximum),
        "size": rounded_vector(maximum - minimum),
    }


def image_record(image: bpy.types.Image) -> dict[str, object]:
    source_path = image.filepath or image.filepath_raw
    resolved = bpy.path.abspath(source_path) if source_path else ""
    packed = image.packed_file is not None
    return {
        "name": image.name,
        "source": image.source,
        "filepath": source_path,
        "resolvedPath": resolved,
        "packed": packed,
        "exists": packed or (bool(resolved) and os.path.exists(resolved)),
        "size": list(image.size),
    }


def object_record(obj: bpy.types.Object) -> dict[str, object]:
    record: dict[str, object] = {
        "name": obj.name,
        "type": obj.type,
        "location": rounded_vector(obj.matrix_world.translation),
        "dimensions": rounded_vector(obj.dimensions),
        "hiddenRender": obj.hide_render,
    }
    if obj.type == "MESH":
        record["vertices"] = len(obj.data.vertices)
        record["polygons"] = len(obj.data.polygons)
    if obj.type == "CAMERA":
        record["cameraType"] = obj.data.type
        record["panoramaType"] = getattr(obj.data, "panorama_type", None)
    return record


def main() -> None:
    args = parse_args()
    scene = bpy.context.scene
    images = [image_record(image) for image in bpy.data.images]
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    audit = {
        "blendFile": bpy.data.filepath,
        "blenderVersion": bpy.app.version_string,
        "scene": scene.name,
        "renderEngine": scene.render.engine,
        "unitSystem": scene.unit_settings.system,
        "unitScale": scene.unit_settings.scale_length,
        "objectTypes": dict(Counter(obj.type for obj in scene.objects)),
        "objectCount": len(scene.objects),
        "meshCount": len(meshes),
        "baseVertices": sum(len(obj.data.vertices) for obj in meshes),
        "basePolygons": sum(len(obj.data.polygons) for obj in meshes),
        "materials": len(bpy.data.materials),
        "images": images,
        "missingImages": [image for image in images if not image["exists"]],
        "libraries": [library.filepath for library in bpy.data.libraries],
        "texts": {text.name: text.as_string() for text in bpy.data.texts},
        "bounds": scene_bounds(),
        "objects": [object_record(obj) for obj in scene.objects],
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(audit, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"MESHTOUR_AUDIT={output}")


if __name__ == "__main__":
    main()
