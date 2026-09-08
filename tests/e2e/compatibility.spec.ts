import { expect, test } from "@playwright/test";

test("loads and navigates with WebGL2 across supported browser engines", async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/?tour=italian-flat", { waitUntil: "domcontentloaded" });
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const points = page.getByRole("navigation", { name: "Tour points" });
  const livingRoom = points.getByRole("button", { name: "Living Room" });
  await expect(livingRoom).toHaveAttribute("aria-current", "location", { timeout: 45_000 });
  await expect(livingRoom).toBeEnabled({ timeout: 45_000 });
  expect(
    await canvas.evaluate((element: HTMLCanvasElement) => Boolean(element.getContext("webgl2"))),
  ).toBe(true);

  const kitchen = points.getByRole("button", { name: "Kitchen & Dining" });
  await kitchen.click();
  await expect(kitchen).toHaveAttribute("aria-current", "location", { timeout: 45_000 });
  expect(errors).toEqual([]);
});
