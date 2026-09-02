# Walking transitions

MeshTour loads the destination panorama and its material layers before
moving the camera. During the move, it projects both panoramas onto the mesh.
Depth maps help reject pixels from surfaces that were hidden at capture time.

The proxy needs to follow the walls, floor, and large furniture. If a surface
looks as though it slides during a move, check the proxy against the panorama
in author mode. A separate visibility mesh can keep the interaction proxy
small while giving the depth test more detail.

Choose nearby viewpoints that see much of the same room. Use an
[authored path](CONFIG.md#authored-transition-paths) when a straight line
crosses furniture. If neither panorama sees part of the room, add coverage
with a bridge mesh or set `rendering.transition: "fade"`. The [asset options](CONFIG.md#assets)
describe the supported visibility, depth, and bridge inputs.

## Check a change

Try each affected link in both directions. Check that the settled views match
the source panoramas and that material layers stay aligned while moving.

```sh
pnpm exec playwright test tests/e2e/transition-quality.spec.ts --project=desktop-chromium
```

The test attaches frames and camera data for each link. Set
`TRANSITION_EDGE=living:lounge` to inspect one direction. See the
[performance notes](PERFORMANCE.md) for timing checks.
