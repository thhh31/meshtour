import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoUrl = process.argv[2] ?? "http://127.0.0.1:4173/";
const output = path.resolve(
  process.argv[3] ?? path.join(projectRoot, "test-results/recording/italian-flat.webm"),
);
const recordingDirectory = await mkdtemp(path.join(tmpdir(), "meshtour-recording-"));

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: recordingDirectory, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const recordingUrl = new URL(demoUrl);
  recordingUrl.searchParams.set("test", "1");
  await page.goto(recordingUrl.href);
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__?.state === "ready");
  const invitation = page.getByRole("button", { name: "Dismiss guided tour invitation" });
  if (await invitation.isVisible()) await invitation.click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1_000);

  for (const node of ["kitchen", "living", "lounge"]) {
    await page.evaluate(async (id) => {
      const engine = window.__MESHTOUR_TEST_ENGINE__;
      await engine.goToNode(id);
      if (engine.getCurrentNode() !== id) throw new Error("Could not reach " + id);
    }, node);
    await page.waitForTimeout(600);
  }

  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not create a video");
  const recordedPath = await video.path();
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(recordedPath, output);
} finally {
  await browser?.close();
  await rm(recordingDirectory, { recursive: true, force: true });
}

console.log(output);
