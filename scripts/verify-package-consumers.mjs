import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryPrefix = path.join(tmpdir(), "meshtour-consumer-");
const temporaryRoot = await mkdtemp(temporaryPrefix);
const packDirectory = path.join(temporaryRoot, "packs");
const consumerDirectory = path.join(temporaryRoot, "consumer");
const resolvedTemporaryRoot = path.resolve(temporaryRoot);
const resolvedPrefix = path.resolve(tmpdir()) + path.sep;
if (
  !resolvedTemporaryRoot.startsWith(resolvedPrefix) ||
  !path.basename(temporaryRoot).startsWith("meshtour-consumer-")
) {
  throw new Error(`Unexpected temporary path: ${resolvedTemporaryRoot}`);
}

function run(command, args, cwd = projectRoot) {
  execFileSync(command, args, { cwd, stdio: "inherit" });
}

async function write(relativePath, contents) {
  const target = path.join(consumerDirectory, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

try {
  await mkdir(packDirectory, { recursive: true });
  run("pnpm", [
    "--dir",
    path.join(projectRoot, "packages/core"),
    "pack",
    "--pack-destination",
    packDirectory,
  ]);
  run("pnpm", [
    "--dir",
    path.join(projectRoot, "packages/react"),
    "pack",
    "--pack-destination",
    packDirectory,
  ]);

  const tarballs = await readdir(packDirectory);
  const coreTarball = tarballs.find((name) => name.startsWith("meshtour-core-"));
  const reactTarball = tarballs.find((name) => name.startsWith("meshtour-react-"));
  if (!coreTarball || !reactTarball) throw new Error("Expected package tarballs were not created");

  await mkdir(consumerDirectory, { recursive: true });
  await write(
    "package.json",
    `${JSON.stringify(
      {
        name: "meshtour-package-consumer",
        private: true,
        type: "module",
        packageManager: "pnpm@9.15.4",
        dependencies: {
          "@meshtour/core": `file:${path.join(packDirectory, coreTarball)}`,
          "@meshtour/react": `file:${path.join(packDirectory, reactTarball)}`,
          react: "19.2.7",
          "react-dom": "19.2.7",
          three: "0.184.0",
        },
        devDependencies: {
          "@types/react": "19.2.17",
          "@types/react-dom": "19.2.3",
          typescript: "5.9.3",
        },
      },
      null,
      2,
    )}\n`,
  );
  await write(
    "tsconfig.json",
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          skipLibCheck: false,
        },
        include: ["src"],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    "src/consumer.tsx",
    `import { TourEngine, validateConfig, type TourConfigInput } from "@meshtour/core";
import { Tour, useTour } from "@meshtour/react";

const config = {
  version: 1,
  assets: {},
  nodes: [{ id: "room", position: [0, 1.6, 0], panorama: { url: "room.jpg" } }],
} satisfies TourConfigInput;

validateConfig(config);
const engineTypecheck = (engine: TourEngine) => engine.lookAt([0, 1.6, -1]);

export function Controls() {
  const { goToNode } = useTour();
  return <button onClick={() => void goToNode("room")}>Room</button>;
}

export function Consumer() {
  return <Tour config={config}><Controls /></Tour>;
}

void engineTypecheck;
`,
  );
  await write(
    "smoke.mjs",
    `import React from "react";
import { renderToString } from "react-dom/server";
import { TourEventEmitter, validateConfig } from "@meshtour/core";
import { Tour } from "@meshtour/react";

const config = validateConfig({
  version: 1,
  nodes: [{ id: "room", position: [0, 1.6, 0], panorama: { url: "room.jpg" } }],
});
if (config.start !== undefined || config.nodes[0].panorama.yaw !== 0) {
  throw new Error("ESM config defaults are invalid");
}
const events = new TourEventEmitter();
let ready = false;
events.once("ready", () => { ready = true; });
events.emit("ready", undefined);
if (!ready) throw new Error("ESM event emitter did not fire");
const html = renderToString(React.createElement(Tour, { config }));
if (!html.includes("position:relative")) throw new Error("React SSR output is invalid");
`,
  );
  await write(
    "smoke.cjs",
    `const React = require("react");
const { renderToString } = require("react-dom/server");
const { validateConfig } = require("@meshtour/core");
const { Tour } = require("@meshtour/react");

const config = validateConfig({
  version: 1,
  nodes: [{ id: "room", position: [0, 1.6, 0], panorama: { url: "room.jpg" } }],
});
if (config.interactables.namePrefix !== "int_") throw new Error("CJS config defaults are invalid");
const html = renderToString(React.createElement(Tour, { config }));
if (!html.includes("position:relative")) throw new Error("CommonJS React SSR output is invalid");
`,
  );

  run("pnpm", ["install", "--prefer-offline", "--ignore-scripts"], consumerDirectory);
  run("pnpm", ["exec", "tsc", "--noEmit"], consumerDirectory);
  run("node", ["smoke.mjs"], consumerDirectory);
  run("node", ["smoke.cjs"], consumerDirectory);

  const packedReact = JSON.parse(
    execFileSync("tar", ["-xOf", path.join(packDirectory, reactTarball), "package/package.json"], {
      encoding: "utf8",
    }),
  );
  const { version: coreVersion } = JSON.parse(
    await readFile(path.join(projectRoot, "packages/core/package.json"), "utf8"),
  );
  if (packedReact.peerDependencies["@meshtour/core"] !== `^${coreVersion}`) {
    throw new Error("Packed React package did not rewrite its workspace core peer");
  }

  const packageFiles = await Promise.all(
    [coreTarball, reactTarball].map(async (tarball) => ({
      tarball,
      bytes: (await readFile(path.join(packDirectory, tarball))).byteLength,
    })),
  );
  console.log(
    `Package consumers verified: ESM, CommonJS, React SSR, TypeScript; ${packageFiles
      .map(({ tarball, bytes }) => `${tarball} ${(bytes / 1024).toFixed(1)} KiB`)
      .join(", ")}`,
  );
} finally {
  await rm(resolvedTemporaryRoot, { recursive: true, force: false });
}
