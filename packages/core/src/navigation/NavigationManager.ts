import {
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
} from "three";
import type { NodeConfig, TourConfig } from "../config/schema";
import type { TourEventEmitter } from "../events";
import type { AssetManager } from "../engine/AssetManager";
import type { InteractionManager } from "../interaction/InteractionManager";
import type { PanoramaProjection } from "../rendering/PanoramaMaterial";
import { easeInOutCubic, lerp, transitionBlend } from "../utils/math";

function createDiscTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const gradient = ctx.createRadialGradient(c, c, 0, c, c, c);
  gradient.addColorStop(0, "rgba(255,255,255,0.55)");
  gradient.addColorStop(0.62, "rgba(255,255,255,0.18)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0.0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  // Crisp ring
  ctx.beginPath();
  ctx.arc(c, c, size * 0.34, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = size * 0.025;
  ctx.stroke();
  return new CanvasTexture(canvas);
}

interface LinkDisc {
  mesh: Mesh;
  material: MeshBasicMaterial;
  targetScale: number;
  unregister: () => void;
}

export interface TransitionOptions {
  /** Seconds. */
  duration?: number;
  /** Skip the animation entirely. */
  instant?: boolean;
}

const DEFAULT_DURATION = 1.2;

/**
 * Owns link floor discs and orchestrates the node-to-node transition: camera
 * travels in real 3D space from A to B while the dual panorama projection
 * crossfades, biased so the blend completes before arrival.
 */
export class NavigationManager {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private events: TourEventEmitter;
  private assets: AssetManager;
  private projection: PanoramaProjection;
  private interaction: InteractionManager;
  private config: TourConfig;
  private discTexture = createDiscTexture();
  private linkGroups = new Map<string, Group>();
  private discs: LinkDisc[] = [];
  private currentNodeId: string | null = null;
  private transition: {
    from: NodeConfig;
    to: NodeConfig;
    elapsed: number;
    duration: number;
    resolve: () => void;
  } | null = null;

  /** Called when a transition lands on a node (after promote). */
  onArrive: ((nodeId: string, from: string | null) => void) | null = null;

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    events: TourEventEmitter,
    assets: AssetManager,
    projection: PanoramaProjection,
    interaction: InteractionManager,
    config: TourConfig,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.events = events;
    this.assets = assets;
    this.projection = projection;
    this.interaction = interaction;
    this.config = config;
    this.buildLinkDiscs();
  }

  private buildLinkDiscs(): void {
    for (const node of this.config.nodes) {
      const group = new Group();
      group.visible = false;
      this.scene.add(group);
      this.linkGroups.set(node.id, group);

      for (const link of node.links) {
        const material = new MeshBasicMaterial({
          map: this.discTexture,
          transparent: true,
          depthWrite: false,
          opacity: 0.95,
        });
        const mesh = new Mesh(new CircleGeometry(0.28, 48), material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.fromArray(link.position);
        mesh.position.y += 0.015; // avoid z-fighting with the floor
        mesh.renderOrder = 4;
        group.add(mesh);

        const disc: LinkDisc = {
          mesh,
          material,
          targetScale: 1,
          unregister: () => {},
        };
        disc.unregister = this.interaction.registerPickable({
          object: mesh,
          onClick: () => void this.goToNode(link.to),
          onHoverChange: (hovered) => {
            disc.targetScale = hovered ? 1.25 : 1;
          },
        });
        this.discs.push(disc);
      }
    }
  }

  node(nodeId: string): NodeConfig {
    const node = this.config.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Unknown node "${nodeId}"`);
    return node;
  }

  getCurrentNodeId(): string | null {
    return this.currentNodeId;
  }

  isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** Place the camera at a node with no animation (initial load). */
  async setCurrentNode(nodeId: string): Promise<void> {
    const node = this.node(nodeId);
    const texture = await this.assets.ensureBest(nodeId);
    this.assets.preupload(texture);
    const center = new Vector3().fromArray(node.position);
    this.projection.setSlotA(texture, center, node.panorama.yaw);
    this.projection.setBlend(0);
    this.camera.position.copy(center);
    const from = this.currentNodeId;
    this.currentNodeId = nodeId;
    this.updateLinkVisibility();
    this.onArrive?.(nodeId, from);
    this.events.emit("nodechange", { from, to: nodeId });
  }

  async goToNode(nodeId: string, options: TransitionOptions = {}): Promise<void> {
    if (this.transition || nodeId === this.currentNodeId) return;
    if (this.currentNodeId === null || options.instant) {
      await this.setCurrentNode(nodeId);
      return;
    }

    const from = this.node(this.currentNodeId);
    const to = this.node(nodeId);

    // Upload the target texture *before* the move starts — never mid-flight.
    const texture = await this.assets.ensureBest(nodeId);
    if (this.transition) return; // a competing call won while we loaded
    this.assets.preupload(texture);

    this.projection.setSlotB(texture, new Vector3().fromArray(to.position), to.panorama.yaw);
    this.hideLinksDuringTransition();
    this.events.emit("transitionstart", { from: from.id, to: to.id });

    await new Promise<void>((resolve) => {
      this.transition = {
        from,
        to,
        elapsed: 0,
        duration: options.duration ?? DEFAULT_DURATION,
        resolve,
      };
    });
  }

  private hideLinksDuringTransition(): void {
    for (const group of this.linkGroups.values()) group.visible = false;
  }

  private updateLinkVisibility(): void {
    for (const [nodeId, group] of this.linkGroups) {
      group.visible = nodeId === this.currentNodeId;
    }
  }

  update(dt: number): void {
    for (const disc of this.discs) {
      const s = lerp(disc.mesh.scale.x, disc.targetScale, Math.min(1, dt * 12));
      disc.mesh.scale.setScalar(s);
    }

    const transition = this.transition;
    if (!transition) return;

    transition.elapsed += dt;
    const t = Math.min(1, transition.elapsed / transition.duration);
    const travel = easeInOutCubic(t);

    const a = new Vector3().fromArray(transition.from.position);
    const b = new Vector3().fromArray(transition.to.position);
    this.camera.position.copy(a.lerp(b, travel));
    this.projection.setBlend(transitionBlend(t));

    if (t >= 1) {
      this.projection.promoteBToA();
      const fromId = transition.from.id;
      const toId = transition.to.id;
      this.currentNodeId = toId;
      this.transition = null;
      this.updateLinkVisibility();
      this.onArrive?.(toId, fromId);
      this.events.emit("nodechange", { from: fromId, to: toId });
      this.events.emit("transitionend", { from: fromId, to: toId });
      transition.resolve();
    }
  }

  /** Author mode appends links at runtime. */
  addLinkDisc(fromNodeId: string, to: string, position: [number, number, number]): void {
    const node = this.node(fromNodeId);
    node.links.push({ to, position });
    // Rebuild is cheap at author-mode scale.
    this.rebuild();
  }

  private rebuild(): void {
    for (const disc of this.discs) {
      disc.unregister();
      disc.mesh.removeFromParent();
      disc.material.dispose();
      disc.mesh.geometry.dispose();
    }
    this.discs = [];
    for (const group of this.linkGroups.values()) group.removeFromParent();
    this.linkGroups.clear();
    this.buildLinkDiscs();
    this.updateLinkVisibility();
  }

  dispose(): void {
    for (const disc of this.discs) {
      disc.unregister();
      disc.mesh.removeFromParent();
      disc.material.dispose();
      disc.mesh.geometry.dispose();
    }
    this.discs = [];
    for (const group of this.linkGroups.values()) group.removeFromParent();
    this.linkGroups.clear();
    this.discTexture.dispose();
  }
}
