import { expect, test } from "@playwright/test";

const FAST_4G = {
  offline: false,
  latency: 40,
  downloadThroughput: (4 * 1024 * 1024) / 8,
  uploadThroughput: (3 * 1024 * 1024) / 8,
};

test("keeps the Italian Flat cold start within the transfer budget", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The cold-start budget targets phones");

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", FAST_4G);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => performance.getEntriesByName("meshtour-ready").length > 0);
  const interactiveMs = await page.evaluate(
    () => performance.getEntriesByName("meshtour-ready")[0]!.startTime,
  );
  const resources = await page.evaluate((readyAt) => {
    const entries = [
      ...performance.getEntriesByType("navigation"),
      ...performance.getEntriesByType("resource"),
    ] as PerformanceResourceTiming[];
    return entries
      .filter(
        (entry) => new URL(entry.name).origin === location.origin && entry.responseEnd <= readyAt,
      )
      .map((entry) => ({
        path: new URL(entry.name).pathname,
        startTime: entry.startTime,
        duration: entry.duration,
        transferSize: entry.transferSize,
      }))
      .sort((a, b) => a.startTime - b.startTime);
  }, interactiveMs);
  const transferSize = resources.reduce((total, resource) => total + resource.transferSize, 0);
  console.log(
    `Italian Flat interactive in ${interactiveMs.toFixed(0)} ms after ${(transferSize / 1024).toFixed(0)} KiB on emulated fast 4G`,
  );
  console.log(JSON.stringify(resources, null, 2));

  await testInfo.attach("cold-start.json", {
    body: JSON.stringify({ profile: FAST_4G, interactiveMs, transferSize, resources }, null, 2),
    contentType: "application/json",
  });
  expect(
    resources.find(({ path }) => path.endsWith("/pano/living_1k.jpg"))?.transferSize,
  ).toBeGreaterThan(0);
  expect(resources.find(({ path }) => path.endsWith(".glb"))?.transferSize).toBeGreaterThan(0);
  expect(transferSize).toBeLessThan(FAST_4G.downloadThroughput * 2);
});

test("keeps transitions above the frame-rate budget", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.goto("/?tour=italian-flat&test=1");
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
  await expect
    .poll(() =>
      page.evaluate(() =>
        performance
          .getEntriesByType("resource")
          .some((entry) => entry.name.endsWith("/pano/lounge_4k.ktx2")),
      ),
    )
    .toBe(true);

  await page.evaluate(() => {
    performance.clearMarks("meshtour-transition-start");
    performance.clearMarks("meshtour-transition-end");
  });
  const memoryBefore = await page.evaluate(() => ({
    textures: window.__MESHTOUR_TEST_ENGINE__!.getRenderer().info.memory.textures,
    geometries: window.__MESHTOUR_TEST_ENGINE__!.getRenderer().info.memory.geometries,
  }));
  const preparationPromise = page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        window.__MESHTOUR_TEST_ENGINE__!.once("transitionprepare", ({ durationMs }) =>
          resolve(durationMs),
        );
      }),
  );
  const frameSamplesPromise = page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        const sample = (now: number) => {
          const started = performance.getEntriesByName("meshtour-transition-start").length > 0;
          const ended = performance.getEntriesByName("meshtour-transition-end").length > 0;
          if (started) samples.push(now);
          if (started && ended) resolve(samples);
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Library Lounge" }),
  ).toHaveAttribute("aria-current", "location");
  const samples = await frameSamplesPromise;
  const preparationMs = await preparationPromise;
  const elapsed = samples.at(-1)! - samples[0]!;
  const fps = ((samples.length - 1) * 1_000) / elapsed;
  const frameTimes = samples.slice(1).map((sample, index) => sample - samples[index]!);
  const sortedFrameTimes = [...frameTimes].sort((a, b) => a - b);
  const p95FrameMs = sortedFrameTimes[Math.floor(sortedFrameTimes.length * 0.95)] ?? Infinity;
  const droppedFrames = frameTimes.filter((frameTime) => frameTime > 35).length;
  const minimumFps = testInfo.project.name === "mobile-chromium" ? 30 : 55;
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    if (!gl) return "WebGL2 unavailable";
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    return extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : "masked";
  });

  console.log(
    `${testInfo.project.name}: ${fps.toFixed(1)} fps, p95 ${p95FrameMs.toFixed(1)} ms, ${renderer}`,
  );

  const sharedRenderer = /swiftshader|llvmpipe|software|paravirtual/i.test(renderer);
  if (sharedRenderer) {
    testInfo.annotations.push({
      type: "performance",
      description: `Recorded frame timing on a software or virtual WebGL renderer: ${renderer}`,
    });
    expect(samples.length).toBeGreaterThan(2);
  } else {
    expect(fps).toBeGreaterThanOrEqual(minimumFps);
    expect(p95FrameMs).toBeLessThanOrEqual(35);
  }

  // Exercise every configured edge in both directions after the measured run.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const room of ["Living Room", "Kitchen & Dining", "Living Room", "Library Lounge"]) {
    await page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: room })
      .click();
    await expect(
      page.getByRole("navigation", { name: "Tour points" }).getByRole("button", { name: room }),
    ).toHaveAttribute("aria-current", "location");
  }
  const memoryAfter = await page.evaluate(() => ({
    textures: window.__MESHTOUR_TEST_ENGINE__!.getRenderer().info.memory.textures,
    geometries: window.__MESHTOUR_TEST_ENGINE__!.getRenderer().info.memory.geometries,
  }));
  await testInfo.attach("transition-performance.json", {
    body: JSON.stringify(
      {
        preparationMs,
        fps,
        p95FrameMs,
        droppedFrames,
        frames: samples.length,
        minimumFps,
        renderer,
        memoryBefore,
        memoryAfter,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  expect(memoryAfter.geometries).toBeLessThanOrEqual(memoryBefore.geometries + 2);
});
