# Contributing

See the [README](README.md) to run the demo. Use short commit subjects that
describe the change.

```sh
pnpm lint
pnpm typecheck
pnpm test
```

For changes to the viewer or its assets, run the browser tests as well.

```sh
pnpm exec playwright install chromium firefox webkit
pnpm test:e2e
```

Add a changeset with `pnpm changeset` for changes to the published packages.
Keep engine behavior in `packages/core` and React bindings in `packages/react`.
Add new fields to the [tour config](docs/CONFIG.md) as optional fields.

For a rendering bug, include the browser, GPU, tour config, and the two
viewpoints if the problem happens during a transition. A short recording helps.
See [transition notes](docs/TRANSITION_QUALITY.md) for common artifacts.
