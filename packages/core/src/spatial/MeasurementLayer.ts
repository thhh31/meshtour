import {
  Box3,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Object3D,
  type Scene,
} from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { MeasurementAxis, MeasurementConfig, TourConfig } from "../config/schema";
import { calculateCustomMeasurement, type CustomMeasurementState } from "./customMeasurement";

interface LabelEntry {
  element: HTMLDivElement;
  positions: Vector3[];
}

function formatMeters(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} m`;
}

function formatSquareMeters(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} m²`;
}

function objectByName(root: Object3D, name: string): Object3D | null {
  let match: Object3D | null = null;
  root.traverse((object) => {
    if (!match && object.name === name) match = object;
  });
  return match;
}

/** Three.js dimension lines plus camera-facing HTML labels. */
export class MeasurementLayer {
  private config: TourConfig;
  private root: Object3D;
  private camera: () => Camera;
  private container: HTMLElement;
  private overlay: HTMLDivElement;
  private group = new Group();
  private labels: LabelEntry[] = [];
  private lineMaterials: LineMaterial[] = [];
  private markerMaterials: MeshBasicMaterial[] = [];
  private measurementConfigs: MeasurementConfig[];
  private selectedId: string | null = null;
  private customActive = false;
  private customPoints: Vector3[] = [];
  private visible = false;
  private opacity = 0;
  private targetOpacity = 0;

  constructor(
    scene: Scene,
    root: Object3D,
    overlayRoot: HTMLElement,
    container: HTMLElement,
    camera: () => Camera,
    config: TourConfig,
  ) {
    this.config = config;
    this.root = root;
    this.camera = camera;
    this.container = container;
    this.group.name = "meshtour_measurements";
    this.group.visible = false;
    scene.add(this.group);
    this.overlay = document.createElement("div");
    this.overlay.className = "meshtour-measurements";
    this.overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;display:none";
    overlayRoot.appendChild(this.overlay);
    this.measurementConfigs =
      config.spatial.measurements.length > 0
        ? config.spatial.measurements
        : this.createAutomaticMeasurements();
  }

  hasTargets(): boolean {
    return this.measurementConfigs.length > 0;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (visible && !this.selectedId) {
      this.selectedId =
        this.measurementConfigs.find((measurement) => !measurement.defaultVisible)?.id ?? null;
    }
    this.refreshVisibility();
  }

  isVisible(): boolean {
    return this.visible;
  }

  setCustomActive(active: boolean): boolean {
    if (this.customActive === active) return false;
    this.customActive = active;
    this.refreshVisibility();
    return true;
  }

  isCustomActive(): boolean {
    return this.customActive;
  }

  addCustomPoint(point: Vector3, normal: Vector3 | null): void {
    const placed = point.clone();
    if (normal) placed.addScaledVector(normal, 0.012);
    this.customPoints.push(placed);
    this.refreshVisibility();
  }

  undoCustomPoint(): boolean {
    if (this.customPoints.length === 0) return false;
    this.customPoints.pop();
    this.refreshVisibility();
    return true;
  }

  clearCustomMeasurement(): boolean {
    if (this.customPoints.length === 0) return false;
    this.customPoints = [];
    this.refreshVisibility();
    return true;
  }

  getCustomState(): CustomMeasurementState {
    const points = this.customPoints.map((point) => point.toArray() as [number, number, number]);
    return {
      active: this.customActive,
      points,
      ...calculateCustomMeasurement(points),
    };
  }

  selectInteractable(interactableId: string): void {
    const prefix = this.config.interactables.namePrefix;
    const match = this.measurementConfigs.find(
      (measurement) =>
        measurement.id === interactableId ||
        measurement.target === interactableId ||
        measurement.target === `${prefix}${interactableId}`,
    );
    if (!match || this.selectedId === match.id) return;
    this.selectedId = match.id;
    if (this.visible) this.rebuild();
  }

  update(dt: number): void {
    if (Math.abs(this.targetOpacity - this.opacity) > 0.001) {
      // Frame-rate-independent easing gives the labels and WebGL lines the
      // same soft response on both high-refresh and throttled displays.
      const blend = 1 - Math.exp(-dt * 10);
      this.opacity += (this.targetOpacity - this.opacity) * blend;
      if (Math.abs(this.targetOpacity - this.opacity) <= 0.01) {
        this.opacity = this.targetOpacity;
      }
      this.applyOpacity();
      if (!this.visible && this.opacity === 0) this.finishFadeOut();
    }
    if (this.targetOpacity === 0 && this.opacity === 0) return;
    const camera = this.camera();
    camera.updateMatrixWorld();
    for (const material of this.lineMaterials) {
      material.resolution.set(this.container.clientWidth, this.container.clientHeight);
    }
    for (const label of this.labels) {
      const projected = label.positions
        .map((position) => position.clone().project(camera))
        .filter(
          (position) =>
            position.z >= -1 &&
            position.z <= 1 &&
            Math.abs(position.x) <= 1.05 &&
            Math.abs(position.y) <= 1.05,
        )
        .sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))[0];
      label.element.style.display = projected ? "block" : "none";
      if (!projected) continue;
      label.element.style.left = `${((projected.x + 1) / 2) * this.container.clientWidth}px`;
      label.element.style.top = `${((1 - projected.y) / 2) * this.container.clientHeight}px`;
    }
  }

  private createAutomaticMeasurements(): MeasurementConfig[] {
    const prefix = this.config.interactables.namePrefix;
    const measurements: MeasurementConfig[] = [];
    const seen = new Set<string>();
    this.root.traverse((object) => {
      if (!object.name.startsWith(prefix) || seen.has(object.name)) return;
      seen.add(object.name);
      const id = object.name.slice(prefix.length);
      measurements.push({
        id,
        label: id.replaceAll("_", " "),
        target: object.name,
        axes: ["width", "depth", "height"],
        defaultVisible: measurements.length === 0,
        alwaysOnTop: false,
        offset: 0.18,
      });
    });
    return measurements;
  }

  private resolveBounds(measurement: MeasurementConfig): Box3 | null {
    if (measurement.bounds) {
      return new Box3(
        new Vector3().fromArray(measurement.bounds.min),
        new Vector3().fromArray(measurement.bounds.max),
      );
    }
    const target = measurement.target ? objectByName(this.root, measurement.target) : null;
    if (!target) return null;
    const bounds = new Box3().setFromObject(target);
    return bounds.isEmpty() ? null : bounds;
  }

  private rebuild(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      (child as LineSegments2).geometry?.dispose();
      const material = (child as LineSegments2).material;
      if (material && !Array.isArray(material)) material.dispose();
    }
    this.lineMaterials = [];
    this.markerMaterials = [];
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    if (!this.shouldRender()) return;

    if (this.visible && !this.customActive) {
      for (const measurement of this.measurementConfigs) {
        if (!measurement.defaultVisible && measurement.id !== this.selectedId) continue;
        const bounds = this.resolveBounds(measurement);
        if (!bounds) continue;
        this.addMeasurement(measurement, bounds);
      }
    }
    this.addCustomMeasurement();
    this.applyOpacity();
  }

  private shouldRender(): boolean {
    return this.visible || this.customActive || this.customPoints.length > 0;
  }

  private refreshVisibility(): void {
    const shouldRender = this.shouldRender();
    this.targetOpacity = shouldRender ? 1 : 0;
    if (shouldRender) {
      this.rebuild();
      this.group.visible = true;
      this.overlay.style.display = "block";
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.opacity = this.targetOpacity;
      this.applyOpacity();
      if (!shouldRender) this.finishFadeOut();
    }
  }

  private applyOpacity(): void {
    for (const material of this.lineMaterials) material.opacity = 0.98 * this.opacity;
    for (const material of this.markerMaterials) material.opacity = this.opacity;
    this.overlay.style.opacity = String(this.opacity);
  }

  private finishFadeOut(): void {
    this.group.visible = false;
    this.overlay.style.display = "none";
    this.rebuild();
  }

  private addMeasurement(measurement: MeasurementConfig, bounds: Box3): void {
    this.addOutline(measurement, bounds);
    for (const axis of measurement.axes) {
      const { positions, value } = this.dimension(axis, bounds, measurement.offset);
      const axisLabel = axis[0]!.toUpperCase() + axis.slice(1);
      const element = document.createElement("div");
      element.className = "meshtour-measurement-label";
      element.textContent = `${axisLabel} ${formatMeters(value)}`;
      element.setAttribute(
        "aria-label",
        `${measurement.label}: ${axisLabel} ${formatMeters(value)}`,
      );
      element.style.cssText =
        "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:7px 10px;border-radius:9px;background:rgba(24,24,24,.82);color:#fff;font:750 13px/1.1 system-ui,sans-serif;letter-spacing:-.01em;box-shadow:0 4px 18px rgba(0,0,0,.34);text-shadow:0 1px 1px rgba(0,0,0,.35)";
      this.overlay.appendChild(element);
      this.labels.push({ element, positions });
    }
  }

  private addOutline(measurement: MeasurementConfig, bounds: Box3): void {
    const { min, max } = bounds;
    const corners = [
      new Vector3(min.x, min.y, min.z),
      new Vector3(max.x, min.y, min.z),
      new Vector3(max.x, max.y, min.z),
      new Vector3(min.x, max.y, min.z),
      new Vector3(min.x, min.y, max.z),
      new Vector3(max.x, min.y, max.z),
      new Vector3(max.x, max.y, max.z),
      new Vector3(min.x, max.y, max.z),
    ];
    const edges: Array<readonly [number, number]> = [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 4],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    const positions = edges.flatMap(([a, b]) => [
      ...corners[a]!.toArray(),
      ...corners[b]!.toArray(),
    ]);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions);
    const material = new LineMaterial({
      color: measurement.color ?? this.config.spatial.measurementColor,
      linewidth: 3,
      worldUnits: false,
      depthTest: !measurement.alwaysOnTop,
      depthWrite: false,
      transparent: true,
      opacity: 0.98,
    });
    material.resolution.set(this.container.clientWidth, this.container.clientHeight);
    this.lineMaterials.push(material);
    const outline = new LineSegments2(geometry, material);
    outline.computeLineDistances();
    outline.renderOrder = measurement.alwaysOnTop ? 100 : 30;
    outline.frustumCulled = false;
    this.group.add(outline);
  }

  private addCustomMeasurement(): void {
    if (this.customPoints.length === 0) return;

    const color = this.config.spatial.measurementColor;
    for (const point of this.customPoints) {
      const material = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: this.opacity,
        depthTest: false,
        depthWrite: false,
      });
      this.markerMaterials.push(material);
      const marker = new Mesh(new SphereGeometry(0.035, 16, 12), material);
      marker.position.copy(point);
      marker.renderOrder = 102;
      marker.frustumCulled = false;
      this.group.add(marker);
    }

    const linePositions: number[] = [];
    for (let index = 1; index < this.customPoints.length; index += 1) {
      const previous = this.customPoints[index - 1]!;
      const current = this.customPoints[index]!;
      linePositions.push(...previous.toArray(), ...current.toArray());
      this.addCustomLabel(
        formatMeters(previous.distanceTo(current)),
        [previous.clone().lerp(current, 0.5)],
        `Measurement segment ${index}: ${formatMeters(previous.distanceTo(current))}`,
      );
    }

    const result = calculateCustomMeasurement(this.customPoints);
    if (result.area !== null) {
      const first = this.customPoints[0]!;
      const last = this.customPoints.at(-1)!;
      linePositions.push(...last.toArray(), ...first.toArray());
    }

    if (linePositions.length > 0) {
      const geometry = new LineSegmentsGeometry();
      geometry.setPositions(linePositions);
      const material = new LineMaterial({
        color,
        linewidth: 4,
        worldUnits: false,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.98 * this.opacity,
      });
      material.resolution.set(this.container.clientWidth, this.container.clientHeight);
      this.lineMaterials.push(material);
      const line = new LineSegments2(geometry, material);
      line.computeLineDistances();
      line.renderOrder = 101;
      line.frustumCulled = false;
      this.group.add(line);
    }

    if (this.customPoints.length >= 2) {
      const summary =
        result.area === null
          ? `Total ${formatMeters(result.length)}`
          : `Perimeter ${formatMeters(result.perimeter!)} · Area ${formatSquareMeters(result.area)}`;
      const centroid = this.customPoints
        .reduce((sum, point) => sum.add(point), new Vector3())
        .multiplyScalar(1 / this.customPoints.length);
      this.addCustomLabel(summary, [centroid], summary);
    }
  }

  private addCustomLabel(text: string, positions: Vector3[], ariaLabel: string): void {
    const element = document.createElement("div");
    element.className = "meshtour-measurement-label meshtour-custom-measurement-label";
    element.textContent = text;
    element.setAttribute("aria-label", ariaLabel);
    element.style.cssText =
      "position:absolute;transform:translate(-50%,-50%);white-space:nowrap;padding:7px 10px;border:1px solid rgba(255,255,255,.16);border-radius:999px;background:rgba(12,13,16,.88);color:#fff;font:700 12px/1.1 system-ui,sans-serif;letter-spacing:-.01em;box-shadow:0 5px 20px rgba(0,0,0,.38);text-shadow:0 1px 1px rgba(0,0,0,.35);backdrop-filter:blur(12px)";
    this.overlay.appendChild(element);
    this.labels.push({ element, positions });
  }

  private dimension(
    axis: MeasurementAxis,
    bounds: Box3,
    offset: number,
  ): { positions: Vector3[]; value: number } {
    const min = bounds.min;
    const max = bounds.max;
    let positions: Vector3[];
    if (axis === "width") {
      positions = [
        new Vector3((min.x + max.x) / 2, max.y + offset * 0.45, max.z + offset * 0.08),
        new Vector3((min.x + max.x) / 2, min.y + offset * 0.45, max.z + offset * 0.08),
        new Vector3((min.x + max.x) / 2, max.y + offset * 0.45, min.z - offset * 0.08),
        new Vector3((min.x + max.x) / 2, min.y + offset * 0.45, min.z - offset * 0.08),
      ];
    } else if (axis === "depth") {
      positions = [
        new Vector3(max.x + offset * 0.6, min.y + offset * 0.35, (min.z + max.z) / 2),
        new Vector3(min.x - offset * 0.6, min.y + offset * 0.35, (min.z + max.z) / 2),
        new Vector3(max.x + offset * 0.6, max.y - offset * 0.35, (min.z + max.z) / 2),
        new Vector3(min.x - offset * 0.6, max.y - offset * 0.35, (min.z + max.z) / 2),
      ];
    } else {
      positions = [
        new Vector3(max.x + offset * 0.55, (min.y + max.y) / 2, max.z + offset * 0.08),
        new Vector3(min.x - offset * 0.55, (min.y + max.y) / 2, max.z + offset * 0.08),
        new Vector3(max.x + offset * 0.55, (min.y + max.y) / 2, min.z - offset * 0.08),
        new Vector3(min.x - offset * 0.55, (min.y + max.y) / 2, min.z - offset * 0.08),
      ];
    }
    const value =
      axis === "width" ? max.x - min.x : axis === "depth" ? max.z - min.z : max.y - min.y;
    return { positions, value };
  }

  dispose(): void {
    this.visible = false;
    this.customActive = false;
    this.customPoints = [];
    this.rebuild();
    this.group.removeFromParent();
    this.overlay.remove();
  }
}
