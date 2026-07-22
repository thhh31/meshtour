# First production demo asset runbook

This document records the workflow used to produce the bundled Italian Flat tour built from a freely licensed Blender scene.

The reference build is now complete in `apps/demo/public/tours/italian-flat/`: three repositioned panorama nodes, a detailed Draco proxy, progressive JPEG/KTX2 textures, a config, attribution, and a checksum manifest.

## Completed reference build

- Source: **Italian Flat** by Flavio Della Tommasa.
- Source SHA-256: `0027fcbd73411cce7f49b3d86c22c03d18980e22641083da9d8ba82d9fc94e25`.
- Blender audit: 4.5.10 LTS; 525 original objects; packed textures; no external libraries; no missing source images (excluding Blender's virtual Render Result/Viewer Node images).
- Cleanup: removed four exterior Japanese-maple objects totaling roughly 10.1 million polygons.
- Tour: `kitchen`, `living`, and `lounge` nodes at 1.62 m eye height, positioned
  along the clear circulation line and away from the dining table, sofa,
  lounge chair, pouf, and stair edge.
- Proxy: 32 objects, 16,791 polygons, and a 275 KiB Draco GLB. Structural,
  interactable, and important visual-only furniture meshes
  keep decimated source contours instead of bounding boxes. Dining chairs,
  library shelving, and side tables now contribute transition parallax.
- Navigation: projective `walk` transitions with radial source-visibility maps
  that reject proxy surfaces hidden from either panorama capture point.
- Alignment: every panorama uses a `−π/2` yaw offset, calibrated against the
  proxy wireframe in author mode.
- Panoramas: 1024x512 JPEG previews and 4096x2048 UASTC/Zstd KTX2 textures with mipmaps.
- Runtime bundle: 9 tracked files totaling 20.3 MiB, plus self-hosted
  Draco/Basis decoders.
- Verification: Khronos KTX validation, desktop and mobile browser smoke tests, and checked-in Playwright visual baselines.

The embedded source notice says `CC-BY` but does not specify a version. Preserve that notice and attribution as shipped; do not silently assign a version.

## Recommended source scene

The first candidate was selected. Keep the fallbacks for future demos:

1. **Italian Flat by Flavio della Tommasa** — preferred because it is an actual architectural-visualization interior.
   - Download: <https://download.blender.org/demo/cycles/flat-archiviz.blend>
   - License: CC-BY; preserve the exact attribution found inside the downloaded file.
   - Background: <https://www.blender3darchitect.com/tag/v-ray-rt/?random-article=1>
2. **Modern Home Interior by CianGameDev** — fallback if Italian Flat has missing resources or requires excessive repair.
   - Download page: <https://blendswap.com/blend/18670>
   - License: CC0.
   - Approximately 38k vertices; expected to be faster to modernize and simplify.
3. **Blender Classroom by Christophe Seux** — fallback for a technical demo if neither apartment scene is usable.
   - Download: <https://download.blender.org/demo/test/classroom.zip>
   - License: CC0; verify the license included with the archive.

Do not use an asset merely because it is described as "free." MeshTour distributes a derived proxy mesh, so the license must permit modification and redistribution. CC0 and CC-BY are acceptable. Avoid royalty-free assets that prohibit redistribution of original or modified models.

## License gate

Complete this before modifying the source scene:

- Open the downloaded `.blend` or archive and locate its embedded README/license text.
- Record the author, asset name, source URL, license name and license version.
- Save a copy of the original license alongside the source asset.
- Create `ATTRIBUTION.md` for all CC-BY content.
- Record the download date and, if practical, a SHA-256 checksum of the original file.
- Check every externally linked texture, HDRI and model. The scene-level license is not sufficient if it contains separately licensed dependencies.
- Replace any missing, unclear or incompatible dependency with a CC0 asset.

Poly Haven is the preferred source for replacement models, textures and HDRIs because its assets are CC0 and redistributable: <https://polyhaven.com/license>.

Do not commit the source scene or generated assets until this license gate passes.

## Working directories

Keep original source files separate from web deliverables:

```text
assets-source/
└── italian-flat/
    ├── original/
    │   ├── flat-archiviz.blend
    │   └── LICENSE.txt
    ├── working/
    │   └── meshtour-italian-flat.blend
    ├── renders-master/
    │   └── *.exr or *.png
    └── ATTRIBUTION.md

apps/demo/public/tours/italian-flat/
├── tour.json
├── ATTRIBUTION.md
├── mesh/
│   └── apartment.glb
├── pano/
│   ├── living_1k.jpg
│   ├── living_4k.ktx2
│   ├── lounge_1k.jpg
│   ├── lounge_4k.ktx2
│   ├── kitchen_1k.jpg
│   └── kitchen_4k.ktx2
```

Large source `.blend`, EXR and PNG files should normally live outside Git or in Git LFS. The web-ready GLB, JPEG, KTX2, WebP, config and attribution files are the demo deliverables.

## Phase 1: scene audit

Open the source in the current Blender LTS release and produce a short audit before doing cleanup:

- Does the scene open without missing-file warnings?
- Are all textures packed or resolvable?
- Does a normal Cycles render complete?
- Are dimensions approximately real-world scale?
- Are walls, floors, ceilings and large furniture separate objects?
- Is there enough navigable space for at least three panorama positions?
- Can adjacent camera positions see much of the same geometry?
- Is the license safe for the source scene and every dependency?

Stop and use the next candidate if repairing the scene is likely to take more than one working day.

## Phase 2: panorama cameras

Create an initial three-node tour. Add more nodes only after the complete workflow works.

Suggested node IDs:

- `living_01`
- `living_02`
- `kitchen` or `entry`

Camera requirements:

- Height: approximately 1.6 m above the finished floor.
- Type: Panoramic -> Equirectangular.
- Adjacent cameras must have direct line of sight and substantial shared visibility.
- Straight paths between linked cameras must not cross walls, furniture or closed doors.
- Keep cameras away from walls and large furniture to reduce reprojection distortion.
- Use a consistent exposure, white balance, world lighting and color-management configuration.
- Name Blender cameras using the same IDs as `tour.json` nodes.

MeshTour uses right-handed, Y-up coordinates. Blender uses Z-up. Convert manually copied Blender positions as follows:

```text
Blender (x, y, z) -> MeshTour [x, z, -y]
```

Render low-resolution tests first. Do not start final 8K renders until the proxy alignment and transitions are working.

## Phase 3: proxy mesh

Build the proxy from a duplicate of the visual scene; never destructively simplify the only working source.

The proxy must retain:

- Floors, walls and ceilings.
- Door and window openings.
- Large fixed cabinetry.
- Large furniture and other important occluders.
- Furniture silhouettes used for interaction or hotspots.

Remove:

- Small decoration, cables, books, tableware and plants.
- Materials, textures, lights and render-only helpers.
- Geometry invisible from every tour node.
- High-frequency details that do not affect silhouette or occlusion.

Target requirements:

- Fewer than 150k triangles; preferably below 75k for this first demo.
- Walls and floors within roughly 2-3 cm of the rendered geometry.
- Large furniture silhouettes within roughly 5 cm.
- Applied transforms and correct normals.
- No unintended gaps that reveal the background during panorama projection.
- Interactable objects named with the `int_` prefix, for example `int_sofa`, `int_table` and `int_kitchen_island`.

Export as binary glTF:

- Format: `.glb`.
- Coordinate conversion: `+Y Up`.
- Draco compression: enabled.
- Animations, cameras and lights: excluded.
- Materials may be omitted because MeshTour replaces them with the panorama projection material.

## Phase 4: panorama output

For each node in the reference demo, produce:

1. A lossless master, stored outside the web bundle.
2. A 1024x512 JPEG preview.
3. A 4096x2048 KTX2 production texture.

The 4K production texture materially improves fine artwork, textile, and
cabinet detail while UASTC and mipmaps keep it GPU-friendly.

Example conversion commands:

```bash
magick living.png -resize 1024x512 -quality 80 living_1k.jpg
magick living.png -resize 4096x2048 -flip living_4k_flipped.png
toktx --t2 --uastc 4 --zcmp 18 --genmipmap living_4k.ktx2 living_4k_flipped.png
```

KTX2 input is flipped intentionally because KTX2 texture orientation differs from the JPEG/PNG path used by Three.js. Visually verify the sky, floor and panorama seam after conversion.

## Phase 5: tour configuration

Create `apps/demo/public/tours/italian-flat/tour.json` using the v1 schema documented in [CONFIG.md](./CONFIG.md).

Initial configuration:

```jsonc
{
  "version": 1,
  "name": "Italian Flat Demo",
  "units": "meters",
  "assets": {
    "basePath": "./tours/italian-flat/",
    "mesh": { "url": "mesh/apartment.glb", "draco": true },
  },
  "rendering": {
    "previewSuffix": "_1k.jpg",
    "fullSuffix": "_4k.ktx2",
    "background": "#0b0b0e",
    "transition": "walk",
  },
  "nodes": [
    {
      "id": "living",
      "position": [3.55, 1.6, -6.55],
      "panorama": { "url": "pano/living", "yaw": -1.570796326794898 },
      "links": [],
    },
  ],
  "hotspots": [],
  "start": "living",
}
```

Replace every example coordinate and link position with authored values. Links should be bidirectional unless there is a deliberate reason for one-way navigation.

Use author mode to:

- Inspect exact surface positions.
- Place link discs.
- Place and drag hotspots and link markers.
- Calibrate panorama yaw.
- Verify proxy alignment in wireframe mode.
- Export the final JSON.

Hotspot media uses the same `assets.basePath` as the mesh and panoramas, so prefer portable relative URLs such as `img/sofa.webp`.

## Phase 6: demo application integration

The final React integration uses only the public API:

```tsx
<Tour config="./tours/italian-flat/tour.json" />
```

Do not import internal engine classes into the public demo to work around asset or config problems.

## QA checklist

### Visual

- No black gaps, inverted panoramas or visible vertical seam.
- Panorama and proxy alignment remains stable while looking around.
- Walk-mode tours: floor, wall and furniture silhouettes do not noticeably swim during transitions.
- Fade-mode tours: camera travel is fully covered and both settled views are aligned.
- Exposure and color remain consistent between nodes.
- No duplicated or transparent-looking furniture appears at any demo link.
- Hotspots hide behind walls and appear from valid viewpoints.

### Interaction

- All link discs navigate to the intended node.
- Hidden links and hotspots are not hoverable or clickable.
- Interactable names emit the expected IDs.
- Pointer drag, touch drag, wheel zoom and pinch zoom work.
- Author mode can place, move and export hotspots and links.

### Performance

- First preview becomes interactive within two seconds on a representative connection after assets are cached by the server/CDN normally, not preloaded by the browser test.
- No texture upload occurs during an active transition.
- Transitions stay near 60 fps on desktop and at least 30 fps on a mid-range phone.
- The tour does not exceed mobile GPU texture memory after visiting every node repeatedly.
- Only the current node and direct neighbors remain resident after navigation settles.

### Compatibility

- Current Chrome, Firefox and Safari desktop.
- Current iOS Safari.
- Current Android Chrome on a physical mid-range device.
- Both ESM and React quickstarts can load the same tour folder.

## Required verification commands

Run from the repository root:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:apps
pnpm lint
pnpm test:e2e
pnpm --filter @meshtour/demo dev
```

In addition to automated checks, manually run every transition in both directions and inspect browser console errors and GPU-memory behavior.

## Definition of done

The first production asset demo is complete when:

- The exact source and dependency licenses are recorded and compliant.
- At least three real panorama nodes load from static files.
- The aligned Draco GLB proxy is used for rendering and interaction.
- Preview JPEG -> 2K KTX2 upgrades work without a visible stall.
- Every configured transition is visually acceptable on desktop and mobile.
- Hotspots, interactables and occlusion behave correctly.
- The demo no longer bakes panoramas at runtime.
- The public build passes automated browser screenshot tests.
- `ATTRIBUTION.md` ships with the deployed tour and repository assets.
