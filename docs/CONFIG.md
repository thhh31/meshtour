# MeshTour config format (v1)

The tour config is the public contract of MeshTour: a single JSON document that fully describes a tour. It is validated with [zod](https://zod.dev) — the schema ships in `@meshtour/core` as `tourConfigSchema`, and `validateConfig(data)` returns a typed, defaults-applied `TourConfig` or throws a readable `ConfigError`.

Design rule: the future visual editor's only job will be producing this file. Anything the editor needs must be expressible here.

## Coordinate system

Right-handed, **Y-up**, **meters** (three.js convention). Blender exports are Z-up; see [BLENDER.md](../assets-pipeline/BLENDER.md) for the conversion.

Yaw/pitch are radians. Yaw 0 looks toward −Z, positive yaw turns left (counter-clockwise from above). Positive pitch looks up.

## Full example

```jsonc
{
  "version": 1,
  "name": "Demo Apartment",
  "units": "meters",
  "assets": {
    "mesh": { "url": "mesh/apartment.glb", "draco": true },
    "visibilityMesh": { "url": "mesh/transition-visibility.glb", "draco": true },
    "bridge": { "url": "mesh/transition-bridge.glb", "draco": true },
    "dollhouse": { "url": "mesh/dollhouse.glb", "draco": true },
    "basePath": "https://cdn.example.com/tours/apartment/",
  },
  "rendering": {
    "previewSuffix": "_1k.jpg",
    "fullSuffix": "_8k.ktx2",
    "background": "#0b0b0e",
  },
  "interactables": {
    "namePrefix": "int_",
    "highlight": { "color": "#ffffff", "opacity": 0.12 },
  },
  "spatial": {
    "overview": {
      "bounds": { "min": [0, -8], "max": [6, 0] },
      "floorY": 0,
      "ceiling": {
        "y": 2.7,
        "bounds": { "min": [0, -8], "max": [6, 0] },
      },
    },
    "measurements": [
      {
        "id": "apartment",
        "label": "Apartment",
        "bounds": { "min": [0, 0, -8], "max": [6, 2.7, 0] },
        "axes": ["width", "depth"],
        "defaultVisible": true,
      },
      { "id": "sofa", "label": "Sofa", "target": "int_sofa" },
    ],
  },
  "configurables": [
    {
      "id": "sofa-finish",
      "label": "Sofa finish",
      "interactable": "sofa",
      "default": "original",
      "variants": [
        { "id": "original", "label": "Original" },
        {
          "id": "cream",
          "label": "Cream",
          "layers": {
            "living_room": "layers/sofa/cream/living_room.ktx2",
            "kitchen": "layers/sofa/cream/kitchen.ktx2",
          },
        },
      ],
    },
  ],
  "links": [
    { "to": "living_room", "position": [2.1, 0.02, -3.4], "hideAtTarget": true },
    { "to": "kitchen", "position": [3.8, 0.02, -2.2], "hideAtTarget": false },
  ],
  "nodes": [
    {
      "id": "living_room",
      "name": "Living Room",
      "position": [2.1, 1.6, -3.4],
      "panorama": {
        "url": "pano/living_room",
        "yaw": 1.5708,
        "correction": { "exposure": -0.15, "color": [1.0, 0.99, 0.97] },
      },
      "depth": {
        "url": "depth/living-room.ktx2",
        "encoding": "rgba8-linear-radial",
        "size": 256,
        "near": 0.025,
        "far": 200,
        "checksum": "sha256:…",
      },
      "links": [
        {
          "to": "kitchen",
          "position": [3.8, 0.02, -2.2],
          "path": { "waypoints": [[3.4, 1.6, -2.8]], "reversible": true },
        },
      ],
      "initialView": { "yaw": 0.4, "pitch": -0.05 },
    },
    {
      "id": "kitchen",
      "name": "Kitchen",
      "position": [5.0, 1.6, -1.0],
      "panorama": { "url": "pano/kitchen" },
      "links": [{ "to": "living_room", "position": [4.2, 0.02, -1.8] }],
    },
  ],
  "hotspots": [
    {
      "id": "hs_sofa",
      "node": "living_room",
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

## Reference

### Root

| Field           | Type       | Required | Notes                                                     |
| --------------- | ---------- | -------- | --------------------------------------------------------- |
| `version`       | `1`        | ✅       | Schema version. Frozen for v1.                            |
| `name`          | string     | –        | Display name.                                             |
| `units`         | `"meters"` | –        | Reserved; only meters in v1.                              |
| `assets`        | object     | –        | See below.                                                |
| `rendering`     | object     | –        | See below.                                                |
| `interactables` | object     | –        | See below.                                                |
| `spatial`       | object     | –        | Automatic plan/top view and measurement metadata.         |
| `configurables` | object[]   | –        | Selectable panorama layers for proxy interactables.       |
| `guides`        | Guide[]    | –        | Interactive, authored property stories.                   |
| `links`         | Link[]     | –        | Shared navigation markers visible from every viewpoint.   |
| `nodes`         | Node[]     | ✅ (≥1)  | Viewpoints. Ids must be unique.                           |
| `hotspots`      | Hotspot[]  | –        | Shared and location-specific points of interest.          |
| `start`         | string     | –        | Starting node id; defaults to the first node. Must exist. |

### `assets`

| Field                  | Type    | Default | Notes                                                                                                                                                    |
| ---------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesh.url`             | string  | –       | Interaction/render proxy mesh glTF/GLB. Optional **only** when the host passes a `proxyMesh` object to the engine.                                       |
| `mesh.draco`           | boolean | `false` | Whether the glTF is Draco-compressed.                                                                                                                    |
| `visibilityMesh.url`   | string  | –       | Optional higher-detail geometry used only for transition radial-depth capture. It is never added to interaction picking or the main scene.               |
| `visibilityMesh.draco` | boolean | `false` | Whether the transition-visibility GLB is Draco-compressed.                                                                                               |
| `bridge.url`           | string  | –       | Optional baked, unlit GLB shown behind rejected panorama fragments during a walk.                                                                        |
| `bridge.draco`         | boolean | `false` | Whether the bridge GLB is Draco-compressed.                                                                                                              |
| `dollhouse.url`        | string  | –       | Optional pre-textured dollhouse GLB. When omitted, the interaction proxy is combined with up to four spatially distributed panorama previews.            |
| `dollhouse.draco`      | boolean | `false` | Whether the dedicated dollhouse GLB is Draco-compressed.                                                                                                 |
| `basePath`             | string  | –       | All relative URLs in the config resolve against this, so a tour folder is relocatable. Absolute (`https:`, `/…`), `blob:` and `data:` URLs pass through. |

### `rendering`

| Field           | Type                 | Default     | Notes                                                                                                                                                                                                                           |
| --------------- | -------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `previewSuffix` | string               | –           | Appended to `panorama.url` for the low-res image loaded first (e.g. `"_1k.jpg"`).                                                                                                                                               |
| `fullSuffix`    | string               | –           | Appended for the full-res image (e.g. `"_8k.ktx2"`). Two distinct suffixes enable progressive loading. If only one suffix is present, it is the sole quality; if neither is present, `panorama.url` is loaded as-is.            |
| `background`    | string               | `"#0b0b0e"` | Clear color / fallback.                                                                                                                                                                                                         |
| `transition`    | `"walk"` \| `"fade"` | `"walk"`    | `walk` reprojects panoramas during camera travel and uses a krpano-style half-second texture blend around the midpoint; `fade` hides travel between two clean, stationary views and is safer for sparse or approximate proxies. |

### `interactables`

| Field               | Type       | Default     | Notes                                                                                                               |
| ------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `namePrefix`        | string     | `"int_"`    | Proxy meshes named `int_table_01` resolve to interactable id `table_01`. The prefix may also sit on a parent group. |
| `highlight.color`   | string     | `"#ffffff"` | Hover highlight tint.                                                                                               |
| `highlight.opacity` | number 0–1 | `0.12`      | Hover highlight strength. Set to `0` to keep picking/click events without drawing a highlight.                      |

### `configurables`

A configurable replaces one interactable's appearance with transparent,
panorama-aligned image layers. This keeps offline-rendered lighting and remains
aligned during MeshTour's walking transition.

| Field          | Type   | Required | Notes                                                                        |
| -------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `id`           | string | ✅       | Public id used by `engine.setVariant(id, variantId)`.                        |
| `label`        | string | –        | Optional host-UI label.                                                      |
| `interactable` | string | ✅       | Target after removing `interactables.namePrefix`; `int_sofa` becomes `sofa`. |
| `default`      | string | ✅       | Initial variant id. It must exist in `variants`.                             |
| `variants`     | array  | ✅ (≥1)  | Available appearances; ids must be unique within this configurable.          |

Each variant has an `id`, optional `label`, optional CSS-color `swatch`, and a
`layers` object mapping node ids to image URLs. Empty `layers` displays the
original panorama. A missing node also falls back to the original appearance,
so provide a layer for every node from which the target is visible.

Layer requirements:

- Equirectangular RGBA image rendered from exactly the same camera position,
  orientation, exposure, aspect ratio, and color management as the node.
- Transparent everywhere except the configurable object.
- Same object geometry and silhouette as the proxy target.
- PNG/WebP works directly. KTX2 is recommended for production; vertically flip
  its source before encoding, just like a KTX2 panorama.

```ts
await engine.setVariant("sofa-finish", "cream");
console.log(engine.getVariant("sofa-finish")); // "cream"
engine.on("variantchange", ({ configurableId, variantId }) => {
  // Synchronize the host UI, URL, saved design, or quotation.
});
```

Use `engine.setVariants({ ... })` when a package changes several appearances.
All required layers are loaded and preuploaded before one atomic visual commit.

### `configurator`

The optional configurator is a buyer-facing product model above the low-level
rendering bindings in `configurables`. Prices are integer minor currency units;
`840000` means €8,400 when `currency` is `EUR`.

```jsonc
{
  "configurator": {
    "catalogVersion": "development-a-2026-08",
    "currency": "EUR",
    "basePriceMinor": 48500000,
    "groups": [
      {
        "id": "flooring",
        "label": "Flooring",
        "default": "standard",
        "options": [
          {
            "id": "standard",
            "label": "Developer standard",
            "sku": "FLR-STD",
            "variants": { "floor-finish": "original" },
          },
          {
            "id": "oak",
            "label": "Natural oak",
            "sku": "FLR-OAK",
            "priceDeltaMinor": 840000,
            "availability": "available",
            "variants": { "floor-finish": "natural-oak" },
            "requires": [{ "groupId": "kitchen", "optionIds": ["walnut"] }],
          },
        ],
      },
    ],
    "presets": [
      {
        "id": "warm",
        "label": "Warm Contemporary",
        "selections": { "flooring": "oak", "kitchen": "walnut" },
      },
    ],
  },
}
```

Options support labels, descriptions, SKUs, swatches, thumbnails, product
metadata, `available`/`on-request`/`unavailable` status, price deltas, visual
variant mappings, and data-only `requires`/`excludes` constraints. Presets may
be partial; omitted groups use their configured defaults.

The core controller validates complete states and exposes:

```ts
await engine.selectConfigurationOption("flooring", "oak");
await engine.applyConfigurationPreset("warm");
const shareValue = engine.serializeConfiguration();
await engine.restoreSerializedConfiguration(shareValue);
const quote = engine.requestConfiguration(); // also emits configurationrequest
```

`configurationstatechange` fires for applying, ready, and error states. Quote
payloads contain catalog revision, selections, selected preset, totals, and
SKU-level line items. A commerce backend must re-resolve price and availability
instead of trusting browser or URL values.

### `guides`

Guides are opt-in property stories layered over normal free exploration. A
chapter can reproduce a panorama, dollhouse, or top-view camera; set configured
measurements and finishes; and present concise plain-text sales copy. Visitors
may navigate away at any time and resume the current chapter.

```jsonc
{
  "guides": [
    {
      "id": "highlights",
      "title": "Property highlights",
      "description": "A short spatial introduction.",
      "autoplay": { "stepDurationMs": 8000 },
      "cta": { "id": "book", "label": "Book a viewing", "href": "/contact" },
      "steps": [
        {
          "id": "layout",
          "title": "A connected plan",
          "body": "See how the living spaces relate.",
          "view": {
            "mode": "dollhouse",
            "node": "living_room",
            "position": [8, 7, 8],
            "target": [2, 1, -3],
            "fov": 45,
          },
          "measurementsVisible": false,
          "variants": { "sofa-finish": "cream" },
        },
        {
          "id": "living",
          "title": "Room to gather",
          "view": {
            "mode": "panorama",
            "node": "living_room",
            "yaw": 0.4,
            "pitch": -0.05,
          },
        },
        {
          "id": "dimensions",
          "title": "Verify the footprint",
          "view": { "mode": "top", "center": [2, -3], "zoom": 1 },
          "measurementsVisible": true,
        },
      ],
    },
  ],
}
```

Guide and step ids must be unique. Panorama and dollhouse `node` values must
exist. Dollhouse snapshots use world-space `position` and `target`; top views
use world X/Z `center` and zoom `0.65..5`. `variants` maps configurable ids to
valid variant ids. Step `durationMs` overrides the guide autoplay dwell and must
be between 3000 and 120000 ms. Autoplay is never started without a visitor
pressing Play.

The core API exposes `startGuide`, `stopGuide`, chapter navigation,
play/pause/resume, `captureViewSnapshot`, and `applyViewSnapshot`. Guide events
cover start, step changes, exploration, autoplay, completion, exit, CTA action,
and errors so a host can connect its own analytics or CRM without SDK storage.

### `spatial`

Spatial metadata is optional. When present, the core engine can generate a
plan directly from the proxy, switch to a textured orthographic top view, add
a missing fallback ceiling, and display accurate architectural/object
dimensions. The same feature works for apartments, showrooms, products, and
other metric proxy scenes.

| Field                   | Type                       | Default      | Notes                                                                                                                                           |
| ----------------------- | -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview.bounds`       | `{ min:[x,z], max:[x,z] }` | proxy bounds | Stable plan/top-view crop.                                                                                                                      |
| `overview.floorY`       | number                     | `0`          | Reference floor elevation.                                                                                                                      |
| `overview.ceiling`      | object                     | –            | Fallback slab with `y`, optional `thickness` (`0.08`), and X/Z `bounds`; skipped if a ceiling exists.                                           |
| `overview.topView`      | object                     | –            | Baked orthographic image with `url`, optional X/Z `bounds`, and optional `dollhouseProjection` (`false`); replaces projective 3D top rendering. |
| `overview.hiddenMeshes` | string[]                   | `[]`         | Exact proxy names hidden from plan/top view.                                                                                                    |
| `measurementColor`      | CSS color                  | `#ffffff`    | Measured-geometry outline color.                                                                                                                |
| `measurements`          | Measurement[]              | `[]`         | Authored architectural bounds and/or automatic named-object bounds.                                                                             |

Each measurement requires an `id`, `label`, and either an exact proxy
`target` name or explicit `{ min:[x,y,z], max:[x,y,z] }` bounds. `axes` may
contain `width` (X), `depth` (Z), and `height` (Y). `defaultVisible` keeps an
overall measurement visible while clicking an interactable selects its detail
measurement. A per-measurement `color` overrides `measurementColor`, and
`alwaysOnTop: true` keeps important architectural outlines visible through
scene geometry. Explicit bounds are recommended for architecture and rotated
or irregular objects; named targets use their automatic world-aligned bounds.

For production-quality top mode, render the furnished source scene with an
orthographic camera directly above the space and configure it as
`overview.topView`. The full image is aligned to `topView.bounds` (or
`overview.bounds` when omitted), so navigation and measurement overlays remain
in the same world coordinate system. If no image is configured or loading
fails, MeshTour falls back to the projective 3D overview.

Set `topView.dollhouseProjection: true` only when the same image should fill
uncovered upward-facing dollhouse surfaces. It is disabled by default because
orthographic projection can visibly bend across non-planar proxy geometry.

Top mode displays navigation links from every location. Selecting one returns
to panorama mode and travels to that link's target node.

```ts
engine.setMeasurementsVisible(true);
engine.setMeasurementTarget("sofa");
engine.setViewMode("top");
engine.setViewMode("dollhouse");
engine.renderPlan(document.querySelector("canvas")!);
```

### Node

| Field          | Type              | Required | Notes                                                                                                       |
| -------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `id`           | string            | ✅       | Unique.                                                                                                     |
| `name`         | string            | –        | Display name.                                                                                               |
| `position`     | [x, y, z]         | ✅       | **Capture position** of the panorama, Y-up meters. Eye height is typically ~1.6.                            |
| `panorama.url` | string            | ✅       | Stem or full URL (see `rendering` suffixes).                                                                |
| `panorama.yaw` | number            | `0`      | Per-panorama yaw alignment in radians — export imprecision is real; author mode has nudge buttons for this. |
| `links`        | Link[]            | `[]`     | Navigation markers unique to this viewpoint.                                                                |
| `initialView`  | `{ yaw, pitch? }` | –        | Camera orientation applied when the tour starts at this node.                                               |

Each panorama may define a deterministic `correction` with an `exposure`
offset in stops and a linear-RGB `color` multiplier. The correction applies to
the base panorama and its transparent variant layers before A/B blending.

A node may also reference a precomputed radial-depth KTX2 cubemap:

- `encoding` is currently `"rgba8-linear-radial"`;
- `near` and `far` must exactly match the runtime values (`0.025` and `200`
  meters), otherwise loading fails with the node id and URL;
- `size` records one cubemap-face dimension; and
- `checksum` records the compiler-produced content checksum.

When `depth` is absent, MeshTour captures the same packed radial depth at
runtime from `assets.visibilityMesh`, or from `assets.mesh` as the final
backward-compatible fallback.

### Authored transition paths

A node-specific link may include `path.waypoints`, expressed as world-space
camera positions. Shared top-level links cannot define a path because they
have no single source capture. MeshTour always inserts the source and
destination capture positions as exact endpoints and samples the resulting
centripetal spline by arc length. Set
`reversible: false` to prevent an otherwise pathless opposite edge from reusing
the waypoints in reverse; an explicit path on the opposite link always wins.
The author overlay displays draggable waypoint handles, preserves their eye
height while dragging, and reports proxy intersections with **Check path
clearance**.

### Link

Links carry **their own floor positions** — they are authored, never
auto-derived. Put links in the top-level `links` array when they should be
shared by every viewpoint. Use `nodes[].links` only for navigation markers
unique to one location.

| Field          | Type      | Required | Notes                                                                                              |
| -------------- | --------- | -------- | -------------------------------------------------------------------------------------------------- |
| `to`           | string    | ✅       | Target node id. Must exist.                                                                        |
| `position`     | [x, y, z] | ✅       | Floor disc placement (y slightly above the floor).                                                 |
| `hideAtTarget` | boolean   | `true`   | For a shared link, hide its marker while `to` is the current node. Set `false` to keep it visible. |
| `path`         | object    | –        | Optional `{ waypoints, reversible? }` camera path described above.                                 |

### Hotspot

Keep shared hotspots in this single top-level list without a `node`. Add a
`node` only when the hotspot is unique to one location. This avoids duplicating
the same physical hotspot for every panorama that can see it.

| Field           | Type                                      | Required | Notes                                                                                |
| --------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `id`            | string                                    | ✅       | Unique handle, used in events.                                                       |
| `node`          | string                                    | –        | Owning node; omit for a shared hotspot visible from every location.                  |
| `position`      | [x, y, z]                                 | ✅       | 3D anchor. Hotspots are occlusion-tested against the proxy mesh.                     |
| `type`          | `"info" \| "image" \| "link" \| "custom"` | `"info"` | Open enum.                                                                           |
| `title`, `body` | string                                    | –        | Popup content.                                                                       |
| `href`          | string                                    | –        | For `type: "link"`: opened in a new tab by the default popup layer.                  |
| `media.image`   | string                                    | –        | Popup image URL.                                                                     |
| `payload`       | anything                                  | –        | For `type: "custom"`: passed to the host app untouched via the `hotspotclick` event. |

## Validation guarantees

`validateConfig` rejects: unknown `version`, empty `nodes`, duplicate node,
hotspot, configurable, measurement, variant, guide, or guide-step ids; invalid spatial bounds;
missing configurable defaults; and
`start`/top-level or node-specific link targets/`hotspots[].node`/variant-layer
or guide references to nonexistent nodes/configurables/variants. Defaults shown
above are applied on parse.

## Stability

The v1 schema is **append-only**: future releases may add optional fields but will not change the meaning of existing ones. A `version: 2` would only ship with a published migration.
