import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
  type Object3D,
} from "three";
import type { HotspotConfig, TourConfig } from "../config/schema";
import type { LookControls } from "../controls/LookControls";
import type { HotspotLayer } from "../interaction/HotspotLayer";
import type { InteractionManager, SceneHit } from "../interaction/InteractionManager";
import type { AuthorLinkHandle, NavigationManager } from "../navigation/NavigationManager";
import type { PanoramaProjection } from "../rendering/PanoramaMaterial";

export interface AuthorModeContext {
  config: TourConfig;
  camera: PerspectiveCamera;
  overlay: HTMLElement;
  canvas: HTMLCanvasElement;
  controls: LookControls;
  interaction: InteractionManager;
  hotspots: HotspotLayer;
  navigation: NavigationManager;
  projection: PanoramaProjection;
  proxyRoot: Object3D | null;
  proxyMeshes: Mesh[];
}

type ClickMode = "inspect" | "hotspot" | "link";
type DragTarget =
  | { kind: "hotspot"; hotspot: HotspotConfig }
  | { kind: "link"; handle: AuthorLinkHandle };

const PANEL_CSS = [
  "position:absolute",
  "top:12px",
  "right:12px",
  "width:240px",
  "background:rgba(14,14,18,0.92)",
  "color:#ddd",
  "font:12px/1.6 ui-monospace,Menlo,monospace",
  "border-radius:10px",
  "padding:12px",
  "pointer-events:auto",
  "z-index:30",
  "box-shadow:0 6px 24px rgba(0,0,0,0.45)",
].join(";");

const BUTTON_CSS =
  "background:#2a2a33;border:1px solid #444;color:#ddd;border-radius:6px;padding:3px 8px;cursor:pointer;font:inherit";

/**
 * Minimal in-canvas author/debug overlay: wireframe toggle, click-to-place
 * hotspots and links, hotspot dragging, per-node panorama yaw nudge, camera
 * yaw/pitch readout, and copy/download of the updated JSON. Deliberately a
 * debug tool, not a product — no persistence, no backend.
 */
export class AuthorMode {
  private ctx: AuthorModeContext;
  private panel: HTMLElement;
  private clickMode: ClickMode = "inspect";
  private wireframes: Mesh[] = [];
  private wireframeMaterial: MeshBasicMaterial | null = null;
  private lastHitText: HTMLElement;
  private viewText: HTMLElement;
  private yawText: HTMLElement;
  private linkTargetSelect: HTMLSelectElement;
  private hotspotCounter = 0;
  private abort = new AbortController();
  private dragging: DragTarget | null = null;
  private dragRaycaster = new Raycaster();

  constructor(ctx: AuthorModeContext) {
    this.ctx = ctx;
    this.panel = document.createElement("div");
    this.panel.className = "meshtour-author-panel";
    this.panel.style.cssText = PANEL_CSS;

    this.lastHitText = document.createElement("div");
    this.viewText = document.createElement("div");
    this.yawText = document.createElement("span");
    this.linkTargetSelect = document.createElement("select");

    this.buildPanel();
    ctx.overlay.appendChild(this.panel);
    ctx.interaction.onSceneClick = (hit) => this.onSceneClick(hit);

    const { signal } = this.abort;
    ctx.canvas.addEventListener("pointerdown", this.onPointerDown, { signal, capture: true });
    ctx.canvas.addEventListener("pointermove", this.onPointerMove, { signal });
    ctx.canvas.addEventListener("pointerup", this.onPointerUp, { signal });
    ctx.canvas.addEventListener("pointercancel", this.onPointerUp, { signal });
  }

  private el(tag: string, text?: string, css?: string): HTMLElement {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (css) node.style.cssText = css;
    return node;
  }

  private button(label: string, onClick: () => void): HTMLElement {
    const button = this.el("button", label, BUTTON_CSS);
    button.addEventListener("click", onClick, { signal: this.abort.signal });
    return button;
  }

  private buildPanel(): void {
    const title = this.el(
      "div",
      "MeshTour author mode",
      "font-weight:700;margin-bottom:8px;color:#fff",
    );
    this.panel.appendChild(title);

    // Wireframe toggle
    const wireRow = this.el("label", "", "display:flex;gap:6px;align-items:center;cursor:pointer");
    const wireBox = document.createElement("input");
    wireBox.type = "checkbox";
    wireBox.addEventListener("change", () => this.setWireframe(wireBox.checked), {
      signal: this.abort.signal,
    });
    wireRow.appendChild(wireBox);
    wireRow.appendChild(this.el("span", "Show proxy wireframe"));
    this.panel.appendChild(wireRow);

    // Click mode
    const modeRow = this.el("div", "", "margin-top:8px;display:flex;gap:4px;flex-wrap:wrap");
    for (const mode of ["inspect", "hotspot", "link"] as const) {
      const label = mode === "inspect" ? "Inspect" : mode === "hotspot" ? "+ Hotspot" : "+ Link";
      const button = this.button(label, () => {
        this.clickMode = mode;
        [...modeRow.children].forEach((child, i) => {
          (child as HTMLElement).style.borderColor =
            (["inspect", "hotspot", "link"] as const)[i] === mode ? "#7af" : "#444";
        });
      });
      if (mode === "inspect") button.style.borderColor = "#7af";
      modeRow.appendChild(button);
    }
    this.panel.appendChild(modeRow);

    // Link target selector
    const linkRow = this.el("div", "", "margin-top:6px;display:flex;gap:6px;align-items:center");
    linkRow.appendChild(this.el("span", "Link to:"));
    this.linkTargetSelect.style.cssText = BUTTON_CSS;
    this.refreshLinkTargets();
    linkRow.appendChild(this.linkTargetSelect);
    this.panel.appendChild(linkRow);

    // Readouts
    this.lastHitText.style.cssText = "margin-top:8px;color:#9fd;word-break:break-all";
    this.lastHitText.textContent = "Click the scene to inspect a position.";
    this.panel.appendChild(this.lastHitText);
    this.viewText.style.cssText = "margin-top:4px;color:#adf";
    this.panel.appendChild(this.viewText);

    // Yaw nudge
    const yawRow = this.el(
      "div",
      "",
      "margin-top:8px;display:flex;gap:4px;align-items:center;flex-wrap:wrap",
    );
    yawRow.appendChild(this.el("span", "Pano yaw:"));
    yawRow.appendChild(this.button("−2°", () => this.nudgeYaw(-2)));
    yawRow.appendChild(this.button("−0.1°", () => this.nudgeYaw(-0.1)));
    yawRow.appendChild(this.button("+0.1°", () => this.nudgeYaw(0.1)));
    yawRow.appendChild(this.button("+2°", () => this.nudgeYaw(2)));
    yawRow.appendChild(this.yawText);
    this.panel.appendChild(yawRow);

    // Export
    const exportRow = this.el("div", "", "margin-top:10px;display:flex;gap:6px");
    exportRow.appendChild(
      this.button("Copy JSON", () => {
        void navigator.clipboard.writeText(this.serialize());
      }),
    );
    exportRow.appendChild(
      this.button("Download JSON", () => {
        const blob = new Blob([this.serialize()], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "tour.json";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Revoking synchronously can cancel the download in Chromium/WebKit.
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }),
    );
    this.panel.appendChild(exportRow);

    const hint = this.el(
      "div",
      "Drag a hotspot or link marker to move it along surfaces.",
      "margin-top:8px;color:#888",
    );
    this.panel.appendChild(hint);
  }

  private refreshLinkTargets(): void {
    this.linkTargetSelect.innerHTML = "";
    for (const node of this.ctx.config.nodes) {
      const option = document.createElement("option");
      option.value = node.id;
      option.textContent = node.id;
      this.linkTargetSelect.appendChild(option);
    }
  }

  private serialize(): string {
    return JSON.stringify(this.ctx.config, null, 2);
  }

  private nudgeYaw(degrees: number): void {
    const nodeId = this.ctx.navigation.getCurrentNodeId();
    if (!nodeId) return;
    const node = this.ctx.config.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    node.panorama.yaw += (degrees * Math.PI) / 180;
    this.ctx.projection.setYawA(node.panorama.yaw);
  }

  private onSceneClick(hit: SceneHit): void {
    const p = hit.point;
    const rounded = [p.x, p.y, p.z].map((v) => Math.round(v * 1000) / 1000) as [
      number,
      number,
      number,
    ];
    this.lastHitText.textContent = `hit ${JSON.stringify(rounded)}${
      hit.interactableId ? ` (${hit.interactableId})` : ""
    }`;

    const currentNode = this.ctx.navigation.getCurrentNodeId();
    if (this.clickMode === "hotspot" && currentNode) {
      const hotspot: HotspotConfig = {
        id: `hs_${Date.now().toString(36)}_${this.hotspotCounter++}`,
        node: currentNode,
        position: rounded,
        type: "info",
        title: "New hotspot",
      };
      this.ctx.config.hotspots.push(hotspot);
      this.ctx.hotspots.add(hotspot);
      this.lastHitText.textContent = `added hotspot ${hotspot.id} @ ${JSON.stringify(rounded)}`;
    } else if (this.clickMode === "link" && currentNode) {
      const to = this.linkTargetSelect.value;
      if (to && to !== currentNode) {
        this.ctx.navigation.addLinkDisc(currentNode, to, rounded);
        this.lastHitText.textContent = `added link → ${to} @ ${JSON.stringify(rounded)}`;
      } else {
        this.lastHitText.textContent = "pick a different target node first";
      }
    }
  }

  // --- Hotspot dragging -----------------------------------------------------

  private pointerNdc(event: PointerEvent): Vector2 {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.dragRaycaster.setFromCamera(this.pointerNdc(event), this.ctx.camera);
    const currentNode = this.ctx.navigation.getCurrentNodeId();
    for (const hotspot of this.ctx.config.hotspots) {
      if (hotspot.node !== undefined && hotspot.node !== currentNode) continue;
      const sprite = this.findSprite(hotspot);
      if (!sprite?.visible) continue;
      const hits = this.dragRaycaster.intersectObject(sprite, false);
      if (hits.length > 0) {
        this.startDrag(event, { kind: "hotspot", hotspot });
        return;
      }
    }

    const link = this.linkNearPointer(event, currentNode);
    if (link) {
      this.startDrag(event, { kind: "link", handle: link });
    }
  };

  /**
   * A horizontal floor disc becomes nearly edge-on toward the horizon, making
   * triangle raycasts frustratingly precise. Author mode therefore gives
   * visible link markers a small screen-space grab radius.
   */
  private linkNearPointer(
    event: PointerEvent,
    currentNode: string | null,
  ): AuthorLinkHandle | null {
    const rect = this.ctx.canvas.getBoundingClientRect();
    this.ctx.camera.updateMatrixWorld();
    let closest: { handle: AuthorLinkHandle; distance: number } | null = null;
    for (const handle of this.ctx.navigation.getAuthorLinkHandles()) {
      if (handle.fromNodeId !== currentNode || !handle.mesh.visible) continue;
      handle.mesh.updateWorldMatrix(true, false);
      const point = handle.mesh.getWorldPosition(new Vector3()).project(this.ctx.camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = rect.left + ((point.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - point.y) / 2) * rect.height;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance <= 32 && (!closest || distance < closest.distance)) {
        closest = { handle, distance };
      }
    }
    return closest?.handle ?? null;
  }

  private startDrag(event: PointerEvent, target: DragTarget): void {
    this.dragging = target;
    this.ctx.controls.enabled = false;
    this.ctx.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }

  private findSprite(hotspot: HotspotConfig): Object3D | null {
    return this.ctx.hotspots.getSprite(hotspot.id);
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragRaycaster.setFromCamera(this.pointerNdc(event), this.ctx.camera);
    this.dragRaycaster.firstHitOnly = true;
    const hits = this.dragRaycaster.intersectObjects(this.ctx.proxyMeshes, false);
    const hit = hits[0];
    if (hit) {
      const position: [number, number, number] = [
        Math.round(hit.point.x * 1000) / 1000,
        Math.round(hit.point.y * 1000) / 1000,
        Math.round(hit.point.z * 1000) / 1000,
      ];
      if (this.dragging.kind === "hotspot") {
        this.dragging.hotspot.position = position;
        this.ctx.hotspots.updatePosition(this.dragging.hotspot.id, position);
      } else {
        this.ctx.navigation.updateLinkPosition(this.dragging.handle.link, position);
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const target = this.dragging;
    const label =
      target.kind === "hotspot"
        ? target.hotspot.id
        : `link ${target.handle.fromNodeId} → ${target.handle.link.to}`;
    const position =
      target.kind === "hotspot" ? target.hotspot.position : target.handle.link.position;
    this.lastHitText.textContent = `moved ${label} @ ${JSON.stringify(position)}`;
    this.dragging = null;
    this.ctx.controls.enabled = true;
    if (this.ctx.canvas.hasPointerCapture(event.pointerId)) {
      this.ctx.canvas.releasePointerCapture(event.pointerId);
    }
  };

  // --- Wireframe -------------------------------------------------------------

  private setWireframe(visible: boolean): void {
    if (visible && this.wireframes.length === 0) {
      this.wireframeMaterial = new MeshBasicMaterial({
        color: 0x00ffcc,
        wireframe: true,
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      });
      for (const mesh of this.ctx.proxyMeshes) {
        const wire = new Mesh(mesh.geometry, this.wireframeMaterial);
        wire.renderOrder = 6;
        wire.raycast = () => {};
        mesh.add(wire);
        this.wireframes.push(wire);
      }
    }
    for (const wire of this.wireframes) wire.visible = visible;
  }

  /** Per-frame: keep the camera yaw/pitch readout fresh (for initialView authoring). */
  update(): void {
    const { yaw, pitch } = this.ctx.controls;
    this.viewText.textContent = `view yaw ${yaw.toFixed(3)} pitch ${pitch.toFixed(3)}`;
    const nodeId = this.ctx.navigation.getCurrentNodeId();
    const node = nodeId ? this.ctx.config.nodes.find((n) => n.id === nodeId) : null;
    this.yawText.textContent = node ? ` ${((node.panorama.yaw * 180) / Math.PI).toFixed(2)}°` : "";
  }

  dispose(): void {
    this.abort.abort();
    this.panel.remove();
    for (const wire of this.wireframes) wire.removeFromParent();
    this.wireframes = [];
    this.wireframeMaterial?.dispose();
    this.ctx.interaction.onSceneClick = null;
    this.ctx.controls.enabled = true;
  }
}
