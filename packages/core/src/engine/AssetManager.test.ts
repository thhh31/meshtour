import type { WebGLRenderer } from "three";
import { describe, expect, it } from "vitest";
import { validateConfig } from "../config/loader";
import { AssetManager } from "./AssetManager";

function manager(rendering: { previewSuffix?: string; fullSuffix?: string }) {
  const config = validateConfig({
    version: 1,
    assets: { basePath: "/tour/" },
    rendering,
    nodes: [{ id: "room", position: [0, 1.6, 0], panorama: { url: "pano/room" } }],
  });
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 4 },
  } as unknown as WebGLRenderer;
  return new AssetManager(renderer, config);
}

describe("AssetManager panorama URLs", () => {
  it("uses distinct preview and full suffixes", () => {
    const assets = manager({ previewSuffix: "_1k.jpg", fullSuffix: "_2k.ktx2" });
    expect(assets.panoramaUrl("room", "preview")).toBe("/tour/pano/room_1k.jpg");
    expect(assets.panoramaUrl("room", "full")).toBe("/tour/pano/room_2k.ktx2");
  });

  it.each([
    [{ previewSuffix: "_1k.jpg" }, "/tour/pano/room_1k.jpg"],
    [{ fullSuffix: "_2k.ktx2" }, "/tour/pano/room_2k.ktx2"],
    [{}, "/tour/pano/room"],
  ] as const)("uses the sole configured quality for both requests", (rendering, expected) => {
    const assets = manager(rendering);
    expect(assets.panoramaUrl("room", "preview")).toBe(expected);
    expect(assets.panoramaUrl("room", "full")).toBe(expected);
  });
});
