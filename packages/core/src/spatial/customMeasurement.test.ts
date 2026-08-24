import { describe, expect, it } from "vitest";
import { calculateCustomMeasurement } from "./customMeasurement";

describe("calculateCustomMeasurement", () => {
  it("adds the length of consecutive points", () => {
    const result = calculateCustomMeasurement([
      [0, 0, 0],
      [3, 0, 0],
      [3, 4, 0],
    ]);

    expect(result.length).toBe(7);
  });

  it("calculates area for a coplanar polygon in any orientation", () => {
    const result = calculateCustomMeasurement([
      [2, 0, 0],
      [2, 3, 0],
      [2, 3, 4],
      [2, 0, 4],
    ]);

    expect(result.area).toBeCloseTo(12);
    expect(result.perimeter).toBeCloseTo(14);
  });

  it("does not report area for a non-coplanar path", () => {
    const result = calculateCustomMeasurement([
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 1, 2],
    ]);

    expect(result.area).toBeNull();
    expect(result.perimeter).toBeNull();
  });
});
