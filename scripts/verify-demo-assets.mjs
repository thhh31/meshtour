import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../packages/core/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toursRoot = path.join(projectRoot, "apps/demo/public/tours");
const tourRoot = path.join(toursRoot, "italian-flat");

async function listFiles(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path.join(directory, entry.name), relative)));
    } else if (entry.isFile() && relative !== "manifest.json") {
      files.push(relative);
    }
  }
  return files.sort();
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

const publicTours = ["italian-flat", "italian-flat-v2", "italian-flat-v3", "italian-flat-v4"];
const availableTours = (await readdir(toursRoot)).filter((name) => name !== ".DS_Store").sort();
assert(
  JSON.stringify(availableTours) === JSON.stringify(publicTours),
  "The public demo must contain only the four Italian Flat tours",
);

const manifest = JSON.parse(await readFile(path.join(tourRoot, "manifest.json"), "utf8"));
const config = validateConfig(JSON.parse(await readFile(path.join(tourRoot, "tour.json"), "utf8")));
const actualFiles = await listFiles(tourRoot);
const manifestFiles = manifest.files.map((entry) => entry.path).sort();

assert(
  JSON.stringify(actualFiles) === JSON.stringify(manifestFiles),
  `Manifest file list differs from disk.\nmanifest=${manifestFiles}\ndisk=${actualFiles}`,
);

for (const entry of manifest.files) {
  const file = path.join(tourRoot, entry.path);
  const contents = await readFile(file);
  assert(contents.byteLength === entry.bytes, `${entry.path}: byte size does not match manifest`);
  assert(sha256(contents) === entry.sha256, `${entry.path}: SHA-256 does not match manifest`);
}

assert(config.assets.mesh?.draco === true, "Demo proxy must use Draco compression");
assert(config.nodes.length === 3, "Italian Flat demo must expose exactly three points");
assert(
  config.nodes.map((node) => node.id).join(",") === "kitchen,living,lounge",
  "Italian Flat point ids or order changed unexpectedly",
);
const expectedHotspots = new Map([
  ["kitchen_finishes", { node: "kitchen", position: [1.823, 0.835, -0.494] }],
  ["sofa_materials", { node: undefined, position: [2.45, 0.618, -6.872] }],
  ["rug_materials", { node: undefined, position: [3.384, 0.003, -7.466] }],
  ["chair_materials", { node: undefined, position: [4.06, 0.37, -6.565] }],
]);
assert(config.hotspots.length === expectedHotspots.size, "Italian Flat hotspot count changed");
for (const hotspot of config.hotspots) {
  const expected = expectedHotspots.get(hotspot.id);
  assert(expected !== undefined, `Unexpected Italian Flat hotspot: ${hotspot.id}`);
  assert(hotspot.node === expected.node, `${hotspot.id}: assigned to the wrong point`);
  assert(
    JSON.stringify(hotspot.position) === JSON.stringify(expected.position),
    `${hotspot.id}: authored surface position changed unexpectedly`,
  );
}
assert(
  config.spatial.overview.ceiling !== undefined,
  "Italian Flat must define a ceiling fallback",
);
assert(
  config.spatial.measurements.map((measurement) => measurement.id).join(",") ===
    "apartment,sofa,dining-table,lounge-chair,pouf",
  "Italian Flat spatial measurements changed unexpectedly",
);
const expectedConfigurables = new Map([
  ["sofa-finish", { interactable: "sofa", variants: 4 }],
  ["rug-finish", { interactable: "rug", variants: 4 }],
  ["lounge-chair-style", { interactable: "lounge_chair", variants: 3 }],
]);
assert(
  config.configurables.length === expectedConfigurables.size,
  "Italian Flat must expose sofa, rug, and lounge-chair configurables",
);
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const configurable of config.configurables) {
  const expected = expectedConfigurables.get(configurable.id);
  assert(expected !== undefined, `Unexpected configurable: ${configurable.id}`);
  assert(
    configurable.interactable === expected.interactable,
    `${configurable.id}: targets the wrong interactable`,
  );
  assert(configurable.default === "original", `${configurable.id}: default must be original`);
  assert(
    configurable.variants.length === expected.variants,
    `${configurable.id}: unexpected material catalogue size`,
  );
  for (const variant of configurable.variants) {
    if (variant.id === "original") {
      assert(
        Object.keys(variant.layers).length === 0,
        `${configurable.id}: original must be layerless`,
      );
      continue;
    }
    assert(variant.swatch, `${configurable.id}/${variant.id}: missing UI swatch`);
    assert(
      Object.keys(variant.layers).sort().join(",") === "living,lounge",
      `${configurable.id}/${variant.id}: must provide Living and Lounge layers`,
    );
    for (const [nodeId, layerPath] of Object.entries(variant.layers)) {
      const layer = await readFile(path.join(tourRoot, layerPath));
      assert(
        layer.subarray(0, pngMagic.length).equals(pngMagic),
        `${layerPath}: invalid PNG header`,
      );
      assert(
        layer.readUInt32BE(16) === 4096 && layer.readUInt32BE(20) === 2048,
        `${layerPath}: expected a 4096x2048 production layer`,
      );
      assert(layer[25] === 6, `${layerPath}: expected RGBA PNG color type`);
      assert(["living", "lounge"].includes(nodeId), `${layerPath}: unexpected layer node`);
    }
  }
}
const expectedLinks = new Map([
  ["kitchen", [3.688, 0, -3.142]],
  ["living", [3.4, 0, -5.35]],
  ["lounge", [3.932, 0, -9.193]],
]);
for (const node of config.nodes) {
  assert(node.links.length === 0, `${node.id}: Italian Flat links must be shared`);
}
for (const link of config.links) {
  const expected = expectedLinks.get(link.to);
  assert(expected !== undefined, `Unexpected Italian Flat shared link: ${link.to}`);
  assert(link.hideAtTarget === true, `${link.to}: current-target marker must be hidden`);
  assert(
    JSON.stringify(link.position) === JSON.stringify(expected),
    `${link.to}: shared navigation position changed unexpectedly`,
  );
  expectedLinks.delete(link.to);
}
assert(expectedLinks.size === 0, "Italian Flat is missing a shared navigation link");
const meshPath = config.assets.mesh.url.split(/[?#]/, 1)[0];
const mesh = await readFile(path.join(tourRoot, meshPath));
assert(mesh.subarray(0, 4).toString("ascii") === "glTF", `${meshPath}: invalid GLB header`);
const proxyJson = parseGlbJson(mesh, meshPath);
const rugMesh = proxyJson.meshes.find((candidate) => candidate.name === "int_rug_mesh");
assert(
  rugMesh?.extras?.meshtourRepair === "padded-rug-projection-surface",
  "Rug projection surface is not repaired",
);
assert(
  proxyJson.accessors[rugMesh.primitives[0].attributes.POSITION].count === 4 &&
    proxyJson.accessors[rugMesh.primitives[0].indices].count === 6,
  "Rug projection surface must be a padded two-triangle plane",
);
assert(
  (await stat(path.join(tourRoot, meshPath))).size === manifest.proxy.bytes,
  "Proxy size does not match manifest statistics",
);

const ktx2Magic = Buffer.from([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
for (const node of config.nodes) {
  const previewPath = `${node.panorama.url}${config.rendering.previewSuffix}`;
  const fullPath = `${node.panorama.url}${config.rendering.fullSuffix}`;
  const preview = await readFile(path.join(tourRoot, previewPath));
  const full = await readFile(path.join(tourRoot, fullPath));
  assert(
    preview[0] === 0xff && preview[1] === 0xd8 && preview[2] === 0xff,
    `${previewPath}: invalid JPEG header`,
  );
  assert(full.subarray(0, ktx2Magic.length).equals(ktx2Magic), `${fullPath}: invalid KTX2 header`);
  assert(
    full.readUInt32LE(20) === 4096 && full.readUInt32LE(24) === 2048,
    `${fullPath}: expected a 4096x2048 production texture`,
  );
}

assert(
  manifest.source.sha256 === "0027fcbd73411cce7f49b3d86c22c03d18980e22641083da9d8ba82d9fc94e25",
  "Audited source checksum changed unexpectedly",
);

const totalBytes = manifest.files.reduce((sum, entry) => sum + entry.bytes, 0);
console.log(
  `Italian Flat demo: ${config.nodes.length} nodes, ${actualFiles.length} tracked files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB`,
);
