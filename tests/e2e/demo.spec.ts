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

test("loads the latest Italian Flat by default and accepts an alternate tour URL", async ({
  page,
}) => {
  await page.goto("/?test=1");
  await page.waitForFunction(
    () =>
      window.__MESHTOUR_TEST_ENGINE__?.getConfig()?.name ===
      "Italian Flat v4 — Property Configurator",
  );

  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
  expect(
    await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.nodes.length),
  ).toBe(5);
  await expect(page.locator(".demo-title")).toHaveCount(0);
  await expect(page.locator(".demo-scene-switcher")).toHaveCount(0);

  await page.goto("/?tour=italian-flat-v2&test=1");
  await page.waitForFunction(
    () => window.__MESHTOUR_TEST_ENGINE__?.getConfig()?.name === "Italian Flat v2",
  );
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Kitchen & Dining" }),
  ).toBeVisible();
});

test("opens the demo material selector and changes flooring", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  const launcher = page.getByRole("button", { name: /Materials/ });
  await expect(launcher).toBeVisible();
  await expect(launcher.locator(".materials-panel-launcher-label")).toHaveCSS(
    "writing-mode",
    "vertical-rl",
  );
  await expect(page.getByRole("complementary", { name: "Material selector" })).toBeHidden();
  const openingClasses = await page.evaluate(() => {
    const panel = document.querySelector(".materials-panel")!;
    const launcher = document.querySelector<HTMLButtonElement>(".materials-panel-launcher")!;

    return new Promise<string[]>((resolve) => {
      const classes = [panel.className];
      let timeout = 0;
      const finish = () => {
        observer.disconnect();
        window.clearTimeout(timeout);
        resolve(classes);
      };
      const observer = new MutationObserver(() => {
        classes.push(panel.className);
        if (panel.classList.contains("is-open")) finish();
      });
      observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
      launcher.click();
      timeout = window.setTimeout(finish, 5_000);
    });
  });

  expect(openingClasses).toContain("materials-panel is-visible");
  expect(openingClasses).toContain("materials-panel is-visible is-open");

  const panel = page.getByRole("complementary", { name: "Material selector" });
  await expect(panel).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(panel.getByText("Flooring", { exact: true })).toBeVisible();
  const oak = panel.locator(".materials-option").filter({ hasText: "Natural European oak" });
  await oak.click();
  await expect(oak).toHaveAttribute("aria-pressed", "true", { timeout: 45_000 });
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("floor-finish")))
    .toBe("natural-oak");

  await panel.getByRole("button", { name: "Close materials" }).click();
  await expect(panel).toBeHidden();
  await expect(launcher).toBeVisible();
});

test("opens configured v4 material hotspots in synchronized popups", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  const panel = page.getByRole("complementary", { name: "Material selector" });
  await clickHotspot(page, "sofa_materials");
  const sofaPopup = page.getByRole("dialog", { name: "Sofa finish" });
  await expect(sofaPopup).toBeVisible();
  await expect(panel).toBeHidden();
  await sofaPopup.getByRole("button", { name: "Terracotta" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("sofa-finish")))
    .toBe("terracotta");
  await sofaPopup.getByRole("button", { name: "Close sofa finish" }).click();

  await clickHotspot(page, "floor_finishes");
  const flooringPopup = page.getByRole("dialog", { name: "Flooring" });
  await expect(flooringPopup).toBeVisible();
  await flooringPopup.getByRole("button", { name: "Natural European oak" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getVariant("floor-finish")))
    .toBe("natural-oak");

  await flooringPopup.getByRole("button", { name: "Close flooring" }).click();
  await page.getByRole("button", { name: /Materials/ }).click();
  await expect(
    panel.locator(".materials-group-trigger").filter({ hasText: "Natural European oak" }),
  ).toBeVisible();
});

test("collapses the guided tour into a compact launcher", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  await page.getByRole("button", { name: "Explore on my own" }).click();
  const launcher = page.getByRole("button", { name: "Open guided tour" });
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox).not.toBeNull();
  expect(launcherBox!.x).toBeLessThan(24);
  expect(launcherBox!.width).toBeLessThanOrEqual(44);

  await launcher.click();
  await page.getByRole("button", { name: /Start guided tour/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status), {
      timeout: 45_000,
    })
    .toBe("presenting");

  await page.getByRole("button", { name: "Close guided tour" }).click();
  await expect(launcher).toBeVisible();
  await launcher.click();
  await expect(page.getByRole("button", { name: /Start guided tour/ })).toBeVisible();
});

test("runs an interruptible spatial property story and restores visitor choices", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/?test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  const start = page.getByRole("button", { name: /Start guided tour/ });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page.getByText("One connected living sequence")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status), {
      timeout: 45_000,
    })
    .toBe("presenting");
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getViewMode())).toBe(
    "dollhouse",
  );
  const dollhouseSnapshot = await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.captureViewSnapshot(),
  );
  expect(dollhouseSnapshot.mode).toBe("dollhouse");
  if (dollhouseSnapshot.mode !== "dollhouse") throw new Error("Expected dollhouse snapshot");
  expect(dollhouseSnapshot.node).toBe("living");
  expect(dollhouseSnapshot.fov).toBe(45);
  dollhouseSnapshot.position.forEach((value, index) => {
    expect(value).toBeCloseTo([14.2, 10.2, 6.4][index]!, 6);
  });
  dollhouseSnapshot.target.forEach((value, index) => {
    expect(value).toBeCloseTo([3.49, 0.9, -4.95][index]!, 6);
  });

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("A living room you can make your own")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          status: window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status,
          node: window.__MESHTOUR_TEST_ENGINE__!.getCurrentNode(),
          sofa: window.__MESHTOUR_TEST_ENGINE__!.getVariant("sofa-finish"),
        })),
      { timeout: 60_000 },
    )
    .toEqual({ status: "presenting", node: "living", sofa: "ivory-boucle" });

  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" })
    .click();
  await expect(page.getByRole("button", { name: "Resume chapter" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status))
    .toBe("exploring");
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getCurrentNode()), {
      timeout: 60_000,
    })
    .toBe("lounge");
  await page.getByRole("button", { name: "Resume chapter" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getCurrentNode()), {
      timeout: 60_000,
    })
    .toBe("living");

  await page.getByRole("button", { name: /Go to chapter 4:/ }).click();
  await expect(page.getByText("Verify the footprint, not just the mood")).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          status: window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status,
          mode: window.__MESHTOUR_TEST_ENGINE__!.getViewMode(),
          measurements: window.__MESHTOUR_TEST_ENGINE__!.areMeasurementsVisible(),
        })),
      { timeout: 60_000 },
    )
    .toEqual({ status: "presenting", mode: "top", measurements: true });
  const topSnapshot = await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.captureViewSnapshot(),
  );
  expect(topSnapshot.mode).toBe("top");
  if (topSnapshot.mode !== "top") throw new Error("Expected top-view snapshot");
  expect(topSnapshot.center[0]).toBeCloseTo(3.49, 6);
  expect(topSnapshot.center[1]).toBeCloseTo(-4.9495, 6);
  expect(topSnapshot.zoom).toBeCloseTo(1, 6);

  await page.getByRole("button", { name: /Go to chapter 5:/ }).click();
  const cta = page.getByRole("link", { name: "Book a private viewing" });
  await expect(cta).toBeVisible();
  await page.evaluate(() => {
    (window as typeof window & { __GUIDE_ACTIONS__?: number }).__GUIDE_ACTIONS__ = 0;
    window.__MESHTOUR_TEST_ENGINE__!.on("guideaction", () => {
      const target = window as typeof window & { __GUIDE_ACTIONS__?: number };
      target.__GUIDE_ACTIONS__ = (target.__GUIDE_ACTIONS__ ?? 0) + 1;
    });
  });
  await cta.click();
  expect(await page.evaluate(() => location.hash)).toBe("#book-viewing");
  expect(
    await page.evaluate(
      () => (window as typeof window & { __GUIDE_ACTIONS__?: number }).__GUIDE_ACTIONS__,
    ),
  ).toBe(1);

  await page.getByRole("button", { name: "Close guided tour" }).click();
  const reopen = page.getByRole("button", { name: "Open guided tour" });
  await expect(reopen).toBeVisible();
  await expect(page.getByRole("button", { name: /Start guided tour/ })).toHaveCount(0);
  await reopen.click();
  await expect(page.getByRole("button", { name: /Start guided tour/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        status: window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status,
        sofa: window.__MESHTOUR_TEST_ENGINE__!.getVariant("sofa-finish"),
        measurements: window.__MESHTOUR_TEST_ENGINE__!.areMeasurementsVisible(),
      })),
    )
    .toEqual({ status: "idle", sofa: "original", measurements: false });
});

test("honors reduced motion while applying a guided chapter", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?test=1");
  await page.getByRole("button", { name: /Start guided tour/ }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status))
    .toBe("presenting");
  await page.getByRole("button", { name: "Next" }).click();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status))
    .toBe("presenting");
  const view = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getView());
  expect(view.yaw).toBeCloseTo(-0.295, 3);
  expect(view.pitch).toBeCloseTo(-0.03, 3);
});

test("captures, recaptures, and reorders guided chapters in author mode", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?test=1&author=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.isAuthorMode());
  const panel = page.locator(".meshtour-author-panel");
  await expect(panel.getByText("Guided stories")).toBeVisible();

  const answers = ["Buyer perspective", "A newly captured sales chapter"];
  page.on("dialog", async (dialog) => {
    await dialog.accept(answers.shift() ?? "");
  });
  await panel.getByRole("button", { name: "Capture current chapter" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.guides[0]!.steps.length),
    )
    .toBe(6);

  await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.setView(0.8, -0.1));
  await panel.getByRole("button", { name: "Recapture" }).last().click();
  const capturedView = await page.evaluate(
    () => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.guides[0]!.steps.at(-1)!.view,
  );
  expect(capturedView).toMatchObject({ mode: "panorama", node: "living", yaw: 0.8, pitch: -0.1 });

  await panel.getByRole("button", { name: "↑" }).last().click();
  expect(
    await page.evaluate(
      () => window.__MESHTOUR_TEST_ENGINE__!.getConfig()!.guides[0]!.steps.at(-2)!.title,
    ),
  ).toBe("Buyer perspective");
});

test("combines Italian Flat v3 panoramas in an orbitable dollhouse view", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleProblems: string[] = [];
  const panoramaPreviews = new Set<string>();
  page.on("console", (message) => {
    const isProblem = message.type() === "warning" || message.type() === "error";
    const isChromiumReadbackNotice = message.text().includes("GPU stall due to ReadPixels");
    if (isProblem && !isChromiumReadbackNotice) {
      consoleProblems.push(message.text());
    }
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (/\/italian-flat-v3\/pano\/(?:kitchen|living|lounge)_1k\.jpg$/.test(pathname)) {
      panoramaPreviews.add(pathname);
    }
  });
  await page.goto("/?test=1");
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
  await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.setVariant("sofa-finish", "terracotta"),
  );

  await expect(page.getByRole("button", { name: "Open dollhouse view" })).toBeVisible();
  await page.getByRole("button", { name: "Open dollhouse view" }).click();
  await expect(page.getByRole("button", { name: "Return to panorama" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('nav[aria-label="Tour points"] [aria-current]')).toHaveCount(0);
  const flightStart = await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const position = engine.getActiveCamera().position;
    const sharedLinks = engine.getScene().getObjectByName("meshtour_shared_links");
    return {
      state: engine.state,
      position: position.toArray(),
      sharedGroupVisible: sharedLinks?.visible,
      visibleSharedLinks: sharedLinks?.children.filter((child) => child.visible).length,
    };
  });
  expect(flightStart.state).toBe("transitioning");
  expect(flightStart.sharedGroupVisible).toBe(true);
  expect(flightStart.visibleSharedLinks).toBe(3);
  await expect
    .poll(() =>
      page.evaluate((start) => {
        const position = window.__MESHTOUR_TEST_ENGINE__!.getActiveCamera().position;
        return Math.hypot(position.x - start[0], position.y - start[1], position.z - start[2]);
      }, flightStart.position),
    )
    .toBeGreaterThan(0.01);
  await expect.poll(() => panoramaPreviews.size).toBe(3);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const engine = window.__MESHTOUR_TEST_ENGINE__!;
        let topViewProjection: "pending" | "enabled" | "disabled" = "pending";
        engine.getScene().traverse((object) => {
          const material = (object as { material?: { name?: string; uniforms?: object } }).material;
          if (material?.name?.startsWith("meshtour_dollhouse_projection_") && material.uniforms) {
            topViewProjection = "uTopView" in material.uniforms ? "enabled" : "disabled";
          }
        });
        return topViewProjection;
      }),
    )
    .toBe("disabled");

  await expect
    .poll(() =>
      page.evaluate(() => {
        const textures = new Set<string>();
        window.__MESHTOUR_TEST_ENGINE__!.getScene().traverse((object) => {
          const material = (object as { material?: { name?: string; uniforms?: object } }).material;
          if (!material?.name?.endsWith("_layer") || !material.uniforms) return;
          const uniforms = material.uniforms as Record<string, { value?: unknown }>;
          for (let index = 0; `uHasLayer${index}` in uniforms; index += 1) {
            if (uniforms[`uHasLayer${index}`]?.value !== 1) continue;
            const texture = uniforms[`uLayer${index}`]?.value as { uuid?: string } | undefined;
            if (texture?.uuid) textures.add(texture.uuid);
          }
        });
        return [...textures].sort();
      }),
    )
    .not.toEqual([]);
  const selectedLayerTextures = await page.evaluate(() => {
    const textures = new Set<string>();
    window.__MESHTOUR_TEST_ENGINE__!.getScene().traverse((object) => {
      const material = (object as { material?: { name?: string; uniforms?: object } }).material;
      if (!material?.name?.endsWith("_layer") || !material.uniforms) return;
      const uniforms = material.uniforms as Record<string, { value?: unknown }>;
      for (let index = 0; `uHasLayer${index}` in uniforms; index += 1) {
        if (uniforms[`uHasLayer${index}`]?.value !== 1) continue;
        const texture = uniforms[`uLayer${index}`]?.value as { uuid?: string } | undefined;
        if (texture?.uuid) textures.add(texture.uuid);
      }
    });
    return [...textures].sort();
  });

  await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.setVariant("sofa-finish", "ivory-boucle"),
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const textures = new Set<string>();
        window.__MESHTOUR_TEST_ENGINE__!.getScene().traverse((object) => {
          const material = (object as { material?: { name?: string; uniforms?: object } }).material;
          if (!material?.name?.endsWith("_layer") || !material.uniforms) return;
          const uniforms = material.uniforms as Record<string, { value?: unknown }>;
          for (let index = 0; `uHasLayer${index}` in uniforms; index += 1) {
            if (uniforms[`uHasLayer${index}`]?.value !== 1) continue;
            const texture = uniforms[`uLayer${index}`]?.value as { uuid?: string } | undefined;
            if (texture?.uuid) textures.add(texture.uuid);
          }
        });
        return [...textures].sort();
      }),
    )
    .not.toEqual(selectedLayerTextures);

  await page.getByRole("button", { name: "Return to panorama" }).click();
  await expect(page.getByRole("button", { name: "Open dollhouse view" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  const returnFlight = await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const skysphere = engine.getScene().getObjectByName("meshtour_panorama_skysphere");
    let dollhouseMaterials = 0;
    engine.getScene().traverse((object) => {
      const material = (object as { material?: { name?: string } }).material;
      if (material?.name?.startsWith("meshtour_dollhouse_projection_")) {
        dollhouseMaterials += 1;
      }
    });
    return { skysphereVisible: skysphere?.visible, dollhouseMaterials };
  });
  expect(returnFlight.skysphereVisible).toBe(false);
  expect(returnFlight.dollhouseMaterials).toBeGreaterThan(0);
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.state), { timeout: 30_000 })
    .toBe("ready");
  expect(
    await page.evaluate(
      () =>
        window.__MESHTOUR_TEST_ENGINE__!.getScene().getObjectByName("meshtour_panorama_skysphere")
          ?.visible,
    ),
  ).toBe(true);
  expect(consoleProblems).toEqual([]);
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

  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" })
    .click({ noWaitAfter: true });
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
  await expect(
    page.getByRole("region", { name: "Apartment plan" }).getByRole("button"),
  ).toHaveCount(3);
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
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Kitchen & Dining" }),
  ).toHaveAttribute("aria-current", "location");
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
    const button = page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: point });
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  }

  releaseConfig();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
});

test("disables point buttons until a scene transition finishes", async ({ page }) => {
  await page.goto("/?tour=italian-flat&test=1");
  const lounge = page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" });
  const kitchen = page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Kitchen & Dining" });

  await lounge.click({ noWaitAfter: true });
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "transitioning");
  await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const clock = (engine as unknown as Record<symbol, { setProgress(progress: number): boolean }>)[
      Symbol.for("meshtour.transitionTestClock")
    ];
    if (!clock?.setProgress(0.5)) throw new Error("Transition clock unavailable");
  });

  await expect(lounge).toBeDisabled();
  await expect(kitchen).toBeDisabled();
  await kitchen.click({ force: true });
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.state)).toBe("transitioning");

  await page.evaluate(() => {
    const engine = window.__MESHTOUR_TEST_ENGINE__!;
    const clock = (engine as unknown as Record<symbol, { complete(): boolean }>)[
      Symbol.for("meshtour.transitionTestClock")
    ];
    if (!clock?.complete()) throw new Error("Transition clock unavailable");
  });
  await expect(lounge).toHaveAttribute("aria-current", "location");
  await expect(kitchen).toBeEnabled();
});

test("loads the production tour and walks between nodes", async ({ page }) => {
  test.setTimeout(90_000);
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
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
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

  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Library Lounge" }),
  ).toHaveAttribute("aria-current", "location", { timeout: 45_000 });
  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Kitchen & Dining" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Kitchen & Dining" }),
  ).toHaveAttribute("aria-current", "location", { timeout: 45_000 });
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
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");

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

  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Library Lounge" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Library Lounge" }),
  ).toHaveAttribute("aria-current", "location", { timeout: 30_000 });
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
