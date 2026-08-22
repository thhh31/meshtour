import {
  BufferGeometry,
  Camera,
  Intersection,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  RingGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
} from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type { TourConfig } from "../config/schema";
import type { TourEventEmitter } from "../events";
import { createHighlightMaterial } from "../rendering/HighlightMaterial";

export interface SceneHit {
  point: Vector3;
  normal: Vector3 | null;
  object: Object3D;
  interactableId: string | null;
}

export interface Pickable {
  object: Object3D;
  onClick?: (hit: Intersection) => void;
  onHoverChange?: (hovered: boolean) => void;
}

/**
 * three.js raycasting does not consider Object3D.visible, especially when an
 * object is intersected directly instead of through its parent. A pickable is
 * interactive only when it and every ancestor are visible.
 */
export function isObjectEffectivelyVisible(object: Object3D): boolean {
  let current: Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

/** A marker must be in front of the first proxy surface to receive input. */
export function isPickableInFront(
  pickableDistance: number,
  proxyDistance: number | null,
  tolerance = 0.05,
): boolean {
  return proxyDistance === null || pickableDistance < proxyDistance + tolerance;
}

type BvhGeometry = BufferGeometry & {
  computeBoundsTree: typeof computeBoundsTree;
  disposeBoundsTree: typeof disposeBoundsTree;
  boundsTree?: unknown;
};

/**
 * Pointer raycasting against the proxy mesh (BVH-accelerated), interactable
 * hover + highlight overlay, cursor reticle, and click dispatch to pickables
 * (link discs, hotspot markers) registered by other managers.
 */
export class InteractionManager {
  /** Author mode taps into raw scene clicks for hotspot/link placement. */
  onSceneClick: ((hit: SceneHit) => void) | null = null;

  private camera: Camera;
  private element: HTMLElement;
  private events: TourEventEmitter;
  private raycaster = new Raycaster();
  private pointerNdc = new Vector2();
  private pointerInside = false;
  private pointerDirty = false;
  private proxyMeshes: Mesh[] = [];
  private interactableIds = new Map<Mesh, string>();
  private interactableGroups = new Map<string, Mesh[]>();
  private pickables: Pickable[] = [];
  private hoveredPickable: Pickable | null = null;
  private hoveredInteractable: string | null = null;
  private highlightMeshes: Mesh[] = [];
  private highlightMaterial: ShaderMaterial;
  private reticle: Mesh;
  private downPosition: Vector2 | null = null;
  private abort = new AbortController();
  private enabled = true;
  private proxyPickingEnabled = true;

  constructor(
    camera: Camera,
    scene: Scene,
    element: HTMLElement,
    events: TourEventEmitter,
    config: TourConfig,
  ) {
    this.camera = camera;
    this.element = element;
    this.events = events;

    const highlight = config.interactables.highlight;
    this.highlightMaterial = createHighlightMaterial(highlight.color, highlight.opacity);

    this.reticle = new Mesh(
      new RingGeometry(0.03, 0.05, 32),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.reticle.renderOrder = 10;
    this.reticle.visible = false;
    scene.add(this.reticle);

    const { signal } = this.abort;
    element.addEventListener("pointermove", this.onPointerMove, { signal });
    element.addEventListener("pointerdown", this.onPointerDown, { signal });
    element.addEventListener("pointerup", this.onPointerUp, { signal });
    element.addEventListener("pointerleave", this.onPointerLeave, { signal });
  }

  /** Register the proxy mesh: builds BVHs and resolves interactable ids by name prefix. */
  setProxyMesh(root: Object3D, namePrefix: string): void {
    this.proxyMeshes = [];
    this.interactableIds.clear();
    this.interactableGroups.clear();

    root.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const geometry = mesh.geometry as BvhGeometry;
      geometry.computeBoundsTree = computeBoundsTree;
      geometry.disposeBoundsTree = disposeBoundsTree;
      if (!geometry.boundsTree) geometry.computeBoundsTree();
      mesh.raycast = acceleratedRaycast;
      this.proxyMeshes.push(mesh);

      // Resolve the interactable id from this mesh or the nearest named ancestor
      // ("int_table_01" -> "table_01"); glTF export often nests primitives.
      let id: string | null = null;
      let current: Object3D | null = mesh;
      while (current && current !== root) {
        if (current.name.startsWith(namePrefix)) {
          id = current.name.slice(namePrefix.length);
          break;
        }
        current = current.parent;
      }
      if (id) {
        this.interactableIds.set(mesh, id);
        const group = this.interactableGroups.get(id) ?? [];
        group.push(mesh);
        this.interactableGroups.set(id, group);
      }
    });
  }

  registerPickable(pickable: Pickable): () => void {
    this.pickables.push(pickable);
    return () => {
      this.pickables = this.pickables.filter((p) => p !== pickable);
      if (this.hoveredPickable === pickable) this.hoveredPickable = null;
    };
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.setHoveredPickable(null);
      this.setHoveredInteractable(null);
      this.reticle.visible = false;
    }
  }

  /** Switch picking to the camera used by the active view mode. */
  setCamera(camera: Camera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    this.invalidate();
  }

  /** Top view only needs marker picking; its hidden proxy must not occlude markers. */
  setProxyPickingEnabled(enabled: boolean): void {
    if (enabled === this.proxyPickingEnabled) return;
    this.proxyPickingEnabled = enabled;
    this.setHoveredInteractable(null);
    this.reticle.visible = false;
    this.invalidate();
  }

  /** Re-run picking when the camera moves without a pointer event. */
  invalidate(): void {
    if (this.pointerInside) this.pointerDirty = true;
  }

  private onPointerMove = (event: PointerEvent): void => {
    const rect = this.element.getBoundingClientRect();
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerInside = true;
    this.pointerDirty = true;
  };

  private onPointerLeave = (): void => {
    this.pointerInside = false;
    this.setHoveredPickable(null);
    this.setHoveredInteractable(null);
    this.reticle.visible = false;
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.downPosition = new Vector2(event.clientX, event.clientY);
  };

  private onPointerUp = (event: PointerEvent): void => {
    const down = this.downPosition;
    this.downPosition = null;
    if (!down || !this.enabled) return;
    // A click is a press that didn't drag.
    if (down.distanceTo(new Vector2(event.clientX, event.clientY)) > 6) return;

    this.onPointerMove(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    this.selectWithCurrentRay();
  };

  /** Dispatch a selection from an arbitrary world-space ray (for XR controllers). */
  selectFromRay(origin: Vector3, direction: Vector3): boolean {
    if (!this.enabled) return false;
    this.raycaster.set(origin, direction);
    return this.selectWithCurrentRay();
  }

  private selectWithCurrentRay(): boolean {
    const pickableHit = this.raycastPickables();
    const proxyHit = this.raycastProxy();
    if (
      pickableHit &&
      isPickableInFront(pickableHit.intersection.distance, proxyHit?.distance ?? null)
    ) {
      pickableHit.pickable.onClick?.(pickableHit.intersection);
      return true;
    }

    if (!proxyHit) return false;
    const sceneHit = this.toSceneHit(proxyHit);
    if (sceneHit.interactableId) {
      this.events.emit("interactableclick", {
        id: sceneHit.interactableId,
        point: [proxyHit.point.x, proxyHit.point.y, proxyHit.point.z],
      });
    }
    this.onSceneClick?.(sceneHit);
    return true;
  }

  private raycastPickables(): { pickable: Pickable; intersection: Intersection } | null {
    let best: { pickable: Pickable; intersection: Intersection } | null = null;
    for (const pickable of this.pickables) {
      if (!isObjectEffectivelyVisible(pickable.object)) continue;
      const hits = this.raycaster.intersectObject(pickable.object, true);
      const hit = hits[0];
      if (hit && (!best || hit.distance < best.intersection.distance)) {
        best = { pickable, intersection: hit };
      }
    }
    return best;
  }

  private raycastProxy(): Intersection | null {
    if (!this.proxyPickingEnabled) return null;
    this.raycaster.firstHitOnly = true;
    const hits = this.raycaster.intersectObjects(this.proxyMeshes, false);
    return hits[0] ?? null;
  }

  private toSceneHit(hit: Intersection): SceneHit {
    const normal = hit.normal
      ? hit.normal.clone().transformDirection(hit.object.matrixWorld)
      : (hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? null);
    return {
      point: hit.point.clone(),
      normal,
      object: hit.object,
      interactableId: this.interactableIds.get(hit.object as Mesh) ?? null,
    };
  }

  /** Per-frame hover update (only re-raycasts when the pointer moved). */
  update(): void {
    if (!this.enabled || !this.pointerInside || !this.pointerDirty) return;
    this.pointerDirty = false;

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    this.updateHoverWithCurrentRay(true);
  }

  /** Update hover/highlight state from a world-space ray (for XR controllers). */
  updateFromRay(origin: Vector3, direction: Vector3): void {
    if (!this.enabled) return;
    this.raycaster.set(origin, direction);
    this.updateHoverWithCurrentRay(false);
  }

  private updateHoverWithCurrentRay(updateCursor: boolean): void {
    const pickableHit = this.raycastPickables();
    const proxyHit = this.raycastProxy();
    const pickableInFront =
      pickableHit &&
      isPickableInFront(pickableHit.intersection.distance, proxyHit?.distance ?? null);

    if (pickableInFront) {
      this.setHoveredPickable(pickableHit.pickable);
      this.setHoveredInteractable(null);
      this.reticle.visible = false;
      if (updateCursor) this.element.style.cursor = "pointer";
      return;
    }
    this.setHoveredPickable(null);

    if (!proxyHit) {
      this.setHoveredInteractable(null);
      this.reticle.visible = false;
      if (updateCursor) this.element.style.cursor = "";
      return;
    }

    const sceneHit = this.toSceneHit(proxyHit);
    this.updateReticle(sceneHit);
    this.setHoveredInteractable(sceneHit.interactableId);
    if (updateCursor) this.element.style.cursor = sceneHit.interactableId ? "pointer" : "";
  }

  private updateReticle(hit: SceneHit): void {
    this.reticle.visible = true;
    const normal = hit.normal ?? new Vector3(0, 1, 0);
    this.reticle.position.copy(hit.point).addScaledVector(normal, 0.01);
    this.reticle.lookAt(hit.point.clone().add(normal));
  }

  private setHoveredPickable(pickable: Pickable | null): void {
    if (this.hoveredPickable === pickable) return;
    this.hoveredPickable?.onHoverChange?.(false);
    this.hoveredPickable = pickable;
    pickable?.onHoverChange?.(true);
  }

  private setHoveredInteractable(id: string | null): void {
    if (this.hoveredInteractable === id) return;
    this.hoveredInteractable = id;

    for (const mesh of this.highlightMeshes) mesh.removeFromParent();
    this.highlightMeshes = [];

    if (id) {
      for (const mesh of this.interactableGroups.get(id) ?? []) {
        const overlay = new Mesh(mesh.geometry, this.highlightMaterial);
        overlay.renderOrder = 5;
        overlay.raycast = () => {};
        mesh.add(overlay);
        this.highlightMeshes.push(overlay);
      }
    }
    this.events.emit("interactablehover", { id });
  }

  getHoveredInteractable(): string | null {
    return this.hoveredInteractable;
  }

  dispose(): void {
    this.abort.abort();
    this.setHoveredInteractable(null);
    this.highlightMaterial.dispose();
    this.reticle.removeFromParent();
    this.reticle.geometry.dispose();
    (this.reticle.material as MeshBasicMaterial).dispose();
    for (const mesh of this.proxyMeshes) {
      const geometry = mesh.geometry as BvhGeometry;
      if (geometry.boundsTree) geometry.disposeBoundsTree();
    }
    this.element.style.cursor = "";
  }
}
