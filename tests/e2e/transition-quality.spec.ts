import { expect, test, type Page, type TestInfo } from "@playwright/test";

const PROGRESS = [0, 0.15, 0.29, 0.4, 0.5, 0.6, 0.71, 0.85, 1] as const;
const EDGE_FILTER = process.env.TRANSITION_EDGE;

interface TestClockSnapshot {
  from: string;
  to: string;
  progress: number;
  camera: [number, number, number];
  blend: number;
  depthAReady: boolean;
  depthBReady: boolean;
  renderer: string;
  devicePixelRatio: number;
  frameTimeMs: number;
  gpuTextures: number;
  gpuGeometries: number;
}

async function directedEdges(page: Page): Promise<Array<[string, string]>> {
  return page.evaluate(() => {
    const config = window.__MESHTOUR_TEST_ENGINE__!.getConfig()!;
    const edges = new Set<string>();
    for (const from of config.nodes) {
      for (const link of config.links) {
        if (from.id !== link.to) edges.add(`${from.id}\0${link.to}`);
      }
      for (const link of from.links) edges.add(`${from.id}\0${link.to}`);
    }
    return [...edges].map((edge) => edge.split("\0") as [string, string]);
  });
}

async function captureEdge(
  page: Page,
  testInfo: TestInfo,
  from: string,
  to: string,
): Promise<void> {
  await page.evaluate(async (nodeId) => {
    await window.__MESHTOUR_TEST_ENGINE__!.goToNode(nodeId, { instant: true });
  }, from);
  await page.evaluate((nodeId) => {
    void window.__MESHTOUR_TEST_ENGINE__!.goToNode(nodeId);
  }, to);
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__!.state === "transitioning");

  const metadata: TestClockSnapshot[] = [];
  for (const progress of PROGRESS) {
    const snapshot = await page.evaluate((value) => {
      const engine = window.__MESHTOUR_TEST_ENGINE__!;
      const clock = (
        engine as unknown as Record<
          symbol,
          {
            setProgress(progress: number): boolean;
            snapshot(): TestClockSnapshot | null;
            renderFrame(): void;
          }
        >
      )[Symbol.for("meshtour.transitionTestClock")];
      if (!clock?.setProgress(value)) throw new Error("Transition test clock is unavailable");
      clock.renderFrame();
      return clock.snapshot();
    }, progress);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.from).toBe(from);
    expect(snapshot!.to).toBe(to);
    expect(snapshot!.progress).toBeCloseTo(progress, 6);
    expect(snapshot!.depthAReady).toBe(true);
    expect(snapshot!.depthBReady).toBe(true);
    metadata.push(snapshot!);

    const label = `${from}-to-${to}-${progress.toFixed(2)}`;
    await testInfo.attach(`${label}.png`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  }

  await testInfo.attach(`${from}-to-${to}.json`, {
    body: JSON.stringify(metadata, null, 2),
    contentType: "application/json",
  });
  await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const clock = (engine as unknown as Record<symbol, { complete(): boolean }>)[
      Symbol.for("meshtour.transitionTestClock")
    ];
    if (!clock?.complete()) throw new Error("Could not complete frozen transition");
  });
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getCurrentNode()))
    .toBe(to);
}

for (const tour of ["italian-flat", "italian-flat-v2"] as const) {
  test(`captures the ${tour} directed transition matrix deterministically`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_200_000);
    test.skip(
      testInfo.project.name === "mobile-chromium" && tour !== "italian-flat",
      "One reference tour supplies the mobile transition matrix",
    );
    const problems: string[] = [];
    page.on("console", (message) => {
      if (!["warning", "error"].includes(message.type())) return;
      if (message.text().includes("GPU stall due to ReadPixels")) return;
      problems.push(message.text());
    });
    page.on("pageerror", (error) => problems.push(error.message));

    await page.goto(`/?tour=${tour}&test=1`);
    await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

    // Exercise a selected transparent variant through the Italian Flat matrix.
    if (tour.startsWith("italian-flat")) {
      await page.evaluate(async () => {
        const engine = window.__MESHTOUR_TEST_ENGINE__!;
        const configurable = engine.getConfig()!.configurables[0];
        const variant = configurable?.variants.find((entry) => entry.id !== configurable.default);
        if (configurable && variant) await engine.setVariant(configurable.id, variant.id);
      });
    }

    const edges = (await directedEdges(page)).filter(
      ([from, to]) => !EDGE_FILTER || EDGE_FILTER === `${from}:${to}`,
    );
    expect(edges.length).toBeGreaterThan(0);
    for (const [from, to] of edges) await captureEdge(page, testInfo, from, to);
    expect(problems).toEqual([]);
  });
}
