import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat");
const outputRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v2");
const sourceGlbPath = path.join(sourceRoot, "mesh/apartment.glb");
const outputGlbPath = path.join(outputRoot, "mesh/transition-visibility.glb");

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");
const align4 = (size) => (size + 3) & ~3;

function parseGlb(contents) {
  if (contents.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`${sourceGlbPath}: invalid GLB header`);
  }
  const chunks = [];
  for (let offset = 12; offset < contents.length; ) {
    const byteLength = contents.readUInt32LE(offset);
    const type = contents.subarray(offset + 4, offset + 8).toString("ascii");
    const data = contents.subarray(offset + 8, offset + 8 + byteLength);
    chunks.push({ type, data });
    offset += 8 + byteLength;
  }
  const jsonChunk = chunks.find((chunk) => chunk.type === "JSON");
  if (!jsonChunk) throw new Error(`${sourceGlbPath}: missing JSON chunk`);
  return {
    json: JSON.parse(jsonChunk.data.toString("utf8").trimEnd()),
    binary: chunks.find((chunk) => chunk.type === "BIN\0")?.data,
  };
}

function createGlb(json, binary) {
  const jsonContents = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(align4(jsonContents.length), 0x20);
  jsonContents.copy(paddedJson);
  const chunks = [{ type: "JSON", data: paddedJson }];
  if (binary) chunks.push({ type: "BIN\0", data: binary });
  const totalLength = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.data.length, 0);
  const result = Buffer.alloc(totalLength);
  result.write("glTF", 0, "ascii");
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(totalLength, 8);
  let offset = 12;
  for (const chunk of chunks) {
    result.writeUInt32LE(chunk.data.length, offset);
    result.write(chunk.type, offset + 4, "ascii");
    chunk.data.copy(result, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return result;
}

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

const sourceGlb = await readFile(sourceGlbPath);
const { json, binary } = parseGlb(sourceGlb);
const excludedNames = new Set(["int_rug"]);
const originalSceneNodes = json.scenes[json.scene ?? 0].nodes;
const visibilitySceneNodes = originalSceneNodes.filter(
  (nodeIndex) => !excludedNames.has(json.nodes[nodeIndex]?.name),
);
json.scenes[json.scene ?? 0].nodes = visibilitySceneNodes;
json.asset.extras = {
  ...(json.asset.extras ?? {}),
  meshtourRole: "transition-visibility",
  sourceSha256: sha256(sourceGlb),
  excludedNodes: [...excludedNames],
};
const visibilityGlb = createGlb(json, binary);
await writeFile(outputGlbPath, visibilityGlb);

const files = [];
for (const relative of await listFiles(outputRoot)) {
  const contents = await readFile(path.join(outputRoot, relative));
  files.push({ path: relative, bytes: contents.byteLength, sha256: sha256(contents) });
}
const manifest = {
  version: 2,
  name: "Italian Flat v2",
  generatedAt: new Date().toISOString(),
  source: {
    tour: "../italian-flat",
    proxy: "../italian-flat/mesh/apartment.glb",
    proxySha256: sha256(sourceGlb),
  },
  transitionVisibility: {
    objects: visibilitySceneNodes.length,
    excludedObjects: [...excludedNames],
    bytes: visibilityGlb.byteLength,
    sha256: sha256(visibilityGlb),
  },
  capabilities: {
    dedicatedVisibilityMesh: true,
    directedPaths: true,
    panoramaCorrectionMetadata: true,
    offlineRadialDepth: false,
    disocclusionBridge: false,
  },
  files,
};
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Italian Flat v2: ${files.length} files, ${visibilitySceneNodes.length}/${originalSceneNodes.length} visibility objects`,
);
