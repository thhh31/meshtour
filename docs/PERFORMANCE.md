# MeshTour performance verification

The automated performance checks live in `tests/e2e/performance.spec.ts`.
They measure browser-authored marks rather than test-runner polling:

- `meshtour-ready` is emitted from the React `onReady` callback.
- `meshtour-transition-start` and `meshtour-transition-end` bracket exactly the
  engine's animated transition.

Run the hardware check with:

```bash
pnpm test:performance
```

A headed browser is intentional. Headless Chromium normally reports a
SwiftShader software renderer in CI; CPU rasterization is useful for functional
regression testing but cannot represent device GPU frame rate. The test records
software-renderer results and traverses all configured links, but enforces the
55 fps desktop / 30 fps phone-viewport thresholds only when WebGL reports a
hardware renderer.

## Current reference results

Measured on 2026-08-17 from a production Vite preview:

| Check             | Profile                                                             |                      Result |              Budget |
| ----------------- | ------------------------------------------------------------------- | --------------------------: | ------------------: |
| First interactive | Pixel 5 viewport, cold cache, 4 Mbps down, 3 Mbps up, 40 ms latency |                    1,596 ms |          < 2,000 ms |
| Transition        | 1280×720 headed Chromium, Apple M4 / ANGLE Metal                    | 60.0 fps, 18.6 ms p95 frame | ≥55 fps, ≤35 ms p95 |

The cold-start profile includes the application JavaScript, config, JPEG
preview, Draco proxy, and self-hosted Draco decoder. Critical files are
preloaded by the demo and the engine loads the proxy and first panorama in
parallel.

These measurements are reproducible development evidence, not a substitute
for release sign-off on physical devices. Before launch, test current Android
Chrome on a real mid-range phone over a representative mobile connection,
record first-interactive time and transition fps here, and check iOS Safari.
