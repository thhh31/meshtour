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
import {
  PANORAMA_DEPTH_BIAS,
  PANORAMA_DEPTH_FAR,
  PANORAMA_DEPTH_NEAR,
} from "./PanoramaVisibilityMap";

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
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

#ifdef USE_PANORAMA_LAYER

uniform sampler2D uLayerA;
uniform sampler2D uLayerB;
uniform float uHasLayerA;
uniform float uHasLayerB;

#endif

varying vec3 vWorldPosition;
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

float sourceVisibility(
  samplerCube depthMap,
  float hasDepth,
  vec3 center
) {
  if (hasDepth < 0.5) return 1.0;
  vec3 sourceRay = vWorldPosition - center;
  float fragmentDistance = length(sourceRay);
  float normalizedDepth = unpackRGBAToDepth(texture(depthMap, normalize(sourceRay)));
  float nearestDistance = mix(uDepthNear, uDepthFar, normalizedDepth);
  return fragmentDistance <= nearestDistance + uDepthBias ? 1.0 : 0.0;
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
    colA = vec4(mix(colA.rgb, layerA.rgb, layerA.a), 1.0);
  }
  if (uHasLayerB > 0.5) {
    vec4 layerB = samplePano(uLayerB, uCenterB, uYawB);
    colB = vec4(mix(colB.rgb, layerB.rgb, layerB.a), 1.0);
  }

#endif

#ifdef USE_SOURCE_VISIBILITY

  float visibleA = uHasA > 0.5
    ? sourceVisibility(uDepthA, uHasDepthA, uCenterA)
    : 0.0;
  float visibleB = uHasB > 0.5
    ? sourceVisibility(uDepthB, uHasDepthB, uCenterB)
    : visibleA;

  // If one source did not see this surface, use the other source instead of
  // stretching an occluding foreground object over it. Only reject fragments
  // hidden from both capture points; discarding then lets a deeper visible
  // proxy surface (or the skysphere) render.
  if (visibleA < 0.5 && visibleB < 0.5) discard;
  if (visibleA < 0.5) colA = colB;
  if (visibleB < 0.5) colB = colA;

#endif

  // linearToOutputTexel is injected by the renderer for the active output
  // color space (same conversion <colorspace_fragment> performs).
  fragColor = linearToOutputTexel(mix(colA, colB, uBlend));
}
`;

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
    uDepthBias: { value: PANORAMA_DEPTH_BIAS },
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

  setSlotA(texture: Texture, center: Vector3, yaw: number, depth?: CubeTexture): void {
    this.uniforms.uPanoA.value = texture;
    this.uniforms.uCenterA.value.copy(center);
    this.uniforms.uYawA.value = yaw;
    this.uniforms.uHasA.value = 1;
    this.uniforms.uDepthA.value = depth ?? null;
    this.uniforms.uHasDepthA.value = depth ? 1 : 0;
  }

  setSlotB(texture: Texture, center: Vector3, yaw: number, depth?: CubeTexture): void {
    this.uniforms.uPanoB.value = texture;
    this.uniforms.uCenterB.value.copy(center);
    this.uniforms.uYawB.value = yaw;
    this.uniforms.uHasB.value = 1;
    this.uniforms.uDepthB.value = depth ?? null;
    this.uniforms.uHasDepthB.value = depth ? 1 : 0;
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
    u.uBlend.value = 0;
  }

  /** Live-update the yaw of slot A (used by author mode's yaw nudge). */
  setYawA(yaw: number): void {
    this.uniforms.uYawA.value = yaw;
  }

  dispose(): void {
    for (const material of this.materials) material.dispose();
    this.materials = [];
  }
}
