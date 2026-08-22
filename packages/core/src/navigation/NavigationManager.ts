import {
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
} from "three";
import type { LinkConfig, NodeConfig, TourConfig } from "../config/schema";
import type { TourEventEmitter } from "../events";
import type { AssetManager } from "../engine/AssetManager";
import type { InteractionManager } from "../interaction/InteractionManager";
import type { PanoramaProjection } from "../rendering/PanoramaMaterial";
import type { PanoramaVisibilityMap } from "../rendering/PanoramaVisibilityMap";
import { easeInOutCubic, lerp, smoothstep, transitionBlend } from "../utils/math";
import {
  createTransitionPath,
  resolveTransitionWaypoints,
  type TransitionPathSampler,
} from "./TransitionPath";

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
  fromNodeId: string | null;
  link: LinkConfig;
  mesh: Mesh;
  material: MeshBasicMaterial;
  targetScale: number;
  unregister: () => void;
}

export interface AuthorLinkHandle {
  fromNodeId: string;
  link: LinkConfig;
  mesh: Mesh;
}

export interface AuthorWaypointHandle {
  fromNodeId: string;
  link: LinkConfig;
  index: number;
  mesh: Mesh;
}

export interface TransitionSnapshot {
  from: string;
  to: string;
  progress: number;
  camera: [number, number, number];
  blend: number;
  depthAReady: boolean;
  depthBReady: boolean;
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
 * travels in real 3D space from A to B. Walk mode continuously reprojects both
 * panoramas; fade mode hides the travel for tours with sparse proxy coverage.
 */
export class NavigationManager {
  private scene: Scene;
  private camera: PerspectiveCamera;
  private events: TourEventEmitter;
  private assets: AssetManager;
  private projection: PanoramaProjection;
  private visibility: PanoramaVisibilityMap;
  private interaction: InteractionManager;
  private config: TourConfig;
  private discTexture = createDiscTexture();
  private linkGroups = new Map<string | null, Group>();
  private discs: LinkDisc[] = [];
  private currentNodeId: string | null = null;
  private markersVisible = true;
  private showAllMarkers = false;
  private showCurrentSharedMarker = false;
  private authorPathGroup = new Group();
  private authorWaypointGeometry = new SphereGeometry(0.075, 12, 8);
  private authorWaypointMaterial = new MeshBasicMaterial({ color: 0xffb020, depthTest: false });
  private authorPathMaterial = new LineBasicMaterial({ color: 0xffb020, depthTest: false });
  private authorWaypoints: AuthorWaypointHandle[] = [];
  private authorPathLines = new Map<LinkConfig, Line>();
  private authorPathsVisible = false;
  private preparation = 0;
  private disposed = false;
  private walkFallbackReason: string | null = null;
  private position = new Vector3();
  private transition: {
    from: NodeConfig;
    to: NodeConfig;
    elapsed: number;
    duration: number;
    path: TransitionPathSampler;
    progress: number;
    manualProgress: number | null;
    resolve: () => void;
  } | null = null;

  /** Called when a transition lands on a node (after promote). */
  onArrive: ((nodeId: string, from: string | null) => void) | null = null;
  /** Full-frame curtain used by fade transitions. */
  onFade: ((opacity: number) => void) | null = null;
  /** Load optional configurable-object layers before a projection slot becomes visible. */
  onPrepareProjectionSlot: ((slot: "a" | "b", nodeId: string) => Promise<void>) | null = null;
  /** Promote optional projection layers at the same instant as panorama B. */
  onPromoteProjectionSlots: (() => void) | null = null;
  /** Lets the engine leave a spatial overview before a marker starts navigation. */
  onNavigateRequested: ((nodeId: string) => void) | null = null;
  /** Compile/upload bridge resources before transitionstart. */
  onPrepareTransition: (() => Promise<void> | void) | null = null;
  /** Show and fade baked bridge coverage only during a walk. */
  onTransitionProgress: ((progress: number, bridgeActive: boolean) => void) | null = null;
  /** Keeps alternate camera rigs (for example WebXR) aligned with navigation. */
  onPositionChange: ((position: Vector3) => void) | null = null;

  constructor(
    scene: Scene,
    camera: PerspectiveCamera,
    events: TourEventEmitter,
    assets: AssetManager,
    projection: PanoramaProjection,
    visibility: PanoramaVisibilityMap,
    interaction: InteractionManager,
    config: TourConfig,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.events = events;
    this.assets = assets;
    this.projection = projection;
    this.visibility = visibility;
    this.interaction = interaction;
    this.config = config;
    this.authorPathGroup.name = "meshtour_author_paths";
    this.authorPathGroup.visible = false;
    this.authorPathGroup.renderOrder = 8;
    this.scene.add(this.authorPathGroup);
    this.buildLinkDiscs();
    this.buildAuthorPaths();
  }

  setWalkFallback(reason: string | null): void {
    this.walkFallbackReason = reason;
  }

  private buildLinkDiscs(): void {
    this.buildLinkGroup(null, this.config.links);
    for (const node of this.config.nodes) {
      this.buildLinkGroup(node.id, node.links);
    }
  }

  private buildLinkGroup(fromNodeId: string | null, links: LinkConfig[]): void {
    const group = new Group();
    group.name = fromNodeId === null ? "meshtour_shared_links" : `meshtour_links_${fromNodeId}`;
    group.visible = false;
    this.scene.add(group);
    this.linkGroups.set(fromNodeId, group);

    for (const link of links) {
      const material = new MeshBasicMaterial({
        map: this.discTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.95,
      });
      const mesh = new Mesh(new CircleGeometry(0.28, 48), material);
      mesh.name = `meshtour_link_${fromNodeId ?? "shared"}_to_${link.to}`;
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.fromArray(link.position);
      mesh.position.y += 0.015; // avoid z-fighting with the floor
      mesh.renderOrder = 4;
      group.add(mesh);

      const disc: LinkDisc = {
        fromNodeId,
        link,
        mesh,
        material,
        targetScale: 1,
        unregister: () => {},
      };
      disc.unregister = this.interaction.registerPickable({
        object: mesh,
        onClick: () => {
          if (this.onNavigateRequested) this.onNavigateRequested(link.to);
          else void this.goToNode(link.to);
        },
        onHoverChange: (hovered) => {
          disc.targetScale = hovered ? 1.25 : 1;
        },
      });
      this.discs.push(disc);
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

  getPosition(target = new Vector3()): Vector3 {
    return target.copy(this.position);
  }

  private setPosition(position: Vector3): void {
    this.position.copy(position);
    if (this.onPositionChange) this.onPositionChange(this.position);
    else this.camera.position.copy(position);
  }

  isTransitioning(): boolean {
    return this.transition !== null;
  }

  /** Place the camera at a node with no animation (initial load). */
  async setCurrentNode(nodeId: string): Promise<void> {
    const node = this.node(nodeId);
    const texture = await this.assets.ensureBest(nodeId);
    await this.onPrepareProjectionSlot?.("a", nodeId);
    this.assets.preupload(texture);
    const center = new Vector3().fromArray(node.position);
    const depth =
      this.config.rendering.transition === "walk" ? await this.depthFor(node, center) : undefined;
    this.projection.setSlotA(texture, center, node.panorama.yaw, depth, node.panorama.correction);
    this.projection.setBlend(0);
    this.onFade?.(0);
    this.setPosition(center);
    const from = this.currentNodeId;
    this.currentNodeId = nodeId;
    this.updateLinkVisibility();
    this.onArrive?.(nodeId, from);
    this.events.emit("nodechange", { from, to: nodeId });
  }

  async goToNode(nodeId: string, options: TransitionOptions = {}): Promise<void> {
    if (this.transition || nodeId === this.currentNodeId) return;
    try {
      const preparation = ++this.preparation;
      const preparationStart = performance.now();
      const duration = options.duration ?? DEFAULT_DURATION;
      if (
        this.currentNodeId === null ||
        options.instant ||
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        await this.setCurrentNode(nodeId);
        return;
      }

      const from = this.node(this.currentNodeId);
      const to = this.node(nodeId);

      // Upload the target texture *before* the move starts — never mid-flight.
      const texture = await this.assets.ensureBest(nodeId);
      await this.onPrepareProjectionSlot?.("b", nodeId);
      if (this.transition || preparation !== this.preparation) return;
      this.assets.preupload(texture);

      const targetCenter = new Vector3().fromArray(to.position);
      const depth =
        this.config.rendering.transition === "walk"
          ? await this.depthFor(to, targetCenter)
          : undefined;
      if (this.transition || preparation !== this.preparation) return;
      this.projection.setSlotB(
        texture,
        targetCenter,
        to.panorama.yaw,
        depth,
        to.panorama.correction,
      );
      if (this.config.rendering.transition === "walk" && !this.walkFallbackReason) {
        await this.onPrepareTransition?.();
      }
      if (this.transition || preparation !== this.preparation) return;
      this.hideLinksDuringTransition();
      this.interaction.setEnabled(false);
      const useWalk = this.config.rendering.transition === "walk" && !this.walkFallbackReason;
      this.onTransitionProgress?.(0, useWalk);
      if (this.walkFallbackReason && this.config.rendering.transition === "walk") {
        console.warn(
          `MeshTour walk ${from.id} → ${to.id} is using fade fallback: ${this.walkFallbackReason}`,
        );
      }
      this.events.emit("transitionprepare", {
        from: from.id,
        to: to.id,
        durationMs: performance.now() - preparationStart,
      });
      let resolveTransition!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveTransition = resolve;
      });
      this.transition = {
        from,
        to,
        elapsed: 0,
        duration,
        path: this.pathFor(from, to),
        progress: 0,
        manualProgress: null,
        resolve: resolveTransition,
      };
      this.events.emit("transitionstart", { from: from.id, to: to.id });
      await completion;
    } catch (error) {
      if (this.disposed) return;
      throw error;
    }
  }

  private async depthFor(node: NodeConfig, center: Vector3) {
    const offline = await this.assets.ensureDepth(node.id);
    if (offline) {
      this.assets.preupload(offline);
      return offline;
    }
    return this.visibility.capture(node.id, center);
  }

  private pathFor(from: NodeConfig, to: NodeConfig): TransitionPathSampler {
    return createTransitionPath(from.position, to.position, resolveTransitionWaypoints(from, to));
  }

  private hideLinksDuringTransition(): void {
    for (const group of this.linkGroups.values()) group.visible = false;
  }

  private updateLinkVisibility(): void {
    for (const [nodeId, group] of this.linkGroups) {
      group.visible =
        this.markersVisible &&
        (nodeId === null || this.showAllMarkers || nodeId === this.currentNodeId);
    }
    for (const disc of this.discs) {
      const hideAtTarget = disc.link.hideAtTarget ?? true;
      disc.mesh.visible = !(
        disc.fromNodeId === null &&
        !this.showCurrentSharedMarker &&
        hideAtTarget &&
        disc.link.to === this.currentNodeId
      );
    }
  }

  /** Spatial overviews expose the complete navigation graph; panorama shows only local links. */
  setMarkersVisible(visible: boolean, showAll = false, showCurrentShared = false): void {
    this.markersVisible = visible;
    this.showAllMarkers = showAll;
    this.showCurrentSharedMarker = showCurrentShared;
    this.updateLinkVisibility();
  }

  update(dt: number): void {
    for (const disc of this.discs) {
      const s = lerp(disc.mesh.scale.x, disc.targetScale, Math.min(1, dt * 12));
      disc.mesh.scale.setScalar(s);
    }

    const transition = this.transition;
    if (!transition) return;

    if (transition.manualProgress === null) transition.elapsed += dt;
    const t = transition.manualProgress ?? Math.min(1, transition.elapsed / transition.duration);
    this.applyTransitionProgress(transition, t, transition.manualProgress === null);
  }

  private applyTransitionProgress(
    transition: NonNullable<NavigationManager["transition"]>,
    t: number,
    completeAtEnd: boolean,
  ) {
    transition.progress = t;
    const fadeTransition =
      this.config.rendering.transition === "fade" || this.walkFallbackReason !== null;
    const travel = fadeTransition ? smoothstep(0.42, 0.58, t) : easeInOutCubic(t);

    transition.path.getPointAt(travel, this.position);
    this.setPosition(this.position);
    if (fadeTransition) {
      this.projection.setBlend(t < 0.5 ? 0 : 1);
      const fade = t < 0.42 ? smoothstep(0, 0.42, t) : t <= 0.58 ? 1 : 1 - smoothstep(0.58, 1, t);
      this.onFade?.(fade);
    } else {
      this.projection.setBlend(transitionBlend(t, transition.duration));
      this.onFade?.(0);
    }
    this.onTransitionProgress?.(t, !fadeTransition);

    if (t >= 1 && completeAtEnd) {
      this.projection.promoteBToA();
      this.onPromoteProjectionSlots?.();
      this.onTransitionProgress?.(1, false);
      this.onFade?.(0);
      const fromId = transition.from.id;
      const toId = transition.to.id;
      this.currentNodeId = toId;
      this.transition = null;
      this.interaction.setEnabled(true);
      this.updateLinkVisibility();
      this.onArrive?.(toId, fromId);
      this.events.emit("nodechange", { from: fromId, to: toId });
      this.events.emit("transitionend", { from: fromId, to: toId });
      transition.resolve();
    }
  }

  /** Internal author/test clock. Not re-exported from the package entry point. */
  setTransitionProgress(progress: number, freeze = true): boolean {
    const transition = this.transition;
    if (!transition) return false;
    const value = Math.min(1, Math.max(0, progress));
    transition.elapsed = value * transition.duration;
    transition.manualProgress = freeze ? value : null;
    this.applyTransitionProgress(transition, value, false);
    return true;
  }

  completeFrozenTransition(): boolean {
    const transition = this.transition;
    if (!transition) return false;
    this.applyTransitionProgress(transition, 1, true);
    return true;
  }

  resumeTransition(): void {
    if (this.transition) this.transition.manualProgress = null;
  }

  getTransitionSnapshot(): TransitionSnapshot | null {
    const transition = this.transition;
    if (!transition) return null;
    return {
      from: transition.from.id,
      to: transition.to.id,
      progress: transition.progress,
      camera: this.position.toArray(),
      blend: this.projection.uniforms.uBlend.value,
      depthAReady: this.projection.uniforms.uHasDepthA.value > 0.5,
      depthBReady: this.projection.uniforms.uHasDepthB.value > 0.5,
    };
  }

  /** Author mode appends links at runtime. */
  addLinkDisc(fromNodeId: string, to: string, position: [number, number, number]): void {
    const node = this.node(fromNodeId);
    node.links.push({ to, position });
    // Rebuild is cheap at author-mode scale.
    this.rebuild();
  }

  /** Link handles exposed only to the built-in author overlay. */
  getAuthorLinkHandles(): AuthorLinkHandle[] {
    return this.discs.flatMap(({ fromNodeId, link, mesh }) =>
      fromNodeId === null ? [] : [{ fromNodeId, link, mesh }],
    );
  }

  private buildAuthorPaths(): void {
    for (const node of this.config.nodes) {
      for (const link of node.links) {
        if (!link.path) continue;
        link.path.waypoints.forEach((position, index) => {
          const mesh = new Mesh(this.authorWaypointGeometry, this.authorWaypointMaterial);
          mesh.name = `meshtour_waypoint_${node.id}_to_${link.to}_${index}`;
          mesh.position.fromArray(position);
          mesh.visible = this.authorPathsVisible;
          mesh.renderOrder = 9;
          mesh.raycast = () => {};
          this.authorPathGroup.add(mesh);
          this.authorWaypoints.push({ fromNodeId: node.id, link, index, mesh });
        });
        const line = new Line(new BufferGeometry(), this.authorPathMaterial);
        line.name = `meshtour_path_${node.id}_to_${link.to}`;
        line.visible = this.authorPathsVisible;
        line.renderOrder = 8;
        line.raycast = () => {};
        this.authorPathGroup.add(line);
        this.authorPathLines.set(link, line);
        this.refreshAuthorPathLine(node.id, link);
      }
    }
  }

  private refreshAuthorPathLine(fromNodeId: string, link: LinkConfig): void {
    const line = this.authorPathLines.get(link);
    const from = this.node(fromNodeId);
    const to = this.node(link.to);
    if (!line || !link.path) return;
    const sample = createTransitionPath(from.position, to.position, link.path.waypoints);
    const points = Array.from({ length: 33 }, (_, index) => sample.getPointAt(index / 32));
    line.geometry.dispose();
    line.geometry = new BufferGeometry().setFromPoints(points);
  }

  setAuthorPathsVisible(visible: boolean): void {
    this.authorPathsVisible = visible;
    this.authorPathGroup.visible = visible;
    for (const handle of this.authorWaypoints) handle.mesh.visible = visible;
    for (const line of this.authorPathLines.values()) line.visible = visible;
  }

  getAuthorWaypointHandles(): AuthorWaypointHandle[] {
    return this.authorWaypoints;
  }

  updateWaypointPosition(handle: AuthorWaypointHandle, position: [number, number, number]): void {
    const path = handle.link.path;
    if (!path?.waypoints[handle.index]) return;
    path.waypoints[handle.index] = position;
    handle.mesh.position.fromArray(position);
    this.refreshAuthorPathLine(handle.fromNodeId, handle.link);
  }

  /** Move an authored link without rebuilding every navigation marker. */
  updateLinkPosition(link: LinkConfig, position: [number, number, number]): void {
    link.position = position;
    const disc = this.discs.find((entry) => entry.link === link);
    if (!disc) return;
    disc.mesh.position.fromArray(position);
    disc.mesh.position.y += 0.015;
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
    for (const line of this.authorPathLines.values()) line.geometry.dispose();
    this.authorPathLines.clear();
    this.authorWaypoints = [];
    this.authorPathGroup.clear();
    this.buildLinkDiscs();
    this.buildAuthorPaths();
    this.updateLinkVisibility();
  }

  dispose(): void {
    this.disposed = true;
    this.preparation += 1;
    const transition = this.transition;
    this.transition = null;
    transition?.resolve();
    this.onFade?.(0);
    this.interaction.setEnabled(true);
    for (const disc of this.discs) {
      disc.unregister();
      disc.mesh.removeFromParent();
      disc.material.dispose();
      disc.mesh.geometry.dispose();
    }
    this.discs = [];
    for (const group of this.linkGroups.values()) group.removeFromParent();
    this.linkGroups.clear();
    for (const line of this.authorPathLines.values()) line.geometry.dispose();
    this.authorPathLines.clear();
    this.authorWaypoints = [];
    this.authorPathGroup.removeFromParent();
    this.authorWaypointGeometry.dispose();
    this.authorWaypointMaterial.dispose();
    this.authorPathMaterial.dispose();
    this.discTexture.dispose();
  }
}
