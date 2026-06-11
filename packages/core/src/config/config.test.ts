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
    expect(config.nodes[0]!.panorama.yaw).toBe(0);
    expect(config.nodes[0]!.initialView!.pitch).toBe(0);
    expect(config.nodes[1]!.links).toEqual([]);
    expect(config.hotspots[0]!.type).toBe("info");
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
