import { expect, test } from "@playwright/test";

test("keeps the dollhouse toggle inside a phone viewport", async ({ page }) => {
  await page.goto("/?test=1");
  const button = page.getByRole("button", { name: "Open dollhouse view" });
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
});

test("keeps the collapsed material selector and panel inside a phone viewport", async ({
  page,
}) => {
  await page.goto("/?tour=italian-flat-v4&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  const launcher = page.getByRole("button", { name: /Materials/ });
  const panel = page.getByRole("complementary", { name: "Material selector" });
  await expect(launcher).toBeVisible();
  await expect(panel).toBeHidden();
  await launcher.click();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
});

test("keeps the selected tour point visible after the viewport changes", async ({ page }) => {
  await page.goto("/?tour=italian-flat-v3&test=1");
  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );

  const indicator = page
    .getByRole("navigation", { name: "Tour points" })
    .locator(":scope > div[aria-hidden='true']");
  await expect(indicator).toHaveCSS("opacity", "1");

  await page.setViewportSize({ width: 545, height: 720 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await expect(indicator).toHaveCSS("opacity", "1");
});

test("keeps the selection pill aligned with the active tour point", async ({ page }) => {
  await page.goto("/?tour=italian-flat-v4&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");

  const navigation = page.getByRole("navigation", { name: "Tour points" });
  const target = navigation.getByRole("button", { name: "Point 4: Living Window", exact: true });
  const indicator = navigation.locator(":scope > div[aria-hidden='true']");

  await target.click();
  await expect(target).toHaveAttribute("aria-current", "location", { timeout: 45_000 });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );

  const targetBox = await target.boundingBox();
  const indicatorBox = await indicator.boundingBox();
  expect(targetBox).not.toBeNull();
  expect(indicatorBox).not.toBeNull();
  expect(Math.abs(indicatorBox!.x - targetBox!.x)).toBeLessThan(1);
  expect(Math.abs(indicatorBox!.width - targetBox!.width)).toBeLessThan(1);

  const navigationBox = await navigation.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(targetBox!.x).toBeGreaterThanOrEqual(navigationBox!.x);
  expect(targetBox!.x + targetBox!.width).toBeLessThanOrEqual(
    navigationBox!.x + navigationBox!.width,
  );
});

test("keeps the guided-story card and actions inside a phone viewport", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?test=1");
  const start = page.getByRole("button", { name: /Start guided tour/ });
  await expect(start).toBeVisible();
  const viewport = page.viewportSize();
  const invitation = page.getByRole("complementary", { name: "Guided property tour" });
  const invitationBox = await invitation.boundingBox();
  expect(viewport).not.toBeNull();
  expect(invitationBox).not.toBeNull();
  expect(invitationBox!.x).toBeGreaterThanOrEqual(0);
  expect(invitationBox!.x + invitationBox!.width).toBeLessThanOrEqual(viewport!.width);

  await page.getByRole("button", { name: "Explore on my own" }).click();
  const launcher = page.getByRole("button", { name: "Open guided tour" });
  await expect(launcher).toBeVisible();
  const launcherBox = await launcher.boundingBox();
  expect(launcherBox).not.toBeNull();
  expect(launcherBox!.x).toBeLessThan(24);
  expect(launcherBox!.width).toBeLessThanOrEqual(44);
  await launcher.click();

  await start.click();
  const story = page.getByRole("region", { name: /guided tour/ });
  await expect(story).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getGuideState().status), {
      timeout: 45_000,
    })
    .toBe("presenting");
  const storyBox = await story.boundingBox();
  expect(storyBox).not.toBeNull();
  expect(storyBox!.x).toBeGreaterThanOrEqual(0);
  expect(storyBox!.x + storyBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(storyBox!.y + storyBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(page.getByRole("button", { name: "Next" })).toBeVisible();
});

test("keeps the tour controls usable on a phone viewport", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/?tour=italian-flat&test=1");
  await expect(page.getByRole("button", { name: "Living Room" })).toHaveAttribute(
    "aria-current",
    "location",
  );
  const viewBeforeNavigation = await page.evaluate(() =>
    window.__MESHTOUR_TEST_ENGINE__!.getView(),
  );

  const controls = page.getByLabel("Tour points");
  const plan = page.getByRole("region", { name: "Apartment plan" });
  const spatialTools = page.getByRole("toolbar", { name: "Spatial tools" });
  const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
  const controlBox = await controls.boundingBox();
  expect(controlBox).not.toBeNull();
  expect(controlBox!.width).toBeLessThanOrEqual(viewportWidth);
  const planBox = await plan.boundingBox();
  const spatialBox = await spatialTools.boundingBox();
  expect(planBox).not.toBeNull();
  expect(spatialBox).not.toBeNull();
  expect(planBox!.x).toBeGreaterThanOrEqual(0);
  expect(planBox!.x + planBox!.width).toBeLessThanOrEqual(viewportWidth);
  expect(spatialBox!.x + spatialBox!.width).toBeLessThanOrEqual(viewportWidth);
  for (const point of ["Kitchen & Dining", "Living Room", "Library Lounge"]) {
    const button = page.getByRole("button", { name: point });
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
  }

  await page.getByRole("button", { name: "Library Lounge" }).click();
  await expect(page.getByRole("button", { name: "Library Lounge" })).toHaveAttribute(
    "aria-current",
    "location",
    { timeout: 45_000 },
  );
  const viewAfterNavigation = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getView());
  expect(viewAfterNavigation.yaw).toBeCloseTo(viewBeforeNavigation.yaw, 4);
  expect(viewAfterNavigation.pitch).toBeCloseTo(viewBeforeNavigation.pitch, 4);
  await page.getByRole("button", { name: "Open top view" }).click();
  await expect(page.getByRole("button", { name: "Return to panorama" })).toBeVisible();
  expect(await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getViewMode())).toBe("top");
  await page.getByRole("button", { name: "Return to panorama" }).click();
  await expect(page).toHaveScreenshot("mobile-lounge.png");
});

test("supports touch drag and pinch zoom", async ({ page, context }) => {
  await page.goto("/?tour=italian-flat&test=1");
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__ !== undefined);
  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const cdp = await context.newCDPSession(page);

  const before = await page.evaluate(() => ({
    ...window.__MESHTOUR_TEST_ENGINE__!.getView(),
    fov: window.__MESHTOUR_TEST_ENGINE__!.getCamera().fov,
  }));
  const start = { x: box!.x + box!.width * 0.3, y: box!.y + box!.height * 0.45 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: start.x + 70, y: start.y - 25 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
  const afterDrag = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getView());
  expect(afterDrag.yaw).not.toBeCloseTo(before.yaw, 3);
  expect(afterDrag.pitch).not.toBeCloseTo(before.pitch, 3);

  const left = { x: box!.x + box!.width * 0.35, y: box!.y + box!.height * 0.5 };
  const right = { x: box!.x + box!.width * 0.65, y: box!.y + box!.height * 0.5 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [left, right],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: left.x - 35, y: left.y },
      { x: right.x + 35, y: right.y },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const afterPinchFov = await page.evaluate(() => window.__MESHTOUR_TEST_ENGINE__!.getCamera().fov);
  expect(afterPinchFov).toBeLessThan(before.fov);
  expect(afterPinchFov).toBeGreaterThanOrEqual(40);
});
