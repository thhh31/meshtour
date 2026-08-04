import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tourRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat");
const manifestPath = path.join(tourRoot, "manifest.json");

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    } else if (entry.isFile() && relative !== "manifest.json") {
      files.push(relative);
    }
  }
  return files.sort();
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const files = [];
for (const relative of await listFiles(tourRoot)) {
  const contents = await readFile(path.join(tourRoot, relative));
  files.push({
    path: relative,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}

manifest.generatedAt = new Date().toISOString();
manifest.blenderVersion = "5.2.0 LTS";
manifest.configurableLayers = {
  blenderVersion: "5.2.0 LTS",
  renderer: "Cycles Metal",
  resolution: [4096, 2048],
  samples: 64,
  transparent: true,
  targets: ["sofa", "rug", "lounge_chair"],
  renderedVariants: 8,
};
manifest.proxy = {
  objects: 33,
  polygons: 17388,
  bytes: (await stat(path.join(tourRoot, "mesh/apartment.glb"))).size,
};
manifest.files = files;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated ${path.relative(projectRoot, manifestPath)} with ${files.length} files`);
