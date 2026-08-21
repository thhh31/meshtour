import { CatmullRomCurve3, Vector3 } from "three";
import type { NodeConfig, Vec3 } from "../config/schema";
import { clamp } from "../utils/math";

export interface TransitionPathSampler {
  readonly points: readonly Vector3[];
  readonly length: number;
  getPointAt(progress: number, target?: Vector3): Vector3;
}

/** Resolve a directed path, preferring an explicit path over reversible opposite-edge data. */
export function resolveTransitionWaypoints(from: NodeConfig, to: NodeConfig): readonly Vec3[] {
  const direct = from.links.find((link) => link.to === to.id);
  if (direct?.path) return direct.path.waypoints;
  const reverse = to.links.find((link) => link.to === from.id && link.path?.reversible !== false);
  return reverse?.path ? [...reverse.path.waypoints].reverse() : [];
}

/**
 * Build a path with exact capture-position endpoints. CatmullRomCurve3's
 * getPointAt maps normalized arc length rather than the raw spline parameter,
 * keeping camera speed stable through unevenly spaced authored waypoints.
 */
export function createTransitionPath(
  from: Vec3,
  to: Vec3,
  waypoints: readonly Vec3[] = [],
): TransitionPathSampler {
  const points = [from, ...waypoints, to].map((point) => new Vector3().fromArray(point));
  const curve = points.length > 2 ? new CatmullRomCurve3(points, false, "centripetal", 0.5) : null;
  const length = curve ? curve.getLength() : points[0]!.distanceTo(points[1]!);

  return {
    points,
    length,
    getPointAt(progress, target = new Vector3()) {
      const t = clamp(progress, 0, 1);
      if (t === 0) return target.copy(points[0]!);
      if (t === 1) return target.copy(points.at(-1)!);
      if (curve) return curve.getPointAt(t, target);
      return target.copy(points[0]!).lerp(points[1]!, t);
    },
  };
}
