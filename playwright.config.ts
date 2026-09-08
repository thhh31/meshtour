import { defineConfig, devices } from "@playwright/test";

const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const previewUrl = `http://127.0.0.1:${previewPort}`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  // Browser/GPU performance assertions are meaningful only without competing
  // workers sharing the same headless renderer.
  workers: 1,
  reporter: ci ? [["github"], ["list"]] : "list",
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{projectName}/{arg}{ext}",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.08,
    },
  },
  use: {
    baseURL: previewUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: ci ? "chromium" : undefined,
        viewport: { width: 1280, height: 720 },
        // Keep the same layout while reducing the render load on hosted runners.
        deviceScaleFactor: ci ? 0.5 : 1,
      },
      testMatch: /(?:demo|performance|transition-quality)\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
        channel: ci ? "chromium" : undefined,
        deviceScaleFactor: ci ? 1 : devices["Pixel 5"].deviceScaleFactor,
      },
      testMatch: /(?:mobile|performance|transition-quality)\.spec\.ts/,
    },
    {
      name: "desktop-firefox",
      use: { ...devices["Desktop Firefox"], viewport: { width: 1280, height: 720 } },
      testMatch: /compatibility\.spec\.ts/,
    },
    {
      name: "desktop-webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 720 } },
      testMatch: /compatibility\.spec\.ts/,
    },
    {
      name: "mobile-webkit",
      use: { ...devices["iPhone 13"] },
      testMatch: /compatibility\.spec\.ts/,
    },
  ],
  webServer: {
    command: `pnpm build && pnpm --filter @meshtour/demo build && pnpm --filter @meshtour/demo preview --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
