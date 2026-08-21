import { clamp, smoothstep } from "../utils/math";

export const DEPTH_TOLERANCE_MIN = 0.02;
export const DEPTH_TOLERANCE_MAX = 0.14;
export const DEPTH_TOLERANCE_CONSTANT = 0.012;
export const DEPTH_TEXEL_SCALE = 1.25;
export const DEPTH_GRAZING_SCALE = 0.025;

/** CPU reference for the adaptive tolerance used by PanoramaMaterial.glsl. */
export function adaptiveDepthTolerance(
  fragmentDistance: number,
  cubemapSize: number,
  normalRayAlignment = 1,
): number {
  const safeSize = Math.max(1, cubemapSize);
  const texelFootprint = (2 * Math.max(0, fragmentDistance)) / safeSize;
  const grazing = 1 - clamp(Math.abs(normalRayAlignment), 0, 1);
  return clamp(
    DEPTH_TOLERANCE_CONSTANT + texelFootprint * DEPTH_TEXEL_SCALE + grazing * DEPTH_GRAZING_SCALE,
    DEPTH_TOLERANCE_MIN,
    DEPTH_TOLERANCE_MAX,
  );
}

/** Smooth, monotonic visibility confidence around a stored radial depth. */
export function radialDepthConfidence(
  fragmentDistance: number,
  storedDistance: number,
  tolerance: number,
): number {
  const safeTolerance = Math.max(Number.EPSILON, tolerance);
  return (
    1 -
    smoothstep(
      storedDistance + safeTolerance * 0.2,
      storedDistance + safeTolerance,
      fragmentDistance,
    )
  );
}

export interface SourceWeights {
  weightA: number;
  weightB: number;
  total: number;
  /** One means neither panorama contains valid evidence for this fragment. */
  bridge: number;
}

/** CPU implementation of three.js packDepthToRGBA after RGBA8 quantization. */
export function packDepthRgba8(depth: number): [number, number, number, number] {
  const value = clamp(depth, 0, 1);
  if (value <= 0) return [0, 0, 0, 0];
  if (value >= 1) return [255, 255, 255, 255];
  let integer = Math.floor(value * 256 ** 3);
  const alpha = value * 256 ** 3 - integer;
  const blue = (integer % 256) / 256;
  integer = Math.floor(integer / 256);
  const green = (integer % 256) / 256;
  integer = Math.floor(integer / 256);
  return [
    Math.round((integer / 255) * 255),
    Math.round(((green * 256) / 255) * 255),
    Math.round(((blue * 256) / 255) * 255),
    Math.round(alpha * 255),
  ];
}

export function unpackDepthRgba8(rgba: readonly number[]): number {
  const [r = 0, g = 0, b = 0, a = 0] = rgba.map((channel) => clamp(channel, 0, 255) / 255);
  const downscale = 255 / 256;
  return r * downscale + g * (downscale / 256) + b * (downscale / 256 ** 2) + a * (1 / 256 ** 3);
}

export function radialDepthRoundTrip(distance: number, near: number, far: number): number {
  const normalized = clamp((distance - near) / (far - near), 0, 1);
  return near + unpackDepthRgba8(packDepthRgba8(normalized)) * (far - near);
}

/** CPU reference for confidence-weighted source normalization. */
export function normalizedSourceWeights(
  handoff: number,
  confidenceA: number,
  confidenceB: number,
): SourceWeights {
  const t = clamp(Number.isFinite(handoff) ? handoff : 0, 0, 1);
  const a = clamp(Number.isFinite(confidenceA) ? confidenceA : 0, 0, 1);
  const b = clamp(Number.isFinite(confidenceB) ? confidenceB : 0, 0, 1);
  let rawA = (1 - t) * a;
  let rawB = t * b;
  if (a <= 1e-3 && b > 1e-3) rawB = b;
  if (b <= 1e-3 && a > 1e-3) rawA = a;
  const total = rawA + rawB;
  if (total <= 1e-6) return { weightA: 0, weightB: 0, total: 0, bridge: 1 };
  return {
    weightA: rawA / total,
    weightB: rawB / total,
    total,
    bridge: 0,
  };
}
