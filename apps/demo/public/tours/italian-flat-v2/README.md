# Italian Flat v2

This is a self-contained, additive upgrade of `italian-flat`. The original tour
folder and route remain unchanged.

## Enabled transition-quality capabilities

- A separately loaded transition-visibility GLB, reproducibly derived from the
  audited interaction proxy. Flat decorative geometry is excluded while the
  architecture and dominant occluders remain.
- Six explicit directed paths between the three capture points. The long
  Living/Lounge route follows the circulation gap around the sofa rather than
  intersecting furniture.
- Panorama correction metadata on every node. The current values are deliberate
  identity corrections: source exposure/color is preserved until matching can
  be calibrated against source-render data rather than image-wide averages.
- Existing 1K preview, 4K KTX2 panorama, configurables, hotspots, measurements,
  top view, Draco, and interaction capabilities are retained.
## Deliberately unavailable source-dependent assets

Offline radial-depth cubemaps and a baked disocclusion bridge are not included.
The committed source bundle does not contain the Blender scene or bridge
textures, and no KTX2 encoder is available in the repository. Runtime radial
depth capture therefore remains the validated fallback.

Run `pnpm assets:build:v2` after changing the v1 proxy or v2 config. It rebuilds
`mesh/transition-visibility.glb` and the checksum manifest. Run
`pnpm assets:verify:v2` after `pnpm build` to validate the independent package.
