# Releasing MeshTour

The repository is release-ready, but publishing is intentionally gated on
credentials and ownership that must belong to the maintainer.

## One-time setup

1. Create or obtain access to the `@meshtour` npm organization. An anonymous
   registry lookup currently returns 404 for both planned package names, but
   only npm can confirm scope ownership for the publishing account.
2. Create the GitHub repository and add it as this checkout's `origin`.
3. Add an npm automation token as the GitHub Actions secret `NPM_TOKEN`.
4. Enable GitHub Pages with **GitHub Actions** as its source; the Demo Pages
   workflow publishes `apps/demo/dist` on each main-branch push.
5. Review the package names, license, and version (`0.1.0`) before the first
   publish.

## Normal release flow

1. Add a changeset to each public behavior/API pull request with
   `pnpm changeset`.
2. Merge to `main`. The Release workflow opens or updates a version pull
   request.
3. Merge the version pull request. The same workflow builds and publishes the
   package tarballs with npm provenance.

## First release verification

Run these locally before configuring the token:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
pnpm packages:verify
pnpm typecheck
pnpm test
pnpm build:apps
pnpm test:e2e
pnpm --dir packages/core pack --pack-destination /tmp/meshtour-packs
pnpm --dir packages/react pack --pack-destination /tmp/meshtour-packs
```

Inspect both tarballs: they should contain only `dist`, `package.json`,
`README.md`, and `LICENSE`. The packed React manifest must rewrite its
`workspace:^` core peer to `^0.1.0`.

Publishing and announcing the project are external, irreversible actions; do
not run `pnpm release` or create launch posts from a development checkout
without the maintainer's explicit approval.
