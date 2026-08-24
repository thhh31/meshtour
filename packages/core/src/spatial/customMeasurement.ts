import { Vector3 } from "three";
import type { Vec3 } from "../config/schema";

export interface CustomMeasurementState {
  active: boolean;
  points: Vec3[];
  /** Sum of the open path's consecutive segments, in meters. */
  length: number;
  /** Closed polygon perimeter when a valid area is available. */
  perimeter: number | null;
  /** Enclosed area in square meters when three or more points are coplanar. */
  area: number | null;
}

const MIN_AREA = 1e-5;

/** Calculate an open-path length and, when valid, the polygon area. */
export function calculateCustomMeasurement(
  points: readonly (Vec3 | Vector3)[],
): Pick<CustomMeasurementState, "length" | "perimeter" | "area"> {
  const vectors = points.map((point) =>
    point instanceof Vector3 ? point : new Vector3(point[0], point[1], point[2]),
  );

  let length = 0;
  for (let index = 1; index < vectors.length; index += 1) {
    length += vectors[index - 1]!.distanceTo(vectors[index]!);
  }

  if (vectors.length < 3) return { length, perimeter: null, area: null };

  // Newell's vector area works in any orientation. Its direction is the
  // polygon normal and half its magnitude is the enclosed planar area.
  const vectorArea = new Vector3();
  for (let index = 0; index < vectors.length; index += 1) {
    const current = vectors[index]!;
    const next = vectors[(index + 1) % vectors.length]!;
    vectorArea.x += (current.y - next.y) * (current.z + next.z);
    vectorArea.y += (current.z - next.z) * (current.x + next.x);
    vectorArea.z += (current.x - next.x) * (current.y + next.y);
  }

  const area = vectorArea.length() * 0.5;
  if (area < MIN_AREA) return { length, perimeter: null, area: null };

  const normal = vectorArea.normalize();
  const origin = vectors[0]!;
  const extent = Math.max(1, ...vectors.map((point) => point.distanceTo(origin)));
  const coplanarTolerance = Math.max(0.03, extent * 0.015);
  const coplanar = vectors.every(
    (point) => Math.abs(normal.dot(point.clone().sub(origin))) <= coplanarTolerance,
  );

  return {
    length,
    perimeter: coplanar ? length + vectors.at(-1)!.distanceTo(vectors[0]!) : null,
    area: coplanar ? area : null,
  };
}
