import { AdditiveBlending, Color, DoubleSide, ShaderMaterial } from "three";

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;

varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float fresnel = pow(1.0 - facing, 2.0);
  float alpha = uOpacity * (0.55 + 1.4 * fresnel);
  gl_FragColor = vec4(uColor, alpha);
}
`;

/** Subtle additive fresnel overlay used for the interactable hover highlight. */
export function createHighlightMaterial(color: string, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}
