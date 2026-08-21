import { expect, test, type Page } from "@playwright/test";

async function clickHotspot(page: Page, hotspotId: string) {
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const hotspotScreen = await page.evaluate((id) => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const hotspot = engine.getConfig()!.hotspots.find((entry) => entry.id === id)!;
    engine.lookAt(hotspot.position);
    return engine.worldToScreen(hotspot.position);
  }, hotspotId);
  expect(hotspotScreen.visible).toBe(true);
  await page.waitForTimeout(150);
  await page.mouse.click(box!.x + hotspotScreen.x, box!.y + hotspotScreen.y);
}

test("loads Italian Flat by default and accepts an alternate tour URL", async ({ page }) => {
  await page.goto("/?test=1");
  await page.waitForFunction(
    () => window.__MESHTOUR_TEST_ENGINE__?.getConfig()?.name === "Italian Flat Demo",
  );

  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  expect(
    await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.nodes.length),
  ).toBe(3);
  await expect(page.locator(".demo-title")).toHaveCount(0);
  await expect(page.locator(".demo-scene-switcher")).toHaveCount(0);

  await page.goto("/?tour=italian-flat-v2&test=1");
  await page.waitForFunction(
    () => window.__MESHTOUR_TEST_ENGINE__?.getConfig()?.name === "Italian Flat v2",
  );
  await expect(page.getByRole("button", { name: "Kitchen & Dining" })).toBeVisible();
});

test("loads Italian Flat v2 with dedicated visibility and furniture-safe paths", async ({
  page,
}) => {
  const assetResponses = new Map<string, number>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/tours/italian-flat-v2/")) {
      assetResponses.set(url.pathname, response.status());
    }
  });

  await page.goto("/?tour=italian-flat-v2&test=1");
  await page.waitForFunction(
    () => window.__MESHTOUR_TEST_ENGINE__?.getConfig()?.name === "Italian Flat v2",
  );

  const capability = await page.evaluate(() => {
    const config = window.__MESHTOUR_TEST_ENGINE__!.getConfig()!;
    return {
      basePath: config.assets.basePath,
      visibility: config.assets.visibilityMesh?.url,
      sharedLinks: config.links.length,
      directedLinks: config.nodes.reduce((sum, node) => sum + node.links.length, 0),
      paths: config.nodes.flatMap((node) => node.links).filter((link) => link.path).length,
    };
  });
  expect(capability).toEqual({
    basePath: "./tours/italian-flat-v2/",
    visibility: "mesh/transition-visibility.glb?v=1",
    sharedLinks: 0,
    directedLinks: 6,
    paths: 6,
  });
  await expect
    .poll(() => assetResponses.get("/tours/italian-flat-v2/mesh/transition-visibility.glb"))
    .toBe(200);

  await page.getByRole("button", { name: "Library Lounge" }).click({ noWaitAfter: true });
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "transitioning");
  const midpoint = await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const clock = (
      engine as unknown as Record<
        symbol,
        {
          setProgress(progress: number): boolean;
          snapshot(): { camera: [number, number, number]; blend: number } | null;
        }
      >
    )[Symbol.for("meshtour.transitionTestClock")];
    if (!clock?.setProgress(0.4)) throw new Error("Transition clock unavailable");
    const earlyBlend = clock.snapshot()!.blend;
    clock.setProgress(0.5);
    return {
      ...clock.snapshot()!,
      earlyBlend,
      curtainOpacity: Number(
        getComputedStyle(document.querySelector(".meshtour-transition-curtain")!).opacity,
      ),
    };
  });
  expect(midpoint.camera[0]).toBeLessThan(1.5);
  expect(midpoint.earlyBlend).toBeGreaterThan(0);
  expect(midpoint.blend).toBeCloseTo(0.5);
  expect(midpoint.curtainOpacity).toBe(0);
});

test("provides an automatic plan, measurements, textured top view, and fullscreen control", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/?tour=italian-flat&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__ !== undefined);

  await expect(page.getByRole("region", { name: "Apartment plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Plan point/ })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Enter fullscreen" })).toBeVisible();
  const headingCone = page.getByRole("region", { name: "Apartment plan" }).locator("polygon");
  const initialCone = await headingCone.getAttribute("points");
  expect(initialCone).not.toBeNull();
  await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.setView(Math.PI / 2, 0));
  await expect.poll(() => headingCone.getAttribute("points")).not.toBe(initialCone);
  const [origin, leftEdge, rightEdge] = (await headingCone.getAttribute("points"))!
    .split(" ")
    .map((point) => point.split(",").map(Number));
  expect((leftEdge![0]! + rightEdge![0]!) / 2).toBeLessThan(origin![0]! - 20);
  expect((leftEdge![1]! + rightEdge![1]!) / 2).toBeCloseTo(origin![1]!, 4);
  expect(
    await page.evaluate(() =>
      Boolean(window.__MESHTOUR_TEST_ENGINE__!.getScene().getObjectByName("meshtour_ceiling")),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.spatial.overview.topView?.url,
    ),
  ).toBe("overview/top.jpg");

  await page.getByRole("button", { name: "Show measurements" }).click();
  await expect(page.getByRole("button", { name: "Hide measurements" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.areMeasurementsVisible())).toBe(
    true,
  );
  await expect(page.getByText("Height 0.76 m").first()).toBeAttached();
  expect(
    await page.evaluate(() => {
      const group = window
        .__MESHTOUR_TEST_ENGINE__!.getScene()
        .getObjectByName("meshtour_measurements");
      return group?.children.some((child) => {
        const material = (
          child as typeof child & {
            material?: { color?: { getHexString(): string }; depthTest: boolean };
          }
        ).material;
        return material?.color?.getHexString() === "58d3f7" && material.depthTest === false;
      });
    }),
  ).toBe(true);

  await page.getByRole("button", { name: "Open top view" }).click();
  await expect(page.getByRole("button", { name: "Return to panorama" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__MESHTOUR_TEST_ENGINE__!.getScene().getObjectByName("meshtour_top_view")?.visible,
      ),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => ({
      mode: window.__MESHTOUR_TEST_ENGINE__!.getViewMode(),
      camera: window.__MESHTOUR_TEST_ENGINE__!.getActiveCamera().type,
      renderedTopVisible: window
        .__MESHTOUR_TEST_ENGINE__!.getScene()
        .getObjectByName("meshtour_top_view")!.visible,
      ceilingVisible: window
        .__MESHTOUR_TEST_ENGINE__!.getScene()
        .getObjectByName("meshtour_ceiling")!.visible,
    })),
  ).toEqual({
    mode: "top",
    camera: "OrthographicCamera",
    renderedTopVisible: true,
    ceilingVisible: false,
  });
  await expect(page.getByText("Width 6.98 m").first()).toBeVisible();

  await page.getByRole("button", { name: "Return to panorama" }).click();
  expect(
    await page.evaluate(() => ({
      mode: window.__MESHTOUR_TEST_ENGINE__!.getViewMode(),
      camera: window.__MESHTOUR_TEST_ENGINE__!.getActiveCamera().type,
      renderedTopVisible: window
        .__MESHTOUR_TEST_ENGINE__!.getScene()
        .getObjectByName("meshtour_top_view")!.visible,
      ceilingVisible: window
        .__MESHTOUR_TEST_ENGINE__!.getScene()
        .getObjectByName("meshtour_ceiling")!.visible,
    })),
  ).toEqual({
    mode: "panorama",
    camera: "PerspectiveCamera",
    renderedTopVisible: false,
    ceilingVisible: true,
  });

  await page.getByRole("button", { name: "Open top view" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const scene = window.__MESHTOUR_TEST_ENGINE__!.getScene();
        return {
          kitchenLink: scene.getObjectByName("meshtour_link_shared_to_kitchen")?.parent?.visible,
          currentLivingLink: scene.getObjectByName("meshtour_link_shared_to_living")?.visible,
          loungeLink: scene.getObjectByName("meshtour_link_shared_to_lounge")?.parent?.visible,
        };
      }),
    )
    .toEqual({ kitchenLink: true, currentLivingLink: false, loungeLink: true });

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const kitchenLink = await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    return engine.worldToScreen(
      engine.getConfig()!.links.find((link) => link.to === "kitchen")!.position,
    );
  });
  await page.mouse.click(box!.x + kitchenLink.x, box!.y + kitchenLink.y);
  await expect(page.getByRole("button", { name: "Kitchen & Dining" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getViewMode())).toBe(
    "panorama",
  );
  expect(
    await page.evaluate(() => {
      const scene = window.__MESHTOUR_TEST_ENGINE__!.getScene();
      return {
        currentKitchenLink: scene.getObjectByName("meshtour_link_shared_to_kitchen")?.visible,
        livingLink: scene.getObjectByName("meshtour_link_shared_to_living")?.visible,
      };
    }),
  ).toEqual({ currentKitchenLink: false, livingLink: true });
});

test("keeps all point buttons visible while the Italian Flat is loading", async ({ page }) => {
  let releaseConfig!: () => void;
  const configGate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  await page.route("**/tours/italian-flat/tour.json*", async (route) => {
    await configGate;
    await route.continue();
  });

  await page.goto("/?tour=italian-flat", { waitUntil: "domcontentloaded" });
  for (const point of ["Kitchen & Dining", "Living Room", "Library Lounge"]) {
    const button = page.getByRole("button", { name: point });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  }

  releaseConfig();
  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );
});

test("loads the production tour and walks between nodes", async ({ page }) => {
  const consoleProblems: string[] = [];
  const assetResponses = new Map<string, number>();

  page.on("console", (message) => {
    const isProblem = message.type() === "warning" || message.type() === "error";
    const isChromiumReadbackNotice = message.text().includes("GPU stall due to ReadPixels");
    if (isProblem && !isChromiumReadbackNotice) {
      consoleProblems.push(message.text());
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (/italian-flat|basis_transcoder|draco_/.test(url.pathname)) {
      assetResponses.set(url.pathname, response.status());
    }
  });

  await page.goto("/?tour=italian-flat&test=1");
  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const viewBeforeNavigation = await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.getView(),
  );

  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const requiredAssets = [
    "/tours/italian-flat/tour.json",
    "/tours/italian-flat/mesh/apartment.glb",
    "/tours/italian-flat/pano/living_1k.jpg",
    "/tours/italian-flat/pano/living_4k.ktx2",
    "/vendor/basis/basis_transcoder.wasm",
  ];
  await expect
    .poll(() => requiredAssets.map((path) => [path, assetResponses.get(path) ?? null]))
    .toEqual(requiredAssets.map((path) => [path, 200]));
  await expect
    .poll(() =>
      [...assetResponses].some(
        ([path, status]) => path.startsWith("/vendor/draco/") && status === 200,
      ),
    )
    .toBe(true);

  await page.getByRole("button", { name: "Library Lounge" }).click();
  await expect(page.getByRole("button", { name: "Library Lounge" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  await page.getByRole("button", { name: "Kitchen & Dining" }).click();
  await expect(page.getByRole("button", { name: "Kitchen & Dining" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const viewAfterNavigation = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getView());
  expect(viewAfterNavigation.yaw).toBeCloseTo(viewBeforeNavigation.yaw, 4);
  expect(viewAfterNavigation.pitch).toBeCloseTo(viewBeforeNavigation.pitch, 4);
  await expect(page).toHaveScreenshot("dining-room.png");
  expect(consoleProblems).toEqual([]);
});

test("applies independent furniture layers and keeps them across nodes", async ({ page }) => {
  test.setTimeout(120_000);
  const layerResponses = new Map<string, number>();
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("/layers/")) {
      layerResponses.set(url.pathname, response.status());
    }
  });

  await page.goto("/?tour=italian-flat&test=1");
  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );

  await clickHotspot(page, "sofa_materials");
  await expect(page.getByRole("dialog", { name: "Sofa finish" })).toBeVisible();
  await page.getByRole("button", { name: "Terracotta" }).click();
  await expect(page.getByRole("button", { name: "Terracotta" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("sofa-finish")))
    .toBe("terracotta");
  expect(layerResponses.get("/tours/italian-flat/layers/sofa/terracotta/living_4k.png")).toBe(200);

  await page.getByRole("button", { name: "Close sofa finish" }).click();
  await clickHotspot(page, "rug_materials");
  await expect(page.getByRole("dialog", { name: "Rug finish" })).toBeVisible();
  await page.getByRole("button", { name: "Sage weave" }).click();
  await expect(page.getByRole("button", { name: "Sage weave" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(layerResponses.get("/tours/italian-flat/layers/rug/sage-weave/living_4k.png")).toBe(200);

  await page.getByRole("button", { name: "Close rug finish" }).click();
  await clickHotspot(page, "chair_materials");
  await expect(page.getByRole("dialog", { name: "Lounge chair style" })).toBeVisible();
  await page.getByRole("button", { name: "Cognac leather" }).click();
  await expect(page.getByRole("button", { name: "Cognac leather" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(layerResponses.get("/tours/italian-flat/layers/chair/cognac-leather/living_4k.png")).toBe(
    200,
  );

  await page.getByRole("button", { name: "Library Lounge" }).click();
  await expect(page.getByRole("button", { name: "Library Lounge" })).toHaveAttribute(
    "aria-current",
    "location",
    { timeout: 30_000 },
  );
  expect(layerResponses.get("/tours/italian-flat/layers/sofa/terracotta/lounge_4k.png")).toBe(200);
  expect(layerResponses.get("/tours/italian-flat/layers/rug/sage-weave/lounge_4k.png")).toBe(200);
  expect(layerResponses.get("/tours/italian-flat/layers/chair/cognac-leather/lounge_4k.png")).toBe(
    200,
  );
  expect(
    await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("sofa-finish")),
  ).toBe("terracotta");
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("rug-finish"))).toBe(
    "sage-weave",
  );
  expect(
    await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("lounge-chair-style")),
  ).toBe("cognac-leather");

  await clickHotspot(page, "sofa_materials");
  await expect(page.getByRole("dialog", { name: "Sofa finish" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Terracotta" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Original grey" }).click();
  await expect(page.getByRole("button", { name: "Original grey" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("authors and exports hotspots and links", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/?tour=italian-flat&author=1");
  await expect(page.getByText("MeshTour author mode", { exact: true })).toBeVisible();
  const wireframe = page.getByLabel("Show proxy wireframe");
  await wireframe.check();
  await expect(wireframe).toBeChecked();

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const scenePoint = { x: box!.x + box!.width * 0.5, y: box!.y + box!.height * 0.48 };
  const floorPoint = { x: box!.x + box!.width * 0.28, y: box!.y + box!.height * 0.72 };

  await page.getByRole("button", { name: "+ Hotspot" }).click();
  await page.mouse.click(scenePoint.x, scenePoint.y);
  await expect(page.getByText(/added hotspot hs_/)).toBeVisible();

  const copyJson = async () => {
    await page.getByRole("button", { name: "Copy JSON" }).click();
    return JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  };
  const afterHotspot = await copyJson();
  expect(afterHotspot.hotspots).toHaveLength(5);
  const authoredHotspot = afterHotspot.hotspots.at(-1);
  expect(authoredHotspot.node).toBe("living");

  await page.mouse.move(scenePoint.x, scenePoint.y);
  await page.mouse.down();
  await page.mouse.move(scenePoint.x + 70, scenePoint.y + 25, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText(/moved hs_/)).toBeVisible();
  const afterHotspotDrag = await copyJson();
  expect(afterHotspotDrag.hotspots.at(-1).position).not.toEqual(authoredHotspot.position);

  await page.getByRole("button", { name: "+ Link" }).click();
  await page.getByText("Link to:").locator("..").locator("select").selectOption("kitchen");
  await page.mouse.click(floorPoint.x, floorPoint.y);
  await expect(page.getByText("added link → kitchen", { exact: false })).toBeVisible();
  const afterLink = await copyJson();
  const living = afterLink.nodes.find((node: { id: string }) => node.id === "living");
  expect(afterLink.links).toHaveLength(3);
  expect(living.links).toHaveLength(1);
  const authoredLink = living.links.at(-1);

  await page.waitForTimeout(100);
  await page.mouse.move(floorPoint.x, floorPoint.y);
  await page.mouse.down();
  await page.mouse.move(floorPoint.x + 65, floorPoint.y - 20, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText("moved link living → kitchen", { exact: false })).toBeVisible();
  const afterLinkDrag = await copyJson();
  const movedLiving = afterLinkDrag.nodes.find((node: { id: string }) => node.id === "living");
  expect(movedLiving.links.at(-1).position).not.toEqual(authoredLink.position);

  const yawBefore = movedLiving.panorama.yaw;
  await page.getByRole("button", { name: "+2°" }).click();
  const afterYaw = await copyJson();
  expect(afterYaw.nodes.find((node: { id: string }) => node.id === "living").panorama.yaw).toBe(
    yawBefore + (2 * Math.PI) / 180,
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  await expect((await downloadPromise).suggestedFilename()).toBe("tour.json");
});

test("supports pointer look and wheel zoom", async ({ page }) => {
  await page.goto("/?tour=italian-flat&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__ !== undefined);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const before = await page.evaluate(() => ({
    ...window.__MESHTOUR_TEST_ENGINE__!.getView(),
    fov: window.__MESHTOUR_TEST_ENGINE__!.getCamera().fov,
  }));
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2 + 25, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const afterDrag = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getView());
  expect(afterDrag.yaw).not.toBeCloseTo(before.yaw, 3);
  expect(afterDrag.pitch).not.toBeCloseTo(before.pitch, 3);

  await page.mouse.wheel(0, 300);
  const afterWheelFov = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getCamera().fov);
  expect(afterWheelFov).toBeGreaterThan(before.fov);
  expect(afterWheelFov).toBeLessThanOrEqual(95);
});

test("opens hotspots and emits mesh interaction ids", async ({ page }) => {
  await page.goto("/?tour=italian-flat&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__ !== undefined);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  expect(
    await page.evaluate(
      () =>
        window
          .__MESHTOUR_TEST_ENGINE__!.getConfig()!
          .hotspots.find((entry) => entry.id === "sofa_materials")!.position,
    ),
  ).toEqual([2.45, 0.618, -6.872]);
  await clickHotspot(page, "sofa_materials");
  await expect(page.getByRole("dialog", { name: "Sofa finish" })).toBeVisible();
  await page.getByRole("button", { name: "Close sofa finish" }).click();
  await expect(page.getByRole("dialog", { name: "Sofa finish" })).toBeHidden();

  await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    engine.setHotspotsVisible(false);
    engine.lookAt([2.15, 0.65, -7]);
  });
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_EVENTS__!.hovered))
    .toMatch(/^sofa/);
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_EVENTS__!.clicked))
    .toMatch(/^sofa/);
});
