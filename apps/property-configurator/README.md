# Italian Flat configurator

Try different finishes, compare them with the original, and share a link to
the selection.

```sh
pnpm build
pnpm --filter @meshtour/property-configurator dev
```

The app serves the assets from `apps/demo/public`. The request form emits a
`meshtour:lead` browser event with the selected finishes and contact details.
The demo has no server for submissions.

See the [asset notes](../../docs/FIRST_DEMO_ASSETS.md) to rebuild the scene.
