import {
  Color,
  CubeCamera,
  DoubleSide,
  GLSL3,
  NearestFilter,
  NoBlending,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector3,
  WebGLCubeRenderTarget,
  type CubeTexture,
  type Object3D,
  type WebGLRenderer,
} from "three";

export const PANORAMA_DEPTH_NEAR = 0.025;
export const PANORAMA_DEPTH_FAR = 200;
export const PANORAMA_DEPTH_BIAS = 0.08;

const depthVertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const depthFragmentShader = /* glsl */ `
uniform vec3 uCenter;
uniform float uNear;
uniform float uFar;

varying vec3 vWorldPosition;
out vec4 fragColor;

#include <packing>

void main() {
  float distanceFromSource = length(vWorldPosition - uCenter);
  float normalizedDepth = clamp(
    (distanceFromSource - uNear) / (uFar - uNear),
    0.0,
    1.0
  );
  fragColor = packDepthToRGBA(normalizedDepth);
}
`;

/**
 * Renders and caches radial-distance cubemaps from panorama capture points.
 * They act like point-light shadow maps: the projective panorama shader can
 * reject proxy fragments that were hidden from the source camera, preventing
 * foreground objects from being reprojected as "phantoms" on rear surfaces.
 */
export class PanoramaVisibilityMap {
  private readonly renderer: WebGLRenderer;
  private readonly depthScene = new Scene();
  private readonly depthMaterial: ShaderMaterial;
  private readonly targets = new Map<string, WebGLCubeRenderTarget>();

  constructor(renderer: WebGLRenderer, proxyRoot: Object3D) {
    this.renderer = renderer;
    this.depthScene.background = new Color(0xffffff);
    this.depthScene.add(proxyRoot.clone(true));
    this.depthMaterial = new ShaderMaterial({
      vertexShader: depthVertexShader,
      fragmentShader: depthFragmentShader,
      uniforms: {
        uCenter: { value: new Vector3() },
        uNear: { value: PANORAMA_DEPTH_NEAR },
        uFar: { value: PANORAMA_DEPTH_FAR },
      },
      side: DoubleSide,
      blending: NoBlending,
      glslVersion: GLSL3,
    });
    this.depthScene.overrideMaterial = this.depthMaterial;
  }

  /** Render once per node, then reuse while that node remains nearby. */
  capture(nodeId: string, center: Vector3): CubeTexture {
    const cached = this.targets.get(nodeId);
    if (cached) return cached.texture;

    const target = new WebGLCubeRenderTarget(256, {
      format: RGBAFormat,
      type: UnsignedByteType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = `meshtour-visibility-${nodeId}`;

    this.depthMaterial.uniforms.uCenter!.value.copy(center);
    const camera = new CubeCamera(PANORAMA_DEPTH_NEAR, PANORAMA_DEPTH_FAR, target);
    camera.position.copy(center);

    const previousAutoClear = this.renderer.autoClear;
    this.renderer.autoClear = true;
    try {
      camera.update(this.renderer, this.depthScene);
    } catch (error) {
      target.dispose();
      throw error;
    } finally {
      this.renderer.autoClear = previousAutoClear;
    }

    this.targets.set(nodeId, target);
    return target.texture;
  }

  /** Keep the current node and its immediate navigation targets on the GPU. */
  releaseExcept(nodeIds: Set<string>): void {
    for (const [nodeId, target] of this.targets) {
      if (nodeIds.has(nodeId)) continue;
      target.dispose();
      this.targets.delete(nodeId);
    }
  }

  dispose(): void {
    for (const target of this.targets.values()) target.dispose();
    this.targets.clear();
    this.depthMaterial.dispose();
    this.depthScene.clear();
  }
}
