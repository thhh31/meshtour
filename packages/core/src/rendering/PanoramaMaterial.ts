import {
  Color,
  CubeTexture,
  DoubleSide,
  GLSL3,
  ShaderMaterial,
  Texture,
  Vector3,
  type IUniform,
  type Side,
} from "three";
import { PANORAMA_DEPTH_FAR, PANORAMA_DEPTH_NEAR } from "./PanoramaVisibilityMap";
import {
  DEPTH_GRAZING_SCALE,
  DEPTH_TEXEL_SCALE,
  DEPTH_TOLERANCE_CONSTANT,
  DEPTH_TOLERANCE_MAX,
  DEPTH_TOLERANCE_MIN,
} from "./visibilityMath";

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

const fragmentShader = /* glsl */ `
uniform sampler2D uPanoA;
uniform sampler2D uPanoB;
uniform samplerCube uDepthA;
uniform samplerCube uDepthB;
uniform vec3 uCenterA;
uniform vec3 uCenterB;
uniform float uYawA;
uniform float uYawB;
uniform float uBlend;
uniform vec3 uBackground;
uniform float uHasA;
uniform float uHasB;
uniform float uHasDepthA;
uniform float uHasDepthB;
uniform float uDepthNear;
uniform float uDepthFar;
uniform float uDepthBias;
uniform float uExposureA;
uniform float uExposureB;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uDepthFilter;
uniform float uDebugView;
uniform float uOpacity;

#ifdef USE_PANORAMA_LAYER

uniform sampler2D uLayerA;
uniform sampler2D uLayerB;
uniform float uHasLayerA;
uniform float uHasLayerB;

#endif

varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
out vec4 fragColor;

const float PI = 3.141592653589793;
const float TWO_PI = 6.283185307179586;

#include <packing>

vec3 rotateY(vec3 d, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z);
}

// Project the fragment's world position from the panorama capture position
// into equirectangular UVs and sample with explicit gradients: u jumps by 1
// at the atan seam, which would otherwise thrash mip selection (a blurry
// column at the seam and per-quad mip noise elsewhere). Unwrapping the
// gradient keeps trilinear/anisotropic filtering stable; wrapS = repeat
// covers the filter footprint that crosses the seam.
vec4 samplePano(sampler2D tex, vec3 center, float yaw) {
  vec3 dir = rotateY(normalize(vWorldPosition - center), yaw);
  float u = atan(dir.z, dir.x) / TWO_PI + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  vec2 uv = vec2(u, v);
  vec2 gx = dFdx(uv);
  vec2 gy = dFdy(uv);
  if (abs(gx.x) > 0.5) gx.x -= sign(gx.x);
  if (abs(gy.x) > 0.5) gy.x -= sign(gy.x);
  return textureGrad(tex, uv, gx, gy);
}

#ifdef USE_SOURCE_VISIBILITY

float unpackDistance(vec4 packedDepth) {
  return mix(uDepthNear, uDepthFar, unpackRGBAToDepth(packedDepth));
}

float visibilityForDepth(float fragmentDistance, float storedDistance, float tolerance) {
  return 1.0 - smoothstep(
    storedDistance + tolerance * 0.2,
    storedDistance + tolerance,
    fragmentDistance
  );
}

float sourceConfidence(
  samplerCube depthMap,
  float hasDepth,
  vec3 center
) {
  if (hasDepth < 0.5) return 1.0;
  vec3 sourceRay = vWorldPosition - center;
  float fragmentDistance = length(sourceRay);
  vec3 direction = normalize(sourceRay);
  float mapSize = float(textureSize(depthMap, 0).x);
  float texel = 2.0 / max(1.0, mapSize);
  float alignment = abs(dot(direction, normalize(vWorldNormal)));
  float tolerance = clamp(
    uDepthBias + (2.0 * fragmentDistance / max(1.0, mapSize)) * ${DEPTH_TEXEL_SCALE.toFixed(8)}
      + (1.0 - alignment) * ${DEPTH_GRAZING_SCALE.toFixed(8)},
    ${DEPTH_TOLERANCE_MIN.toFixed(8)},
    ${DEPTH_TOLERANCE_MAX.toFixed(8)}
  );

  float centerDepth = unpackDistance(texture(depthMap, direction));
  if (uDepthFilter < 0.5) {
    return visibilityForDepth(fragmentDistance, centerDepth, tolerance);
  }

  vec3 helper = abs(direction.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(helper, direction));
  vec3 bitangent = cross(direction, tangent);
  float depth1 = unpackDistance(texture(depthMap, normalize(direction + tangent * texel)));
  float depth2 = unpackDistance(texture(depthMap, normalize(direction - tangent * texel)));
  float depth3 = unpackDistance(texture(depthMap, normalize(direction + bitangent * texel)));
  float depth4 = unpackDistance(texture(depthMap, normalize(direction - bitangent * texel)));
  float nearestDepth = min(centerDepth, min(min(depth1, depth2), min(depth3, depth4)));
  float conservative = visibilityForDepth(fragmentDistance, nearestDepth, tolerance);
  if (uDepthFilter < 1.5) return conservative;

  float pcf = (
    visibilityForDepth(fragmentDistance, centerDepth, tolerance)
      + visibilityForDepth(fragmentDistance, depth1, tolerance)
      + visibilityForDepth(fragmentDistance, depth2, tolerance)
      + visibilityForDepth(fragmentDistance, depth3, tolerance)
      + visibilityForDepth(fragmentDistance, depth4, tolerance)
  ) / 5.0;
  float farthestDepth = max(centerDepth, max(max(depth1, depth2), max(depth3, depth4)));
  float edge = smoothstep(tolerance, tolerance * 3.0, farthestDepth - nearestDepth);
  return mix(pcf, min(pcf, conservative), edge);
}

#endif

void main() {
  vec4 background = vec4(uBackground, 1.0);
  vec4 colA = uHasA > 0.5 ? samplePano(uPanoA, uCenterA, uYawA) : background;
  vec4 colB = uHasB > 0.5 ? samplePano(uPanoB, uCenterB, uYawB) : colA;

#ifdef USE_PANORAMA_LAYER

  // Each transparent layer was rendered from the same panorama camera as its
  // source. Composite per source before visibility fallback and transition
  // blending so the configurable object moves exactly with the base image.
  if (uHasLayerA > 0.5) {
    vec4 layerA = samplePano(uLayerA, uCenterA, uYawA);
    // Layer textures are uploaded with premultiplied alpha so filtering and
    // generated mipmaps cannot pull transparent black into silhouette edges.
    colA = vec4(colA.rgb * (1.0 - layerA.a) + layerA.rgb, 1.0);
  }
  if (uHasLayerB > 0.5) {
    vec4 layerB = samplePano(uLayerB, uCenterB, uYawB);
    colB = vec4(colB.rgb * (1.0 - layerB.a) + layerB.rgb, 1.0);
  }

#endif

  colA.rgb *= exp2(uExposureA) * uColorA;
  colB.rgb *= exp2(uExposureB) * uColorB;

  float confidenceA = uHasA > 0.5 ? 1.0 : 0.0;
  float confidenceB = uHasB > 0.5 ? 1.0 : 0.0;

#ifdef USE_SOURCE_VISIBILITY

  // At a settled panorama node, ordinary raster depth already gives layer
  // materials the exact foreground silhouette. Applying the source-depth
  // neighborhood filter as well would erode the layer by one texel and expose
  // a halo of the original material. During a transition both projection
  // slots are populated, so retain source visibility to prevent reprojection
  // onto surfaces that were hidden from either capture point.
  bool needsSourceVisibility = true;
#ifdef USE_PANORAMA_LAYER
  needsSourceVisibility = uHasB > 0.5;
#endif
  if (needsSourceVisibility) {
    confidenceA = uHasA > 0.5
      ? sourceConfidence(uDepthA, uHasDepthA, uCenterA)
      : 0.0;
    confidenceB = uHasB > 0.5
      ? sourceConfidence(uDepthB, uHasDepthB, uCenterB)
      : 0.0;
  }

#endif

  if (uDebugView > 0.5 && uDebugView < 1.5) {
    fragColor = linearToOutputTexel(colA);
    return;
  }
  if (uDebugView > 1.5 && uDebugView < 2.5) {
    fragColor = linearToOutputTexel(colB);
    return;
  }
  if (uDebugView > 3.5 && uDebugView < 4.5) {
    fragColor = vec4(vec3(confidenceA), 1.0);
    return;
  }
  if (uDebugView > 4.5 && uDebugView < 5.5) {
    fragColor = vec4(vec3(confidenceB), 1.0);
    return;
  }
  if (uDebugView > 5.5 && uDebugView < 6.5) {
    bool rejected = confidenceA <= 0.001 && confidenceB <= 0.001;
    fragColor = rejected ? vec4(1.0, 0.0, 0.7, 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  float weightA = (1.0 - uBlend) * confidenceA;
  float weightB = uBlend * confidenceB;
  // A valid sole source is evidence even outside the global handoff window.
  if (confidenceA <= 0.001 && confidenceB > 0.001) weightB = confidenceB;
  if (confidenceB <= 0.001 && confidenceA > 0.001) weightA = confidenceA;
  float totalWeight = weightA + weightB;
  // Leave this proxy fragment uncovered so the baked bridge (or a deeper
  // proxy/skysphere fallback) can provide true-disocclusion coverage.
  if (totalWeight <= 0.001) discard;
  vec4 color = (weightA * colA + weightB * colB) / totalWeight;

  // linearToOutputTexel is injected by the renderer for the active output
  // color space (same conversion <colorspace_fragment> performs).
  fragColor = linearToOutputTexel(vec4(color.rgb, color.a * uOpacity));
}
`;

export type PanoramaDebugView =
  | "normal"
  | "source-a"
  | "source-b"
  | "blend"
  | "visibility-a"
  | "visibility-b"
  | "rejected-both";

const DEBUG_VIEW_VALUE: Record<PanoramaDebugView, number> = {
  normal: 0,
  "source-a": 1,
  "source-b": 2,
  blend: 3,
  "visibility-a": 4,
  "visibility-b": 5,
  "rejected-both": 6,
};

export interface PanoramaUniforms {
  uPanoA: { value: Texture | null };
  uPanoB: { value: Texture | null };
  uDepthA: { value: CubeTexture | null };
  uDepthB: { value: CubeTexture | null };
  uCenterA: { value: Vector3 };
  uCenterB: { value: Vector3 };
  uYawA: { value: number };
  uYawB: { value: number };
  uBlend: { value: number };
  uBackground: { value: Color };
  uHasA: { value: number };
  uHasB: { value: number };
  uHasDepthA: { value: number };
  uHasDepthB: { value: number };
  uDepthNear: { value: number };
  uDepthFar: { value: number };
  uDepthBias: { value: number };
  uExposureA: { value: number };
  uExposureB: { value: number };
  uColorA: { value: Vector3 };
  uColorB: { value: Vector3 };
  uDepthFilter: { value: number };
  uDebugView: { value: number };
  uOpacity: { value: number };
}

export interface PanoramaLayerUniforms {
  uLayerA: { value: Texture | null };
  uLayerB: { value: Texture | null };
  uHasLayerA: { value: number };
  uHasLayerB: { value: number };
}

export interface PanoramaLayerMaterial {
  material: ShaderMaterial;
  uniforms: PanoramaLayerUniforms;
}

/**
 * Owns the shared uniform state for the dual projective panorama shader and
 * hands out materials bound to it (one for the proxy mesh, one for the
 * fallback skysphere). Slot A is the departing/current node, slot B the
 * arriving node; static viewing is simply uBlend = 0.
 */
export class PanoramaProjection {
  readonly uniforms: PanoramaUniforms = {
    uPanoA: { value: null },
    uPanoB: { value: null },
    uDepthA: { value: null },
    uDepthB: { value: null },
    uCenterA: { value: new Vector3() },
    uCenterB: { value: new Vector3() },
    uYawA: { value: 0 },
    uYawB: { value: 0 },
    uBlend: { value: 0 },
    uBackground: { value: new Color("#0b0b0e") },
    uHasA: { value: 0 },
    uHasB: { value: 0 },
    uHasDepthA: { value: 0 },
    uHasDepthB: { value: 0 },
    uDepthNear: { value: PANORAMA_DEPTH_NEAR },
    uDepthFar: { value: PANORAMA_DEPTH_FAR },
    uDepthBias: { value: DEPTH_TOLERANCE_CONSTANT },
    uExposureA: { value: 0 },
    uExposureB: { value: 0 },
    uColorA: { value: new Vector3(1, 1, 1) },
    uColorB: { value: new Vector3(1, 1, 1) },
    uDepthFilter: { value: 2 },
    uDebugView: { value: 0 },
    uOpacity: { value: 1 },
  };

  private materials: ShaderMaterial[] = [];

  createMaterial(
    options: { side?: Side; depthWrite?: boolean; sourceVisibility?: boolean } = {},
  ): ShaderMaterial {
    return this.createShaderMaterial(options, this.uniforms as unknown as Record<string, IUniform>);
  }

  /**
   * A panorama material with private A/B transparent-layer slots. The base
   * panorama uniforms remain shared with every other projection material.
   */
  createLayerMaterial(
    options: { side?: Side; depthWrite?: boolean; sourceVisibility?: boolean } = {},
  ): PanoramaLayerMaterial {
    const layerUniforms: PanoramaLayerUniforms = {
      uLayerA: { value: null },
      uLayerB: { value: null },
      uHasLayerA: { value: 0 },
      uHasLayerB: { value: 0 },
    };
    const material = this.createShaderMaterial(
      options,
      {
        ...(this.uniforms as unknown as Record<string, IUniform>),
        ...(layerUniforms as unknown as Record<string, IUniform>),
      },
      { USE_PANORAMA_LAYER: 1 },
    );
    return { material, uniforms: layerUniforms };
  }

  private createShaderMaterial(
    options: { side?: Side; depthWrite?: boolean; sourceVisibility?: boolean },
    uniforms: Record<string, IUniform>,
    extraDefines: Record<string, number> = {},
  ): ShaderMaterial {
    const material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      defines: {
        ...(options.sourceVisibility === false ? {} : { USE_SOURCE_VISIBILITY: 1 }),
        ...extraDefines,
      },
      side: options.side ?? DoubleSide,
      depthWrite: options.depthWrite ?? true,
      glslVersion: GLSL3, // textureGrad needs GLSL ES 3.0 (WebGL2-only, like three itself)
    });
    this.materials.push(material);
    return material;
  }

  setBackground(color: string): void {
    this.uniforms.uBackground.value.set(color);
  }

  setSlotA(
    texture: Texture,
    center: Vector3,
    yaw: number,
    depth?: CubeTexture,
    correction?: { exposure?: number; color?: [number, number, number] },
  ): void {
    this.uniforms.uPanoA.value = texture;
    this.uniforms.uCenterA.value.copy(center);
    this.uniforms.uYawA.value = yaw;
    this.uniforms.uHasA.value = 1;
    this.uniforms.uDepthA.value = depth ?? null;
    this.uniforms.uHasDepthA.value = depth ? 1 : 0;
    this.uniforms.uExposureA.value = correction?.exposure ?? 0;
    this.uniforms.uColorA.value.fromArray(correction?.color ?? [1, 1, 1]);
  }

  setSlotB(
    texture: Texture,
    center: Vector3,
    yaw: number,
    depth?: CubeTexture,
    correction?: { exposure?: number; color?: [number, number, number] },
  ): void {
    this.uniforms.uPanoB.value = texture;
    this.uniforms.uCenterB.value.copy(center);
    this.uniforms.uYawB.value = yaw;
    this.uniforms.uHasB.value = 1;
    this.uniforms.uDepthB.value = depth ?? null;
    this.uniforms.uHasDepthB.value = depth ? 1 : 0;
    this.uniforms.uExposureB.value = correction?.exposure ?? 0;
    this.uniforms.uColorB.value.fromArray(correction?.color ?? [1, 1, 1]);
  }

  /** Swap an upgraded texture (preview -> full res) into whichever slot holds the node. */
  replaceTexture(previous: Texture, next: Texture): boolean {
    let replaced = false;
    if (this.uniforms.uPanoA.value === previous) {
      this.uniforms.uPanoA.value = next;
      replaced = true;
    }
    if (this.uniforms.uPanoB.value === previous) {
      this.uniforms.uPanoB.value = next;
      replaced = true;
    }
    return replaced;
  }

  setBlend(blend: number): void {
    this.uniforms.uBlend.value = blend;
  }

  /** After a transition completes, B becomes the new static panorama. */
  promoteBToA(): void {
    const u = this.uniforms;
    if (u.uHasB.value < 0.5) return;
    u.uPanoA.value = u.uPanoB.value;
    u.uCenterA.value.copy(u.uCenterB.value);
    u.uYawA.value = u.uYawB.value;
    u.uHasA.value = 1;
    u.uDepthA.value = u.uDepthB.value;
    u.uHasDepthA.value = u.uHasDepthB.value;
    u.uExposureA.value = u.uExposureB.value;
    u.uColorA.value.copy(u.uColorB.value);
    u.uPanoB.value = null;
    u.uDepthB.value = null;
    u.uHasB.value = 0;
    u.uHasDepthB.value = 0;
    u.uBlend.value = 0;
  }

  /** Live-update the yaw of slot A (used by author mode's yaw nudge). */
  setYawA(yaw: number): void {
    this.uniforms.uYawA.value = yaw;
  }

  setDebugView(view: PanoramaDebugView): void {
    this.uniforms.uDebugView.value = DEBUG_VIEW_VALUE[view];
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.materials = [];
  }
}
