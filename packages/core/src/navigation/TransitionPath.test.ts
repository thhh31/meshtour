import { describe, expect, it } from "vitest";
import type { NodeConfig } from "../config/schema";
import { createTransitionPath, resolveTransitionWaypoints } from "./TransitionPath";

function node(id: string, links: NodeConfig["links"] = []): NodeConfig {
  return {
    id,
    position: id === "a" ? [0, 1.6, 0] : [4, 1.6, 0],
    panorama: { url: `${id}.jpg`, yaw: 0 },
    links,
  };
}

describe("authored transition path", () => {
  it("preserves the capture positions as exact endpoints", () => {
    const path = createTransitionPath(
      [0, 1.6, 0],
      [8, 1.6, 0],
      [
        [2, 1.6, -1],
        [5, 1.6, 2],
      ],
    );
    expect(path.getPointAt(0).toArray()).toEqual([0, 1.6, 0]);
    expect(path.getPointAt(1).toArray()).toEqual([8, 1.6, 0]);
  });

  it("samples curved paths at approximately constant world-space speed", () => {
    const path = createTransitionPath(
      [0, 1.6, 0],
      [8, 1.6, 0],
      [
        [0.5, 1.6, -2],
        [6, 1.6, 2],
      ],
    );
    const distances = Array.from({ length: 20 }, (_, index) =>
      path.getPointAt((index + 1) / 20).distanceTo(path.getPointAt(index / 20)),
    );
    const average = distances.reduce((sum, value) => sum + value, 0) / distances.length;
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(average * 0.2);
  });

  it("uses a stable straight-line fallback without waypoints", () => {
    const path = createTransitionPath([0, 1, 0], [4, 1, 0]);
    expect(path.getPointAt(0.25).toArray()).toEqual([1, 1, 0]);
    expect(path.length).toBe(4);
  });

  it("reverses a reusable opposite-edge path", () => {
    const a = node("a", [
      {
        to: "b",
        position: [4, 0, 0],
        path: {
          waypoints: [
            [1, 1.6, -1],
            [3, 1.6, 1],
          ],
          reversible: true,
        },
      },
    ]);
    const b = node("b");
    expect(resolveTransitionWaypoints(b, a)).toEqual([
      [3, 1.6, 1],
      [1, 1.6, -1],
    ]);
  });

  it("prefers an explicit reverse path and respects reversible=false", () => {
    const a = node("a", [
      {
        to: "b",
        position: [4, 0, 0],
        path: { waypoints: [[2, 1.6, -1]], reversible: false },
      },
    ]);
    const bWithoutPath = node("b");
    expect(resolveTransitionWaypoints(bWithoutPath, a)).toEqual([]);

    const b = node("b", [
      {
        to: "a",
        position: [0, 0, 0],
        path: { waypoints: [[2, 1.6, 2]], reversible: true },
      },
    ]);
    expect(resolveTransitionWaypoints(b, a)).toEqual([[2, 1.6, 2]]);
  });
});
