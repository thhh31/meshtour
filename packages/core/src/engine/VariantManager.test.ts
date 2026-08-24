import {
  BoxGeometry,
  CubeTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  Texture,
  Vector3,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { validateConfig } from "../config/loader";
import { createDollhouseMaterial, type DollhouseSource } from "../rendering/DollhouseMaterial";
import { PanoramaProjection } from "../rendering/PanoramaMaterial";
import type { AssetManager } from "./AssetManager";
import { VariantManager } from "./VariantManager";

function fixture() {
  const config = validateConfig({
    version: 1,
    nodes: [
      { id: "living", position: [0, 1.6, 0], panorama: { url: "living.jpg" } },
      { id: "lounge", position: [1, 1.6, 0], panorama: { url: "lounge.jpg" } },
    ],
    configurables: [
      {
        id: "sofa-finish",
        interactable: "sofa",
        default: "original",
        variants: [
          { id: "original" },
          {
            id: "terracotta",
            layers: { living: "living-layer.png", lounge: "lounge-layer.png" },
          },
        ],
      },
    ],
  });
  const root = new Group();
  const sofa = new Group();
  sofa.name = "int_sofa";
  const mesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
  sofa.add(mesh);
  root.add(sofa);
  const living = new Texture();
  const lounge = new Texture();
  const ensureLayer = vi.fn(async (url: string) => (url === "living-layer.png" ? living : lounge));
  const preupload = vi.fn();
  const assets = { ensureLayer, preupload } as unknown as AssetManager;
  const projection = new PanoramaProjection();
  return { config, root, mesh, living, lounge, ensureLayer, preupload, assets, projection };
}

describe("VariantManager", () => {
  it("loads active layers atomically and promotes B to A", async () => {
    const setup = fixture();
    const manager = new VariantManager(setup.config, setup.assets, setup.projection, setup.root);
    const material = setup.mesh.material as unknown as ShaderMaterial;

    await manager.prepareSlot("a", "living");
    expect(material.uniforms.uHasLayerA!.value).toBe(0);

    await manager.setVariant("sofa-finish", "terracotta");
    expect(manager.getVariant("sofa-finish")).toBe("terracotta");
    expect(material.uniforms.uLayerA!.value).toBe(setup.living);
    expect(material.uniforms.uHasLayerA!.value).toBe(1);

    await manager.prepareSlot("b", "lounge");
    expect(material.uniforms.uLayerB!.value).toBe(setup.lounge);
    manager.promoteBToA();
    expect(material.uniforms.uLayerA!.value).toBe(setup.lounge);
    expect(material.uniforms.uLayerB!.value).toBeNull();
    expect(setup.preupload).toHaveBeenCalledWith(setup.living);
    expect(setup.preupload).toHaveBeenCalledWith(setup.lounge);

    setup.projection.dispose();
    setup.mesh.geometry.dispose();
  });

  it("rejects a configurable whose interactable is absent from the proxy", () => {
    const setup = fixture();
    setup.root.clear();
    expect(
      () => new VariantManager(setup.config, setup.assets, setup.projection, setup.root),
    ).toThrow(/targets missing interactable "sofa"/);
    setup.projection.dispose();
    setup.mesh.geometry.dispose();
  });

  it("binds configurable layers to projection-only proxy targets", () => {
    const setup = fixture();
    setup.root.children[0]!.name = "proxy_sofa";

    new VariantManager(setup.config, setup.assets, setup.projection, setup.root);

    expect(setup.mesh.material).toBeInstanceOf(ShaderMaterial);
    setup.projection.dispose();
    setup.mesh.geometry.dispose();
  });

  it("reports whether an atomic update was superseded", async () => {
    const setup = fixture();
    let release: (() => void) | undefined;
    setup.ensureLayer.mockImplementationOnce(
      () => new Promise<Texture>((resolve) => (release = () => resolve(setup.living))),
    );
    const manager = new VariantManager(setup.config, setup.assets, setup.projection, setup.root);
    await manager.prepareSlot("a", "living");

    const older = manager.setVariants({ "sofa-finish": "terracotta" });
    const newer = manager.setVariants({ "sofa-finish": "original" });
    release?.();

    await expect(newer).resolves.toBe(true);
    await expect(older).resolves.toBe(false);
    expect(manager.getVariant("sofa-finish")).toBe("original");

    setup.projection.dispose();
    setup.mesh.geometry.dispose();
  });

  it("keeps selected layers on configurable meshes in dollhouse view", async () => {
    const setup = fixture();
    const manager = new VariantManager(setup.config, setup.assets, setup.projection, setup.root);
    await manager.prepareSlot("a", "living");
    await manager.setVariant("sofa-finish", "terracotta");

    const sources: DollhouseSource[] = setup.config.nodes.map((node) => ({
      nodeId: node.id,
      texture: new Texture(),
      depth: new CubeTexture(),
      center: new Vector3().fromArray(node.position),
      panorama: node.panorama,
    }));
    const base = createDollhouseMaterial(sources, "#000");
    await manager.prepareDollhouseMaterials(base, sources);

    const material = manager.getDollhouseMaterial(setup.mesh);
    expect(material?.uniforms.uLayer0!.value).toBe(setup.living);
    expect(material?.uniforms.uLayer1!.value).toBe(setup.lounge);
    expect(material?.uniforms.uHasLayer0!.value).toBe(1);
    expect(material?.uniforms.uPanoramaMix).toBe(base.uniforms.uPanoramaMix);

    await manager.setVariant("sofa-finish", "original");
    expect(material?.uniforms.uHasLayer0!.value).toBe(0);
    expect(material?.uniforms.uHasLayer1!.value).toBe(0);

    manager.dispose();
    base.dispose();
    setup.projection.dispose();
    setup.mesh.geometry.dispose();
  });
});
