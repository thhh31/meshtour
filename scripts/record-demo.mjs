import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoUrl = process.argv[2] ?? "http://127.0.0.1:4173/";
const output = path.resolve(
  process.argv[3] ?? path.join(projectRoot, "docs/media/meshtour-transition.webm"),
);
const posterOutput = path.join(path.dirname(output), "transition-poster.png");
const recordingDirectory = await mkdtemp(path.join(tmpdir(), "meshtour-recording-"));

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: recordingDirectory, size: { width: 1280, height: 720 } },
  });
  const page = await context.newPage();
  const recordingUrl = new URL(demoUrl);
  recordingUrl.searchParams.set("test", "1");
  await page.goto(recordingUrl.href);
  await page.getByRole("button", { name: "Living Room" }).waitFor({ state: "visible" });
  await page.waitForFunction(() => window.__MESHTOUR_TEST_ENGINE__ !== undefined);
  await page.waitForTimeout(1_500);

  const navigateTo = async (nodeId) => {
    await page.evaluate(async (id) => window.__MESHTOUR_TEST_ENGINE__.goToNode(id), nodeId);
    await page.waitForTimeout(600);
  };

  await navigateTo("gallery");
  await page.screenshot({ path: posterOutput });

  await navigateTo("dining");
  await navigateTo("kitchen");

  const video = page.video();
  await context.close();
  if (!video) throw new Error("Playwright did not create a video");
  const recordedPath = await video.path();
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(recordedPath, output);
} finally {
  await browser.close();
}

console.log(output);
console.log(posterOutput);
