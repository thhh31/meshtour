import { BoxGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { resolvePlanBounds } from "./PlanRenderer";

describe("resolvePlanBounds", () => {
  it("uses authored plan bounds when supplied", () => {
    const root = new Group();
    const configured = { min: [0, -9] as [number, number], max: [7, 0] as [number, number] };
    expect(resolvePlanBounds(root, configured)).toBe(configured);
  });

  it("derives X/Z extents from proxy geometry", () => {
    const root = new Group();
    const room = new Mesh(new BoxGeometry(6, 2.7, 8));
    room.position.set(4, 1.35, -5);
    root.add(room);
    const bounds = resolvePlanBounds(root);
    expect(bounds.min[0]).toBeCloseTo(1);
    expect(bounds.max[0]).toBeCloseTo(7);
    expect(bounds.min[1]).toBeCloseTo(-9);
    expect(bounds.max[1]).toBeCloseTo(-1);
  });
});
