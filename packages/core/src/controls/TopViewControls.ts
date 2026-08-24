import { MathUtils, OrthographicCamera, Vector3 } from "three";
import type { PlanBoundsConfig } from "../config/schema";

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 5;

/** Pan and zoom controls for the engine's orthographic overview camera. */
export class TopViewControls {
  enabled = false;

  private camera: OrthographicCamera;
  private element: HTMLElement;
  private center = new Vector3();
  private defaultCenter = new Vector3();
  private floorY = 0;
  private cameraY = 10;
  private baseHeight = 10;
  private width = 1;
  private height = 1;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private pinchDistance = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private abort = new AbortController();

  constructor(camera: OrthographicCamera, element: HTMLElement) {
    this.camera = camera;
    this.element = element;
    camera.up.set(0, 0, -1);
    const { signal } = this.abort;
    element.addEventListener("pointerdown", this.onPointerDown, { signal });
    element.addEventListener("pointermove", this.onPointerMove, { signal });
    element.addEventListener("pointerup", this.onPointerUp, { signal });
    element.addEventListener("pointercancel", this.onPointerUp, { signal });
    element.addEventListener("wheel", this.onWheel, { signal, passive: false });
  }

  setBounds(bounds: PlanBoundsConfig, floorY: number, maxY: number): void {
    const extentX = bounds.max[0] - bounds.min[0];
    const extentZ = bounds.max[1] - bounds.min[1];
    this.center.set(
      (bounds.min[0] + bounds.max[0]) / 2,
      floorY,
      (bounds.min[1] + bounds.max[1]) / 2,
    );
    this.defaultCenter.copy(this.center);
    this.floorY = floorY;
    this.cameraY = Math.max(maxY + 8, floorY + 8);
    this.baseHeight = Math.max(extentZ, extentX / (this.width / this.height)) * 1.16;
    this.camera.zoom = 1;
    this.apply();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.apply();
  }

  reset(): void {
    this.center.copy(this.defaultCenter);
    this.camera.zoom = 1;
    this.apply();
  }

  getView(): { center: [number, number]; zoom: number } {
    return { center: [this.center.x, this.center.z], zoom: this.camera.zoom };
  }

  setView(center: [number, number], zoom: number): void {
    this.center.set(center[0], this.floorY, center[1]);
    this.setZoom(zoom);
    this.applyPosition();
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private setZoom(zoom: number): void {
    this.camera.zoom = MathUtils.clamp(zoom, MIN_ZOOM, MAX_ZOOM);
    this.camera.updateProjectionMatrix();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.dragging = this.pointers.size === 1;
    if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0) this.setZoom(this.camera.zoom * (distance / this.pinchDistance));
      this.pinchDistance = distance;
      return;
    }
    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    const worldPerPixel = this.baseHeight / this.camera.zoom / this.height;
    this.center.x -= dx * worldPerPixel;
    this.center.z -= dy * worldPerPixel;
    this.applyPosition();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.dragging = false;
    if (this.pointers.size < 2) this.pinchDistance = 0;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.setZoom(this.camera.zoom * Math.exp(-event.deltaY * 0.0015));
  };

  private apply(): void {
    const aspect = this.width / this.height;
    this.camera.left = (-this.baseHeight * aspect) / 2;
    this.camera.right = (this.baseHeight * aspect) / 2;
    this.camera.top = this.baseHeight / 2;
    this.camera.bottom = -this.baseHeight / 2;
    this.camera.updateProjectionMatrix();
    this.applyPosition();
  }

  private applyPosition(): void {
    this.camera.position.set(this.center.x, this.cameraY, this.center.z);
    this.camera.lookAt(this.center.x, this.floorY, this.center.z);
    this.camera.updateMatrixWorld();
  }

  dispose(): void {
    this.abort.abort();
  }
}
