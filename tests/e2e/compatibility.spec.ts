import { expect, test } from "@playwright/test";

test("loads and navigates with WebGL2 across supported browser engines", async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/?tour=italian-flat");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Living Room" }),
  ).toHaveAttribute("aria-current", "location");
  expect(
    await page.evaluate(() => Boolean(document.querySelector("canvas")?.getContext("webgl2"))),
  ).toBe(true);

  await page
    .getByRole("navigation", { name: "Tour points" })
    .getByRole("button", { name: "Kitchen & Dining" })
    .click();
  await expect(
    page
      .getByRole("navigation", { name: "Tour points" })
      .getByRole("button", { name: "Kitchen & Dining" }),
  ).toHaveAttribute("aria-current", "location");
  expect(errors).toEqual([]);
});
