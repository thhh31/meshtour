import { expect, test, type Page } from "@playwright/test";

async function expectNoPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Could not read IES")) {
      errors.push(message.text());
    }
  });
  return () => expect(errors).toEqual([]);
}

test("configures, shares, restores and emits a SKU-level lead", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const verifyErrors = await expectNoPageErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Make it yours" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Warm Contemporary/ })).toBeVisible();

  await page.getByRole("button", { name: /Warm Contemporary/ }).click();
  await expect(page.getByRole("button", { name: /Warm Contemporary/ })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 45_000 },
  );
  await expect(page.getByText("€505,250")).toBeVisible();

  const compare = page.getByRole("button", { name: "Hold for original" });
  await compare.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse" });
  await expect(page.getByRole("button", { name: /Developer Standard/ })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 45_000 },
  );
  await page
    .getByRole("button", { name: "Release to restore" })
    .dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse" });
  await expect(page.getByRole("button", { name: /Warm Contemporary/ })).toHaveAttribute(
    "aria-pressed",
    "true",
    { timeout: 45_000 },
  );

  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByText(/Share link/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("configuration")).toBeTruthy();

  await page.reload();
  await expect(page.getByText("Shared specification restored")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: /Warm Contemporary/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Request this home" }).click();
  await expect(page.getByRole("dialog", { name: "Request this home" })).toBeVisible();
  await page.getByLabel("Name").fill("Ada Buyer");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByRole("button", { name: "Send specification" }).click();
  await expect(page.getByText("Your home is ready for review.")).toBeVisible();
  const lead = await page.evaluate(() => window.__MESHTOUR_LAST_LEAD__);
  expect(lead).toMatchObject({
    tourId: "italian-flat-v4",
    contact: { name: "Ada Buyer", email: "ada@example.com" },
    configuration: {
      catalogVersion: "italian-flat-v4-2026-08",
      selections: { flooring: "natural-oak", kitchen: "smoked-walnut" },
      presetId: "warm-contemporary",
    },
  });

  await page.screenshot({ path: testInfo.outputPath("configured-home.png"), fullPage: true });
  verifyErrors();
});

test("enforces dependencies and keeps the phone configurator inside the viewport", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const verifyErrors = await expectNoPageErrors(page);
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) await page.getByRole("button", { name: /Configure/ }).click();
  await expect(page.getByRole("complementary", { name: "Home configurator" })).toBeVisible();

  await page.getByRole("button", { name: /Living room sofa/ }).click();
  const forest = page.locator(".option-card").filter({ hasText: "Forest velvet" });
  await expect(forest).toBeDisabled();

  await page.getByRole("button", { name: /Living room rug/ }).click();
  await page.getByRole("button", { name: /Sand wool/ }).click();
  await page.getByRole("button", { name: /Living room sofa/ }).click();
  await expect(forest).toBeEnabled();
  await forest.click();
  await expect(forest).toHaveAttribute("aria-pressed", "true", { timeout: 45_000 });

  if (mobile) {
    const panel = page.getByRole("complementary", { name: "Home configurator" });
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
  }
  verifyErrors();
});
