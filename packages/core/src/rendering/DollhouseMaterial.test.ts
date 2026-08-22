import { CubeTexture, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createDollhouseMaterial } from "./DollhouseMaterial";

describe("createDollhouseMaterial", () => {
  it("uses the top render only after panorama coverage is exhausted", () => {
    const material = createDollhouseMaterial(
      [
        {
          nodeId: "room",
          texture: new Texture(),
          depth: new CubeTexture(),
          center: new Vector3(),
          panorama: { url: "pano/room.jpg", yaw: 0 },
        },
      ],
      "#000000",
      {
        texture: new Texture(),
        bounds: { min: [0, -5], max: [5, 0] },
      },
    );

    const panoramaContribution = material.fragmentShader.indexOf("weightSum += sourceWeight0");
    const topFallback = material.fragmentShader.indexOf("if (weightSum <= 0.000001)");
    expect(panoramaContribution).toBeGreaterThan(-1);
    expect(topFallback).toBeGreaterThan(panoramaContribution);
    expect(material.fragmentShader).toContain("float upwardFacing = step(0.65");
    expect(material.uniforms.uPanoramaMix?.value).toBe(0);
    expect(material.uniforms.uPreferred0?.value).toBe(0);
  });
});
