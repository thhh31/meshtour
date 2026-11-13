# Releasing MeshTour

`@meshtour/core` and `@meshtour/react` are published on npm. The
[Italian Flat demo](https://meshtour-demo.vercel.app/) runs on Vercel and can
stay public while the source repository is private.

## Deploy the demo

The Vercel project is `meshtour-demo`, connected to `thhh31/meshtour` on `main`.
It builds with Node.js 22 from `apps/demo`, with files outside that directory
included for the workspace packages. The build command and output directory
are set in [vercel.json](../apps/demo/vercel.json).

The [Demo Pages workflow](../.github/workflows/demo-pages.yml) is an optional
deployment for a public repository. It skips private repositories because
GitHub Pages on the Free plan requires a public source repository.

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
