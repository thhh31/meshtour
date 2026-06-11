import {
  BackSide,
  Mesh,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { AuthorMode } from "../author/AuthorMode";
import { loadConfig } from "../config/loader";
import type { TourConfig, TourConfigInput } from "../config/schema";
import { LookControls } from "../controls/LookControls";
import { TourEventEmitter, type TourEventMap } from "../events";
import { HotspotLayer } from "../interaction/HotspotLayer";
import { InteractionManager } from "../interaction/InteractionManager";
import { NavigationManager, type TransitionOptions } from "../navigation/NavigationManager";
import { PanoramaProjection } from "../rendering/PanoramaMaterial";
import { AssetManager } from "./AssetManager";

export type TourEngineState = "idle" | "loading" | "ready" | "transitioning" | "error";

export interface TourEngineOptions {
  /** Element the canvas (and HTML overlay) is mounted into. */
  container: HTMLElement;
  /** Tour config URL or inline object. */
  config: string | TourConfigInput;
  /** Override the config's `start` node. */
  initialNode?: string;
  /** Enable the author/debug overlay. */
  authorMode?: boolean;
  /**
   * Provide the proxy mesh directly instead of loading `assets.mesh` from the
   * config (useful for runtime-generated geometry or custom loaders).
   */
  proxyMesh?: Object3D;
  dracoDecoderPath?: string;
  ktx2TranscoderPath?: string;
  /** Render built-in HTML popups on hotspot click (default true). */
  defaultPopups?: boolean;
  /** Background-prefetch panoramas of linked neighbor nodes (default true). */
  prefetchNeighbors?: boolean;
}

/**
 * The framework-agnostic MeshTour engine: owns the three.js renderer, scene,
 * camera, load lifecycle and state machine, and wires together asset loading,
 * panorama projection, interaction, navigation and author mode.
 */
export class TourEngine {
  readonly events = new TourEventEmitter();

  private options: TourEngineOptions;
  private container: HTMLElement;
  private overlay: HTMLElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private projection = new PanoramaProjection();
  private controls: LookControls;
  private interaction: InteractionManager | null = null;
  private hotspots: HotspotLayer | null = null;
  private navigation: NavigationManager | null = null;
  private assets: AssetManager | null = null;
  private authorOverlay: AuthorMode | null = null;
  private config: TourConfig | null = null;
  private proxyRoot: Object3D | null = null;
  private proxyMeshes: Mesh[] = [];
  private skysphere: Mesh | null = null;
  private resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private lastTime = 0;
  private disposed = false;
  private internalState: TourEngineState = "idle";

  constructor(options: TourEngineOptions) {
    this.options = options;
    this.container = options.container;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%";
    if (getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }
    this.container.appendChild(canvas);

    this.overlay = document.createElement("div");
    this.overlay.className = "meshtour-overlay";
    this.overlay.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1";
    this.container.appendChild(this.overlay);

    this.camera = new PerspectiveCamera(75, 1, 0.05, 1000);
    this.controls = new LookControls(this.camera, canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  get state(): TourEngineState {
    if (this.internalState === "ready" && this.navigation?.isTransitioning()) {
      return "transitioning";
    }
    return this.internalState;
  }

  /** Escape hatches for advanced integrations. */
  getRenderer(): WebGLRenderer {
    return this.renderer;
  }
  getScene(): Scene {
    return this.scene;
  }
  getCamera(): PerspectiveCamera {
    return this.camera;
  }
  getConfig(): TourConfig | null {
    return this.config;
  }

  async start(): Promise<void> {
    if (this.internalState !== "idle") return;
    this.internalState = "loading";
    try {
      this.events.emit("loadprogress", { progress: 0.05 });
      const config = await loadConfig(this.options.config);
      this.config = config;
      this.projection.setBackground(config.rendering.background);
      this.renderer.setClearColor(config.rendering.background);

      this.assets = new AssetManager(this.renderer, config, {
        dracoDecoderPath: this.options.dracoDecoderPath,
        ktx2TranscoderPath: this.options.ktx2TranscoderPath,
      });
      this.assets.onTextureUpgraded = (_nodeId, previous, next) => {
        this.assets?.preupload(next);
        this.projection.replaceTexture(previous, next);
      };

      this.events.emit("loadprogress", { progress: 0.15 });
      this.proxyRoot = this.options.proxyMesh ?? (await this.assets.loadProxyMesh());
      this.events.emit("loadprogress", { progress: 0.5 });
      this.setupProxy(config);
      this.setupSkysphere();

      this.interaction = new InteractionManager(
        this.camera,
        this.scene,
        this.renderer.domElement,
        this.events,
        config,
      );
      this.interaction.setProxyMesh(this.proxyRoot, config.interactables.namePrefix);

      this.hotspots = new HotspotLayer(
        this.scene,
        this.camera,
        this.overlay,
        this.events,
        this.interaction,
        config,
        this.options.defaultPopups ?? true,
      );
      this.hotspots.setProxyMeshes(this.proxyMeshes);

      this.navigation = new NavigationManager(
        this.scene,
        this.camera,
        this.events,
        this.assets,
        this.projection,
        this.interaction,
        config,
      );
      this.navigation.onArrive = (nodeId) => this.onArrive(nodeId);

      const startNode = this.options.initialNode ?? config.start ?? config.nodes[0]!.id;
      await this.navigation.setCurrentNode(startNode);
      this.events.emit("loadprogress", { progress: 0.95 });

      const node = config.nodes.find((n) => n.id === startNode)!;
      if (node.initialView) {
        this.controls.setYawPitch(node.initialView.yaw, node.initialView.pitch);
      }

      if (this.options.authorMode) this.setAuthorMode(true);

      this.internalState = "ready";
      this.lastTime = performance.now();
      this.loop();
      this.events.emit("loadprogress", { progress: 1 });
      this.events.emit("ready", undefined);
    } catch (cause) {
      this.internalState = "error";
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.events.emit("error", { error });
      throw error;
    }
  }

  private setupProxy(config: TourConfig): void {
    const root = this.proxyRoot!;
    const material = this.projection.createMaterial();
    this.proxyMeshes = [];
    root.traverse((object) => {
      if ((object as Mesh).isMesh) {
        const mesh = object as Mesh;
        mesh.material = material;
        this.proxyMeshes.push(mesh);
      }
    });
    if (this.proxyMeshes.length === 0) {
      throw new Error("Proxy mesh contains no geometry");
    }
    void config;
    this.scene.add(root);
  }

  private setupSkysphere(): void {
    // Fallback for rays that miss the proxy mesh (windows, sky, missing
    // geometry): a large sphere that follows the camera, rendered first.
    const material = this.projection.createMaterial({ side: BackSide, depthWrite: false });
    this.skysphere = new Mesh(new SphereGeometry(150, 48, 24), material);
    this.skysphere.renderOrder = -1;
    this.skysphere.frustumCulled = false;
    this.skysphere.raycast = () => {};
    this.scene.add(this.skysphere);
  }

  private onArrive(nodeId: string): void {
    if (!this.config || !this.assets || !this.hotspots) return;
    this.hotspots.setCurrentNode(nodeId);
    if (this.options.prefetchNeighbors ?? true) {
      this.assets.prefetchNeighbors(nodeId);
    }
    const node = this.config.nodes.find((n) => n.id === nodeId)!;
    const keep = new Set<string>([nodeId, ...node.links.map((l) => l.to)]);
    this.assets.releaseExcept(keep);
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    this.controls.update(dt);
    this.navigation?.update(dt);
    this.interaction?.update();
    this.hotspots?.update(dt);
    this.authorOverlay?.update();
    this.skysphere?.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  };

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  // --- Public imperative API -------------------------------------------------

  on<K extends keyof TourEventMap>(event: K, listener: (payload: TourEventMap[K]) => void) {
    return this.events.on(event, listener);
  }
  once<K extends keyof TourEventMap>(event: K, listener: (payload: TourEventMap[K]) => void) {
    return this.events.once(event, listener);
  }
  off<K extends keyof TourEventMap>(event: K, listener: (payload: TourEventMap[K]) => void) {
    this.events.off(event, listener);
  }

  async goToNode(nodeId: string, options?: TransitionOptions): Promise<void> {
    if (!this.navigation) throw new Error("Engine not started");
    await this.navigation.goToNode(nodeId, options);
  }

  getCurrentNode(): string | null {
    return this.navigation?.getCurrentNodeId() ?? null;
  }

  lookAt(target: [number, number, number] | Vector3): void {
    const vec = Array.isArray(target) ? new Vector3().fromArray(target) : target;
    this.controls.lookAt(vec);
  }

  getView(): { yaw: number; pitch: number } {
    return { yaw: this.controls.yaw, pitch: this.controls.pitch };
  }

  setView(yaw: number, pitch: number): void {
    this.controls.setYawPitch(yaw, pitch);
  }

  setHotspotsVisible(visible: boolean): void {
    this.hotspots?.setVisible(visible);
  }

  /** Project a world position to container pixel coordinates (for custom HTML UIs). */
  worldToScreen(position: [number, number, number]): { x: number; y: number; visible: boolean } {
    const projected = new Vector3().fromArray(position).project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - projected.y) / 2) * this.container.clientHeight,
      visible: projected.z <= 1 && Math.abs(projected.x) <= 1.2 && Math.abs(projected.y) <= 1.2,
    };
  }

  setAuthorMode(enabled: boolean): void {
    if (enabled && !this.authorOverlay) {
      if (!this.config || !this.interaction || !this.hotspots || !this.navigation) {
        this.options.authorMode = true; // applied once start() completes
        return;
      }
      this.authorOverlay = new AuthorMode({
        config: this.config,
        camera: this.camera,
        overlay: this.overlay,
        canvas: this.renderer.domElement,
        controls: this.controls,
        interaction: this.interaction,
        hotspots: this.hotspots,
        navigation: this.navigation,
        projection: this.projection,
        proxyRoot: this.proxyRoot,
        proxyMeshes: this.proxyMeshes,
      });
    } else if (!enabled && this.authorOverlay) {
      this.authorOverlay.dispose();
      this.authorOverlay = null;
    }
  }

  isAuthorMode(): boolean {
    return this.authorOverlay !== null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.authorOverlay?.dispose();
    this.hotspots?.dispose();
    this.navigation?.dispose();
    this.interaction?.dispose();
    this.assets?.dispose();
    this.controls.dispose();
    this.projection.dispose();
    this.skysphere?.geometry.dispose();
    this.events.removeAllListeners();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.overlay.remove();
  }
}
