import { Box3, Group, Vector3, type Camera, type Object3D, type Scene } from "three";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { MeasurementAxis, MeasurementConfig, TourConfig } from "../config/schema";

interface LabelEntry {
  element: HTMLDivElement;
  positions: Vector3[];
}

function formatMeters(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} m`;
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
  private measurementConfigs: MeasurementConfig[];
  private selectedId: string | null = null;
  private visible = false;

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
    this.rebuild();
    this.group.visible = visible;
    this.overlay.style.display = visible ? "block" : "none";
  }

  isVisible(): boolean {
    return this.visible;
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

  update(): void {
    if (!this.visible) return;
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
    for (const label of this.labels) label.element.remove();
    this.labels = [];
    if (!this.visible) return;

    for (const measurement of this.measurementConfigs) {
      if (!measurement.defaultVisible && measurement.id !== this.selectedId) continue;
      const bounds = this.resolveBounds(measurement);
      if (!bounds) continue;
      this.addMeasurement(measurement, bounds);
    }
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
    this.rebuild();
    this.group.removeFromParent();
    this.overlay.remove();
  }
}
