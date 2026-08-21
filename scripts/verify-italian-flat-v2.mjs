import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../packages/core/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const v1Root = path.join(projectRoot, "apps/demo/public/tours/italian-flat");
const tourRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v2");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile() && relative !== "manifest.json") files.push(relative);
  }
  return files.sort();
}

const manifest = JSON.parse(await readFile(path.join(tourRoot, "manifest.json"), "utf8"));
const config = validateConfig(JSON.parse(await readFile(path.join(tourRoot, "tour.json"), "utf8")));
const actualFiles = await listFiles(tourRoot);
assert(
  JSON.stringify(actualFiles) === JSON.stringify(manifest.files.map((entry) => entry.path).sort()),
  "Italian Flat v2 manifest file list differs from disk",
);
for (const entry of manifest.files) {
  const contents = await readFile(path.join(tourRoot, entry.path));
  assert(contents.byteLength === entry.bytes, `${entry.path}: byte size does not match manifest`);
  assert(sha256(contents) === entry.sha256, `${entry.path}: SHA-256 does not match manifest`);
}

const v1Manifest = JSON.parse(await readFile(path.join(v1Root, "manifest.json"), "utf8"));
assert(
  config.assets.basePath === "./tours/italian-flat-v2/",
  "v2 must be independently relocatable",
);
assert(config.assets.visibilityMesh?.draco === true, "v2 requires a Draco visibility mesh");
assert(config.links.length === 0, "v2 navigation must use directed node links");
assert(config.nodes.length === 3, "v2 must retain all three capture points");
for (const node of config.nodes) {
  assert(node.links.length === 2, `${node.id}: expected a path to each other capture point`);
  assert(node.panorama.correction !== undefined, `${node.id}: missing correction metadata`);
  for (const link of node.links) {
    assert(link.path !== undefined, `${node.id} -> ${link.to}: missing authored path`);
    assert(link.path.waypoints.length >= 3, `${node.id} -> ${link.to}: path is underspecified`);
  }
}
assert(
  manifest.capabilities.offlineRadialDepth === false &&
    config.nodes.every((node) => node.depth === undefined),
  "v2 depth capability metadata/config disagree",
);
assert(
  manifest.capabilities.disocclusionBridge === false && config.assets.bridge === undefined,
  "v2 bridge capability metadata/config disagree",
);
assert(
  sha256(await readFile(path.join(v1Root, "tour.json"))) ===
    v1Manifest.files.find((entry) => entry.path === "tour.json")?.sha256,
  "v1 config no longer matches its committed manifest",
);

const independentlyCopiedAssets = actualFiles.filter(
  (relative) =>
    !["ATTRIBUTION.md", "README.md", "tour.json", "mesh/transition-visibility.glb"].includes(
      relative,
    ),
);
for (const relative of independentlyCopiedAssets) {
  const [v1Contents, v2Contents] = await Promise.all([
    readFile(path.join(v1Root, relative)),
    readFile(path.join(tourRoot, relative)),
  ]);
  assert(
    sha256(v1Contents) === sha256(v2Contents),
    `${relative}: self-contained v2 copy differs unexpectedly from v1 source asset`,
  );
}

console.log(
  `Italian Flat v2 verified: ${config.nodes.length} nodes, 6 directed paths, ${actualFiles.length} files`,
);
