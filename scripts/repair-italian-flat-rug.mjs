import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUG_MESH_NAME = "int_rug_mesh";
const RUG_PADDING_METERS = 0.05;
const REPAIR_ROLE = "padded-rug-projection-surface";
const align4 = (size) => (size + 3) & ~3;
const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

const proxyAssets = [
  {
    tour: "italian-flat",
    mesh: "mesh/apartment.glb",
  },
  {
    tour: "italian-flat-v2",
    mesh: "mesh/apartment.glb",
  },
  {
    tour: "italian-flat-v3",
    mesh: "mesh/v3_covered_windows.glb",
  },
];

function parseGlb(contents, sourcePath) {
  if (contents.subarray(0, 4).toString("ascii") !== "glTF") {
    throw new Error(`${sourcePath}: invalid GLB header`);
  }
  const chunks = [];
  for (let offset = 12; offset < contents.length; ) {
    const byteLength = contents.readUInt32LE(offset);
    const type = contents.subarray(offset + 4, offset + 8).toString("ascii");
    chunks.push({ type, data: contents.subarray(offset + 8, offset + 8 + byteLength) });
    offset += 8 + byteLength;
  }
  const jsonChunk = chunks.find((chunk) => chunk.type === "JSON");
  const binaryChunk = chunks.find((chunk) => chunk.type === "BIN\0");
  if (!jsonChunk || !binaryChunk) throw new Error(`${sourcePath}: expected JSON and BIN chunks`);
  return {
    json: JSON.parse(jsonChunk.data.toString("utf8").trimEnd()),
    binary: binaryChunk.data,
  };
}

function createGlb(json, binary) {
  const jsonContents = Buffer.from(JSON.stringify(json));
  const paddedJson = Buffer.alloc(align4(jsonContents.length), 0x20);
  jsonContents.copy(paddedJson);
  const paddedBinary = Buffer.alloc(align4(binary.length));
  binary.copy(paddedBinary);
  const chunks = [
    { type: "JSON", data: paddedJson },
    { type: "BIN\0", data: paddedBinary },
  ];
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

function triangleCount(json) {
  return json.meshes.reduce(
    (total, mesh) =>
      total +
      mesh.primitives.reduce((meshTotal, primitive) => {
        const accessorIndex = primitive.indices ?? primitive.attributes.POSITION;
        return meshTotal + json.accessors[accessorIndex].count / 3;
      }, 0),
    0,
  );
}

function appendBuffer(binary, contents) {
  const byteOffset = align4(binary.length);
  const prefix = Buffer.alloc(byteOffset - binary.length);
  return {
    binary: Buffer.concat([binary, prefix, contents]),
    byteOffset,
  };
}

function repairRug(contents, sourcePath) {
  const parsed = parseGlb(contents, sourcePath);
  const { json } = parsed;
  let { binary } = parsed;
  const mesh = json.meshes.find((candidate) => candidate.name === RUG_MESH_NAME);
  if (!mesh) throw new Error(`${sourcePath}: missing ${RUG_MESH_NAME}`);
  if (mesh.extras?.meshtourRepair === REPAIR_ROLE) {
    return { contents, polygons: triangleCount(json), changed: false };
  }
  if (mesh.primitives.length !== 1) {
    throw new Error(`${sourcePath}: ${RUG_MESH_NAME} must contain exactly one primitive`);
  }

  const primitive = mesh.primitives[0];
  const sourcePosition = json.accessors[primitive.attributes.POSITION];
  if (!sourcePosition?.min || !sourcePosition?.max) {
    throw new Error(`${sourcePath}: ${RUG_MESH_NAME} POSITION accessor has no bounds`);
  }
  const [sourceMinX, , sourceMinZ] = sourcePosition.min;
  const [sourceMaxX, sourceMaxY, sourceMaxZ] = sourcePosition.max;
  const minX = sourceMinX - RUG_PADDING_METERS;
  const maxX = sourceMaxX + RUG_PADDING_METERS;
  const minZ = sourceMinZ - RUG_PADDING_METERS;
  const maxZ = sourceMaxZ + RUG_PADDING_METERS;
  const y = sourceMaxY;

  const positions = Buffer.from(
    new Float32Array([minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ]).buffer,
  );
  const normals = Buffer.from(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]).buffer);
  const uvs = Buffer.from(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]).buffer);
  // Counter-clockwise when viewed from above (+Y).
  const indices = Buffer.from(new Uint16Array([0, 2, 1, 0, 3, 2]).buffer);

  const addView = (data, target) => {
    const appended = appendBuffer(binary, data);
    binary = appended.binary;
    const index = json.bufferViews.length;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: appended.byteOffset,
      byteLength: data.byteLength,
      target,
    });
    return index;
  };
  const positionView = addView(positions, 34962);
  const normalView = addView(normals, 34962);
  const uvView = addView(uvs, 34962);
  const indexView = addView(indices, 34963);

  const addAccessor = (accessor) => {
    const index = json.accessors.length;
    json.accessors.push(accessor);
    return index;
  };
  const positionAccessor = addAccessor({
    bufferView: positionView,
    componentType: 5126,
    count: 4,
    type: "VEC3",
    min: [minX, y, minZ],
    max: [maxX, y, maxZ],
  });
  const normalAccessor = addAccessor({
    bufferView: normalView,
    componentType: 5126,
    count: 4,
    type: "VEC3",
  });
  const uvAccessor = addAccessor({
    bufferView: uvView,
    componentType: 5126,
    count: 4,
    type: "VEC2",
  });
  const indexAccessor = addAccessor({
    bufferView: indexView,
    componentType: 5123,
    count: 6,
    type: "SCALAR",
    min: [0],
    max: [3],
  });

  mesh.primitives[0] = {
    ...(primitive.material === undefined ? {} : { material: primitive.material }),
    attributes: {
      POSITION: positionAccessor,
      NORMAL: normalAccessor,
      TEXCOORD_0: uvAccessor,
    },
    indices: indexAccessor,
    mode: 4,
  };
  mesh.extras = {
    ...(mesh.extras ?? {}),
    meshtourRepair: REPAIR_ROLE,
    paddingMeters: RUG_PADDING_METERS,
    sourceBounds: { min: sourcePosition.min, max: sourcePosition.max },
  };
  json.buffers[0].byteLength = align4(binary.length);

  return {
    contents: createGlb(json, binary),
    polygons: triangleCount(json),
    changed: true,
  };
}

async function updateManifest(tour, meshPath, meshContents, polygons) {
  const manifestPath = path.join(projectRoot, "apps/demo/public/tours", tour, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const entry = manifest.files.find((candidate) => candidate.path === meshPath);
  if (!entry) throw new Error(`${manifestPath}: missing ${meshPath} entry`);
  entry.bytes = meshContents.byteLength;
  entry.sha256 = sha256(meshContents);
  if (manifest.proxy) {
    manifest.proxy.bytes = meshContents.byteLength;
    if (typeof manifest.proxy.polygons === "number") manifest.proxy.polygons = polygons;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

const results = new Map();
for (const asset of proxyAssets) {
  const meshPath = path.join(projectRoot, "apps/demo/public/tours", asset.tour, asset.mesh);
  const repaired = repairRug(await readFile(meshPath), meshPath);
  if (repaired.changed) await writeFile(meshPath, repaired.contents);
  await updateManifest(asset.tour, asset.mesh, repaired.contents, repaired.polygons);
  results.set(asset.tour, repaired);
  console.log(
    `${asset.tour}: ${repaired.changed ? "repaired" : "already repaired"} rug projection ` +
      `(4 vertices, 2 triangles, ${repaired.contents.byteLength} bytes)`,
  );
}

// Keep v2's provenance metadata synchronized with the repaired source proxy.
const source = results.get("italian-flat").contents;
const v2Root = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v2");
const visibilityPath = path.join(v2Root, "mesh/transition-visibility.glb");
const visibility = parseGlb(await readFile(visibilityPath), visibilityPath);
visibility.json.asset.extras = {
  ...(visibility.json.asset.extras ?? {}),
  sourceSha256: sha256(source),
};
const updatedVisibility = createGlb(visibility.json, visibility.binary);
await writeFile(visibilityPath, updatedVisibility);

const v2ManifestPath = path.join(v2Root, "manifest.json");
const v2Manifest = JSON.parse(await readFile(v2ManifestPath, "utf8"));
v2Manifest.source.proxySha256 = sha256(source);
v2Manifest.transitionVisibility.bytes = updatedVisibility.byteLength;
v2Manifest.transitionVisibility.sha256 = sha256(updatedVisibility);
const visibilityEntry = v2Manifest.files.find(
  (entry) => entry.path === "mesh/transition-visibility.glb",
);
if (!visibilityEntry) throw new Error(`${v2ManifestPath}: missing transition visibility entry`);
visibilityEntry.bytes = updatedVisibility.byteLength;
visibilityEntry.sha256 = sha256(updatedVisibility);
await writeFile(v2ManifestPath, `${JSON.stringify(v2Manifest, null, 2)}\n`);
