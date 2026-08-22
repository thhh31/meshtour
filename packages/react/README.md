# @meshtour/react

React bindings for the MeshTour mesh-backed virtual-tour engine.

```bash
npm install @meshtour/react @meshtour/core three
```

```tsx
import { Tour, TourSpatialControls } from "@meshtour/react";

export function Apartment() {
  return (
    <Tour config="/tours/apartment/tour.json" style={{ height: "100dvh" }}>
      <TourSpatialControls />
    </Tour>
  );
}
```

`TourSpatialControls` adds an automatic live minimap, plan-node navigation,
multi-panorama dollhouse and textured top views, configured measurements, and
container fullscreen support. On a compatible headset browser it also shows an
immersive VR button; controller trigger rays select the existing navigation
markers and hotspots.
Its plan is derived from the loaded proxy; no separate plan image is required.

Use `useTour()` inside `<Tour>` children for imperative navigation and view
control. The wrapper is SSR-safe and supports custom React hotspot popups,
loading/error fallbacks, event callbacks, author mode, spatial view mode, and
measurement state.

`useTour()` exposes `vrSupported`, `vrActive`, `enterVR()`, and `exitVR()` for a
custom headset UI. `<Tour>` also accepts `onVRSupportChange` and `onVRChange`.

`onReady` receives the underlying `TourEngine`. Transition lifecycle callbacks
are available through `onTransitionStart` and `onTransitionEnd`.

License: MIT.
