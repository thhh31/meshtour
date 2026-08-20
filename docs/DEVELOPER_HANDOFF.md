# MeshTour developer handoff

This is the single starting point for a developer taking over MeshTour.

## What this project is

MeshTour is an open-source TypeScript library for mesh-backed virtual tours.
It projects equirectangular panoramas onto a low-poly GLB proxy of the same
space. The proxy enables parallax-correct walking transitions, surface-aware
interaction, and hotspot occlusion that a sphere-only panorama viewer cannot
provide.

The repository is a pnpm monorepo:

- `packages/core` — framework-independent Three.js engine.
- `packages/react` — React component and hook around the core engine.
- `apps/demo` — public React demo using checked-in production assets.
- `assets-pipeline` — Blender workflow and reproducible reference scripts.
- `tests/e2e` — Playwright desktop/mobile and visual coverage.

## Current status

The codebase is a **Stage 1 / v0.1 release candidate**. The local product work
is complete:

- Core engine and React API are implemented and packaged.
- Config schema v1 is documented and validated at runtime.
- Panorama preview-to-KTX2 loading, Draco proxy loading, navigation,
  transitions, hotspots, object picking, occlusion, and author mode work.
- Disposal/loading races, texture-upgrade timing, transition edge cases,
  duplicate hotspot IDs, and proxy-vs-pickable occlusion have regression tests.
- The public demo uses three repositioned viewpoints from the CC-BY Italian Flat
  Blender scene; it has no runtime asset CDN dependency. Its contour-accurate
  proxy fixes the former box-shaped furniture highlights and now retains more
  visual furniture for transition parallax. All three panorama
  yaws are calibrated to `−π/2`, and the demo uses the projective `walk`
  transition with per-source radial depth rejection. Interactable meshes still
  emit hover/click events, but the demo's visible hover tint is disabled with
  `interactables.highlight.opacity: 0`.
- Desktop and Pixel 5-sized Chromium flows have Playwright coverage and visual
  baselines; Firefox, desktop WebKit, and iPhone-sized WebKit have compatibility
  smoke coverage.
- CI, Changesets, npm package metadata, GitHub Pages deployment, bundle-size
  checks, asset checksums, and release automation are configured.

What is **not** complete is external publication. A maintainer still needs to
provide the Git remote, npm scope access/token, GitHub Pages setting, live URL,
and approval/accounts for launch announcements. A real mid-range phone should
also be used for the final performance sign-off; the checked-in mobile test is
emulated Chromium, not physical hardware.

## First setup

Requirements: a current Node.js 20 LTS or newer release and pnpm 9.15.4
(declared in `package.json`). Blender is only needed when rebuilding the
reference assets.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @meshtour/demo dev
```

Open the local URL printed by Vite. Add `?author=1` to enable the in-browser
authoring panel.

## Required verification

Run the complete release gate before merging or publishing:

```bash
pnpm lint
pnpm build
pnpm sizecheck
pnpm packages:verify
pnpm assets:verify
pnpm typecheck
pnpm test
pnpm build:apps
pnpm test:e2e
pnpm test:performance
pnpm exec changeset status
```

`pnpm test:e2e` starts a production preview automatically. Install its browser
engines once with `pnpm exec playwright install chromium firefox webkit` if
Playwright asks for them. Do not update visual snapshots until the rendered
diff has been inspected.
The headed performance methodology and current reference measurements are in
[PERFORMANCE.md](PERFORMANCE.md).

## Demo assets

No additional asset purchase or search is required for the first demo. The
web-ready bundle is checked in at:

```text
apps/demo/public/tours/italian-flat/
├── ATTRIBUTION.md
├── manifest.json
├── tour.json
├── mesh/apartment.glb
└── pano/{kitchen,living,lounge}_{1k.jpg,4k.ktx2}
```

It contains a 275 KiB detailed contour-accurate Draco proxy, three JPEG
previews, and three 4K UASTC/Zstd KTX2 panoramas. The nine-file tour bundle is
20.3 MiB. Draco and Basis decoder files are self-hosted under
`apps/demo/public/vendor/`.

The source is **Italian Flat by Flavio Della Tommasa**, marked `CC-BY` inside
the Blender file. The embedded notice does not specify a Creative Commons
version, so preserve the exact attribution and do not invent one. The audited
source URL, SHA-256, modifications, and downstream attribution are recorded in
the bundled
[attribution](../apps/demo/public/tours/italian-flat/ATTRIBUTION.md) and
[asset runbook](FIRST_DEMO_ASSETS.md).

For future assets, “free to download” is not sufficient. Accept assets only
when modification and redistribution are clearly permitted. Prefer CC0; CC-BY
is acceptable when attribution is shipped. Audit separately licensed models,
textures, and HDRIs before committing derivatives. Poly Haven is the preferred
source for CC0 replacements.

## Rebuilding the reference scene

The original `.blend` and lossless render masters intentionally stay out of
Git. Download the audited source, verify its SHA-256 against the attribution
record, and run Blender from the repository root:

```bash
blender -b /path/to/flat-archiviz.blend \
  --python assets-pipeline/scripts/build_italian_flat_demo.py -- \
  --output-dir apps/demo/public/tours/italian-flat \
  --mode all --width 4096 --samples 128
```

Encode the generated masters to `_1k.jpg` and vertically flipped `_4k.ktx2`
files using the commands in `assets-pipeline/BLENDER.md`, validate the KTX2
files with Khronos `ktx validate`, then run `pnpm assets:verify`. Lossless
masters should remain outside the web bundle and can be regenerated by the
script.

## Engineering rules

- Keep engine logic in `packages/core`; React bindings should remain thin.
- Treat config schema v1 as an append-only public contract.
- Keep Three.js and React as peer dependencies of the published packages.
- Resolve all tour media relative to `assets.basePath`.
- Upload texture upgrades before a transition, never while it is moving.
- Preserve disposal safety: asynchronous loaders must not resurrect or leak
  assets after an engine is disposed.
- Add tests for public behavior changes and a Changeset for release-visible
  changes.
- Preserve the demo attribution and update `manifest.json` whenever a tracked
  demo asset changes.
- Stay under the 60 KiB gzipped core bundle budget.

Known visual limitations are documented in the root README. Walk transitions
use per-source radial depth cubemaps to reject hidden proxy surfaces; use the
configurable fade mode when a source proxy cannot provide reliable shared
coverage. Proxy imprecision and the normal panorama seam/pole constraints still
apply.

## Publishing and launch

The maintainer must complete these owner-only steps:

1. Create the remote repository and add it as `origin`.
2. Confirm control of the `@meshtour` npm organization.
3. Add an npm automation token as the repository secret `NPM_TOKEN`.
4. Enable GitHub Pages with **GitHub Actions** as the source.
5. Push `main` and confirm CI and the Demo Pages workflow pass.
6. Test the live demo on a physical mid-range phone over a throttled/mobile
   connection and record time-to-interactive and transition frame rate.
7. Merge the Changesets version pull request to publish `0.1.0`.
8. Verify clean installs of both packages from npm and replace any placeholder
   demo links with the live URL.
9. Publish launch announcements only after the package and demo URLs work.

Do not run `pnpm release` from an unreviewed checkout. The detailed token,
tarball, provenance, and first-release procedure is in
[RELEASING.md](RELEASING.md); ready-to-customize announcement copy is in
[LAUNCH.md](LAUNCH.md).

## Demo media

`docs/media/meshtour-transition.webm` is a reproducible 1280×720 walkthrough.
With a demo server running, regenerate it with:

```bash
pnpm demo:record http://127.0.0.1:5173/
```

The recording inherits the Italian Flat attribution; keep
`docs/media/README.md` with it.
