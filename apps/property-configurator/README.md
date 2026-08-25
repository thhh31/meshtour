# MeshTour property configurator

Buyer-facing Italian Flat v4 demo. It intentionally lives outside the engine
capability demo so its UI can optimize the property-sales journey: curated
packages, individual upgrades, compatibility, price deltas, share restoration,
press-and-hold comparison, analytics and CRM-ready lead data.

```bash
pnpm assets:build:v4
pnpm assets:verify:v4
pnpm --filter @meshtour/property-configurator dev
```

The app reuses `apps/demo/public` as its Vite public directory. V4 owns only its
new proxy, property layers, material sources, config and manifest; v3 retains
the shared panoramas and existing furniture layers.

Host integrations listen for:

- `meshtour:analytics` — product interaction events.
- `meshtour:lead` — contact details plus the versioned SKU quote payload.

Demo submissions stay in the browser and are also exposed as
`window.__MESHTOUR_LAST_LEAD__` for end-to-end verification.
