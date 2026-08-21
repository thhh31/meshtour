import { describe, expect, it } from "vitest";
import {
  DEPTH_TOLERANCE_MAX,
  DEPTH_TOLERANCE_MIN,
  adaptiveDepthTolerance,
  normalizedSourceWeights,
  radialDepthConfidence,
  radialDepthRoundTrip,
} from "./visibilityMath";

describe("radial depth math", () => {
  it.each([0.025, 1.6, 8, 199.9, 200])("round-trips %s meters through packed RGBA8", (distance) => {
    expect(radialDepthRoundTrip(distance, 0.025, 200)).toBeCloseTo(distance, 4);
  });

  it("keeps adaptive tolerance bounded and grows with texel footprint", () => {
    const near = adaptiveDepthTolerance(1, 256, 1);
    const far = adaptiveDepthTolerance(20, 256, 1);
    const grazing = adaptiveDepthTolerance(20, 256, 0);
    expect(near).toBeGreaterThanOrEqual(DEPTH_TOLERANCE_MIN);
    expect(grazing).toBeLessThanOrEqual(DEPTH_TOLERANCE_MAX);
    expect(far).toBeGreaterThan(near);
    expect(grazing).toBeGreaterThanOrEqual(far);
  });

  it("decreases confidence monotonically behind the stored surface", () => {
    const values = [4.98, 5, 5.01, 5.03, 5.06, 5.1].map((distance) =>
      radialDepthConfidence(distance, 5, 0.08),
    );
    expect(values[0]).toBe(1);
    expect(values.at(-1)).toBe(0);
    values.slice(1).forEach((value, index) => expect(value).toBeLessThanOrEqual(values[index]!));
  });
});

describe("source weight normalization", () => {
  it.each([
    [0.5, 1, 0, 1, 0, 0],
    [0.5, 0, 1, 0, 1, 0],
    [0.25, 1, 1, 0.75, 0.25, 0],
    [0.5, 0, 0, 0, 0, 1],
    [0, 0, 1, 0, 1, 0],
    [1, 1, 0, 1, 0, 0],
  ])(
    "normalizes handoff=%s confidence=%s/%s",
    (handoff, confidenceA, confidenceB, expectedA, expectedB, bridge) => {
      const weights = normalizedSourceWeights(handoff, confidenceA, confidenceB);
      expect(weights.weightA).toBeCloseTo(expectedA);
      expect(weights.weightB).toBeCloseTo(expectedB);
      expect(weights.bridge).toBe(bridge);
      for (const value of Object.values(weights)) expect(Number.isFinite(value)).toBe(true);
    },
  );

  it("never returns NaN or Infinity for non-finite inputs", () => {
    const weights = normalizedSourceWeights(Number.NaN, Infinity, -Infinity);
    for (const value of Object.values(weights)) expect(Number.isFinite(value)).toBe(true);
  });
});
