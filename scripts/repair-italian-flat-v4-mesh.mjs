import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MANUAL_COVER_NODES = [
  "Cube",
  "Cube.001",
  "Cube.002",
  "proxy_Door.009",
  "proxy_Door.010",
  "proxy_Door.011",
];
// Local-space bounds measured from the stable v3 int_kitchen mesh. Rebuilding
// these horizontal surfaces as quads avoids carrying the old decimator's long
// triangles back into the otherwise clean v4 cabinetry proxy.
const KITCHEN_TOP_RECTS = [
  {
    name: "long-worktop",
    minX: -0.3082875609397888,
    maxX: 0.3117416501045227,
    minZ: -3.0558829307556152,
    maxZ: 0.506666898727417,
    y: 0.4148460626602173,
  },
  {
    name: "worktop-return",
    minX: 0.3117416501045227,
    maxX: 1.841540813446045,
    minZ: -0.14316892623901367,
    maxZ: 0.506666898727417,
    y: 0.4148460626602173,
  },
  {
    name: "tall-cabinet-top",
    minX: -0.31956571340560913,
    maxX: 0.4272083044052124,
    minZ: -3.8850948810577393,
    maxZ: -3.05507755279541,
    y: 1.387988567352295,
  },
];
const COMPONENTS_PER_TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const BYTES_PER_COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function parseGlb(contents, sourcePath) {
  assert(contents.subarray(0, 4).toString("ascii") === "glTF", `${sourcePath}: invalid GLB`);
  const jsonLength = contents.readUInt32LE(12);
  const json = JSON.parse(
    contents
      .subarray(20, 20 + jsonLength)
      .toString("utf8")
      .trimEnd(),
  );
  const binaryHeader = 20 + jsonLength;
  const binaryLength = contents.readUInt32LE(binaryHeader);
  const binaryStart = binaryHeader + 8;
  return {
    json,
    binary: Buffer.from(contents.subarray(binaryStart, binaryStart + binaryLength)),
  };
}

function readComponent(view, byteOffset, componentType) {
  if (componentType === 5120) return view.getInt8(byteOffset);
  if (componentType === 5121) return view.getUint8(byteOffset);
  if (componentType === 5122) return view.getInt16(byteOffset, true);
  if (componentType === 5123) return view.getUint16(byteOffset, true);
  if (componentType === 5125) return view.getUint32(byteOffset, true);
  if (componentType === 5126) return view.getFloat32(byteOffset, true);
  throw new Error(`Unsupported glTF component type ${componentType}`);
}

function readAccessor(source, accessorIndex) {
  const accessor = source.json.accessors[accessorIndex];
  assert(accessor && accessor.bufferView !== undefined, `Accessor ${accessorIndex} has no data`);
  const bufferView = source.json.bufferViews[accessor.bufferView];
  const components = COMPONENTS_PER_TYPE[accessor.type];
  const componentBytes = BYTES_PER_COMPONENT[accessor.componentType];
  assert(components && componentBytes, `Accessor ${accessorIndex} has an unsupported layout`);
  const elementBytes = components * componentBytes;
  const stride = bufferView.byteStride ?? elementBytes;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(
    source.binary.buffer,
    source.binary.byteOffset,
    source.binary.byteLength,
  );
  const values = new Array(accessor.count * components);
  for (let index = 0; index < accessor.count; index += 1) {
    for (let component = 0; component < components; component += 1) {
      values[index * components + component] = readComponent(
        view,
        start + index * stride + component * componentBytes,
        accessor.componentType,
      );
    }
  }
  return { accessor, bufferView, components, componentBytes, elementBytes, stride, start, values };
}

function encodeFloat32(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function encodeUint16(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function minMax(values, components) {
  const min = new Array(components).fill(Infinity);
  const max = new Array(components).fill(-Infinity);
  for (let index = 0; index < values.length; index += components) {
    for (let component = 0; component < components; component += 1) {
      min[component] = Math.min(min[component], values[index + component]);
      max[component] = Math.max(max[component], values[index + component]);
    }
  }
  return { min, max };
}

function serializeGlb(json, binary) {
  let jsonText = JSON.stringify(json);
  while (Buffer.byteLength(jsonText) % 4 !== 0) jsonText += " ";
  const jsonChunk = Buffer.from(jsonText, "utf8");
  const binaryPadding = (4 - (binary.byteLength % 4)) % 4;
  const binaryChunk = binaryPadding ? Buffer.concat([binary, Buffer.alloc(binaryPadding)]) : binary;
  const header = Buffer.alloc(12);
  const jsonHeader = Buffer.alloc(8);
  const binaryHeader = Buffer.alloc(8);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.byteLength + 8 + binaryChunk.byteLength, 8);
  jsonHeader.writeUInt32LE(jsonChunk.byteLength, 0);
  jsonHeader.write("JSON", 4, 4, "ascii");
  binaryHeader.writeUInt32LE(binaryChunk.byteLength, 0);
  binaryHeader.write("BIN\0", 4, 4, "ascii");
  return Buffer.concat([header, jsonHeader, jsonChunk, binaryHeader, binaryChunk]);
}

export async function repairItalianFlatV4Mesh(projectRoot) {
  const v3Path = path.join(
    projectRoot,
    "apps/demo/public/tours/italian-flat-v3/mesh/v3_covered_windows.glb",
  );
  const basePath = path.join(
    projectRoot,
    "apps/demo/public/tours/italian-flat-v4/mesh/property-configurator.glb",
  );
  const outputPath = path.join(
    projectRoot,
    "apps/demo/public/tours/italian-flat-v4/mesh/property-configurator-covered.glb",
  );
  const [baseContents, v3Contents] = await Promise.all([readFile(basePath), readFile(v3Path)]);
  const base = parseGlb(baseContents, basePath);
  const v3 = parseGlb(v3Contents, v3Path);
  const output = base.json;
  const binaryParts = [base.binary];
  let binaryLength = base.binary.byteLength;

  const appendBufferView = (contents, sourceBufferView = {}) => {
    const leadingPadding = (4 - (binaryLength % 4)) % 4;
    if (leadingPadding) {
      binaryParts.push(Buffer.alloc(leadingPadding));
      binaryLength += leadingPadding;
    }
    const bufferView = {
      buffer: 0,
      byteOffset: binaryLength,
      byteLength: contents.byteLength,
    };
    if (sourceBufferView.target !== undefined) bufferView.target = sourceBufferView.target;
    output.bufferViews.push(bufferView);
    binaryParts.push(contents);
    binaryLength += contents.byteLength;
    return output.bufferViews.length - 1;
  };

  const cloneAccessor = (sourceAccessorIndex) => {
    const sourceAccessor = readAccessor(v3, sourceAccessorIndex);
    const contents = Buffer.alloc(sourceAccessor.accessor.count * sourceAccessor.elementBytes);
    for (let index = 0; index < sourceAccessor.accessor.count; index += 1) {
      v3.binary.copy(
        contents,
        index * sourceAccessor.elementBytes,
        sourceAccessor.start + index * sourceAccessor.stride,
        sourceAccessor.start + index * sourceAccessor.stride + sourceAccessor.elementBytes,
      );
    }
    const bufferView = appendBufferView(contents, sourceAccessor.bufferView);
    const accessor = { ...sourceAccessor.accessor, bufferView, byteOffset: 0 };
    output.accessors.push(accessor);
    return output.accessors.length - 1;
  };

  const cloneMesh = (sourceMeshIndex) => {
    const sourceMesh = v3.json.meshes[sourceMeshIndex];
    const primitives = sourceMesh.primitives.map((sourcePrimitive) => {
      const attributes = Object.fromEntries(
        Object.entries(sourcePrimitive.attributes).map(([semantic, accessor]) => [
          semantic,
          cloneAccessor(accessor),
        ]),
      );
      const primitive = { ...sourcePrimitive, attributes };
      if (sourcePrimitive.indices !== undefined) {
        primitive.indices = cloneAccessor(sourcePrimitive.indices);
      }
      delete primitive.material;
      return primitive;
    });
    output.meshes.push({ ...sourceMesh, primitives });
    return output.meshes.length - 1;
  };

  const scene = output.scenes[output.scene ?? 0];
  scene.nodes ??= [];
  for (const name of MANUAL_COVER_NODES) {
    const sourceNode = v3.json.nodes.find((node) => node.name === name);
    assert(sourceNode?.mesh !== undefined, `v3 manual cover ${name} is missing`);
    const mesh = cloneMesh(sourceNode.mesh);
    const node = { ...sourceNode, mesh };
    delete node.children;
    output.nodes.push(node);
    scene.nodes.push(output.nodes.length - 1);
  }

  const sourceKitchenNode = v3.json.nodes.find((node) => node.name === "int_kitchen");
  assert(sourceKitchenNode?.mesh !== undefined, "v3 int_kitchen is missing");
  const newPositions = [];
  const newNormals = [];
  const newUvs = [];
  const newIndices = [];
  for (const rectangle of KITCHEN_TOP_RECTS) {
    const first = newPositions.length / 3;
    newPositions.push(
      rectangle.minX,
      rectangle.y,
      rectangle.minZ,
      rectangle.minX,
      rectangle.y,
      rectangle.maxZ,
      rectangle.maxX,
      rectangle.y,
      rectangle.maxZ,
      rectangle.maxX,
      rectangle.y,
      rectangle.minZ,
    );
    newNormals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    newUvs.push(0, 0, 0, 1, 1, 1, 1, 0);
    newIndices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  }
  const kitchenTopVertices = newPositions.length / 3;
  const kitchenTopTriangles = newIndices.length / 3;

  const addAccessor = (contents, accessor, target) => {
    const bufferView = appendBufferView(contents, { target });
    output.accessors.push({ ...accessor, bufferView, byteOffset: 0 });
    return output.accessors.length - 1;
  };
  const positionBounds = minMax(newPositions, 3);
  const topPositionAccessor = addAccessor(
    encodeFloat32(newPositions),
    {
      componentType: 5126,
      count: kitchenTopVertices,
      type: "VEC3",
      ...positionBounds,
    },
    34962,
  );
  const topNormalAccessor = addAccessor(
    encodeFloat32(newNormals),
    { componentType: 5126, count: kitchenTopVertices, type: "VEC3" },
    34962,
  );
  const topUvAccessor = addAccessor(
    encodeFloat32(newUvs),
    { componentType: 5126, count: kitchenTopVertices, type: "VEC2" },
    34962,
  );
  const topIndexAccessor = addAccessor(
    encodeUint16(newIndices),
    {
      componentType: 5123,
      count: newIndices.length,
      type: "SCALAR",
      min: [0],
      max: [kitchenTopVertices - 1],
    },
    34963,
  );
  output.meshes.push({
    name: "visual_kitchen_tops_mesh",
    extras: {
      meshtourRepair: "horizontal-kitchen-projection-cover",
      surfaces: KITCHEN_TOP_RECTS.map((rectangle) => rectangle.name),
    },
    primitives: [
      {
        attributes: {
          POSITION: topPositionAccessor,
          NORMAL: topNormalAccessor,
          TEXCOORD_0: topUvAccessor,
        },
        indices: topIndexAccessor,
        mode: 4,
      },
    ],
  });
  output.nodes.push({
    name: "visual_kitchen_tops",
    mesh: output.meshes.length - 1,
    ...(sourceKitchenNode.translation ? { translation: sourceKitchenNode.translation } : {}),
    ...(sourceKitchenNode.rotation ? { rotation: sourceKitchenNode.rotation } : {}),
    ...(sourceKitchenNode.scale ? { scale: sourceKitchenNode.scale } : {}),
  });
  scene.nodes.push(output.nodes.length - 1);

  output.asset.extras = {
    ...output.asset.extras,
    meshtourCoverageRepair: {
      source: "../italian-flat-v3/mesh/v3_covered_windows.glb",
      manualCovers: MANUAL_COVER_NODES,
      kitchenTopTriangles,
    },
  };
  const binary = Buffer.concat(binaryParts);
  output.buffers[0].byteLength = binary.byteLength;
  const repaired = serializeGlb(output, binary);
  await writeFile(outputPath, repaired);
  console.log(
    `Italian Flat v4 mesh repaired: ${MANUAL_COVER_NODES.length} manual covers, ${kitchenTopTriangles} kitchen-top triangles, ${repaired.byteLength} bytes`,
  );
  return { outputPath, manualCovers: MANUAL_COVER_NODES.length, kitchenTopTriangles };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await repairItalianFlatV4Mesh(projectRoot);
}
