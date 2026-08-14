# Contributing to MeshTour

Thanks for taking the time! This is an early-stage project — issues, bug reports with reproductions, and small focused PRs are the most useful contributions right now.

## Setup

```bash
corepack enable pnpm   # or: npm i -g pnpm
pnpm install
pnpm build             # builds @meshtour/core and @meshtour/react
pnpm test
pnpm --filter @meshtour/demo dev         # React demo
```

The demo serves the checked-in Italian Flat web bundle; the large original `.blend` and lossless render masters stay outside Git and can be regenerated with the scripts under `assets-pipeline/scripts`.

## Project shape

- `packages/core` — the engine. Framework-agnostic, three.js as a **peer** dependency, no React imports ever.
- `packages/react` — thin wrappers only. Engine logic does not belong here.
- `docs/CONFIG.md` — the config format is a **frozen public contract** (v1, append-only). Schema changes need an issue first.

## Quality bar

- TypeScript strict; `pnpm typecheck` must pass.
- `pnpm test` (Vitest) must pass; new behavior in config validation, projection math, or the event flow needs tests.
- `pnpm test:e2e` must pass for viewer, demo UI, navigation, or asset-loading changes. Update visual baselines only after inspecting the diff.
- `pnpm lint` (ESLint + Prettier) before pushing; `pnpm format` fixes formatting.
- Public API/runtime changes need a `pnpm changeset` entry.
- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`…).

## Performance budget (don't regress these)

- Core bundle < 60 kB gzipped excluding three.js.
- First interactive paint of a tour's start node < 2 s on a mid-range phone over 4G (preview JPEG + Draco mesh first, full KTX2 swaps in later).
- 60 fps transitions on desktop, 30+ on mobile; textures upload **before** a transition starts, never during.

## Reporting rendering artifacts

Transition ghosting/smearing reports are most actionable with: the two node positions, a screen recording, and whether the artifact area is visible from both capture positions. See "Known rendering artifacts" in the README before filing.
