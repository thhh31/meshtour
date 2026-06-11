export const TWO_PI = Math.PI * 2;

export function clamp(x: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, x));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Blend curve for the panorama crossfade during a transition. Biased so the
 * blend completes around ~78% of the camera travel, hiding the worst
 * reprojection stretching near the arrival point.
 */
export function transitionBlend(t: number): number {
  return smoothstep(0.1, 0.78, t);
}

/**
 * Convert a world-space direction to equirectangular UV, matching the GLSL in
 * PanoramaMaterial and three.js' `equirectUv` convention.
 * `yaw` is the per-panorama alignment offset in radians.
 */
export function dirToEquirectUv(
  dir: { x: number; y: number; z: number },
  yaw = 0,
): [number, number] {
  // Rotate around Y by yaw (must match rotateY in the shader).
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const x = c * dir.x + s * dir.z;
  const z = -s * dir.x + c * dir.z;
  const len = Math.hypot(x, dir.y, z) || 1;
  const u = Math.atan2(z / len, x / len) / TWO_PI + 0.5;
  const v = Math.asin(clamp(dir.y / len, -1, 1)) / Math.PI + 0.5;
  return [u, v];
}
