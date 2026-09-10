# @meshtour/react

React components and hooks for [MeshTour](https://www.npmjs.com/package/@meshtour/core).

```sh
npm install @meshtour/react @meshtour/core three
```

```tsx
import { Tour, TourGuidedControls, TourSpatialControls } from "@meshtour/react";

export function Apartment() {
  return (
    <Tour config="/tours/apartment/tour.json" style={{ height: "100dvh" }}>
      <TourSpatialControls />
      <TourGuidedControls />
    </Tour>
  );
}
```

`TourSpatialControls` adds the minimap, top and dollhouse views, measurement
controls, and fullscreen. It also offers a VR button on compatible headsets.
`TourGuidedControls` shows the chapters defined in the tour config.

Use these hooks inside `<Tour>` to build your own controls:

- `useTour()` for navigation, camera modes, and headset controls.
- `useGuidedTour()` for the current chapter, playback, and free exploration.
- `useTourConfiguration()` for finish selection, presets, and share links.

`onReady` receives the core engine. See the
[config reference](https://github.com/thhh31/meshtour/blob/main/docs/CONFIG.md)
for the asset format and guide and finish options.

License: MIT.
