# Releasing MeshTour

MeshTour can be released on GitHub before its packages are available on npm.
The README quickstart builds both packages from the checkout.

## GitHub source release

1. Create a new empty GitHub repository for the public release. The original
   private repository contains company test assets in its history. Publish only
   the prepared `codex/public-release` branch to the new repository as `main`.
   Use a named branch push, since other local branches contain the private history.
2. For a hosted demo, select **GitHub Actions** as the Pages publishing source.
   The Demo Pages workflow publishes `apps/demo/dist` from `main`.
3. Confirm the GitHub CI workflow passes and open the demo if Pages is enabled.

## First npm release

1. Get publishing access to the `@meshtour` npm scope. If the scope is unavailable,
   select a scope you control and update both package names and workspace references.
   [npm organization publishing guide](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/)
2. Set the `repository.url` in each publishable package to the public source repository
   for npm provenance, and verify the tarballs using the commands below.
   [npm provenance requirements](https://docs.npmjs.com/generating-provenance-statements/)
3. For the existing Release workflow, add a granular npm token with package write
   access and bypass 2FA as the Actions secret `NPM_TOKEN`. Allow Actions to create
   pull requests, then set the Actions variable `NPM_PUBLISH_ENABLED` to `true`.
   [npm publishing authentication](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)

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
