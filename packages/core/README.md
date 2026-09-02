# @meshtour/core

Three.js engine for walking between panoramas projected onto a mesh.

```sh
npm install @meshtour/core three
```

Give your page a container with an explicit height, then start the tour.

```js
import { TourEngine } from "@meshtour/core";

const tour = new TourEngine({
  container: document.getElementById("tour"),
  config: "/tours/apartment/tour.json",
});

await tour.start();
```

Call `tour.dispose()` when you remove the viewer. The package includes
TypeScript types and supports ESM and CommonJS.

- `renderPlan()` draws a plan from the tour mesh. `setViewMode()` switches
  between panorama, top, and dollhouse views.
- `startGuide()` runs a guide defined in the tour config. Use
  `captureViewSnapshot()` to save the current view when authoring a chapter.
- `applyConfigurationPreset()` changes a set of finishes together.
  `requestConfiguration()` emits the selected options for the host app.
- `enterVR()` starts a WebXR session on a compatible headset. Call it from a
  click or tap, on HTTPS or localhost.

[Tour config](https://github.com/thhh31/meshtour-public/blob/main/docs/CONFIG.md) ·
[Blender export guide](https://github.com/thhh31/meshtour-public/blob/main/assets-pipeline/BLENDER.md) ·
[React bindings](https://www.npmjs.com/package/@meshtour/react)

License: MIT.
