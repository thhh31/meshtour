import { Euler, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { resolveXRRigPosition, resolveXRRigYaw } from "./xrMath";

describe("WebXR rig calibration", () => {
  it("places the initial local-floor headset pose exactly at the tour node", () => {
    const node = new Vector3(4, 1.62, -3);
    const viewer = new Vector3(0.15, 1.68, -0.1);
    const rotation = new Quaternion().setFromEuler(new Euler(0, Math.PI / 3, 0));
    const rigPosition = resolveXRRigPosition(node, viewer, rotation);
    const calibratedHead = viewer.clone().applyQuaternion(rotation).add(rigPosition);

    expect(calibratedHead.toArray()).toEqual(node.toArray());
  });

  it("preserves the desktop heading when the headset starts turned", () => {
    const desktopYaw = Math.PI / 4;
    const viewerOrientation = new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0));
    const rigYaw = resolveXRRigYaw(desktopYaw, viewerOrientation);
    const worldForward = new Vector3(0, 0, -1)
      .applyQuaternion(viewerOrientation)
      .applyAxisAngle(new Vector3(0, 1, 0), rigYaw);
    const worldYaw = Math.atan2(-worldForward.x, -worldForward.z);

    expect(worldYaw).toBeCloseTo(desktopYaw);
  });
});
