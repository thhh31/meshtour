# Releasing MeshTour

`@meshtour/core` and `@meshtour/react` are published on npm. The
[Demo Pages workflow](../.github/workflows/demo-pages.yml) builds the demo from
`main` and deploys it when GitHub Pages is enabled.

## Check the packages

```sh
pnpm lint
pnpm build
pnpm typecheck
pnpm test
pnpm packages:verify
```

`pnpm packages:verify` installs the packed packages in a separate consumer
project and checks their ESM, CommonJS, and TypeScript entry points.

## Publish through Changesets

1. Add a changeset with `pnpm changeset` and merge it into `main`.
2. Review the version PR, including the changelog and React's Core peer range.
3. Merge the version PR to publish the packages.

The [release workflow](../.github/workflows/release.yml) runs when
`NPM_PUBLISH_ENABLED` is `true`. It uses the `NPM_TOKEN` repository secret and
needs permission to open the version PR. The token needs publishing access to
the `@meshtour` scope. The workflow publishes with npm provenance.
