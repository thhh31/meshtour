# Italian Flat configurable-material workflow

This is the implementation and extension guide for the checked-in Italian Flat
sofa, rug, and lounge-chair configurator.

## Current catalogue

| Configurable         | Proxy target       | Blender source object          | Finishes                                                 |
| -------------------- | ------------------ | ------------------------------ | -------------------------------------------------------- |
| `sofa-finish`        | `int_sofa`         | `Sofa*`, `Pillows`             | Original grey, Terracotta, Ivory bouclé, Forest velvet   |
| `rug-finish`         | `int_rug`          | `Chocofur_Rug_12`              | Original grey, Sand wool, Sage weave, Charcoal geometric |
| `lounge-chair-style` | `int_lounge_chair` | `Poliform_JANE_armchair_large` | Original, Moss velvet, Cognac leather                    |

The source materials are `Fabric_Sofa`, `Carpet Grey`, `Velvet`, `Wood`, and
`Red Leather`. The render script duplicates them before modification, retaining
their licensed image textures, bump maps, roughness, and UV mapping.

## Add another finish

1. Add the variant id to `VARIANTS` in
   `assets-pipeline/scripts/render_italian_flat_material_layers.py`.
2. Add its material recipe to `apply_sofa`, `apply_rug`, or `apply_chair`.
   Always call `tinted_copy` or create another copied material; never modify the
   original shared Blender material in place.
3. Render the finish from both `living` and `lounge` at 4096×2048:

   ```bash
   blender -b flat-archiviz.blend \
     --python assets-pipeline/scripts/render_italian_flat_material_layers.py -- \
     --output-root apps/demo/public/tours/italian-flat/layers \
     --target sofa --variant new-finish --width 4096 --samples 64
   ```

4. Add the variant to `apps/demo/public/tours/italian-flat/tour.json` with a
   label, CSS-color swatch, and per-node layer paths. The original finish must
   remain layerless because it comes from the base panorama.
5. Refresh and verify the asset manifest:

   ```bash
   pnpm build
   pnpm assets:manifest
   pnpm assets:verify
   ```

6. Exercise the finish in `tests/e2e/demo.spec.ts`, including a node transition.

## Add another configurable object

1. Identify the exact source object and material-slot names in Blender.
2. Add an `int_<id>` entry and polygon budget to `INTERACTABLE_GROUPS` and
   `PROXY_GROUP_TARGETS` in `build_italian_flat_demo.py`.
3. Regenerate the proxy. Do this in a temporary output directory first, then
   replace only the audited `mesh/apartment.glb` in the demo bundle.
4. Add the target, material recipes, and safe equirectangular render bounds to
   `render_italian_flat_material_layers.py`. Use a 512×256, one-sample render
   with `--no-border --suffix _preview` to measure new bounds.
5. Add one `configurables[]` entry in `tour.json`. Its `interactable` value is
   the proxy name after removing `int_`.
6. Add a custom hotspot whose payload is
   `{ "configurableId": "<configurable-id>" }`. The generic React popup reads
   its labels and swatches directly from the tour config.

Each configurable must target a different proxy interactable. To expose chair
upholstery and frame as two independent selectors, first split the chair proxy
into `int_lounge_chair_upholstery` and `int_lounge_chair_frame`, and render only
the corresponding source faces in each layer. Otherwise use combined chair
style variants, as the demo does now.

## Quality rules

- Use the exact panorama camera positions and rotation already defined by the
  render script.
- Deliver full-size 4096×2048 RGBA PNGs; do not upscale a low-resolution crop.
- Keep room geometry visible to indirect, glossy, transmission, and shadow
  rays while disabling its camera visibility.
- Render every node from which the proxy target can appear. A missing node
  intentionally falls back to the original panorama.
- Preserve object geometry. A geometry or silhouette change requires a new
  proxy mesh, not merely another image layer.
- Inspect settled views and walking transitions for alignment, alpha fringes,
  z-fighting, original-material leaks, and correct occlusion.
- Keep variants lazy-loaded. For production mobile delivery, convert the PNG
  masters to alpha-capable UASTC KTX2 textures with mipmaps.

## Required checks

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm build:apps
pnpm lint:eslint
pnpm assets:verify
pnpm exec playwright test tests/e2e/demo.spec.ts --project=desktop-chromium
```
