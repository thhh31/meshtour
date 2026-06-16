import { describe, expect, it } from "vitest";
import { resolveAssetUrl, validateConfig, ConfigError } from "./loader";

const minimalNode = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  position: [0, 1.6, 0] as [number, number, number],
  panorama: { url: `pano/${id}` },
  links: [] as { to: string; position: number[] }[],
  ...extra,
});

const validConfig = () => ({
  version: 1 as const,
  nodes: [
    minimalNode("living_room", {
      links: [{ to: "kitchen", position: [1, 0, 1] }],
      initialView: { yaw: 0.4 },
    }),
    minimalNode("kitchen"),
  ],
  hotspots: [
    {
      id: "hs_sofa",
      node: "living_room",
      position: [1.2, 0.7, -4.9],
      type: "info",
      title: "Sofa",
    },
  ],
  start: "living_room",
});

describe("tour config schema", () => {
  it("accepts a valid config and applies defaults", () => {
    const config = validateConfig(validConfig());
    expect(config.units).toBe("meters");
    expect(config.interactables.namePrefix).toBe("int_");
    expect(config.interactables.highlight.opacity).toBeCloseTo(0.12);
    expect(config.rendering.background).toBe("#0b0b0e");
    expect(config.rendering.transition).toBe("walk");
    expect(config.spatial.overview.floorY).toBe(0);
    expect(config.spatial.measurements).toEqual([]);
    expect(config.nodes[0]!.panorama.yaw).toBe(0);
    expect(config.nodes[0]!.initialView!.pitch).toBe(0);
    expect(config.nodes[1]!.links).toEqual([]);
    expect(config.links).toEqual([]);
    expect(config.hotspots[0]!.type).toBe("info");
  });

  it("accepts the fade transition for tours with sparse proxy coverage", () => {
    const parsed = validateConfig({
      ...validConfig(),
      rendering: { transition: "fade" as const },
    });

    expect(parsed.rendering.transition).toBe("fade");
  });

  it("accepts reusable overview, ceiling, baked top view, and measurement metadata", () => {
    const parsed = validateConfig({
      ...validConfig(),
      spatial: {
        overview: {
          bounds: { min: [0, -8], max: [6, 0] },
          ceiling: { y: 2.7, bounds: { min: [0, -8], max: [6, 0] } },
          topView: { url: "overview/top.jpg" },
        },
        measurements: [
          {
            id: "room",
            label: "Room",
            bounds: { min: [0, 0, -8], max: [6, 2.7, 0] },
            axes: ["width", "depth"],
            defaultVisible: true,
          },
          { id: "sofa", label: "Sofa", target: "int_sofa" },
        ],
      },
    });

    expect(parsed.spatial.overview.ceiling?.thickness).toBe(0.08);
    expect(parsed.spatial.overview.topView?.url).toBe("overview/top.jpg");
    expect(parsed.spatial.measurements[0]!.axes).toEqual(["width", "depth"]);
    expect(parsed.spatial.measurements[1]!.axes).toEqual(["width", "depth", "height"]);
  });

  it("rejects invalid spatial bounds and duplicate measurement ids", () => {
    expect(() =>
      validateConfig({
        ...validConfig(),
        spatial: { overview: { bounds: { min: [4, 0], max: [1, 2] } } },
      }),
    ).toThrow(/Plan bounds max must be greater than min/);

    expect(() =>
      validateConfig({
        ...validConfig(),
        spatial: {
          measurements: [
            { id: "sofa", label: "Sofa", target: "int_sofa" },
            { id: "sofa", label: "Other sofa", target: "int_sofa_2" },
          ],
        },
      }),
    ).toThrow(/Duplicate measurement id "sofa"/);
  });

  it("rejects an unknown version", () => {
    expect(() => validateConfig({ ...validConfig(), version: 2 })).toThrow(ConfigError);
  });

  it("rejects an empty node list", () => {
    expect(() => validateConfig({ version: 1, nodes: [] })).toThrow(ConfigError);
  });

  it("rejects duplicate node ids", () => {
    const config = validConfig();
    config.nodes.push(minimalNode("kitchen"));
    expect(() => validateConfig(config)).toThrow(/Duplicate node id "kitchen"/);
  });

  it("rejects links to unknown nodes", () => {
    const config = validConfig();
    config.nodes[0]!.links = [{ to: "garage", position: [0, 0, 0] }];
    expect(() => validateConfig(config)).toThrow(/Link target "garage" does not exist/);
  });

  it("supports shared links alongside location-specific links", () => {
    const parsed = validateConfig({
      ...validConfig(),
      links: [{ to: "kitchen", position: [2, 0, -1], hideAtTarget: false }],
    });

    expect(parsed.links).toEqual([{ to: "kitchen", position: [2, 0, -1], hideAtTarget: false }]);
    expect(parsed.nodes[0]!.links).toHaveLength(1);
  });

  it("rejects shared links to unknown nodes", () => {
    expect(() =>
      validateConfig({
        ...validConfig(),
        links: [{ to: "garage", position: [0, 0, 0] }],
      }),
    ).toThrow(/Link target "garage" does not exist/);
  });

  it("rejects an unknown start node", () => {
    expect(() => validateConfig({ ...validConfig(), start: "garage" })).toThrow(
      /Start node "garage" does not exist/,
    );
  });

  it("rejects hotspots anchored to unknown nodes", () => {
    const config = validConfig();
    config.hotspots[0]!.node = "garage";
    expect(() => validateConfig(config)).toThrow(/Hotspot node "garage" does not exist/);
  });

  it("supports shared hotspots alongside location-specific hotspots", () => {
    const config = validConfig();
    config.hotspots.push({
      id: "hs_shared",
      position: [2, 1, -3],
      type: "info",
      title: "Shared feature",
    } as never);

    const parsed = validateConfig(config);
    expect(parsed.hotspots.find((hotspot) => hotspot.id === "hs_shared")!.node).toBeUndefined();
    expect(parsed.hotspots.find((hotspot) => hotspot.id === "hs_sofa")!.node).toBe("living_room");
  });

  it("rejects duplicate hotspot ids", () => {
    const config = validConfig();
    config.hotspots.push({ ...config.hotspots[0]! });
    expect(() => validateConfig(config)).toThrow(/Duplicate hotspot id "hs_sofa"/);
  });

  it("keeps custom hotspot payloads untouched", () => {
    const config = validConfig();
    config.hotspots[0] = {
      id: "hs_custom",
      position: [0, 0, 0],
      type: "custom",
      payload: { anything: ["goes", 42] },
    } as never;
    const parsed = validateConfig(config);
    expect(parsed.hotspots[0]!.payload).toEqual({ anything: ["goes", 42] });
  });

  it("accepts transparent per-node variants for an interactable", () => {
    const parsed = validateConfig({
      ...validConfig(),
      configurables: [
        {
          id: "sofa-finish",
          interactable: "sofa",
          default: "original",
          variants: [
            { id: "original" },
            {
              id: "cream",
              swatch: "#eee4d4",
              layers: {
                living_room: "layers/sofa/cream/living.png",
                kitchen: "layers/sofa/cream/kitchen.png",
              },
            },
          ],
        },
      ],
    });

    expect(parsed.configurables[0]!.variants[0]!.layers).toEqual({});
    expect(parsed.configurables[0]!.variants[1]!.swatch).toBe("#eee4d4");
    expect(parsed.configurables[0]!.variants[1]!.layers.living_room).toContain("living.png");
  });

  it("rejects configurable defaults and layer nodes that do not exist", () => {
    expect(() =>
      validateConfig({
        ...validConfig(),
        configurables: [
          {
            id: "sofa-finish",
            interactable: "sofa",
            default: "missing",
            variants: [{ id: "cream", layers: { garage: "garage.png" } }],
          },
        ],
      }),
    ).toThrow(/Variant layer node "garage" does not exist/);

    expect(() =>
      validateConfig({
        ...validConfig(),
        configurables: [
          {
            id: "sofa-finish",
            interactable: "sofa",
            default: "missing",
            variants: [{ id: "cream" }],
          },
        ],
      }),
    ).toThrow(/Default variant "missing" does not exist/);
  });
});

describe("resolveAssetUrl", () => {
  const withBase = { assets: { basePath: "https://cdn.example.com/tours/apartment/" } };
  const withBaseNoSlash = { assets: { basePath: "https://cdn.example.com/tours/apartment" } };
  const noBase = { assets: {} };

  it("resolves relative URLs against basePath", () => {
    expect(resolveAssetUrl(withBase, "mesh/apartment.glb")).toBe(
      "https://cdn.example.com/tours/apartment/mesh/apartment.glb",
    );
    expect(resolveAssetUrl(withBaseNoSlash, "mesh/apartment.glb")).toBe(
      "https://cdn.example.com/tours/apartment/mesh/apartment.glb",
    );
  });

  it("passes through absolute, root-relative, blob and data URLs", () => {
    expect(resolveAssetUrl(withBase, "https://other.com/a.glb")).toBe("https://other.com/a.glb");
    expect(resolveAssetUrl(withBase, "/local/a.glb")).toBe("/local/a.glb");
    expect(resolveAssetUrl(withBase, "blob:null/123")).toBe("blob:null/123");
    expect(resolveAssetUrl(withBase, "data:image/png;base64,xyz")).toBe(
      "data:image/png;base64,xyz",
    );
  });

  it("returns the URL unchanged without a basePath", () => {
    expect(resolveAssetUrl(noBase, "mesh/apartment.glb")).toBe("mesh/apartment.glb");
  });
});
