import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import { clamp } from "../utils/math";

const PITCH_LIMIT = MathUtils.degToRad(85);
const MIN_FOV = 40;
const MAX_FOV = 95;

/**
 * Yaw/pitch look controls with inertia and FOV zoom. The camera never
 * translates here — it only leaves a node via transitions.
 * Yaw 0 looks toward -Z; positive yaw turns left. Positive pitch looks up.
 */
export class LookControls {
  yaw = 0;
  pitch = 0;
  enabled = true;

  private camera: PerspectiveCamera;
  private element: HTMLElement;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private velocityYaw = 0;
  private velocityPitch = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private abort = new AbortController();

  constructor(camera: PerspectiveCamera, element: HTMLElement) {
    this.camera = camera;
    this.element = element;
    camera.rotation.order = "YXZ";

    const { signal } = this.abort;
    element.addEventListener("pointerdown", this.onPointerDown, { signal });
    element.addEventListener("pointermove", this.onPointerMove, { signal });
    element.addEventListener("pointerup", this.onPointerUp, { signal });
    element.addEventListener("pointercancel", this.onPointerUp, { signal });
    element.addEventListener("wheel", this.onWheel, { signal, passive: false });
    element.style.touchAction = "none";
    this.apply();
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled) return;
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.velocityYaw = 0;
      this.velocityPitch = 0;
    } else if (this.pointers.size === 2) {
      this.dragging = false;
      this.pinchDistance = this.currentPinchDistance();
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      const distance = this.currentPinchDistance();
      if (this.pinchDistance > 0) {
        const scale = this.pinchDistance / distance;
        this.setFov(this.camera.fov * scale);
      }
      this.pinchDistance = distance;
      return;
    }

    if (!this.dragging) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    // Scale sensitivity with FOV so zoomed-in looking stays controllable.
    const sensitivity = (this.camera.fov / 75) * 0.0032;
    const deltaYaw = dx * sensitivity;
    const deltaPitch = dy * sensitivity;
    this.yaw += deltaYaw;
    this.pitch = clamp(this.pitch + deltaPitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.velocityYaw = deltaYaw;
    this.velocityPitch = deltaPitch;
    this.apply();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinchDistance = 0;
    if (this.pointers.size === 0) this.dragging = false;
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled) return;
    event.preventDefault();
    this.setFov(this.camera.fov + event.deltaY * 0.05);
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private setFov(fov: number): void {
    this.camera.fov = clamp(fov, MIN_FOV, MAX_FOV);
    this.camera.updateProjectionMatrix();
  }

  /** Per-frame: apply inertia after the pointer is released. Returns true when the view moved. */
  update(dt: number): boolean {
    if (this.dragging || (this.velocityYaw === 0 && this.velocityPitch === 0)) return false;
    this.yaw += this.velocityYaw;
    this.pitch = clamp(this.pitch + this.velocityPitch, -PITCH_LIMIT, PITCH_LIMIT);
    const damping = Math.exp(-6 * dt);
    this.velocityYaw *= damping;
    this.velocityPitch *= damping;
    if (Math.abs(this.velocityYaw) < 1e-5) this.velocityYaw = 0;
    if (Math.abs(this.velocityPitch) < 1e-5) this.velocityPitch = 0;
    this.apply();
    return true;
  }

  setYawPitch(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    this.velocityYaw = 0;
    this.velocityPitch = 0;
    this.apply();
  }

  /** Point the camera at a world position (from its current position). */
  lookAt(target: Vector3): void {
    const direction = target.clone().sub(this.camera.position).normalize();
    const yaw = Math.atan2(-direction.x, -direction.z);
    const pitch = Math.asin(clamp(direction.y, -1, 1));
    this.setYawPitch(yaw, pitch);
  }

  private apply(): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  dispose(): void {
    this.abort.abort();
  }
}
