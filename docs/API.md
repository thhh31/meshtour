# MeshTour 1.x API

MeshTour supports the APIs below through the `@meshtour/core` and `@meshtour/react`
package entry points. Within 1.x, existing calls and valid [v1 tour files](CONFIG.md)
keep working. New options and config fields can be added with defaults.

## Core

Create a `TourEngine` in a browser with WebGL 2. Give its container a height.
Subscribe to events before calling `start()` so you receive the first `nodechange`
and `ready`. `start()` rejects when the tour fails to load. If creating the
renderer fails, the constructor throws. Call `dispose()` when you remove the
viewer and create a new engine to load another tour.

```ts
import { TourEngine } from "@meshtour/core";

const engine = new TourEngine({ container, config: "/tours/apartment/tour.json" });
const unsubscribe = engine.on("nodechange", ({ to }) => {
  console.log(to);
});

try {
  await engine.start();
  await engine.goToNode("kitchen");
} catch (error) {
  engine.dispose();
  throw error;
}

// When removing the viewer
unsubscribe();
engine.dispose();
```

Use `getCurrentNode()`, `getView()`, `setView()` and `lookAt()` to read and change
the viewpoint. `goToNode(id, { instant: true })` skips the animation. Use
`setViewMode()` and `renderPlan()` for the spatial views, `startGuide()` and
`goToGuideStep()` for guide playback, and `selectConfigurationOption()` and
`applyConfigurationPreset()` for finishes. The exported `TourEngine` and
`TourEngineOptions` types list the options and method signatures.

`TourEventMap` defines the event names and their payloads. `on()` and `once()`
return an unsubscribe function. Watch `nodechange` for the destination after
either animated or instant navigation. `transitionstart` and `transitionend`
track animated movement. `error` reports a load failure. Await navigation and
configuration commands to handle errors from those commands.

## React

`<Tour>` owns the engine for its lifetime. It starts after mounting in the
browser, restarts when `config` or `initialNode` changes, and disposes on unmount.
Keep an inline config's object reference stable between renders. Pass loader
options through `engineOptions` at mount. `onReady` receives the engine and
`onError` and `errorFallback` handle initialization and load failures. A server
render produces the shell and the browser starts the tour after hydration.

Use the hooks inside `<Tour>` children.

| Hook                     | What it exposes                                                       |
| ------------------------ | --------------------------------------------------------------------- |
| `useTour()`              | Readiness, current viewpoint, navigation, view modes and measurements |
| `useGuidedTour()`        | Guide list, active chapter, playback and chapter navigation           |
| `useTourConfiguration()` | Finish availability, selections, presets and configuration share data |

`<TourSpatialControls>` and `<TourGuidedControls>` provide controls you can use
directly. Use the exported prop and hook result types to build your own.

## Tour files and support

`TourConfigInput` describes the JSON before defaults. `validateConfig()` and
`loadConfig()` return a `TourConfig` and throw `ConfigError` for invalid data.
The [v1 reference](CONFIG.md) describes the fields, defaults and asset URLs.

The Zod schema exports support composition with Zod 4. Use `validateConfig()` to
parse a whole tour with defaults. `AssetManager`, `PanoramaProjection`, direct
access to the Three.js renderer and scene, author mode, and WebXR are experimental.

Use a browser with WebGL 2 and Three.js r160 or later. The React bindings support
React 18 and 19. The packages ship ESM, CommonJS and TypeScript declarations.
For Node.js tooling and server rendering, use Node.js 22.12 or later and
TypeScript 5.9 or later with `moduleResolution` set to `NodeNext` or `Bundler`.
