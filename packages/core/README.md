# @meshtour/core

Framework-agnostic Three.js engine for mesh-backed virtual tours. It projects
equirectangular panoramas onto an invisible proxy mesh to provide walking
transitions, object-aware raycasting, and occlusion-aware hotspots.

```bash
npm install @meshtour/core three
```

```ts
import { TourEngine } from "@meshtour/core";

const engine = new TourEngine({
  container: document.querySelector("#tour")!,
  config: "/tours/apartment/tour.json",
});

await engine.start();

engine.setMeasurementsVisible(true);
engine.setViewMode("top"); // orthographic, panorama-textured overview
```

Give the container an explicit height before starting the engine, for example
`#tour { height: 100dvh; }`.

The engine can render an automatic proxy-derived plan into a canvas with
`renderPlan()`. Optional `spatial` config supplies stable plan bounds,
measurement targets, and a generated fallback ceiling.

The package includes TypeScript declarations and supports both ESM and
CommonJS. The config schema is versioned; see `docs/CONFIG.md` in the MeshTour
repository for the complete contract and `assets-pipeline/BLENDER.md` for the
same-source asset workflow.

License: MIT.
