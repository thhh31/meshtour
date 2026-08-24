import {
  Color,
  DoubleSide,
  GLSL3,
  ShaderMaterial,
  Vector3,
  Vector4,
  type CubeTexture,
  type IUniform,
  type Texture,
} from "three";
import type { PanoramaConfig, PlanBoundsConfig } from "../config/schema";
import { PANORAMA_DEPTH_FAR, PANORAMA_DEPTH_NEAR } from "./PanoramaVisibilityMap";

/**
 * WebGL2 guarantees 16 fragment texture units. Five configurable sources use
 * 15 (panorama, depth and layer each), preserving the final unit for a top
 * view while keeping every capture in the five-node demo.
 */
export const MAX_DOLLHOUSE_SOURCES = 5;

export interface DollhouseSource {
  nodeId: string;
  texture: Texture;
  depth: CubeTexture;
  center: Vector3;
  panorama: PanoramaConfig;
}

/** Optional baked orthographic source used to sharpen horizontal surfaces. */
export interface DollhouseTopView {
  texture: Texture;
  bounds: PlanBoundsConfig;
}

export interface DollhouseLayerSource {
  nodeId: string;
  texture: Texture | null;
}

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

function sourceDeclarations(count: number, hasLayers: boolean): string {
  return Array.from(
    { length: count },
    (_, index) => /* glsl */ `
uniform sampler2D uPano${index};
uniform samplerCube uDepth${index};
uniform vec3 uCenter${index};
uniform float uYaw${index};
uniform float uExposure${index};
uniform vec3 uColor${index};
uniform float uPreferred${index};${
      hasLayers
        ? `
uniform sampler2D uLayer${index};
uniform float uHasLayer${index};`
        : ""
    }`,
  ).join("\n");
}

function sourceContributions(count: number, hasLayers: boolean): string {
  return Array.from(
    { length: count },
    (_, index) => /* glsl */ `
  vec4 sourceColor${index} = samplePano(uPano${index}, uCenter${index}, uYaw${index});
${
  hasLayers
    ? `  if (uHasLayer${index} > 0.5) {
    vec4 layerColor${index} = samplePano(uLayer${index}, uCenter${index}, uYaw${index});
    sourceColor${index} = vec4(
      sourceColor${index}.rgb * (1.0 - layerColor${index}.a) + layerColor${index}.rgb,
      1.0
    );
  }`
    : ""
}
  sourceColor${index}.rgb *= exp2(uExposure${index}) * uColor${index};
  float sourceWeight${index} = sourceWeight(uDepth${index}, uCenter${index});
  colorSum += sourceColor${index}.rgb * sourceWeight${index};
  weightSum += sourceWeight${index};
  float preferredWeight${index} = sourceWeight${index} * uPreferred${index};
  preferredColorSum += sourceColor${index}.rgb * preferredWeight${index};
  preferredWeightSum += preferredWeight${index};`,
  ).join("\n");
}

function topViewDeclarations(enabled: boolean): string {
  if (!enabled) return "";
  return /* glsl */ `
uniform sampler2D uTopView;
uniform vec4 uTopBounds;`;
}

function topViewContribution(enabled: boolean): string {
  if (!enabled) return "";
  return /* glsl */ `
  // The baked top render is a hole filler, never a blend source. Even a very
  // weak depth-validated panorama sample wins completely, which prevents the
  // orthographic image from bending across otherwise covered geometry.
  if (weightSum <= 0.000001) {
    vec2 topExtent = max(uTopBounds.zw - uTopBounds.xy, vec2(0.0001));
    vec2 topUv = vec2(
      (vWorldPosition.x - uTopBounds.x) / topExtent.x,
      (uTopBounds.w - vWorldPosition.z) / topExtent.y
    );
    float insideTopView =
      step(0.0, topUv.x) * step(topUv.x, 1.0) *
      step(0.0, topUv.y) * step(topUv.y, 1.0);
    float upwardFacing = step(0.65, normalize(vWorldNormal).y);
    float topFallback = insideTopView * upwardFacing;
    if (topFallback > 0.5) {
      colorSum = texture(uTopView, clamp(topUv, vec2(0.0), vec2(1.0))).rgb;
      weightSum = 1.0;
    }
  }`;
}

function createFragmentShader(count: number, hasTopView: boolean, hasLayers = false): string {
  return /* glsl */ `
${sourceDeclarations(count, hasLayers)}
${topViewDeclarations(hasTopView)}
uniform vec3 uBackground;
uniform float uDepthNear;
uniform float uDepthFar;
uniform float uPanoramaMix;
uniform float uOpacity;

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
out vec4 fragColor;

const float PI = 3.141592653589793;
const float TWO_PI = 6.283185307179586;

#include <packing>

vec3 rotateY(vec3 direction, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(
    cosine * direction.x + sine * direction.z,
    direction.y,
    -sine * direction.x + cosine * direction.z
  );
}

vec4 samplePano(sampler2D panorama, vec3 center, float yaw) {
  vec3 direction = rotateY(normalize(vWorldPosition - center), yaw);
  float u = atan(direction.z, direction.x) / TWO_PI + 0.5;
  float v = asin(clamp(direction.y, -1.0, 1.0)) / PI + 0.5;
  vec2 uv = vec2(u, v);
  vec2 gradientX = dFdx(uv);
  vec2 gradientY = dFdy(uv);
  if (abs(gradientX.x) > 0.5) gradientX.x -= sign(gradientX.x);
  if (abs(gradientY.x) > 0.5) gradientY.x -= sign(gradientY.x);
  return textureGrad(panorama, uv, gradientX, gradientY);
}

float unpackDistance(vec4 packedDepth) {
  return mix(uDepthNear, uDepthFar, unpackRGBAToDepth(packedDepth));
}

float sourceWeight(samplerCube depthMap, vec3 center) {
  vec3 sourceRay = vWorldPosition - center;
  float fragmentDistance = length(sourceRay);
  vec3 direction = normalize(sourceRay);
  float storedDistance = unpackDistance(texture(depthMap, direction));
  float mapSize = float(textureSize(depthMap, 0).x);
  float tolerance = clamp(0.035 + fragmentDistance * 3.0 / max(1.0, mapSize), 0.04, 0.22);
  float visibility = 1.0 - smoothstep(
    storedDistance + tolerance * 0.25,
    storedDistance + tolerance,
    fragmentDistance
  );
  vec3 surfaceNormal = normalize(vWorldNormal);
  float sourceFacing = dot(surfaceNormal, -direction);
  float viewerFacing = dot(
    surfaceNormal,
    normalize(cameraPosition - vWorldPosition)
  );
  // A zero-thickness proxy wall is visible from both rooms. Only a panorama
  // captured on the camera-facing side may texture the rendered face; using
  // abs(sourceFacing) alone lets the opposite room ghost through the wall.
  float sameSide = smoothstep(0.0, 0.04, sourceFacing * viewerFacing);
  float facing = abs(sourceFacing);
  float distanceQuality = 1.0 / (1.0 + fragmentDistance * fragmentDistance * 0.035);
  float quality =
    visibility * sameSide * (0.2 + 0.8 * facing * facing) * distanceQuality;
  // Prefer a single strong source while retaining a narrow, soft seam where
  // two captures have near-identical coverage.
  return pow(max(quality, 0.0), 5.0);
}

void main() {
  vec3 colorSum = vec3(0.0);
  float weightSum = 0.0;
  vec3 preferredColorSum = vec3(0.0);
  float preferredWeightSum = 0.0;
${sourceContributions(count, hasLayers)}
${topViewContribution(hasTopView)}
  if (weightSum <= 0.000001) discard;
  vec3 compositeColor = colorSum / weightSum;
  vec3 preferredColor = preferredWeightSum > 0.000001
    ? preferredColorSum / preferredWeightSum
    : compositeColor;
  vec4 color = vec4(mix(compositeColor, preferredColor, uPanoramaMix), 1.0);
  fragColor = linearToOutputTexel(vec4(color.rgb, color.a * uOpacity));
}
`;
}

function createMaterial(
  name: string,
  uniforms: Record<string, IUniform>,
  sourceCount: number,
  hasTopView: boolean,
  hasLayers = false,
): ShaderMaterial {
  const material = new ShaderMaterial({
    name,
    uniforms,
    vertexShader,
    fragmentShader: createFragmentShader(sourceCount, hasTopView, hasLayers),
    side: DoubleSide,
    depthTest: true,
    depthWrite: true,
    glslVersion: GLSL3,
  });
  material.toneMapped = false;
  return material;
}

/** Build a stable multi-panorama material for the external dollhouse camera. */
export function createDollhouseMaterial(
  sources: readonly DollhouseSource[],
  background: string,
  topView?: DollhouseTopView,
): ShaderMaterial {
  if (sources.length === 0 || sources.length > MAX_DOLLHOUSE_SOURCES) {
    throw new Error(
      `Dollhouse projection needs 1-${MAX_DOLLHOUSE_SOURCES} panorama sources; received ${sources.length}`,
    );
  }

  const uniforms: Record<string, IUniform> = {
    uBackground: { value: new Color(background) },
    uDepthNear: { value: PANORAMA_DEPTH_NEAR },
    uDepthFar: { value: PANORAMA_DEPTH_FAR },
    uPanoramaMix: { value: 0 },
    uOpacity: { value: 1 },
  };
  sources.forEach((source, index) => {
    const correction = source.panorama.correction;
    uniforms[`uPano${index}`] = { value: source.texture };
    uniforms[`uDepth${index}`] = { value: source.depth };
    uniforms[`uCenter${index}`] = { value: source.center };
    uniforms[`uYaw${index}`] = { value: source.panorama.yaw };
    uniforms[`uExposure${index}`] = { value: correction?.exposure ?? 0 };
    uniforms[`uColor${index}`] = {
      value: new Vector3().fromArray(correction?.color ?? [1, 1, 1]),
    };
    uniforms[`uPreferred${index}`] = { value: 0 };
  });
  if (topView) {
    uniforms.uTopView = { value: topView.texture };
    uniforms.uTopBounds = {
      value: new Vector4(
        topView.bounds.min[0],
        topView.bounds.min[1],
        topView.bounds.max[0],
        topView.bounds.max[1],
      ),
    };
  }

  return createMaterial(
    `meshtour_dollhouse_projection_${sources.length}`,
    uniforms,
    sources.length,
    Boolean(topView),
  );
}

/**
 * Add private configurable-layer slots to a dollhouse material while sharing
 * all base projection uniforms. Camera-flight blending and preferred-source
 * changes therefore stay synchronized across the whole proxy.
 */
export function createDollhouseLayerMaterial(
  baseMaterial: ShaderMaterial,
  sources: readonly DollhouseSource[],
  layers: readonly DollhouseLayerSource[],
): ShaderMaterial {
  if (sources.length === 0 || sources.length > MAX_DOLLHOUSE_SOURCES) {
    throw new Error(
      `Dollhouse projection needs 1-${MAX_DOLLHOUSE_SOURCES} panorama sources; received ${sources.length}`,
    );
  }
  const layersByNode = new Map(layers.map((layer) => [layer.nodeId, layer.texture]));
  const uniforms: Record<string, IUniform> = { ...baseMaterial.uniforms };
  sources.forEach((source, index) => {
    const texture = layersByNode.get(source.nodeId) ?? null;
    uniforms[`uLayer${index}`] = { value: texture };
    uniforms[`uHasLayer${index}`] = { value: texture ? 1 : 0 };
  });
  return createMaterial(
    `${baseMaterial.name}_layer`,
    uniforms,
    sources.length,
    Boolean(baseMaterial.uniforms.uTopView),
    true,
  );
}
