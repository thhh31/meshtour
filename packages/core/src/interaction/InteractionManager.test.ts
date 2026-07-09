import { Group, Mesh, Object3D } from "three";
import { describe, expect, it } from "vitest";
import { isObjectEffectivelyVisible, isPickableInFront } from "./InteractionManager";

describe("isObjectEffectivelyVisible", () => {
  it("accepts a visible object with visible ancestors", () => {
    const root = new Group();
    const child = new Mesh();
    root.add(child);

    expect(isObjectEffectivelyVisible(child)).toBe(true);
  });

  it("rejects an object hidden directly", () => {
    const object = new Object3D();
    object.visible = false;

    expect(isObjectEffectivelyVisible(object)).toBe(false);
  });

  it("rejects a visible object under a hidden navigation group", () => {
    const root = new Group();
    const hiddenGroup = new Group();
    const linkDisc = new Mesh();
    hiddenGroup.visible = false;
    root.add(hiddenGroup);
    hiddenGroup.add(linkDisc);

    expect(linkDisc.visible).toBe(true);
    expect(isObjectEffectivelyVisible(linkDisc)).toBe(false);
  });
});

describe("isPickableInFront", () => {
  it("accepts a marker when the ray does not hit the proxy", () => {
    expect(isPickableInFront(4, null)).toBe(true);
  });

  it("accepts a marker on the proxy surface within tolerance", () => {
    expect(isPickableInFront(4.02, 4)).toBe(true);
  });

  it("rejects a marker hidden behind proxy geometry", () => {
    expect(isPickableInFront(5, 4)).toBe(false);
  });
});
