import { CubeTexture, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { PanoramaProjection } from "./PanoramaMaterial";

describe("PanoramaProjection texture upgrades", () => {
  it("replaces a texture used by an active projection slot", () => {
    const projection = new PanoramaProjection();
    const preview = new Texture();
    const full = new Texture();
    projection.setSlotA(preview, new Vector3(), 0);

    expect(projection.replaceTexture(preview, full)).toBe(true);
    expect(projection.uniforms.uPanoA.value).toBe(full);
  });

  it("keeps transparent layer slots private to each configurable material", () => {
    const projection = new PanoramaProjection();
    const sofa = projection.createLayerMaterial();
    const chair = projection.createLayerMaterial();
    const texture = new Texture();

    sofa.uniforms.uLayerA.value = texture;
    sofa.uniforms.uHasLayerA.value = 1;

    expect(sofa.uniforms.uLayerA.value).toBe(texture);
    expect(chair.uniforms.uLayerA.value).toBeNull();
    expect(chair.uniforms.uHasLayerA.value).toBe(0);
  });

  it("does not report a replacement for an inactive prefetched texture", () => {
    const projection = new PanoramaProjection();

    expect(projection.replaceTexture(new Texture(), new Texture())).toBe(false);
  });

  it("promotes the arriving panorama and its visibility map together", () => {
    const projection = new PanoramaProjection();
    const departing = new Texture();
    const arriving = new Texture();
    const depthA = new CubeTexture();
    const depthB = new CubeTexture();
    projection.setSlotA(departing, new Vector3(), 0, depthA);
    projection.setSlotB(arriving, new Vector3(1, 0, 0), 0.4, depthB);

    projection.promoteBToA();

    expect(projection.uniforms.uPanoA.value).toBe(arriving);
    expect(projection.uniforms.uDepthA.value).toBe(depthB);
    expect(projection.uniforms.uHasDepthA.value).toBe(1);
  });
});
