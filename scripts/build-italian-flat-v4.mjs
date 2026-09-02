import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { repairItalianFlatV4Mesh } from "./repair-italian-flat-v4-mesh.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v3/tour.json");
const outputRoot = path.join(projectRoot, "apps/demo/public/tours/italian-flat-v4");
const outputPath = path.join(outputRoot, "tour.json");
await repairItalianFlatV4Mesh(projectRoot);
const source = JSON.parse(await readFile(sourcePath, "utf8"));

const EXTRA_NODES = [
  {
    id: "living-window",
    name: "Living Window",
    position: [0.981, 1.62, -6.042],
    panorama: {
      url: "../italian-flat-v4/pano/living-window",
      yaw: -1.570796326794898,
    },
    initialView: { yaw: 0, pitch: -0.03 },
  },
  {
    id: "kitchen-window",
    name: "Kitchen Window",
    position: [0.828, 1.62, -1.759],
    panorama: {
      url: "../italian-flat-v4/pano/kitchen-window",
      yaw: -1.570796326794898,
    },
    initialView: { yaw: 0, pitch: -0.03 },
  },
];

source.name = "Italian Flat v4 — Property Configurator";
source.assets.basePath = "./tours/italian-flat-v3/";
source.assets.mesh = {
  // v4's proxy keeps the configurable floor separate and limits the kitchen
  // target to cabinet fronts. The inherited v3 kitchen joins unrelated
  // carcasses and worktops, producing long projection triangles in dollhouse
  // view at grazing angles.
  url: "../italian-flat-v4/mesh/property-configurator-covered.glb",
  draco: true,
};

source.configurables.push({
  id: "floor-finish",
  label: "Flooring",
  interactable: "floor",
  default: "original",
  variants: [
    { id: "original", label: "Developer standard", swatch: "#8c8176" },
    {
      id: "natural-oak",
      label: "Natural European oak",
      swatch: "#c99a61",
      layers: {
        kitchen: "../italian-flat-v4/layers/floor/natural-oak/kitchen_2k.png?v=2",
        living: "../italian-flat-v4/layers/floor/natural-oak/living_2k.png?v=2",
        lounge: "../italian-flat-v4/layers/floor/natural-oak/lounge_2k.png?v=2",
        "living-window": "../italian-flat-v4/layers/floor/natural-oak/living-window_2k.png?v=2",
        "kitchen-window": "../italian-flat-v4/layers/floor/natural-oak/kitchen-window_2k.png?v=2",
      },
    },
    {
      id: "light-travertine",
      label: "Honed light travertine",
      swatch: "#e5d8bf",
      layers: {
        kitchen: "../italian-flat-v4/layers/floor/light-travertine/kitchen_2k.png?v=2",
        living: "../italian-flat-v4/layers/floor/light-travertine/living_2k.png?v=2",
        lounge: "../italian-flat-v4/layers/floor/light-travertine/lounge_2k.png?v=2",
        "living-window":
          "../italian-flat-v4/layers/floor/light-travertine/living-window_2k.png?v=2",
        "kitchen-window":
          "../italian-flat-v4/layers/floor/light-travertine/kitchen-window_2k.png?v=2",
      },
    },
  ],
});

const furnitureLayerDirectories = {
  "sofa-finish": "sofa",
  "rug-finish": "rug",
  "lounge-chair-style": "chair",
};
for (const configurable of source.configurables) {
  const directory = furnitureLayerDirectories[configurable.id];
  if (!directory) continue;
  for (const variant of configurable.variants) {
    if (!variant.layers) continue;
    for (const node of EXTRA_NODES) {
      variant.layers[node.id] =
        `../italian-flat-v4/layers/${directory}/${variant.id}/${node.id}_4k.png?v=2`;
    }
  }
}

source.configurator = {
  catalogVersion: "italian-flat-v4-2026-08",
  currency: "EUR",
  basePriceMinor: 48_500_000,
  requestLabel: "Request this home",
  groups: [
    {
      id: "flooring",
      label: "Flooring",
      description: "Flooring throughout the apartment.",
      room: "Whole home",
      default: "original",
      options: [
        {
          id: "original",
          label: "Developer standard",
          sku: "FLR-STD",
          swatch: "#8c8176",
          variants: { "floor-finish": "original" },
        },
        {
          id: "natural-oak",
          label: "Natural European oak",
          description: "Wide-plank, matte oiled oak.",
          sku: "FLR-OAK-NAT",
          swatch: "#c99a61",
          thumbnail: "./tours/italian-flat-v4/materials/natural-european-oak-basecolor.png",
          priceDeltaMinor: 840_000,
          variants: { "floor-finish": "natural-oak" },
        },
        {
          id: "light-travertine",
          label: "Honed light travertine",
          description: "Low-sheen natural stone with filled pores.",
          sku: "FLR-TRAV-LT",
          swatch: "#e5d8bf",
          thumbnail: "./tours/italian-flat-v4/materials/light-travertine-basecolor.png",
          priceDeltaMinor: 1_120_000,
          variants: { "floor-finish": "light-travertine" },
        },
      ],
    },
    {
      id: "sofa",
      label: "Living room sofa",
      room: "Living room",
      default: "original",
      options: [
        {
          id: "original",
          label: "Original grey",
          sku: "SOF-STD",
          swatch: "#57504d",
          variants: { "sofa-finish": "original" },
        },
        {
          id: "terracotta",
          label: "Terracotta",
          sku: "SOF-TERRA",
          swatch: "#a85f43",
          priceDeltaMinor: 220_000,
          variants: { "sofa-finish": "terracotta" },
        },
        {
          id: "ivory-boucle",
          label: "Ivory bouclé",
          sku: "SOF-BOUCLE",
          swatch: "#e7dcc9",
          priceDeltaMinor: 310_000,
          variants: { "sofa-finish": "ivory-boucle" },
        },
        {
          id: "forest-velvet",
          label: "Forest velvet",
          sku: "SOF-VELVET",
          swatch: "#315b3b",
          priceDeltaMinor: 280_000,
          variants: { "sofa-finish": "forest-velvet" },
          requires: [
            {
              groupId: "rug",
              optionIds: ["sand-wool", "sage-weave"],
              message: "Available with the Sand wool or Sage weave rug package.",
            },
          ],
        },
      ],
    },
    {
      id: "rug",
      label: "Living room rug",
      room: "Living room",
      default: "original",
      options: [
        {
          id: "original",
          label: "Original grey",
          sku: "RUG-STD",
          swatch: "#777370",
          variants: { "rug-finish": "original" },
        },
        {
          id: "sand-wool",
          label: "Sand wool",
          sku: "RUG-SAND",
          swatch: "#bea47b",
          priceDeltaMinor: 95_000,
          variants: { "rug-finish": "sand-wool" },
        },
        {
          id: "sage-weave",
          label: "Sage weave",
          sku: "RUG-SAGE",
          swatch: "#789071",
          priceDeltaMinor: 105_000,
          variants: { "rug-finish": "sage-weave" },
        },
        {
          id: "charcoal-geometric",
          label: "Charcoal geometric",
          sku: "RUG-CHAR",
          swatch: "#41464d",
          priceDeltaMinor: 130_000,
          variants: { "rug-finish": "charcoal-geometric" },
        },
      ],
    },
    {
      id: "chair",
      label: "Lounge chair",
      room: "Library lounge",
      default: "original",
      options: [
        {
          id: "original",
          label: "Original",
          sku: "CHR-STD",
          swatch: "#4d4645",
          variants: { "lounge-chair-style": "original" },
        },
        {
          id: "moss-velvet",
          label: "Moss velvet",
          sku: "CHR-MOSS",
          swatch: "#486347",
          priceDeltaMinor: 145_000,
          variants: { "lounge-chair-style": "moss-velvet" },
        },
        {
          id: "cognac-leather",
          label: "Cognac leather",
          sku: "CHR-COGNAC",
          swatch: "#a45f2d",
          priceDeltaMinor: 190_000,
          variants: { "lounge-chair-style": "cognac-leather" },
        },
      ],
    },
  ],
  presets: [
    {
      id: "developer-standard",
      label: "Developer Standard",
      description: "The standard finishes.",
      badge: "Included",
      selections: {},
    },
    {
      id: "warm-contemporary",
      label: "Warm Contemporary",
      description: "Oak flooring and warm upholstery.",
      badge: "Most popular",
      selections: {
        flooring: "natural-oak",
        sofa: "terracotta",
        rug: "sand-wool",
        chair: "cognac-leather",
      },
    },
    {
      id: "natural-light",
      label: "Natural Light",
      description: "Travertine flooring and light upholstery.",
      selections: {
        flooring: "light-travertine",
        sofa: "ivory-boucle",
        rug: "sage-weave",
        chair: "moss-velvet",
      },
    },
  ],
};

source.hotspots = source.hotspots.filter((hotspot) => hotspot.id !== "kitchen_finishes");
source.hotspots.push({
  id: "floor_finishes",
  node: "living",
  position: [3.194, 0, -4.406],
  type: "custom",
  title: "Flooring",
  payload: { configurationGroup: "flooring" },
});

source.nodes = [
  ...source.nodes.filter((node) => !EXTRA_NODES.some((extra) => extra.id === node.id)),
  ...EXTRA_NODES,
];
source.links = [
  ...source.links.filter((link) => !EXTRA_NODES.some((node) => node.id === link.to)),
  { to: "living-window", position: [0.981, 0, -6.042], hideAtTarget: true },
  { to: "kitchen-window", position: [0.828, 0, -1.759], hideAtTarget: true },
];

await mkdir(outputRoot, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(source, null, 2)}\n`);

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

const files = [];
for (const relative of await listFiles(outputRoot)) {
  const contents = await readFile(path.join(outputRoot, relative));
  files.push({
    path: relative,
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex"),
  });
}
await writeFile(
  path.join(outputRoot, "manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      name: "Italian Flat v4 — Property Configurator",
      inherits: "../italian-flat-v3",
      files,
    },
    null,
    2,
  )}\n`,
);

console.log(`Italian Flat v4 built: ${files.length} local files`);
