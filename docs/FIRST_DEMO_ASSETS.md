# Italian Flat demo assets

The demo uses Flavio Della Tommasa's Italian Flat scene. The
[attribution file](../apps/demo/public/tours/italian-flat/ATTRIBUTION.md)
records the source download, SHA-256, and CC BY notice. Keep the source
Blender file and lossless render masters outside the web bundle.

## Rebuild the reference tour

The Blender script exports the proxy and renders the kitchen, living room,
library lounge, and overhead view. Render into a separate directory so you can
check the output before replacing the demo files.

```sh
blender -b flat-archiviz.blend \
  --python assets-pipeline/scripts/build_italian_flat_demo.py -- \
  --output-dir /tmp/italian-flat --mode all --width 4096 --samples 128
```

Use the [Blender guide](../assets-pipeline/BLENDER.md#3-image-optimization)
to encode the 1024×512 JPEG previews and 4096×2048 KTX2 textures. The
reference panoramas use a yaw offset of −π/2. Check the alignment in author
mode before replacing the proxy or changing camera positions.

See the [material notes](ITALIAN_FLAT_MATERIAL_CATALOG.md) to render the
furniture finishes. V4 reuses the V3 panoramas and layers, with two extra
viewpoints and its own flooring layers.

After updating the V1 bundle, refresh its manifest and run the asset checks.

```sh
pnpm build
pnpm assets:manifest
pnpm assets:verify
pnpm assets:verify:v2
pnpm assets:verify:v3
pnpm assets:verify:v4
```
