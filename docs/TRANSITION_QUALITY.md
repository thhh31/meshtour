# Transition quality implementation guide

This document is the engineering plan for making MeshTour's `walk` transition
reliable enough to remain the default in production tours. It is intentionally
specific to the current implementation; read the files in **Code map** before
changing the rendering path.

The target is not perfectly reconstructing arbitrary viewpoints from two
panoramas. That is impossible when neither capture contains a newly revealed
surface. The target is to:

1. use every valid source pixel without projecting hidden foreground pixels
   onto rear geometry;
2. keep proxy error below the level a normal viewer notices during a short
   move;
3. provide a geometrically stable fallback for true disocclusion; and
4. arrive at the destination panorama without a pop, texture upload, or state
   mismatch.

## Current rendering path

The existing path has four important parts:

1. `NavigationManager` loads and preuploads panorama B, captures its visibility
   cubemap, moves the camera on a straight line, and changes the global A/B
   blend over the middle 16% of the transition.
2. `PanoramaMaterial` projects A and B from their capture centers onto the
   shared proxy. It performs a binary radial-depth test for each source.
3. `PanoramaVisibilityMap` clones the interaction proxy and renders a 256 px
   packed radial-distance cubemap for each nearby node.
4. `VariantManager` keeps transparent configurable-object layers synchronized
   with the same A/B slots.

This already prevents the worst foreground-phantom artifact, but it has three
fundamental limitations:

- the interaction proxy is not accurate enough to be the visibility source at
  every furniture silhouette;
- a 256 px nearest-filtered cubemap plus a fixed 8 cm bias produces hard,
  unstable visibility decisions near edges; and
- if both panoramas lack a surface, the shader can only discard the fragment
  and reveal another proxy surface or the skysphere. It cannot invent the
  missing appearance.

Do not try to solve all three problems by widening the depth bias or changing
the blend window. Those adjustments move artifacts around instead of fixing
their cause.

## Required invariants

Preserve these behaviors through every stage:

- Static node views remain pixel-aligned with their source panorama.
- Panorama B and all selected variant layers are loaded and preuploaded before
  `transitionstart`.
- No preview-to-full texture replacement occurs during an active transition.
- The destination panorama, visibility data, and every variant layer promote
  from B to A in the same frame.
- `fade` remains a supported explicit fallback.
- Existing config version 1 remains valid. Add optional fields; do not change
  the meaning of existing fields.
- Direct `goToNode()` calls and link-marker navigation use the same transition
  implementation.
- Disposal during loading or movement releases every new texture, render
  target, geometry, and event listener.

## Stage 0: establish a deterministic baseline

Do this before modifying shaders or assets.

### Capture every directed transition

Create a transition matrix for each reference tour. Every edge must be tested
in both directions because source visibility is directional.

For each transition, capture frames at normalized progress:

```text
0.00  0.15  0.30  0.42  0.50  0.58  0.70  0.85  1.00
```

Add an internal test-only transition clock rather than sleeping in Playwright.
It should let a test prepare a transition, set normalized progress, render one
frame, and take a screenshot. Do not expose this clock from the public package
entry point.

Store the following metadata next to each captured sequence:

- source and destination node ids;
- camera position and normalized progress;
- panorama A/B blend;
- whether A and B visibility data are ready;
- renderer and device pixel ratio;
- frame time and current GPU texture count.

### Add transition debug views

Extend author mode with a transition diagnostics panel. It must be possible to
freeze progress and view:

- projected source A only;
- projected source B only;
- A/B blend;
- source-A visibility;
- source-B visibility;
- fragments rejected by both sources;
- interaction proxy wireframe;
- transition-visibility geometry wireframe; and
- the bridge mesh described in Stage 3.

Use shader defines or a debug uniform; do not create a second production
shader implementation.

### Classify artifacts before fixing them

Use this table during review:

| Artifact                                      | Likely cause                                                     | Correct first action                                     |
| --------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Foreground object copied onto a wall or floor | Missing or inaccurate source occluder                            | Improve transition visibility geometry/depth             |
| Object edge flickers while moving             | Hard low-resolution depth threshold                              | Add filtered confidence and edge-aware bias              |
| Texture appears to slide across a surface     | Proxy surface differs from rendered geometry                     | Improve the visible proxy contour or use the bridge mesh |
| Black/background hole                         | Both sources reject all proxy surfaces along the ray             | Use bridge coverage; do not merely increase bias         |
| Double furniture around the midpoint          | Both sources are valid but geometrically inconsistent            | Narrow/localize blend using confidence                   |
| Whole-frame pop                               | Texture, yaw, exposure, or slot promotion mismatch               | Fix lifecycle/alignment before shader work               |
| Mid-transition hitch                          | Decode, upload, depth capture, or shader compile during movement | Move work before `transitionstart`                       |

Keep the original recordings. A transition change is not an improvement if it
fixes one edge by making another direction worse.

## Stage 1: decouple transition visibility from interaction geometry

The interaction proxy should remain small and fast to raycast. Introduce a
separate optional visibility source with more accurate silhouettes.

### Add a transition visibility mesh

Extend the asset contract with an optional mesh, for example:

```jsonc
{
  "assets": {
    "mesh": { "url": "mesh/interaction.glb", "draco": true },
    "visibilityMesh": {
      "url": "mesh/transition-visibility.glb",
      "draco": true,
    },
  },
}
```

When absent, preserve the current behavior and use the interaction proxy.

Generate the visibility mesh from the same Blender scene and coordinate system
as the panoramas. It should contain:

- walls, floors, ceilings, door and window openings;
- large furniture and other meaningful occluders;
- furniture contours accurate enough for projected edges; and
- no materials, textures, modifiers, lights, cameras, or tiny decoration.

Unlike the interaction proxy, the visibility mesh does not need semantic
object names or BVH picking. Spend its triangle budget on silhouettes. Start
with a 100k-triangle mobile budget and change it only after measuring GLB size,
depth-capture time, and transition quality.

Update `PanoramaVisibilityMap` to clone the visibility mesh rather than the
interaction proxy. Keep it out of the main render scene and the interaction
raycaster.

### Move radial depth generation offline after validation

The separate mesh is the quickest way to validate whether better visibility
geometry fixes the reference scenes. Once validated, add an offline build mode
that renders radial depth from every panorama camera.

Requirements for the offline depth representation:

- linear radial distance, not camera-plane depth;
- the same near/far values and world units used by the runtime shader;
- enough precision to keep centimeter-scale thresholds stable indoors;
- orientation defined by tests, not manual face rotation;
- GPU-ready delivery without rendering six depth passes on first navigation;
  and
- a manifest entry containing dimensions, encoding, near, far, and checksum.

Do not silently accept depth with different near/far values. Validate it while
loading and fail with the node id and asset URL.

Retain runtime capture as a fallback for procedural and inline proxy meshes.

## Stage 2: replace binary visibility with confidence-weighted blending

The current `sourceVisibility()` returns exactly zero or one. Replace it with a
confidence value that is stable near depth discontinuities.

### Filter depth conservatively

Evaluate a small directional neighborhood around the cubemap lookup. The
filter must avoid treating a rear surface as visible merely because one sample
crossed an occluder edge.

Implement and compare:

- nearest depth, retained as the baseline;
- a conservative minimum-depth neighborhood; and
- a small percentage-closer-filtered visibility result.

Use the smallest sample count that removes edge chatter on physical phones.
Do not enable expensive filtering for static skysphere materials that have
source visibility disabled.

### Use an adaptive depth tolerance

Replace the single global bias with a bounded tolerance derived from:

- a small constant world-space bias;
- depth texel footprint at the fragment distance; and
- optionally the angle between the source ray and proxy surface normal.

Expose conservative defaults in code, not tour JSON initially. A tuning knob
that every content author must adjust is a pipeline failure.

### Blend valid evidence instead of copying colors

Compute a confidence for A and B, then normalize the weighted contribution:

```text
weightA = (1 - handoff) * confidenceA
weightB = handoff * confidenceB
color   = (weightA * colorA + weightB * colorB) / (weightA + weightB)
```

Handle the zero-weight case explicitly; never allow a divide-by-zero or NaN.
When only one source has strong confidence, use that source. When both are
valid, use the handoff curve. When neither is valid, mark the pixel for bridge
coverage rather than sampling a known-invalid panorama.

Apply the same source confidence after compositing each source's transparent
variant layer. A selected sofa finish must never detach from its base
panorama.

### Keep the blend curve configurable in code

Retain the present 0.42-0.58 handoff as the baseline. Compare it with wider
curves only after confidence-weighted blending works. Judge the curve on:

- double exposure;
- midpoint pop;
- stability at furniture silhouettes; and
- consistency in both directions.

Do not tune the global curve independently for every reference link. Per-link
override is a last resort and should be recorded as asset debt.

## Stage 3: add a lightmapped bridge for true disocclusion

No depth test can recover a surface absent from both panoramas. Add an optional
visual mesh rendered only while the camera is away from a capture point.

### Bridge asset

Export a medium-detail GLB with:

- stable UVs;
- baked diffuse/global illumination;
- base-color detail needed during motion;
- alpha-tested geometry only where it materially affects silhouettes;
- compressed geometry and GPU-ready textures; and
- no runtime lights.

Start with an unlit baked material. Reflections and glass do not need to match
the stationary panorama perfectly during a short transition, but geometry and
exposure must not jump.

The bridge mesh and transition visibility mesh may share geometry during the
prototype. Keep their contracts separate so either can be optimized later.

### Composite policy

Render panoramas at full strength at both endpoints. Bring bridge coverage in
only after leaving the source node and remove it before settling at the
destination. Prefer per-fragment coverage based on panorama confidence; use a
whole-frame bridge crossfade only for the initial prototype.

Suggested prototype windows:

```text
0.00-0.12  source panorama settles to panorama + bridge
0.12-0.42  source-dominant projective view with bridge filling gaps
0.42-0.58  confidence-weighted A/B handoff with bridge filling gaps
0.58-0.88  destination-dominant projective view with bridge filling gaps
0.88-1.00  bridge settles out to the destination panorama
```

Avoid transparent double-rendering of the same proxy surfaces where possible.
Test depth-write order explicitly; the bridge must fill missing evidence, not
wash the whole scene with a second image.

### Fallback hierarchy

Use this order:

1. projective walk with valid panorama confidence;
2. bridge mesh for pixels with insufficient panorama confidence;
3. skysphere for exterior/background rays; and
4. full-frame `fade` only when required assets or coverage are unavailable.

Emit a development warning when a walk transition spends a meaningful portion
of the frame at step 4. Include the source and destination node ids.

## Stage 4: improve camera paths

The current straight interpolation can pass through furniture or clip a
doorway even when image projection is correct.

Add optional authored waypoints to node links while preserving straight-line
movement as the default. Requirements:

- endpoints are always the exact capture positions;
- speed is approximately constant in world space;
- the path stays at an authored eye height unless stairs explicitly change it;
- author mode displays and drags waypoints;
- a clearance check reports intersections with structural proxy geometry; and
- reversing a link can either reverse the same path or use an explicitly
  authored reverse path.

Use an arc-length-parameterized curve rather than applying easing directly to
the curve parameter. Apply start/end easing to traveled distance.

Do not automatically rotate the viewer's look direction during a normal walk.
If guided camera orientation is added later, make it an explicit link option
and respect active user input.

## Stage 5: align exposure and color

Same-source renders should use identical color management, but imported or
photographed panoramas will not. Add optional per-node exposure and color
correction after geometry is stable.

The asset compiler should calculate a suggested exposure offset from shared
visible regions. Store explicit values in the config so output is deterministic.
Never run an unpredictable automatic exposure adjustment during navigation.

Apply correction to the base panorama and its variant layers before A/B
blending.

## Code map and change order

Implement in this order to keep reviews small:

1. `tests/e2e/` and author-mode diagnostics: deterministic transition progress,
   frame capture, and debug views.
2. `packages/core/src/config/schema.ts`: optional visibility, depth, bridge,
   and path fields with backward-compatible defaults.
3. `packages/core/src/engine/AssetManager.ts`: load, cache, preupload, evict,
   abort, and dispose new assets.
4. `assets-pipeline/scripts/`: generate visibility mesh, offline radial depth,
   bridge GLB, manifests, and checksums.
5. `packages/core/src/rendering/PanoramaVisibilityMap.ts`: choose precomputed
   depth, visibility mesh capture, or interaction-proxy fallback.
6. `packages/core/src/rendering/PanoramaMaterial.ts`: debug outputs, filtered
   confidence, normalized A/B weights, and bridge-coverage mask.
7. `packages/core/src/navigation/NavigationManager.ts`: asset readiness,
   authored path evaluation, bridge lifecycle, and atomic promotion.
8. `packages/core/src/engine/TourEngine.ts`: bridge scene integration and
   diagnostics wiring.
9. `packages/core/src/engine/VariantManager.ts`: verify confidence, promotion,
   and disposal stay synchronized.
10. `packages/core/src/author/AuthorMode.ts`: path editing and coverage review.

Do not combine the asset contract, shader rewrite, path system, and editor UI
in one change.

## Automated tests

### Unit tests

Add coverage for:

- offline depth metadata validation;
- pack/unpack precision at near, room-scale, and far distances;
- confidence monotonicity around the stored depth;
- adaptive tolerance bounds;
- normalized blend weights for A-only, B-only, both, and neither;
- absence of NaN/Infinity for all blend inputs;
- exact endpoints and approximate constant speed for authored paths;
- reverse-path behavior;
- atomic promotion of panorama, depth, variant layers, and bridge state;
- aborted loads and disposal during every preparation phase; and
- cache eviction retaining only the current node and immediate targets.

The existing TypeScript tests do not execute GLSL. Keep CPU reference
functions for the important depth/confidence math and add browser tests that
compile and render the real shader.

### Visual browser tests

For every reference-tour edge in both directions:

- capture the fixed normalized progress values from Stage 0;
- keep settled-node snapshots separate from transition snapshots;
- capture at least one mobile viewport;
- exercise a non-default material variant through a transition;
- assert there are no WebGL errors or failed asset requests; and
- attach debug-view frames when a visual comparison fails.

Do not approve snapshot updates from a numeric diff alone. Inspect transition
sequences as a flipbook or video because motion can reveal stable-image errors.

### Performance tests

Extend `tests/e2e/performance.spec.ts` to record:

- preparation duration before `transitionstart`;
- transition frame time and dropped frames;
- depth/bridge GPU upload timing;
- renderer texture and geometry counts before and after navigation; and
- cleanup after repeated bidirectional transitions.

Keep the existing desktop budget and establish a physical mid-range Android
budget before making hybrid walk the default. A quality fix that causes
unbounded memory or repeated sub-30 fps motion is not complete.

## Manual acceptance gate

Before merging the final transition implementation:

- [ ] Run every configured edge in both directions on desktop Chrome, Safari,
      and Firefox.
- [ ] Run the complete route on a physical mid-range Android phone and a
      current iPhone.
- [ ] Inspect frozen frames at 0.42, 0.50, and 0.58 with A/B visibility debug
      views.
- [ ] Confirm large occluders do not appear on rear walls or floors.
- [ ] Confirm no rejected-both holes expose the clear color inside the room.
- [ ] Confirm furniture silhouettes do not chatter or visibly swim.
- [ ] Confirm the first and last settled frames match the source panoramas.
- [ ] Confirm selected material variants remain aligned and promote atomically.
- [ ] Confirm no texture decode, shader compile, or GPU upload occurs after
      `transitionstart`.
- [ ] Repeat the route until caches cycle and confirm memory reaches a stable
      plateau.
- [ ] Regenerate the transition video and inspect it at normal speed and 0.25x.
- [ ] Keep `fade` working for a deliberately sparse-proxy fixture.

## Definition of done

Transition quality is complete for the first production milestone when:

1. the deterministic visual suite covers all reference edges in both
   directions;
2. the interaction proxy is no longer the only available visibility source;
3. depth decisions are stable and confidence-weighted rather than binary;
4. true disocclusions have bridge coverage or an explicit fade policy;
5. authored paths can avoid obstacles without changing endpoint alignment;
6. the physical-device performance and memory budgets pass;
7. stationary panorama quality and configurable layers have no regression;
   and
8. a side-by-side review against an equivalent krpano depthmap tour prefers
   MeshTour's transition on the target archviz scenes.

Do not call the work complete based only on the Italian Flat living-to-lounge
direction. The acceptance unit is the directed transition matrix across
multiple scenes, proxies, distances, and devices.
