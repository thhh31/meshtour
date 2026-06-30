import { Box3, Mesh, Vector3, type Object3D } from "three";
import type { PlanBoundsConfig } from "../config/schema";

export interface PlanRenderOptions {
  background?: string;
  floor?: string;
  structure?: string;
  furniture?: string;
  detail?: string;
  padding?: number;
  hiddenMeshes?: readonly string[];
}

const scratchA = new Vector3();
const scratchB = new Vector3();
const scratchC = new Vector3();

function isCeilingName(name: string): boolean {
  return /ceiling|roof/i.test(name);
}

function planRole(name: string): "floor" | "structure" | "furniture" | "detail" {
  if (/floor/i.test(name)) return "floor";
  if (/wall|skirting|door|stair/i.test(name)) return "structure";
  if (/^int_/i.test(name)) return "furniture";
  return "detail";
}

/** Resolve a stable X/Z crop from config, falling back to the proxy's world bounds. */
export function resolvePlanBounds(root: Object3D, configured?: PlanBoundsConfig): PlanBoundsConfig {
  if (configured) return configured;
  const bounds = new Box3().setFromObject(root);
  if (bounds.isEmpty()) return { min: [-1, -1], max: [1, 1] };
  return { min: [bounds.min.x, bounds.min.z], max: [bounds.max.x, bounds.max.z] };
}

/**
 * Draw a lightweight automatic plan from proxy triangles. It uses the same
 * world coordinates as navigation nodes, so hosts can layer live markers and
 * heading cones without maintaining a second authored floor-plan image.
 */
export function renderProxyPlan(
  root: Object3D,
  canvas: HTMLCanvasElement,
  bounds: PlanBoundsConfig,
  options: PlanRenderOptions = {},
): void {
  const context = canvas.getContext("2d");
  if (!context) return;

  const width = canvas.width;
  const height = canvas.height;
  const padding = options.padding ?? Math.max(12, Math.min(width, height) * 0.07);
  const extentX = bounds.max[0] - bounds.min[0];
  const extentZ = bounds.max[1] - bounds.min[1];
  const scale = Math.max(
    0.0001,
    Math.min((width - padding * 2) / extentX, (height - padding * 2) / extentZ),
  );
  const drawWidth = extentX * scale;
  const drawHeight = extentZ * scale;
  const originX = (width - drawWidth) / 2;
  const originY = (height - drawHeight) / 2;
  const hidden = new Set(options.hiddenMeshes ?? []);

  const project = (point: Vector3): [number, number] => [
    originX + (point.x - bounds.min[0]) * scale,
    originY + (point.z - bounds.min[1]) * scale,
  ];

  context.clearRect(0, 0, width, height);
  context.fillStyle = options.background ?? "rgba(15, 16, 19, 0.92)";
  context.fillRect(0, 0, width, height);
  root.updateWorldMatrix(true, true);

  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (!(object as Mesh).isMesh) return;
    if (hidden.has(object.name) || isCeilingName(object.name)) return;
    meshes.push(object as Mesh);
  });
  const roleOrder = { floor: 0, detail: 1, furniture: 2, structure: 3 } as const;
  meshes.sort((a, b) => roleOrder[planRole(a.name)] - roleOrder[planRole(b.name)]);

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) continue;
    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : positions.count / 3;
    const role = planRole(mesh.name);
    context.fillStyle =
      role === "floor"
        ? (options.floor ?? "rgba(237, 233, 224, 0.34)")
        : role === "structure"
          ? (options.structure ?? "rgba(250, 250, 248, 0.94)")
          : role === "furniture"
            ? (options.furniture ?? "rgba(119, 128, 139, 0.74)")
            : (options.detail ?? "rgba(91, 99, 110, 0.48)");
    context.strokeStyle = context.fillStyle;
    context.lineWidth = role === "structure" ? Math.max(1.5, scale * 0.035) : 0.65;

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ai = index ? index.getX(triangle * 3) : triangle * 3;
      const bi = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const ci = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      scratchA.fromBufferAttribute(positions, ai).applyMatrix4(mesh.matrixWorld);
      scratchB.fromBufferAttribute(positions, bi).applyMatrix4(mesh.matrixWorld);
      scratchC.fromBufferAttribute(positions, ci).applyMatrix4(mesh.matrixWorld);
      const a = project(scratchA);
      const b = project(scratchB);
      const c = project(scratchC);
      const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      context.beginPath();
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.lineTo(c[0], c[1]);
      context.closePath();
      if (area > 0.2) context.fill();
      if (role === "structure" || area <= 0.2) context.stroke();
    }
  }
}
