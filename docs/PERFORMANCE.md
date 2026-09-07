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

CI limits the data downloaded before the Italian Flat demo becomes
interactive to 1 MiB, about two seconds of transfer at the emulated 4 Mbps.
It also records startup time, which includes parsing, decoding, and rendering
on the machine running the test. Compare startup times on the same hardware.

## Earlier reference results

Measured on 2026-08-17 from a production Vite preview:

| Check             | Profile                                                             |                      Result |                    Budget |
| ----------------- | ------------------------------------------------------------------- | --------------------------: | ------------------------: |
| First interactive | Pixel 5 viewport, cold cache, 4 Mbps down, 3 Mbps up, 40 ms latency |                    1,596 ms | 2 s on reference hardware |
| Transition        | 1280×720 headed Chromium, Apple M4 / ANGLE Metal                    | 60.0 fps, 18.6 ms p95 frame |       ≥55 fps, ≤35 ms p95 |

The cold-start profile includes the application JavaScript, config, JPEG
preview, Draco proxy, and Draco decoder. The engine loads the proxy and first
panorama in parallel.

The Pixel 5 profile used browser emulation. The transition measurement used
the desktop GPU.
