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
