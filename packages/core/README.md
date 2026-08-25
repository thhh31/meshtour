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

if (engine.getGuides().length > 0) {
  await engine.startGuide(engine.getGuides()[0]!.id);
}

engine.setMeasurementsVisible(true);
engine.setViewMode("top"); // orthographic, panorama-textured overview

// Call from a click/tap. The method rejects when immersive WebXR is unavailable.
await engine.enterVR();
```

Give the container an explicit height before starting the engine, for example
`#tour { height: 100dvh; }`.

The engine can render an automatic proxy-derived plan into a canvas with
`renderPlan()`. Optional `spatial` config supplies stable plan bounds,
measurement targets, and a generated fallback ceiling.

WebXR uses `local-floor` tracking, calibrates the headset to the current node,
and exposes controller rays to the same navigation/hotspot interaction system.
Node changes default to comfort teleports while VR is active. WebXR requires
HTTPS (or localhost) and a browser/headset supporting `immersive-vr`; use
`checkVRSupport()`, `isVRActive()`, and `exitVR()` for custom controls.

Optional config `guides` define interactive property stories. The framework-
independent controller supports manual chapters, opt-in autoplay, free
exploration/resume, state restoration on exit, and analytics-ready lifecycle
events. `captureViewSnapshot()` captures the current panorama, dollhouse, or
top view for authoring.

Optional `configurator` metadata turns visual variants into a deterministic
buyer product model with groups, SKUs, availability, dependencies, curated
packages and integer minor-unit pricing. `applyConfigurationPreset()` commits
all visual layers atomically; serialized state can be restored from a host URL,
and `requestConfiguration()` emits a catalogue-versioned quote payload.

The package includes TypeScript declarations and supports both ESM and
CommonJS. The config schema is versioned; see `docs/CONFIG.md` in the MeshTour
repository for the complete contract and `assets-pipeline/BLENDER.md` for the
same-source asset workflow.

License: MIT.
