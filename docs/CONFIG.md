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
  "nodes": [
    {
      "id": "living_room",
      "name": "Living Room",
      "position": [2.1, 1.6, -3.4],
      "panorama": { "url": "pano/living_room", "yaw": 1.5708 },
      "links": [{ "to": "kitchen", "position": [3.8, 0.02, -2.2] }],
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
| `nodes`         | Node[]     | ✅ (≥1)  | Viewpoints. Ids must be unique.                           |
| `hotspots`      | Hotspot[]  | –        | Points of interest.                                       |
| `start`         | string     | –        | Starting node id; defaults to the first node. Must exist. |

### `assets`

| Field        | Type    | Default | Notes                                                                                                                                                    |
| ------------ | ------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mesh.url`   | string  | –       | Proxy mesh glTF/GLB. Optional **only** when the host passes a `proxyMesh` object to the engine.                                                          |
| `mesh.draco` | boolean | `false` | Whether the glTF is Draco-compressed.                                                                                                                    |
| `basePath`   | string  | –       | All relative URLs in the config resolve against this, so a tour folder is relocatable. Absolute (`https:`, `/…`), `blob:` and `data:` URLs pass through. |

### `rendering`

| Field           | Type   | Default     | Notes                                                                                                                     |
| --------------- | ------ | ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| `previewSuffix` | string | –           | Appended to `panorama.url` for the low-res image loaded first (e.g. `"_1k.jpg"`).                                         |
| `fullSuffix`    | string | –           | Appended for the full-res image (e.g. `"_8k.ktx2"`). When both suffixes are absent, `panorama.url` is loaded as-is, once. |
| `background`    | string | `"#0b0b0e"` | Clear color / fallback.                                                                                                   |

### `interactables`

| Field               | Type       | Default     | Notes                                                                                                               |
| ------------------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `namePrefix`        | string     | `"int_"`    | Proxy meshes named `int_table_01` resolve to interactable id `table_01`. The prefix may also sit on a parent group. |
| `highlight.color`   | string     | `"#ffffff"` | Hover highlight tint.                                                                                               |
| `highlight.opacity` | number 0–1 | `0.12`      | Hover highlight strength.                                                                                           |

### Node

| Field          | Type              | Required | Notes                                                                                                       |
| -------------- | ----------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `id`           | string            | ✅       | Unique.                                                                                                     |
| `name`         | string            | –        | Display name.                                                                                               |
| `position`     | [x, y, z]         | ✅       | **Capture position** of the panorama, Y-up meters. Eye height is typically ~1.6.                            |
| `panorama.url` | string            | ✅       | Stem or full URL (see `rendering` suffixes).                                                                |
| `panorama.yaw` | number            | `0`      | Per-panorama yaw alignment in radians — export imprecision is real; author mode has nudge buttons for this. |
| `links`        | Link[]            | `[]`     | Navigation connections.                                                                                     |
| `initialView`  | `{ yaw, pitch? }` | –        | Camera orientation applied when the tour starts at this node.                                               |

### Link

Links carry **their own floor positions** — they are authored, never auto-derived.

| Field      | Type      | Required | Notes                                              |
| ---------- | --------- | -------- | -------------------------------------------------- |
| `to`       | string    | ✅       | Target node id. Must exist.                        |
| `position` | [x, y, z] | ✅       | Floor disc placement (y slightly above the floor). |

### Hotspot

| Field           | Type                                      | Required | Notes                                                                                |
| --------------- | ----------------------------------------- | -------- | ------------------------------------------------------------------------------------ |
| `id`            | string                                    | ✅       | Unique handle, used in events.                                                       |
| `node`          | string                                    | –        | Owning node; omit for a global hotspot visible from every node.                      |
| `position`      | [x, y, z]                                 | ✅       | 3D anchor. Hotspots are occlusion-tested against the proxy mesh.                     |
| `type`          | `"info" \| "image" \| "link" \| "custom"` | `"info"` | Open enum.                                                                           |
| `title`, `body` | string                                    | –        | Popup content.                                                                       |
| `href`          | string                                    | –        | For `type: "link"`: opened in a new tab by the default popup layer.                  |
| `media.image`   | string                                    | –        | Popup image URL.                                                                     |
| `payload`       | anything                                  | –        | For `type: "custom"`: passed to the host app untouched via the `hotspotclick` event. |

## Validation guarantees

`validateConfig` rejects: unknown `version`, empty `nodes`, duplicate node ids, `start`/`links[].to`/`hotspots[].node` referencing nonexistent nodes. Defaults shown above are applied on parse.

## Stability

The v1 schema is **append-only**: future releases may add optional fields but will not change the meaning of existing ones. A `version: 2` would only ship with a published migration.
