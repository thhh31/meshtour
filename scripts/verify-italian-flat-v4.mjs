import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../packages/core/dist/index.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "apps/demo/public");
const tourRoot = path.join(publicRoot, "tours/italian-flat-v4");
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
  "Italian Flat v4 manifest file list differs from disk",
);
for (const entry of manifest.files) {
  const contents = await readFile(path.join(tourRoot, entry.path));
  assert(contents.byteLength === entry.bytes, `${entry.path}: byte size does not match manifest`);
  assert(sha256(contents) === entry.sha256, `${entry.path}: SHA-256 does not match manifest`);
}

assert(config.configurator?.groups.length === 4, "v4 must expose four buyer option groups");
assert(config.configurator?.presets.length === 3, "v4 must expose three curated packages");
assert(config.configurables.length === 4, "v4 must retain furniture and add flooring finishes");
assert(
  config.configurables.find((entry) => entry.id === "floor-finish")?.interactable === "floor",
  "v4 flooring must target the int_floor mesh",
);
assert(config.guides.length > 0, "v4 must retain the guided property tour");
assert(config.nodes.length === 5, "v4 must expose all five panorama viewpoints");
assert(
  !config.configurables.some((entry) => entry.id === "kitchen-finish"),
  "v4 must not expose kitchen cabinetry variants",
);
assert(
  !config.configurator?.groups.some((entry) => entry.id === "kitchen"),
  "v4 must not expose a kitchen cabinetry option group",
);
assert(
  !config.hotspots.some((entry) => entry.id === "kitchen_finishes"),
  "v4 must not expose the kitchen finishes hotspot",
);
assert(
  config.assets.mesh?.url === "../italian-flat-v4/mesh/property-configurator-covered.glb",
  "v4 must use its cabinetry-safe property configurator mesh",
);
assert(config.assets.mesh?.draco === true, "the v4 property configurator mesh must use Draco");

for (const expected of [
  { id: "living-window", position: [0.981, 1.62, -6.042] },
  { id: "kitchen-window", position: [0.828, 1.62, -1.759] },
]) {
  const node = config.nodes.find((entry) => entry.id === expected.id);
  assert(node, `v4 is missing ${expected.id}`);
  assert(
    JSON.stringify(node.position) === JSON.stringify(expected.position),
    `${expected.id} has the wrong panorama position`,
  );
  for (const suffix of [config.rendering.previewSuffix, config.rendering.fullSuffix]) {
    const panoramaPath = path.resolve(
      publicRoot,
      config.assets.basePath,
      `${node.panorama.url}${suffix}`,
    );
    await readFile(panoramaPath);
  }
}

const flooringHotspot = config.hotspots.find((entry) => entry.id === "floor_finishes");
assert(flooringHotspot, "v4 is missing the flooring hotspot");
assert(
  JSON.stringify(flooringHotspot.position) === JSON.stringify([3.194, 0, -4.406]),
  "the flooring hotspot has the wrong position",
);

for (const configurable of config.configurables) {
  for (const variant of configurable.variants) {
    if (Object.keys(variant.layers).length > 0 && configurable.id !== "floor-finish") {
      for (const nodeId of ["living-window", "kitchen-window"]) {
        assert(variant.layers[nodeId], `${configurable.id}/${variant.id}: missing ${nodeId} layer`);
      }
    }
    for (const layer of Object.values(variant.layers)) {
      const resolved = path.resolve(publicRoot, config.assets.basePath, layer.split("?")[0]);
      const png = await readFile(resolved);
      assert(png.subarray(1, 4).toString("ascii") === "PNG", `${layer}: invalid PNG`);
      if (layer.includes("italian-flat-v4/layers/floor/")) {
        assert(png.readUInt32BE(16) === 2048, `${layer}: property layer width must be 2048`);
        assert(png.readUInt32BE(20) === 1024, `${layer}: property layer height must be 1024`);
      } else if (layer.includes("italian-flat-v4/layers/")) {
        assert(png.readUInt32BE(16) === 4096, `${layer}: furniture layer width must be 4096`);
        assert(png.readUInt32BE(20) === 2048, `${layer}: furniture layer height must be 2048`);
      }
    }
  }
}

const proxyPath = path.resolve(
  publicRoot,
  config.assets.basePath,
  config.assets.mesh.url.split("?")[0],
);
const proxy = await readFile(proxyPath);
assert(proxy.subarray(0, 4).toString("ascii") === "glTF", "v4 proxy has an invalid GLB header");
const jsonLength = proxy.readUInt32LE(12);
const proxyJson = JSON.parse(
  proxy
    .subarray(20, 20 + jsonLength)
    .toString("utf8")
    .trimEnd(),
);
assert(proxyJson.meshes.length > 0, "the v4 proxy contains no meshes");
const proxyNodeNames = new Set(proxyJson.nodes.map((node) => node.name));
for (const coverName of [
  "Cube",
  "Cube.001",
  "Cube.002",
  "proxy_Door.009",
  "proxy_Door.010",
  "proxy_Door.011",
]) {
  assert(proxyNodeNames.has(coverName), `the v4 proxy is missing manual cover ${coverName}`);
}
assert(
  proxyNodeNames.has("int_floor"),
  "the v4 proxy is missing its configurable floor projection surface",
);
const kitchenNode = proxyJson.nodes.find((node) => node.name === "int_kitchen");
assert(kitchenNode, "the v4 proxy is missing int_kitchen");
const kitchenPrimitive = proxyJson.meshes[kitchenNode.mesh]?.primitives[0];
assert(kitchenPrimitive, "the v4 proxy has no kitchen geometry");
assert(kitchenPrimitive.indices !== undefined, "the v4 kitchen geometry is not indexed");
const kitchenIndexAccessor = proxyJson.accessors[kitchenPrimitive.indices];
assert(kitchenIndexAccessor, "the v4 kitchen index accessor is missing");
assert(
  kitchenIndexAccessor.count <= 600,
  "the v4 kitchen proxy includes unrelated geometry that can create projection spikes",
);
const kitchenTopNode = proxyJson.nodes.find((node) => node.name === "visual_kitchen_tops");
assert(kitchenTopNode, "the v4 proxy is missing its kitchen top cover");
const kitchenTopMesh = proxyJson.meshes[kitchenTopNode.mesh];
assert(
  kitchenTopMesh?.extras?.meshtourRepair === "horizontal-kitchen-projection-cover",
  "the v4 kitchen top cover is not marked as a projection repair",
);
const kitchenTopIndices = proxyJson.accessors[kitchenTopMesh.primitives[0].indices];
assert(
  kitchenTopIndices.count === 18,
  "the v4 kitchen top cover must contain exactly three manual quads",
);

console.log(
  `Italian Flat v4 verified: ${config.configurator.groups.length} groups, ${config.configurator.presets.length} packages, ${actualFiles.length} local files`,
);
