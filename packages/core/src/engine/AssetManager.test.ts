import { Texture, TextureLoader, type WebGLRenderer } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function depthManager(depth: Record<string, unknown>) {
  const config = validateConfig({
    version: 1,
    nodes: [{ id: "room", position: [0, 1.6, 0], panorama: { url: "room.jpg" }, depth }],
  });
  const renderer = {
    capabilities: { getMaxAnisotropy: () => 4 },
  } as unknown as WebGLRenderer;
  return new AssetManager(renderer, config);
}

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("AssetManager configurable layers", () => {
  it("uploads transparent layers with premultiplied alpha for edge-safe filtering", async () => {
    const texture = new Texture<HTMLImageElement>();
    vi.spyOn(TextureLoader.prototype, "loadAsync").mockResolvedValue(texture);
    const assets = manager({});

    expect((await assets.ensureLayer("layers/rug.png")).premultiplyAlpha).toBe(true);
  });
});

describe("AssetManager offline radial depth validation", () => {
  const validDepth = {
    url: "depth/room.ktx2",
    encoding: "rgba8-linear-radial",
    size: 256,
    near: 0.025,
    far: 200,
    checksum: "sha256:test",
  };

  it("reports the node and URL for incompatible near/far metadata", async () => {
    const assets = depthManager({ ...validDepth, near: 0.1 });
    await expect(assets.ensureDepth("room")).rejects.toThrow(
      /node "room".*depth\/room\.ktx2.*0\.1\/200.*0\.025\/200/,
    );
  });

  it("rejects non-KTX2 delivery before starting a texture request", async () => {
    const assets = depthManager({ ...validDepth, url: "depth/room.png" });
    await expect(assets.ensureDepth("room")).rejects.toThrow(/must be a KTX2 cubemap/);
  });
});
