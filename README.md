# MeshTour

**Open-source mesh-backed virtual tours for the web.** Photorealistic equirectangular panoramas projected onto an invisible low-poly proxy mesh — so your tour knows what the cursor is pointing at, hides hotspots behind walls, and _walks_ between viewpoints with a parallax-correct transition instead of a crossfade.

> Status: Stage 1 (v0.1). Core engine, React bindings, author mode, and a self-contained demo. Config schema v1.

## Why a mesh behind the image?

Flat panorama viewers (Pannellum, Marzipano, krpano, Kuula) display a sphere of pixels. MeshTour renders the same pixels **projected onto real 3D geometry** of the space, which unlocks:

- **Object-aware cursor** — hover a table, wall, or apartment unit to highlight it, change the cursor, or show a tooltip.
- **Occlusion-aware hotspots** — a hotspot behind a wall is hidden, exactly as it should be.
- **Walking transitions** — the camera moves through real 3D space between viewpoints while panoramas re-project onto the mesh. This is the signature feature.

The closest commercial analogue is Matterport, but MeshTour's primary workflow is **same-source**: panoramas _and_ proxy mesh are exported from one 3D model (Blender, 3ds Max…), so alignment is exact and free. That makes it uniquely suited to **pre-construction real estate and archviz** — spaces that don't physically exist yet and cannot be scanned.

## Packages

| Package                             | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| [`@meshtour/core`](packages/core)   | Framework-agnostic engine (three.js peer dependency) |
| [`@meshtour/react`](packages/react) | `<Tour>` component + `useTour()` hook wrapping core  |

## Quickstart (React)

```bash
npm install @meshtour/react @meshtour/core three
```

```tsx
import { Tour } from "@meshtour/react";

export function Apartment() {
  return (
    <Tour
      config="/tours/apartment/tour.json"
      onNodeChange={(id) => console.log("now at", id)}
      onHotspotClick={(hotspot) => console.log(hotspot.title)}
    />
  );
}
```

## Quickstart (vanilla JS)

```ts
import { TourEngine } from "@meshtour/core";

const engine = new TourEngine({
  container: document.getElementById("tour")!,
  config: "/tours/apartment/tour.json",
});
await engine.start();

engine.on("nodechange", ({ to }) => console.log("now at", to));
await engine.goToNode("kitchen"); // animated walking transition
```

## The tour config

A tour is one JSON file — the full format is documented in [CONFIG.md](docs/CONFIG.md):

```jsonc
{
  "version": 1,
  "name": "Demo Apartment",
  "assets": { "mesh": { "url": "mesh/apartment.glb", "draco": true } },
  "nodes": [
    {
      "id": "living_room",
      "position": [2.1, 1.6, -3.4],
      "panorama": { "url": "pano/living_room", "yaw": 1.5708 },
      "links": [{ "to": "kitchen", "position": [3.8, 0.02, -2.2] }],
    },
  ],
  "start": "living_room",
}
```

## Producing assets

The Blender same-source workflow (panorama cameras + decimated proxy mesh + KTX2 compression) is documented step-by-step in [assets-pipeline/BLENDER.md](assets-pipeline/BLENDER.md).

## Author mode

Pass `authorMode: true` (or the `authorMode` prop) to get an in-canvas debug overlay: toggle the proxy wireframe to verify alignment, click to place hotspots and links, drag hotspots along surfaces, nudge per-panorama yaw, and copy/download the updated JSON. No backend, no persistence — paste the JSON into your tour file.

## Feature comparison

|                                       | MeshTour | Pannellum / Marzipano | Matterport       |
| ------------------------------------- | -------- | --------------------- | ---------------- |
| Open source                           | ✅ MIT   | ✅                    | ❌ SaaS          |
| Walking transition (parallax-correct) | ✅       | ❌ crossfade/zoom     | ✅               |
| Object-aware hover                    | ✅       | ❌                    | partial          |
| Occlusion-aware hotspots              | ✅       | ❌                    | ✅               |
| Works for unbuilt spaces (renders)    | ✅       | ✅ (flat)             | ❌ requires scan |
| Self-hosted                           | ✅       | ✅                    | ❌               |

## Monorepo layout

```
packages/core       @meshtour/core — the engine
packages/react      @meshtour/react — React bindings
apps/demo           React demo app (pnpm --filter @meshtour/demo dev)
assets-pipeline     Blender export guide
docs                CONFIG.md and friends
```

## Development

```bash
pnpm install
pnpm build        # build the publishable packages
pnpm test         # unit tests (config schema, projection math, events)
pnpm typecheck
```

## Known rendering artifacts (and what we do about them)

- **Occlusion ghosting during transitions**: geometry visible from B but not from A briefly shows stretched texels. Mitigated by biasing the blend to complete at ~78% of the travel and by authoring guidance (transition between adjacent nodes with mostly-shared visibility). Per-fragment visibility testing is on the roadmap.
- **Proxy imprecision**: where the low-poly mesh deviates from the rendered geometry, texels swim slightly during movement. Keep walls/floors/large furniture reasonably faithful when decimating.
- **Equirect seam/poles**: handled with derivative-aware dual sampling in the shader.

## Roadmap

- WebXR / headset support
- Calibration tooling for photographed panoramas of real spaces
- Per-fragment occlusion (depth from panorama centers)
- Dollhouse view, minimap, floor plans
- Stage 2: hosted visual editor producing this same config format

## License

[MIT](LICENSE)
