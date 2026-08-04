import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const budgetBytes = 60 * 1024;
const bundle = await readFile(new URL("../packages/core/dist/index.js", import.meta.url));
const gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;

console.log(`@meshtour/core: ${(gzipBytes / 1024).toFixed(1)} KiB gzip (budget: 60 KiB)`);

if (gzipBytes > budgetBytes) {
  throw new Error(`Core bundle exceeds its gzip budget by ${gzipBytes - budgetBytes} bytes`);
}
