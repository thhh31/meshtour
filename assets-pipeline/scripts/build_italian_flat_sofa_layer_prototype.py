"""Generate synthetic Italian Flat sofa layers for the runtime-layer prototype.

These files are deliberately not production renders. They recolor broad areas
of the checked-in 1K panoramas; the runtime clips them to the `int_sofa` proxy
mesh. Replace them with transparent Blender renders using the same filenames to
evaluate final visual quality without changing application or engine code.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


MASKS = {
    # Broad masks are intentional. Only int_sofa receives this image at runtime,
    # so opaque pixels outside the sofa never reach the framebuffer.
    "living": [(250, 245), (705, 245), (705, 510), (235, 510)],
    "lounge": [(0, 260), (275, 260), (275, 512), (0, 512)],
}


def build_layer(source: Path, output: Path, polygon: list[tuple[int, int]]) -> None:
    panorama = Image.open(source).convert("RGB")
    grayscale = ImageOps.grayscale(panorama)
    # Preserve the rendered luminance/detail while replacing the neutral sofa
    # hue with a visibly different warm terracotta finish.
    recolored = ImageOps.colorize(grayscale, black=(24, 7, 4), white=(255, 184, 132))

    alpha = Image.new("L", panorama.size, 0)
    ImageDraw.Draw(alpha).polygon(polygon, fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=2))

    layer = recolored.convert("RGBA")
    layer.putalpha(alpha)
    output.parent.mkdir(parents=True, exist_ok=True)
    layer.save(output, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tour-dir", required=True)
    args = parser.parse_args()
    tour_dir = Path(args.tour_dir).resolve()

    for node_id, polygon in MASKS.items():
        build_layer(
            tour_dir / "pano" / f"{node_id}_1k.jpg",
            tour_dir / "layers" / "sofa" / "terracotta" / f"{node_id}_1k.png",
            polygon,
        )


if __name__ == "__main__":
    main()
