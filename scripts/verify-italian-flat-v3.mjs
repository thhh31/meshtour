import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../packages/core/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tourRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v3");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

function parseGlbJson(contents, sourcePath) {
  assert(contents.subarray(0, 4).toString("ascii") === "glTF", `${sourcePath}: invalid GLB header`);
  const jsonLength = contents.readUInt32LE(12);
  return JSON.parse(
    contents
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trimEnd(),
  );
}

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    else if (entry.isFile() && relative !== "manifest.json" && !entry.name.startsWith("."))
      files.push(relative);
  }
  return files.sort();
}

const manifest = JSON.parse(await readFile(path.join(tourRoot, "manifest.json"), "utf8"));
const config = validateConfig(JSON.parse(await readFile(path.join(tourRoot, "tour.json"), "utf8")));
const actualFiles = await listFiles(tourRoot);
assert(
  JSON.stringify(actualFiles) === JSON.stringify(manifest.files.map((entry) => entry.path).sort()),
  "Italian Flat v3 manifest file list differs from disk",
);
for (const entry of manifest.files) {
  const contents = await readFile(path.join(tourRoot, entry.path));
  assert(contents.byteLength === entry.bytes, `${entry.path}: byte size does not match manifest`);
  assert(sha256(contents) === entry.sha256, `${entry.path}: SHA-256 does not match manifest`);
}

assert(config.assets.basePath === "./tours/italian-flat-v3/", "v3 must point to its own basePath");
assert(
  config.assets.mesh?.url === "mesh/v3_covered_windows.glb",
  "v3 must point to mesh/v3_covered_windows.glb",
);
assert(config.assets.mesh?.draco === false, "v3 mesh is standard GLB without Draco compression");
assert(config.nodes.length === 3, "v3 must retain all three capture points");

const proxyPath = path.join(tourRoot, config.assets.mesh.url);
const proxy = await readFile(proxyPath);
const proxyJson = parseGlbJson(proxy, config.assets.mesh.url);
const rugMesh = proxyJson.meshes.find((candidate) => candidate.name === "int_rug_mesh");
assert(
  rugMesh?.extras?.meshtourRepair === "padded-rug-projection-surface",
  "v3 rug projection surface is not repaired",
);
assert(
  proxyJson.accessors[rugMesh.primitives[0].attributes.POSITION].count === 4 &&
    proxyJson.accessors[rugMesh.primitives[0].indices].count === 6,
  "v3 rug projection surface must be a padded two-triangle plane",
);

const totalBytes = manifest.files.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(
  `Italian Flat v3 verified: ${config.nodes.length} nodes, ${actualFiles.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`,
);
