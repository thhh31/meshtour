import { Quaternion, Vector3 } from "three";

/** Align the headset's initial forward direction with the pre-VR desktop view. */
export function resolveXRRigYaw(
  desktopYaw: number,
  viewerOrientation: Quaternion,
  scratch = new Vector3(),
): number {
  const forward = scratch.set(0, 0, -1).applyQuaternion(viewerOrientation);
  const viewerYaw = Math.atan2(-forward.x, -forward.z);
  return desktopYaw - viewerYaw;
}

/** Offset a local-floor XR origin so the initial headset pose lands on a tour node. */
export function resolveXRRigPosition(
  navigationPosition: Vector3,
  viewerOrigin: Vector3,
  rigOrientation: Quaternion,
  target = new Vector3(),
): Vector3 {
  return target.copy(viewerOrigin).applyQuaternion(rigOrientation).negate().add(navigationPosition);
}
