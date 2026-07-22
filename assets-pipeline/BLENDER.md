# Blender same-source export workflow

This guide turns one Blender scene into a complete MeshTour asset set: equirectangular panoramas + an aligned low-poly proxy mesh + a `tour.json`. Because both come from the same model, alignment is exact — no calibration step.

Folder convention (matches the config defaults):

```
my-tour/
├── tour.json
├── mesh/apartment.glb
├── overview/top.jpg            # optional baked orthographic top view
├── pano/living_room_1k.jpg     # preview
├── pano/living_room_8k.ktx2    # full res
└── img/…                       # hotspot media
```

## 0. Coordinate conversion (read this first)

Blender is **Z-up**; MeshTour (three.js) is **Y-up**. The glTF exporter handles the mesh automatically (`+Y up` is its default). For _positions you copy by hand_ (camera locations), convert:

| tour.json axis | comes from Blender |
| -------------- | ------------------ |
| `x`            | `x`                |
| `y`            | `z`                |
| `z`            | `-y`               |

A Blender location `(x, y, z)` becomes a config position `[x, z, -y]`.

Tiny helper (run in Blender's Python console; prints the active camera's tour position):

```python
import bpy
loc = bpy.context.object.location
print(f"[{loc.x:.3f}, {loc.z:.3f}, {-loc.y:.3f}]")
```

## 1. Panoramas

1. In the **full-quality** scene, add one camera per viewpoint at eye height (~**1.6 m** above the floor). Place them where a person would naturally stand; keep neighboring viewpoints within line of sight of each other (shared visibility = clean transitions).
2. For each camera: `Camera properties → Lens → Type: Panoramic`, `Panorama Type: Equirectangular` (Cycles only).
3. Render at **8192×4096** (or 4096×2048 for smaller tours), Cycles, with denoising on.
4. Record each camera's location and convert with the table above — these are your node `position` values.
5. If a panorama comes out rotated relative to the others, don't re-render: set the node's `panorama.yaw` (author mode has live nudge buttons for exactly this).

## 2. Proxy mesh

1. Duplicate the scene (keep the original untouched).
2. Delete tiny clutter: plants, books, cables, decoration. **Do not delete large occluders** (walls, sofas, kitchen islands) — occlusion correctness depends on them.
3. Add a **Decimate** modifier to heavy objects. Target: **under ~150k triangles total** for the whole tour.
4. Rename every object that should respond to hover/click with the interactable prefix: `int_sofa`, `int_table_01`, `int_unit_3B`. Everything else keeps any name.
5. Remove all materials/textures (they are never rendered — the projection shader replaces them).
6. `File → Export → glTF 2.0`:
   - Format: **glTF Binary (.glb)**
   - Transform: **+Y up** (default)
   - Data → Mesh → Compression: enable **Draco**, default settings
7. Save as `mesh/apartment.glb` and set `"assets": { "mesh": { "url": "mesh/apartment.glb", "draco": true } }`.

Faithfulness rule of thumb: walls and floors within ~2–3 cm, furniture silhouettes within ~5 cm. Where the proxy deviates, projected texels will "swim" slightly during transitions.

### Baked top view

For a clean textured overview, render one additional orthographic image from
directly above the furnished source scene. Hide the ceiling and any upper
storeys, crop the camera exactly to the configured X/Z plan bounds, and save the
result as `overview/top.jpg`. Configure it with:

```json
"spatial": {
  "overview": {
    "bounds": { "min": [0, -10], "max": [7, 0] },
    "topView": { "url": "overview/top.jpg" }
  }
}
```

The Italian Flat builder generates this render automatically in `all` mode, or
independently with `--mode top --top-width 2048`.

## 3. Image optimization

Two files per panorama: a small JPEG preview (first paint < 2 s on 4G) and a GPU-compressed KTX2 full version (KTX2 stays compressed in GPU memory — this is what keeps 8k panoramas alive on mobile).

```bash
# Preview: 1024-wide JPEG (~150 KB)
magick pano/living_room.png -resize 1024x512 -quality 80 pano/living_room_1k.jpg

# Full res: KTX2 / Basis UASTC.
# NOTE the vertical flip: KTX2 textures are not flipped at load time the way
# JPEG/PNG are, so flip at encode time to keep the sky at the top.
magick pano/living_room.png -flip pano/living_room_flipped.png
toktx --t2 --uastc 4 --zcmp 18 --genmipmap \
      pano/living_room_8k.ktx2 pano/living_room_flipped.png
rm pano/living_room_flipped.png
```

Then in the config:

```jsonc
"rendering": { "previewSuffix": "_1k.jpg", "fullSuffix": "_8k.ktx2" }
```

and each node's `panorama.url` is the suffix-less stem: `"pano/living_room"`.

`toktx` ships with the [KTX-Software](https://github.com/KhronosGroup/KTX-Software) release packages. The engine transcodes KTX2 with the Basis transcoder; host the transcoder files yourself and pass `ktx2TranscoderPath` to the engine if you don't want the default CDN.

## 4. Configurable furniture layers

For a small catalogue of pre-rendered finishes, render only the configurable
object over transparency from every panorama node that can see it:

1. Keep the original panorama cameras, transforms, resolution, Cycles settings,
   exposure, and color management unchanged.
2. Enable `Render Properties → Film → Transparent` and RGBA output.
3. Put the room in an **Indirect Only** view-layer collection, or disable its
   Camera ray visibility while retaining Diffuse, Glossy, Transmission, and
   Shadow visibility. The room should still light and reflect in the object.
4. Keep only the configurable object directly visible to the camera and assign
   the desired finish.
5. Render one equirectangular RGBA layer for each node from which the object is
   visible. The unchanged/original finish can use an empty layer map.
6. Preserve the object's geometry. The base panorama already contains its
   shadow, while the proxy mesh clips the replacement layer to its silhouette.

Use PNG as the render master. For production delivery, encode an alpha-capable
KTX2 with the same vertical flip required by full panoramas. See the
`configurables` section in [CONFIG.md](../docs/CONFIG.md) for the JSON contract.

The checked-in Italian Flat demo uses native-4K transparent Cycles layers for
three independent targets: sofa, rug, and lounge chair. The renderer preserves
the source scene's texture maps, bump, lighting, reflections, and material
response while changing the selected finish. Regenerate the complete catalogue
from the official `flat-archiviz.blend` source with:

```bash
blender -b flat-archiviz.blend \
  --python assets-pipeline/scripts/render_italian_flat_material_layers.py -- \
  --output-root apps/demo/public/tours/italian-flat/layers \
  --width 4096 --samples 64
```

Use `--target sofa`, `--target rug`, `--target chair`, `--variant <id>`, or
`--node living` to render a subset. The script restricts each target to its
equirectangular bounds while still writing full-size RGBA images, avoiding
wasted Cycles samples on transparent pixels.

## 5. Assemble tour.json

Start from the example in [CONFIG.md](../docs/CONFIG.md), paste in the converted camera positions, then do the fine work **in author mode** (`authorMode: true`): verify mesh alignment with the wireframe toggle, click to place links and hotspots, nudge per-node yaw, and download the updated JSON.

## Scripted reference build

The repository includes a production script for the bundled CC-BY **Italian
Flat** reference scene. It removes four multi-million-polygon exterior trees,
adds three panorama viewpoints along the clear circulation path, exports a
detailed interaction/occlusion proxy,
and writes the starter config plus attribution and checksums:

```bash
blender -b flat-archiviz.blend \
  --python assets-pipeline/scripts/build_italian_flat_demo.py -- \
  --output-dir apps/demo/public/tours/italian-flat \
  --mode all --width 4096 --samples 128
```

The PNG render masters are intentionally intermediate files. Resize them to
`_1k.jpg`, encode vertically flipped `_4k.ktx2` files as described in §3,
then remove the masters before publishing.
