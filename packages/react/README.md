# @meshtour/react

React bindings for the MeshTour mesh-backed virtual-tour engine.

```bash
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

`TourSpatialControls` adds an automatic live minimap, plan-node navigation,
multi-panorama dollhouse and textured top views, configured measurements, and
container fullscreen support. On a compatible headset browser it also shows an
immersive VR button; controller trigger rays select the existing navigation
markers and hotspots.
Its plan is derived from the loaded proxy; no separate plan image is required.

`TourGuidedControls` renders an accessible, responsive property-story card for
configured `guides`. Chapters can reproduce panorama, dollhouse, and top views,
measurements, and selected finishes. Manual navigation is the default;
configured autoplay remains opt-in, and free exploration pauses with a Resume
action. Use `useGuidedTour()` to replace the card with a custom product UI.

Use `useTour()` inside `<Tour>` children for imperative navigation and view
control. The wrapper is SSR-safe and supports custom React hotspot popups,
loading/error fallbacks, event callbacks, author mode, spatial view mode, and
measurement state.

Use `useTourConfiguration()` for product groups, package selection, constraint
availability, totals, URL serialization/restoration, comparison resets, and
SKU-level request payloads. `<Tour>` mirrors lifecycle changes through
`onConfigurationChange` and `onConfigurationRequest`.

`useTour()` exposes `vrSupported`, `vrActive`, `enterVR()`, and `exitVR()` for a
custom headset UI. `<Tour>` also accepts `onVRSupportChange` and `onVRChange`.

`onReady` receives the underlying `TourEngine`. Transition lifecycle callbacks
are available through `onTransitionStart` and `onTransitionEnd`.
Guide lifecycle callbacks include `onGuideStart`, `onGuideStepChange`,
`onGuideExplore`, `onGuideComplete`, `onGuideAction`, and `onGuideError`.

License: MIT.
