import { CubeTexture, Texture, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createDollhouseMaterial } from "./DollhouseMaterial";

describe("createDollhouseMaterial", () => {
  it("keeps all five panorama captures available to the compositor", () => {
    const material = createDollhouseMaterial(
      Array.from({ length: 5 }, (_, index) => ({
        nodeId: `room-${index}`,
        texture: new Texture(),
        depth: new CubeTexture(),
        center: new Vector3(index, 0, 0),
        panorama: { url: `pano/room-${index}.jpg`, yaw: 0 },
      })),
      "#000000",
    );

    expect(material.name).toBe("meshtour_dollhouse_projection_5");
    expect(material.uniforms.uPano4).toBeDefined();
    expect(material.uniforms.uDepth4).toBeDefined();
  });

  it("rejects panorama captures from the opposite side of a proxy surface", () => {
    const material = createDollhouseMaterial(
      [
        {
          nodeId: "kitchen",
          texture: new Texture(),
          depth: new CubeTexture(),
          center: new Vector3(),
          panorama: { url: "pano/kitchen.jpg", yaw: 0 },
        },
      ],
      "#000000",
    );

    expect(material.fragmentShader).toContain("sourceFacing * viewerFacing");
    expect(material.fragmentShader).toContain("visibility * sameSide");
    expect(material.fragmentShader).not.toContain(
      "float facing = abs(dot(normalize(vWorldNormal), -direction))",
    );
  });

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
