# Stage 1 Build Plan: Open-Source Mesh-Backed Virtual Tour Library

Working name used throughout this document: **MeshTour** (rename freely; keep it short, npm-available, and searchable).

---

## 1. What we are building and why

MeshTour is an open-source TypeScript library (MIT license) for building photorealistic virtual tours on the web. Its core technique is a **hybrid of two layers rendered together**:

1. An **invisible low-poly 3D proxy mesh** of the space (exported from the same 3D model the renders came from). It is never displayed, but it receives raycasts and drives all interaction and camera logic.
2. **High-quality equirectangular panorama images** rendered (or photographed) from known positions inside that space. These provide the visuals.

When a panorama is displayed from exactly the position it was captured at, and the proxy mesh is aligned to the same coordinate system, the user appears to be inside a beautifully rendered 3D scene — but the page is only displaying an image. Because real geometry sits behind the image, the library can do things flat panorama viewers (Pannellum, Marzipano, krpano, Kuula) cannot:

- The cursor knows what object it is over: hovering a table, wall, or apartment unit can highlight it, change the cursor, or show a tooltip.
- Hotspots are **occlusion-aware**: a hotspot behind a wall is hidden, exactly as it should be.
- Navigation between viewpoints can move the camera **through real 3D space** while re-projecting panoramas onto the mesh, producing a parallax-correct walking transition instead of the crude crossfade/zoom every panorama viewer uses. This transition is the signature feature and the centerpiece of every demo.

The closest commercial analogue is Matterport (which uses the same proxy-mesh-plus-panoramas idea internally), but Matterport is a closed SaaS that requires scanning a physical space. MeshTour's primary v1 workflow is **"same-source"**: both the panoramas and the proxy mesh are exported from one 3D model (Blender, 3ds Max, etc.), so alignment is exact and free. This makes MeshTour uniquely suited to **pre-construction real estate and archviz** — spaces that do not physically exist yet and therefore cannot be scanned.

### Goals (v1)

- A production-quality embeddable viewer: load a JSON tour config, render panoramas over a proxy mesh, navigate between viewpoints with the parallax transition.
- Object-aware cursor interaction (raycast hover + highlight) and occlusion-aware hotspots.
- A clean, documented JSON config format — this is the public contract everything else (including a future visual editor) builds on.
- React-first API with a framework-agnostic core.
- A built-in author/debug mode for placing hotspots and links by clicking in the scene.
- One gorgeous public demo (a furnished apartment) plus a documented Blender export workflow.

### Non-goals (v1) — explicitly out of scope

- A hosted visual editor or any backend/SaaS component (that is Stage 2).
- WebXR / headset VR support.
- Calibration tooling for _photographed_ panoramas of real spaces (manual alignment is hard; v1 supports same-source workflows only — though nothing in the config format forbids photo workflows if the user supplies correct positions themselves).
- Dollhouse view, minimaps, floor plans, multi-floor UI, measurements. Keep the v1 surface small.

---

## 2. Core concepts and terminology

Use these terms consistently in code, config, and docs.

| Term             | Meaning                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tour**         | The whole experience: one config file, one proxy mesh set, many nodes.                                                                                 |
| **Node**         | A viewpoint: a position in 3D space with one panorama captured from it. The user "stands" at a node.                                                   |
| **Panorama**     | An equirectangular (2:1) image associated with a node, plus the yaw offset needed to align it with the world.                                          |
| **Proxy mesh**   | The invisible, simplified 3D geometry of the space (glTF). Used for raycasting, occlusion, transitions. Never rendered visibly (except in debug mode). |
| **Interactable** | A named object (or named mesh group) inside the proxy mesh that responds to hover/click — e.g. `table_01`, `unit_3B`.                                  |
| **Hotspot**      | An authored point of interest anchored to a 3D position: info popup, image, link, or custom payload.                                                   |
| **Link**         | A navigation connection from one node to another, rendered as a floor arrow/disc; clicking it triggers the transition.                                 |
| **Transition**   | The animated camera move from node A to node B with dual panorama projection and crossfade.                                                            |

Coordinate system: **right-handed, Y-up, meters** (three.js convention). The Blender export guide handles the Z-up → Y-up conversion.

---

## 3. Architecture

A pnpm monorepo with two published packages and supporting apps:

```
meshtour/
├── packages/
│   ├── core/          # @meshtour/core — framework-agnostic engine (three.js peer dep)
│   └── react/         # @meshtour/react — React components wrapping core
├── apps/
│   ├── demo/          # The public demo apartment (Vite + React), deployed to the author's site
├── assets-pipeline/   # Blender export guide + (stretch) export script
└── docs/              # README-driven at first; docs site later
```

**Why core + react instead of building directly on react-three-fiber:** the target audience skews React, but a framework-agnostic core (a) lets vanilla JS / Vue / Svelte users adopt it, widening the funnel, (b) keeps the rendering loop and shader logic out of React's reconciliation, which matters for transition performance, and (c) makes the React layer thin and easy to maintain. R3F users can still mount the core inside an R3F scene later; do not block on that for v1.

### 3.1 `@meshtour/core` responsibilities

- **TourEngine**: owns the three.js renderer/scene/camera, the load lifecycle, and the state machine (`idle → loading → ready → transitioning`).
- **ConfigLoader**: fetches and validates the JSON config (use `zod` for schema validation; ship the schema so the future editor reuses it).
- **AssetManager**: loads the proxy mesh (glTF + Draco) and panorama textures with a priority queue: current node first at preview resolution, then full resolution, then neighbor nodes in the background.
- **PanoramaMaterial**: the custom shader (see §4) that projects equirectangular textures onto the proxy mesh from arbitrary world positions, supporting two simultaneous projections for transitions.
- **InteractionManager**: pointer raycasting against the proxy mesh, hover state for interactables, occlusion tests for hotspots, cursor reticle.
- **NavigationManager**: link arrows, transition orchestration (camera path, projection blend, easing).
- **AuthorMode**: optional debug overlay (see §7).
- **Events**: a typed event emitter — `nodechange`, `hotspotclick`, `interactablehover`, `loadprogress`, `ready`, `error`.

### 3.2 `@meshtour/react` responsibilities

Thin wrappers only; no engine logic:

```tsx
import { Tour } from "@meshtour/react";

<Tour
  config="/tours/apartment.json"      // URL or inline object
  initialNode="living_room"
  onNodeChange={(id) => …}
  onHotspotClick={(hotspot) => …}
  authorMode={false}
/>
```

Plus a `useTour()` hook exposing the imperative API: `goToNode(id)`, `lookAt(target)`, `getCurrentNode()`, `setHotspotsVisible(bool)`. Custom hotspot rendering via a render prop or `hotspotRenderer` so users can supply their own React UI for popups.

---

## 4. Rendering and the transition shader (build this first)

This is the highest-risk, highest-value piece. **Week 1 is a standalone spike proving it.**

### 4.1 Static viewing (at a node)

When the camera sits exactly at a node's capture position, the simplest correct rendering is a classic skysphere: a large sphere centered on the camera with the equirect texture, mesh invisible. However, to keep one rendering path, render the **proxy mesh itself** with the projection shader even when static — at the capture position the projection is pixel-identical to a skysphere, and geometry seams stay hidden. A background skysphere can remain as a fallback for rays that miss the proxy mesh (windows, sky, missing geometry).

### 4.2 Projective panorama shader

For every fragment of the proxy mesh, compute the direction from the **panorama's capture position** (not the camera) to the fragment's world position; convert that direction to equirectangular UVs; sample the texture:

```glsl
// fragment, simplified
vec3 dir = normalize(vWorldPosition - uPanoCenterA);
dir = rotateY(dir, uPanoYawA);                  // per-panorama yaw alignment
vec2 uv = vec2(atan(dir.z, dir.x) / TWO_PI + 0.5,
               acos(clamp(dir.y, -1.0, 1.0)) / PI);
vec4 colA = texture2D(uPanoA, uv);
// same for B, then:
gl_FragColor = mix(colA, colB, uBlend);
```

The material carries **two** panorama slots (A = departing node, B = arriving node) and a `uBlend` uniform. Static viewing is just `uBlend = 0`.

### 4.3 The transition

On link click: load/ensure node B's texture → set B's center/yaw uniforms → animate over ~1.0–1.4 s with ease-in-out: camera position from A to B along a straight line (v1; path along the mesh floor is a later refinement), `uBlend` 0 → 1, slightly biased so the blend completes around 70–80% of the camera travel (hides the worst reprojection stretching) → on completion, promote B to slot A and return to static state.

### 4.4 Known artifacts and mitigations (document these honestly)

- **Occlusion ghosting**: geometry visible from B but not from A has no valid texels in panorama A; during the blend it shows stretched smears. Mitigations: bias the blend curve toward B early; keep transitions between _adjacent_ nodes with mostly-shared visibility (author guidance); optionally fade a subtle vignette/motion blur during the move. Per-fragment visibility (depth from pano center) is a v2 refinement — note it in the roadmap, do not build it now.
- **Proxy mesh imprecision**: where the low-poly mesh deviates from the rendered geometry, projected texels swim slightly during movement. Mitigation is authoring guidance: keep walls/floors/large furniture reasonably faithful (decimation is fine, deletion of large occluders is not).
- **Seams at equirect poles / UV wrap**: handle the atan wrap with `fwidth`-aware sampling or texture wrap settings; test looking straight up/down.

**Spike exit criteria (end of week 1):** two panoramas + one room mesh; click to move between them; the transition looks convincingly like walking. If it does not, stop and fix this before anything else exists.

---

## 5. Interaction layer

- **Raycasting**: on pointer move, raycast against the proxy mesh (use three-mesh-bvh for performance on larger scenes). Resolve the hit to an interactable by mesh `name` prefix convention (e.g. anything named `int_*` is interactable; `int_table_01` → id `table_01`).
- **Hover highlight**: render the hovered interactable's geometry in an overlay pass with a fresnel/outline material at low opacity. Keep the highlight subtle by default and stylable (color, opacity) via config.
- **Cursor reticle**: a small disc oriented to the hit surface normal, so the cursor visibly "touches" floors/tables. Hide on no-hit.
- **Hotspots**: anchored at 3D positions; each frame (or on camera move, throttled) raycast from camera to hotspot — if the proxy mesh is hit first, the hotspot is occluded → fade it out. Render hotspot markers as billboarded sprites in-canvas; render popup _content_ as positioned HTML (CSS2D-style) so users get real DOM for text/images/buttons.
- **Links**: floor discs/arrows placed in config; same occlusion logic; hover enlarges; click triggers navigation.
- **Camera controls**: yaw/pitch look with pointer drag and touch; clamp pitch (~±85°); inertia; optional FOV zoom on wheel/pinch (clamped 40–95°). No free movement — the camera only leaves a node via transitions.

---

## 6. The JSON config format (the public contract)

Versioned, validated with zod, documented in its own `CONFIG.md`. Design it as if the Stage 2 editor already exists — the editor's only job will be producing this file.

```jsonc
{
  "version": 1,
  "name": "Demo Apartment",
  "units": "meters",
  "assets": {
    "mesh": { "url": "mesh/apartment.glb", "draco": true },
    "basePath": "https://cdn.example.com/tours/apartment/",
  },
  "rendering": {
    "previewSuffix": "_1k.jpg", // low-res loaded first
    "fullSuffix": "_8k.ktx2",
    "background": "#0b0b0e",
  },
  "interactables": {
    "namePrefix": "int_",
    "highlight": { "color": "#ffffff", "opacity": 0.12 },
  },
  "nodes": [
    {
      "id": "living_room",
      "name": "Living Room",
      "position": [2.1, 1.6, -3.4], // capture position, Y-up meters
      "panorama": { "url": "pano/living_room", "yaw": 1.5708 },
      "links": [
        { "to": "kitchen", "position": [3.8, 0.02, -2.2] }, // floor disc placement
      ],
      "initialView": { "yaw": 0.4, "pitch": -0.05 },
    },
    { "id": "kitchen", "...": "..." },
  ],
  "hotspots": [
    {
      "id": "hs_sofa",
      "node": "living_room", // or omit for global
      "position": [1.2, 0.7, -4.9],
      "type": "info",
      "title": "Modular sofa",
      "body": "Upholstery options available…",
      "media": { "image": "img/sofa.jpg" },
    },
  ],
  "start": "living_room",
}
```

Schema decisions worth locking early: panorama `yaw` per node (export imprecision is real); `links` carry their own floor positions (do not auto-derive); hotspot `type` is an open enum (`info | image | link | custom`) with `custom` passing payload to the host app untouched; all URLs resolve against `assets.basePath` so a tour folder is relocatable — which is exactly what makes the future "export a static build" feature trivial.

---

## 7. Author mode (minimal, but non-negotiable)

Without this, placing hotspots means hand-typing coordinates and nobody adopts the library. Scope it tightly:

- Activated via `authorMode: true` (React prop / engine option). Renders an overlay panel in-canvas.
- Toggle proxy mesh visibility (wireframe) to verify alignment.
- Click anywhere → copies the world-space hit position; buttons for "add hotspot here" and "add link-to-current-node here" that append to an in-memory config.
- Drag existing hotspots/links along surfaces to adjust.
- "Copy JSON" / "Download JSON" of the updated config. No persistence, no backend — the user pastes it into their file.
- Display current camera yaw/pitch (for `initialView`) and per-node yaw nudge controls (for fixing panorama alignment), reflected into the JSON.

This is deliberately a _debug tool_, not a product. It also becomes the seed of the Stage 2 editor.

---

## 8. Asset pipeline: the Blender same-source workflow

Ship a step-by-step guide (`assets-pipeline/BLENDER.md`) with screenshots. The promised workflow:

1. **Panoramas**: in the full-quality scene, add cameras at eye height (~1.6 m) at each viewpoint; set camera type Panoramic/Equirectangular; render 8192×4096 (Cycles). Record each camera's location — these become node `position` values (convert Blender Z-up `(x, y, z)` → library Y-up `(x, z, -y)`; the guide includes this table and a tiny helper script).
2. **Proxy mesh**: duplicate the scene; delete tiny clutter; apply Decimate to large objects; aim for **under ~150k triangles total**; rename interactable objects with the `int_` prefix; export glTF (.glb) with Draco compression, +Y up.
3. **Image optimization**: generate a 1024-wide JPEG preview per panorama (`_1k.jpg`) and a full-res **KTX2/Basis** compressed version (`_8k.ktx2`) using `toktx`/`basisu` — KTX2 stays compressed on the GPU, which matters enormously for mobile memory. Provide the exact CLI commands.
4. **Folder convention** matching the config (`mesh/`, `pano/`, `img/`).

Stretch (only if time remains in week 8): a small Blender add-on/script that exports all panorama camera positions directly as a starter `tour.json`.

---

## 9. Performance budget

- First interactive paint of the starting node in **< 2 s on a mid-range phone over 4G**: preview JPEG (~150 KB) + Draco mesh (~1–3 MB) load first; full KTX2 swaps in when ready.
- Background-prefetch panoramas of linked neighbor nodes only (not the whole tour).
- Texture memory cap: keep at most current + neighbors decoded; release others.
- 60 fps during transitions on desktop, 30+ on mobile; the projection shader is cheap (one or two texture samples), so the budget pressure is texture upload — upload full-res textures _before_ starting the transition, never during.
- Bundle: core < 60 kB gzipped excluding three.js (peer dependency).

---

## 10. Repo, tooling, quality bar

TypeScript strict; pnpm workspaces; Vite for apps; tsup (or Vite lib mode) for package builds; Vitest for unit tests (config validation, UV math, event flow) plus Playwright screenshot tests on the bundled tour for visual regressions of the shader; ESLint + Prettier; Changesets for versioning; GitHub Actions CI (typecheck, test, build) with a status badge; MIT license; conventional commits. Issue templates and a `CONTRIBUTING.md` from day one — the repo should look maintained before it is popular.

---

## 11. Milestones (8 weeks, evenings/weekends pace)

**Week 1 — Transition spike.** Throwaway code allowed. Two panoramas, one room mesh, projective shader, animated transition. _Exit: the walk transition looks good in a screen recording._ This gates everything.

**Week 2 — Engine skeleton.** Monorepo scaffolding, TourEngine lifecycle, ConfigLoader + zod schema, AssetManager with preview→full texture swap, static node viewing through the unified shader path, camera look controls. _Exit: a config file loads and renders a multi-node tour without navigation._

**Week 3 — Navigation + transitions in the engine.** Port the spike properly: NavigationManager, link discs, transition state machine, texture pre-upload, neighbor prefetch. _Exit: full walkthrough of a 4+ node tour._

**Week 4 — Interaction.** BVH raycasting, interactable hover highlight, cursor reticle, hotspots with occlusion fade, HTML popup layer, typed events. _Exit: hover a table and it glows; a hotspot hides behind a wall._

**Week 5 — React package + API freeze.** `<Tour>`, `useTour`, custom hotspot rendering, SSR-safety (lazy mount), error/loading states. Write `CONFIG.md`. _Exit: the demo app consumes only the public API; config schema declared v1-frozen._

**Week 6 — Author mode + Blender pipeline.** Debug overlay per §7; write `BLENDER.md` while actually producing the demo apartment assets with it (the guide is tested by using it). _Exit: a hotspot can be placed by clicking, and the demo assets exist._

**Week 7 — The demo + performance pass.** Polished furnished-apartment demo deployed to your personal site: 5–8 nodes, tasteful hotspots, branded loading screen. KTX2 pipeline, memory caps, mobile testing on a real mid-range Android. _Exit: the demo is something you would show a client._

**Week 8 — Docs, tests, launch.** README with the transition GIF up top, live demo link, quickstart (npm install → working tour in 15 lines), feature table vs. Pannellum/Marzipano/Matterport, roadmap (WebXR, photo calibration, per-fragment occlusion, dollhouse). Screenshot tests green, npm publish, then launch: Show HN, r/threejs, r/webdev, Three.js forum, X/Twitter thread led by the transition video, poimandres Discord. _Exit: published, announced, issues template ready for the first bug reports._

---

## 12. Risks and pre-decided responses

- **Transition artifacts unacceptable in the spike** → ship v1 with a high-quality directional crossfade (dolly + blend without full reprojection) and keep reprojection on the roadmap; the mesh interaction features alone still differentiate the library. Decide at the end of week 1, not later.
- **Scope creep toward the editor** → the config format and author mode are the only editor-adjacent work allowed in Stage 1. Anything with a backend is Stage 2 by definition.
- **Demo asset production eats weeks** → acceptable fallbacks: a purchased/CC archviz Blender scene, or (with employer permission only) a stripped-down VisEngine-style scene. Budget demo work into weeks 6–7 explicitly; do not let it slip into the engine weeks.
- **Mobile texture memory crashes (8k equirect)** → KTX2 is mandatory, plus a device heuristic that caps full-res at 4k on constrained GPUs.

## 13. Definition of done

Stage 1 is complete when: the npm packages are published with a frozen v1 config schema; the public demo runs smoothly on desktop and a mid-range phone; a stranger can go from the README to their own working tour using only `CONFIG.md` and `BLENDER.md`; author mode lets them place hotspots without typing coordinates; and the launch posts are live with the transition video. Everything beyond that — editor, hosting, exports, WebXR — is Stage 2 and must not delay this list.
