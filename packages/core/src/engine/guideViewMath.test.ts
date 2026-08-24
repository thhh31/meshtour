import { describe, expect, it } from "vitest";
import { shortestYawDelta } from "./TourEngine";

describe("shortestYawDelta", () => {
  it("crosses the panorama seam using the shorter rotation", () => {
    const from = Math.PI - 0.1;
    const to = -Math.PI + 0.1;
    expect(shortestYawDelta(from, to)).toBeCloseTo(0.2);
    expect(shortestYawDelta(to, from)).toBeCloseTo(-0.2);
  });
});
