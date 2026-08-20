# MeshTour Stage 1 launch runbook

Use this only after the packages and public demo are live. Replace every angle-
bracket placeholder before posting.

## Preflight

- CI and Demo Pages workflows pass on `main`.
- `<LIVE_DEMO_URL>` works in a private browser session.
- The demo is tested on desktop and a physical mid-range phone.
- `@meshtour/core@0.1.0` and `@meshtour/react@0.1.0` install in a clean app.
- README links, npm metadata, attribution, and the transition video work.
- Repository Discussions/issues are monitored for the first 48 hours.

Do not claim the `<2 s` mobile target or `30+ fps` until the physical-device
measurements have been recorded.

## Links to prepare

```text
Repository: <REPOSITORY_URL>
Live demo:  <LIVE_DEMO_URL>
npm core:   <NPM_CORE_URL>
npm React:  <NPM_REACT_URL>
Video:      <TRANSITION_VIDEO_URL>
```

## Show HN

Title:

> Show HN: MeshTour – open-source mesh-backed virtual tours for the web

Body:

> MeshTour combines equirectangular panoramas with an invisible low-poly proxy
> mesh. The panorama provides the pixels; the mesh provides geometry for
> parallax-correct walking transitions, surface-aware cursor interaction, and
> occlusion-aware hotspots.
>
> It is a framework-independent TypeScript engine with thin React bindings,
> built-in author tools, a versioned JSON format, and a documented Blender
> same-source workflow. The demo assets and decoder binaries are self-hosted.
>
> Demo: <LIVE_DEMO_URL>
> Source: <REPOSITORY_URL>
>
> I would especially value feedback on the transition artifacts and the asset
> authoring workflow.

## Three.js forum / r/threejs / r/webdev

Title:

> MeshTour: mesh-backed panorama tours with walking transitions (MIT)

Body:

> I built an MIT-licensed TypeScript viewer that projects panoramas onto a
> low-poly GLB proxy. Keeping the render and proxy in the same coordinate system
> lets a tour move between capture positions with geometric parallax, raycast
> real surfaces, and hide hotspots behind walls.
>
> The v0.1 release includes framework-independent and React packages, author
> mode, a three-point 4K CC-BY apartment demo, Draco/KTX2 delivery, and a reproducible
> Blender pipeline. Known reprojection limitations are documented rather than
> hidden.
>
> Demo/video: <LIVE_DEMO_URL>
> Code/docs: <REPOSITORY_URL>

Adapt the opening sentence to each community and follow its self-promotion
rules. Do not submit identical posts simultaneously.

## Short social thread

1. “Panorama tours usually fake movement with a zoom or crossfade. MeshTour
   projects each panorama onto a real proxy mesh, so transitions have geometric
   parallax. <TRANSITION_VIDEO_URL>”
2. “The same invisible mesh handles surface picking and hides hotspots behind
   walls. The pixels still come from the original archviz render.”
3. “v0.1 is MIT, TypeScript-first, framework-independent with React bindings,
   and ships with a documented Blender → GLB/JPEG/KTX2 workflow.”
4. “Try it: <LIVE_DEMO_URL> · source: <REPOSITORY_URL>”

## Suggested order

1. Publish the repository, demo, npm packages, and a tagged release.
2. Post to the Three.js forum and respond to technical feedback.
3. Post Show HN during a period when the maintainer can answer questions.
4. Space Reddit/community posts over several days and tailor each one.
5. Publish the short social thread with the transition video attached.
6. Record useful feedback as issues; fix release-blocking defects before wider
   promotion.
