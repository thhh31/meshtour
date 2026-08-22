import {
  CanvasTexture,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { HotspotConfig, TourConfig } from "../config/schema";
import { resolveAssetUrl } from "../config/loader";
import type { TourEventEmitter } from "../events";
import type { InteractionManager } from "./InteractionManager";
import { clamp } from "../utils/math";

function createMarkerTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  // Outer ring
  ctx.beginPath();
  ctx.arc(c, c, 52, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 8;
  ctx.stroke();
  // Inner dot
  ctx.beginPath();
  ctx.arc(c, c, 26, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  return new CanvasTexture(canvas);
}

interface HotspotEntry {
  hotspot: HotspotConfig;
  sprite: Sprite;
  material: SpriteMaterial;
  targetOpacity: number;
  unregister: () => void;
}

/**
 * Hotspot markers as billboarded in-canvas sprites with occlusion-aware
 * fading (a hotspot behind a wall hides), plus an HTML popup layer so popup
 * content is real DOM. Host apps can disable the default popup and render
 * their own from the `hotspotclick` event.
 */
export class HotspotLayer {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private events: TourEventEmitter;
  private interaction: InteractionManager;
  private proxyMeshes: Mesh[] = [];
  private entries: HotspotEntry[] = [];
  private raycaster = new Raycaster();
  private markerTexture = createMarkerTexture();
  private visible = true;
  private currentNodeId: string | null = null;
  private popupElement: HTMLElement | null = null;
  private popupAnchor: Vector3 | null = null;
  private overlay: HTMLElement;
  private defaultPopups: boolean;
  private config: TourConfig;
  private occlusionClock = 0;
  private cameraWorldPosition = new Vector3();

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    overlay: HTMLElement,
    events: TourEventEmitter,
    interaction: InteractionManager,
    config: TourConfig,
    defaultPopups: boolean,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.overlay = overlay;
    this.events = events;
    this.interaction = interaction;
    this.defaultPopups = defaultPopups;
    this.config = config;

    for (const hotspot of config.hotspots) this.add(hotspot);
  }

  setProxyMeshes(meshes: Mesh[]): void {
    this.proxyMeshes = meshes;
  }

  add(hotspot: HotspotConfig): void {
    const material = new SpriteMaterial({
      map: this.markerTexture,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new Sprite(material);
    sprite.position.fromArray(hotspot.position);
    sprite.scale.setScalar(0.18);
    sprite.renderOrder = 8;
    this.scene.add(sprite);

    const unregister = this.interaction.registerPickable({
      object: sprite,
      onClick: () => this.onHotspotClick(hotspot),
      onHoverChange: (hovered) => {
        sprite.scale.setScalar(hovered ? 0.22 : 0.18);
      },
    });

    this.entries.push({ hotspot, sprite, material, targetOpacity: 0, unregister });
  }

  /** Author mode moves hotspots live. */
  updatePosition(hotspotId: string, position: [number, number, number]): void {
    const entry = this.entries.find((e) => e.hotspot.id === hotspotId);
    if (!entry) return;
    entry.hotspot.position = position;
    entry.sprite.position.fromArray(position);
  }

  findByObject(object: unknown): HotspotConfig | null {
    return this.entries.find((e) => e.sprite === object)?.hotspot ?? null;
  }

  getSprite(hotspotId: string): Sprite | null {
    return this.entries.find((e) => e.hotspot.id === hotspotId)?.sprite ?? null;
  }

  private onHotspotClick(hotspot: HotspotConfig): void {
    this.events.emit("hotspotclick", { hotspot });
    if (!this.defaultPopups) return;
    if (hotspot.type === "link" && hotspot.href) {
      window.open(hotspot.href, "_blank", "noopener");
      return;
    }
    this.showPopup(hotspot);
  }

  private showPopup(hotspot: HotspotConfig): void {
    this.closePopup();
    const popup = document.createElement("div");
    popup.className = "meshtour-popup";
    popup.style.cssText = [
      "position:absolute",
      "transform:translate(-50%,calc(-100% - 18px))",
      "max-width:280px",
      "background:rgba(18,18,22,0.92)",
      "color:#fff",
      "border-radius:10px",
      "padding:14px 16px",
      "font:13px/1.5 system-ui,sans-serif",
      "pointer-events:auto",
      "box-shadow:0 6px 24px rgba(0,0,0,0.4)",
      "z-index:20",
    ].join(";");

    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    close.style.cssText =
      "position:absolute;top:4px;right:8px;background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:2px";
    close.addEventListener("click", () => this.closePopup());
    popup.appendChild(close);

    if (hotspot.title) {
      const title = document.createElement("div");
      title.textContent = hotspot.title;
      title.style.cssText = "font-weight:600;font-size:14px;margin:0 16px 6px 0";
      popup.appendChild(title);
    }
    if (hotspot.media?.image) {
      const img = document.createElement("img");
      img.src = resolveAssetUrl(this.config, hotspot.media.image);
      img.alt = hotspot.title ?? "";
      img.style.cssText = "width:100%;border-radius:6px;margin:4px 0";
      popup.appendChild(img);
    }
    if (hotspot.body) {
      const body = document.createElement("div");
      body.textContent = hotspot.body;
      popup.appendChild(body);
    }

    this.overlay.appendChild(popup);
    this.popupElement = popup;
    this.popupAnchor = new Vector3().fromArray(hotspot.position);
  }

  closePopup(): void {
    this.popupElement?.remove();
    this.popupElement = null;
    this.popupAnchor = null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.closePopup();
  }

  setCurrentNode(nodeId: string): void {
    this.currentNodeId = nodeId;
    this.closePopup();
  }

  /** Project a world position to overlay pixel coordinates. */
  private projectToOverlay(position: Vector3): { x: number; y: number; behind: boolean } {
    const projected = position.clone().project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * this.overlay.clientWidth,
      y: ((1 - projected.y) / 2) * this.overlay.clientHeight,
      behind: projected.z > 1,
    };
  }

  update(dt: number): void {
    // Occlusion raycasts are throttled; opacity fades run every frame.
    this.occlusionClock -= dt;
    const testOcclusion = this.occlusionClock <= 0;
    if (testOcclusion) this.occlusionClock = 0.1;

    const cameraPosition = this.camera.getWorldPosition(this.cameraWorldPosition);
    for (const entry of this.entries) {
      const belongsToNode =
        entry.hotspot.node === undefined || entry.hotspot.node === this.currentNodeId;
      const shouldShow = this.visible && belongsToNode;

      if (shouldShow && testOcclusion) {
        const toHotspot = entry.sprite.position.clone().sub(cameraPosition);
        const distance = toHotspot.length();
        this.raycaster.set(cameraPosition, toHotspot.normalize());
        this.raycaster.far = distance - 0.05;
        this.raycaster.firstHitOnly = true;
        const occluded = this.raycaster.intersectObjects(this.proxyMeshes, false).length > 0;
        entry.targetOpacity = occluded ? 0 : 1;
      } else if (!shouldShow) {
        entry.targetOpacity = 0;
      }

      const current = entry.material.opacity;
      const target = entry.targetOpacity;
      entry.material.opacity = clamp(current + (target - current) * Math.min(1, dt * 10), 0, 1);
      entry.sprite.visible = entry.material.opacity > 0.01;
    }
    this.raycaster.far = Infinity;

    if (this.popupElement && this.popupAnchor) {
      const { x, y, behind } = this.projectToOverlay(this.popupAnchor);
      this.popupElement.style.left = `${x}px`;
      this.popupElement.style.top = `${y}px`;
      this.popupElement.style.display = behind ? "none" : "";
    }
  }

  dispose(): void {
    this.closePopup();
    for (const entry of this.entries) {
      entry.unregister();
      entry.sprite.removeFromParent();
      entry.material.dispose();
    }
    this.entries = [];
    this.markerTexture.dispose();
  }
}
