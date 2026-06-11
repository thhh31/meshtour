import { describe, expect, it } from "vitest";
import { clamp, dirToEquirectUv, easeInOutCubic, transitionBlend } from "./math";

describe("dirToEquirectUv", () => {
  it("maps cardinal directions to the expected UVs (three.js equirect convention)", () => {
    expect(dirToEquirectUv({ x: 1, y: 0, z: 0 })).toEqual([0.5, 0.5]);
    const [uNegX] = dirToEquirectUv({ x: -1, y: 0, z: 0 });
    expect(uNegX).toBeCloseTo(1.0);
    const [uPosZ] = dirToEquirectUv({ x: 0, y: 0, z: 1 });
    expect(uPosZ).toBeCloseTo(0.75);
    const [uNegZ] = dirToEquirectUv({ x: 0, y: 0, z: -1 });
    expect(uNegZ).toBeCloseTo(0.25);
  });

  it("maps straight up/down to the texture poles", () => {
    expect(dirToEquirectUv({ x: 0, y: 1, z: 0 })[1]).toBeCloseTo(1.0);
    expect(dirToEquirectUv({ x: 0, y: -1, z: 0 })[1]).toBeCloseTo(0.0);
  });

  it("normalizes non-unit directions", () => {
    const [u, v] = dirToEquirectUv({ x: 10, y: 0, z: 0 });
    expect(u).toBeCloseTo(0.5);
    expect(v).toBeCloseTo(0.5);
  });

  it("applies the yaw offset as a rotation around Y", () => {
    const [u] = dirToEquirectUv({ x: 1, y: 0, z: 0 }, Math.PI / 2);
    // x rotated by +90° lands where -z was.
    expect(u).toBeCloseTo(0.25);
  });

  it("matches the GLSL rotateY for an arbitrary yaw", () => {
    const yaw = 0.7;
    const dir = { x: 0.3, y: 0.5, z: -0.8 };
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const rotated = { x: c * dir.x + s * dir.z, y: dir.y, z: -s * dir.x + c * dir.z };
    expect(dirToEquirectUv(dir, yaw)).toEqual(dirToEquirectUv(rotated, 0));
  });
});

describe("transitionBlend", () => {
  it("starts at 0 and ends at 1", () => {
    expect(transitionBlend(0)).toBe(0);
    expect(transitionBlend(1)).toBe(1);
  });

  it("completes the blend by ~78% of the camera travel", () => {
    expect(transitionBlend(0.78)).toBeCloseTo(1);
    expect(transitionBlend(0.8)).toBe(1);
  });

  it("is monotonically non-decreasing", () => {
    let previous = -1;
    for (let i = 0; i <= 100; i++) {
      const value = transitionBlend(i / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("easing helpers", () => {
  it("easeInOutCubic hits its boundary values", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
  });

  it("clamp behaves", () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});
