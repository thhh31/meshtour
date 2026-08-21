import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const glbPath = path.join(
  projectRoot,
  "apps/demo/public/tours/italian-flat-v3/mesh/v3_covered_windows.glb",
);
const manifestPath = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v3/manifest.json");

const sha256 = (contents) => createHash("sha256").update(contents).digest("hex");

async function repair() {
  const glbBuffer = await readFile(glbPath);
  const jsonLen = glbBuffer.readUInt32LE(12);
  const jsonBuf = glbBuffer.subarray(20, 20 + jsonLen);
  const gltf = JSON.parse(jsonBuf.toString("utf8"));
  const binOffset = 20 + jsonLen + 8;
  const binLen = glbBuffer.readUInt32LE(binOffset - 8);
  const binBuf = Buffer.from(glbBuffer.subarray(binOffset, binOffset + binLen));

  const chairMesh = gltf.meshes.find((m) => m.name === "int_lounge_chair_mesh");
  const prim = chairMesh.primitives[0];

  const posAcc = gltf.accessors[prim.attributes.POSITION];
  const normAcc = gltf.accessors[prim.attributes.NORMAL];
  const uvAcc = gltf.accessors[prim.attributes.TEXCOORD_0];
  const idxAcc = gltf.accessors[prim.indices];

  const posBv = gltf.bufferViews[posAcc.bufferView];
  const normBv = gltf.bufferViews[normAcc.bufferView];
  const uvBv = gltf.bufferViews[uvAcc.bufferView];
  const idxBv = gltf.bufferViews[idxAcc.bufferView];

  const oldPosFloats = new Float32Array(
    binBuf.buffer,
    binBuf.byteOffset + (posBv.byteOffset || 0) + (posAcc.byteOffset || 0),
    posAcc.count * 3,
  );
  const oldNormFloats = new Float32Array(
    binBuf.buffer,
    binBuf.byteOffset + (normBv.byteOffset || 0) + (normAcc.byteOffset || 0),
    normAcc.count * 3,
  );
  const oldUvFloats = new Float32Array(
    binBuf.buffer,
    binBuf.byteOffset + (uvBv.byteOffset || 0) + (uvAcc.byteOffset || 0),
    uvAcc.count * 2,
  );
  const oldIndices = new Uint16Array(
    binBuf.buffer,
    binBuf.byteOffset + (idxBv.byteOffset || 0) + (idxAcc.byteOffset || 0),
    idxAcc.count,
  );

  // Find connected components
  const numVerts = posAcc.count;
  const adj = Array.from({ length: numVerts }, () => []);
  for (let i = 0; i < oldIndices.length; i += 3) {
    const a = oldIndices[i],
      b = oldIndices[i + 1],
      c = oldIndices[i + 2];
    adj[a].push(b, c);
    adj[b].push(a, c);
    adj[c].push(a, b);
  }

  const compOfVert = new Int32Array(numVerts).fill(-1);
  let compCount = 0;
  for (let i = 0; i < numVerts; i++) {
    if (compOfVert[i] !== -1) continue;
    const q = [i];
    compOfVert[i] = compCount;
    while (q.length > 0) {
      const c = q.pop();
      for (const n of adj[c]) {
        if (compOfVert[n] === -1) {
          compOfVert[n] = compCount;
          q.push(n);
        }
      }
    }
    compCount++;
  }

  // Keep structural chair components (legs, frame rails, backrest, armrests, cushion top/core)
  // Exclude duplicate overlapping sheets and tiny disconnected scrap
  const keepComps = new Set([
    11,
    19,
    20,
    24, // 4 legs
    12,
    16,
    21,
    23,
    28, // frame rails
    6,
    29,
    30,
    31,
    32, // cushion top, armrests, backrest outer/inner
    4,
    5,
    26, // seat cushion core
  ]);

  const oldToNewVert = new Int32Array(numVerts).fill(-1);
  const newPos = [];
  const newNorm = [];
  const newUv = [];
  const newIndices = [];

  let newVertCount = 0;
  for (let i = 0; i < oldIndices.length; i += 3) {
    const a = oldIndices[i],
      b = oldIndices[i + 1],
      c = oldIndices[i + 2];
    if (keepComps.has(compOfVert[a])) {
      for (const oldV of [a, b, c]) {
        if (oldToNewVert[oldV] === -1) {
          oldToNewVert[oldV] = newVertCount++;
          newPos.push(
            oldPosFloats[oldV * 3],
            oldPosFloats[oldV * 3 + 1],
            oldPosFloats[oldV * 3 + 2],
          );
          newNorm.push(
            oldNormFloats[oldV * 3],
            oldNormFloats[oldV * 3 + 1],
            oldNormFloats[oldV * 3 + 2],
          );
          newUv.push(oldUvFloats[oldV * 2], oldUvFloats[oldV * 2 + 1]);
        }
        newIndices.push(oldToNewVert[oldV]);
      }
    }
  }

  console.log(
    `Repaired chair mesh: ${newVertCount} vertices, ${newIndices.length / 3} triangles (was ${numVerts} verts, ${oldIndices.length / 3} tris)`,
  );

  // Calculate new bounding box for POSITION
  let minX = Infinity,
    maxX = -Infinity;
  let minY = Infinity,
    maxY = -Infinity;
  let minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < newVertCount; i++) {
    const x = newPos[i * 3],
      y = newPos[i * 3 + 1],
      z = newPos[i * 3 + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  // Create new binary buffers for the chair
  const newPosBytes = Buffer.from(new Float32Array(newPos).buffer);
  const newNormBytes = Buffer.from(new Float32Array(newNorm).buffer);
  const newUvBytes = Buffer.from(new Float32Array(newUv).buffer);
  const newIdxBytes = Buffer.from(new Uint16Array(newIndices).buffer);

  // Pad bufferViews to 4-byte boundaries
  function pad4(buf) {
    const rem = buf.byteLength % 4;
    if (rem === 0) return buf;
    return Buffer.concat([buf, Buffer.alloc(4 - rem)]);
  }

  const paddedPos = pad4(newPosBytes);
  const paddedNorm = pad4(newNormBytes);
  const paddedUv = pad4(newUvBytes);
  const paddedIdx = pad4(newIdxBytes);

  // Build new bin buffer:
  // Pre-chair buffer data (before bv 19):
  const chairStartOffset = posBv.byteOffset;
  const chairOldEndOffset = idxBv.byteOffset + idxBv.byteLength;
  const preChairData = binBuf.subarray(0, chairStartOffset);
  const postChairData = binBuf.subarray(chairOldEndOffset);

  const newChairData = Buffer.concat([paddedPos, paddedNorm, paddedUv, paddedIdx]);
  const newBinBuf = Buffer.concat([preChairData, newChairData, postChairData]);

  const offsetDiff = newChairData.byteLength - (chairOldEndOffset - chairStartOffset);

  // Update accessors and bufferViews
  posAcc.count = newVertCount;
  posAcc.min = [minX, minY, minZ];
  posAcc.max = [maxX, maxY, maxZ];
  posBv.byteLength = paddedPos.byteLength;

  normAcc.count = newVertCount;
  normBv.byteOffset = chairStartOffset + paddedPos.byteLength;
  normBv.byteLength = paddedNorm.byteLength;

  uvAcc.count = newVertCount;
  uvBv.byteOffset = normBv.byteOffset + paddedNorm.byteLength;
  uvBv.byteLength = paddedUv.byteLength;

  idxAcc.count = newIndices.length;
  idxBv.byteOffset = uvBv.byteOffset + paddedUv.byteLength;
  idxBv.byteLength = paddedIdx.byteLength;

  // Shift all bufferViews after bufferView 22
  for (let i = 23; i < gltf.bufferViews.length; i++) {
    gltf.bufferViews[i].byteOffset += offsetDiff;
  }

  gltf.buffers[0].byteLength = newBinBuf.byteLength;

  // Encode JSON chunk
  let jsonString = JSON.stringify(gltf);
  while (Buffer.byteLength(jsonString, "utf8") % 4 !== 0) {
    jsonString += " ";
  }
  const jsonChunkData = Buffer.from(jsonString, "utf8");

  // Build final GLB
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4); // version 2

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunkData.byteLength, 0);
  jsonHeader.write("JSON", 4, 4, "ascii");

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(newBinBuf.byteLength, 0);
  binHeader.write("BIN\0", 4, 4, "ascii");

  const totalLength = 12 + 8 + jsonChunkData.byteLength + 8 + newBinBuf.byteLength;
  header.writeUInt32LE(totalLength, 8);

  const finalGlb = Buffer.concat([header, jsonHeader, jsonChunkData, binHeader, newBinBuf]);
  await writeFile(glbPath, finalGlb);
  console.log(`Wrote repaired GLB to ${glbPath} (${finalGlb.byteLength} bytes)`);

  // Update manifest.json
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const meshFileEntry = manifest.files.find((f) => f.path === "mesh/v3_covered_windows.glb");
  if (meshFileEntry) {
    meshFileEntry.bytes = finalGlb.byteLength;
    meshFileEntry.sha256 = sha256(finalGlb);
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("Updated manifest.json");
}

repair().catch(console.error);
