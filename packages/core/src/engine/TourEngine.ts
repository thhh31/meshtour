import {
  BackSide,
  Box3,
  BoxGeometry,
  Camera,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Material,
  type Texture,
} from "three";
import { AuthorMode } from "../author/AuthorMode";
import { loadConfig } from "../config/loader";
import type { TourConfig, TourConfigInput } from "../config/schema";
import { LookControls } from "../controls/LookControls";
import { TopViewControls } from "../controls/TopViewControls";
import { TourEventEmitter, type TourEventMap } from "../events";
import { HotspotLayer } from "../interaction/HotspotLayer";
import { InteractionManager } from "../interaction/InteractionManager";
import { NavigationManager, type TransitionOptions } from "../navigation/NavigationManager";
import { PanoramaProjection } from "../rendering/PanoramaMaterial";
import { PanoramaVisibilityMap } from "../rendering/PanoramaVisibilityMap";
import { MeasurementLayer } from "../spatial/MeasurementLayer";
import { smoothstep } from "../utils/math";
import {
  renderProxyPlan,
  resolvePlanBounds,
  type PlanRenderOptions,
} from "../spatial/PlanRenderer";
import { AssetManager } from "./AssetManager";
import { VariantManager } from "./VariantManager";

export type TourEngineState = "idle" | "loading" | "ready" | "transitioning" | "error";
export type TourViewMode = "panorama" | "top";

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
  private transitionCurtain: HTMLElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera: PerspectiveCamera;
  private topCamera = new OrthographicCamera(-5, 5, 5, -5, 0.05, 1000);
  private projection = new PanoramaProjection();
  private visibility: PanoramaVisibilityMap | null = null;
  private controls: LookControls;
  private topControls: TopViewControls;
  private interaction: InteractionManager | null = null;
  private hotspots: HotspotLayer | null = null;
  private navigation: NavigationManager | null = null;
  private assets: AssetManager | null = null;
  private variants: VariantManager | null = null;
  private authorOverlay: AuthorMode | null = null;
  private measurements: MeasurementLayer | null = null;
  private config: TourConfig | null = null;
  private proxyRoot: Object3D | null = null;
  private visibilityRoot: Object3D | null = null;
  private bridgeRoot: Object3D | null = null;
  private bridgeMaterials: Array<{ material: MeshBasicMaterial; opacity: number }> = [];
  private bridgeFallbackReason: string | null = null;
  private proxyMeshes: Mesh[] = [];
  private overviewMaterial: Material | null = null;
  private panoramaMaterials = new Map<Mesh, Material | Material[]>();
  private overviewVisibility = new Map<Object3D, boolean>();
  private overviewHiddenObjects: Object3D[] = [];
  private generatedCeiling: Mesh | null = null;
  private topViewMesh: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  private topViewUrl: string | null = null;
  private topViewTextureReady = false;
  private topViewLoadToken = 0;
  private proxyRootVisibilityBeforeTop = true;
  private skysphere: Mesh | null = null;
  private resizeObserver: ResizeObserver;
  private animationFrame = 0;
  private lastTime = 0;
  private lastFrameMs = 0;
  private disposed = false;
  private internalState: TourEngineState = "idle";
  private viewMode: TourViewMode = "panorama";
  private hotspotsRequestedVisible = true;
  private pendingTextureUpgrades: Array<{ nodeId: string; previous: Texture; next: Texture }> = [];

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

    this.transitionCurtain = document.createElement("div");
    this.transitionCurtain.className = "meshtour-transition-curtain";
    this.transitionCurtain.style.cssText =
      "position:absolute;inset:0;pointer-events:none;opacity:0;z-index:3;will-change:opacity;background:#0b0b0e";
    this.container.appendChild(this.transitionCurtain);

    this.overlay = document.createElement("div");
    this.overlay.className = "meshtour-overlay";
    this.overlay.style.cssText =
      "position:absolute;inset:0;overflow:hidden;pointer-events:none;z-index:1";
    this.container.appendChild(this.overlay);

    this.camera = new PerspectiveCamera(75, 1, 0.05, 1000);
    this.controls = new LookControls(this.camera, canvas);
    this.topControls = new TopViewControls(this.topCamera, canvas);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();

    // Deliberately symbol-keyed and absent from package exports: visual tests
    // can freeze a transition deterministically without expanding the public API.
    Object.defineProperty(this, Symbol.for("meshtour.transitionTestClock"), {
      configurable: false,
      enumerable: false,
      value: {
        setProgress: (progress: number) =>
          this.navigation?.setTransitionProgress(progress) ?? false,
        complete: () => this.navigation?.completeFrozenTransition() ?? false,
        resume: () => this.navigation?.resumeTransition(),
        snapshot: () => {
          const transition = this.navigation?.getTransitionSnapshot() ?? null;
          if (!transition) return null;
          return {
            ...transition,
            renderer: this.renderer.capabilities.isWebGL2 ? "webgl2" : "webgl1",
            devicePixelRatio: this.renderer.getPixelRatio(),
            frameTimeMs: this.lastFrameMs,
            gpuTextures: this.renderer.info.memory.textures,
            gpuGeometries: this.renderer.info.memory.geometries,
          };
        },
        renderFrame: () => this.renderer.render(this.scene, this.getActiveCamera()),
      },
    });
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
  getActiveCamera(): Camera {
    return this.viewMode === "top" ? this.topCamera : this.camera;
  }
  getContainer(): HTMLElement {
    return this.container;
  }
  getConfig(): TourConfig | null {
    return this.config;
  }

  async start(): Promise<void> {
    if (this.internalState !== "idle" || this.disposed) return;
    this.internalState = "loading";
    try {
      this.events.emit("loadprogress", { progress: 0.05 });
      const config = await loadConfig(this.options.config);
      this.ensureActive();
      this.config = config;
      this.projection.setBackground(config.rendering.background);
      this.renderer.setClearColor(config.rendering.background);
      this.transitionCurtain.style.background = config.rendering.background;

      this.assets = new AssetManager(this.renderer, config, {
        dracoDecoderPath: this.options.dracoDecoderPath,
        ktx2TranscoderPath: this.options.ktx2TranscoderPath,
      });
      this.assets.onTextureUpgraded = (nodeId, previous, next) => {
        if (this.navigation?.isTransitioning()) {
          this.pendingTextureUpgrades.push({ nodeId, previous, next });
          return;
        }
        this.applyTextureUpgrade(nodeId, previous, next);
      };

      const startNode = this.options.initialNode ?? config.start ?? config.nodes[0]!.id;
      this.events.emit("loadprogress", { progress: 0.15 });
      const [proxyRoot, , visibilityRoot, bridgeRoot] = await Promise.all([
        this.options.proxyMesh ?? this.assets.loadProxyMesh(),
        // Mesh decoding and the first panorama are independent. Loading them
        // together removes an avoidable network/decode waterfall on cold starts.
        this.assets.ensureBest(startNode),
        this.assets.loadVisibilityMesh().catch((error) => {
          console.warn(
            `MeshTour could not load transition visibility mesh; using interaction proxy: ${String(error)}`,
          );
          return null;
        }),
        this.assets.loadBridgeMesh().catch((error) => {
          this.bridgeFallbackReason = `bridge asset failed to load (${String(error)})`;
          return null;
        }),
      ]);
      this.proxyRoot = proxyRoot;
      this.visibilityRoot = visibilityRoot;
      this.bridgeRoot = bridgeRoot;
      this.ensureActive();
      this.events.emit("loadprogress", { progress: 0.5 });
      this.ensureCeiling(config);
      this.setupProxy(config);
      if (config.configurables.length > 0) {
        this.variants = new VariantManager(config, this.assets, this.projection, this.proxyRoot);
      }
      this.visibility = new PanoramaVisibilityMap(
        this.renderer,
        this.visibilityRoot ?? this.proxyRoot,
      );
      if (this.bridgeRoot) this.setupBridge(this.bridgeRoot);
      this.setupSkysphere();

      this.interaction = new InteractionManager(
        this.camera,
        this.scene,
        this.renderer.domElement,
        this.events,
        config,
      );
      this.interaction.setProxyMesh(this.proxyRoot, config.interactables.namePrefix);
      this.events.on("interactableclick", ({ id }) => this.measurements?.selectInteractable(id));

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
        this.visibility,
        this.interaction,
        config,
      );
      this.navigation.onArrive = (nodeId) => this.onArrive(nodeId);
      this.navigation.onFade = (opacity) => {
        this.transitionCurtain.style.opacity = String(opacity);
      };
      this.navigation.onPrepareProjectionSlot = (slot, nodeId) =>
        this.variants?.prepareSlot(slot, nodeId) ?? Promise.resolve();
      this.navigation.onPromoteProjectionSlots = () => this.variants?.promoteBToA();
      this.navigation.onNavigateRequested = (nodeId) => void this.goToNode(nodeId);
      this.navigation.onPrepareTransition = () => this.prepareBridge();
      this.navigation.onTransitionProgress = (progress, active) =>
        this.updateBridge(progress, active);
      this.navigation.setWalkFallback(this.bridgeFallbackReason);

      const worldBounds = new Box3().setFromObject(this.proxyRoot);
      const planBounds = resolvePlanBounds(this.proxyRoot, config.spatial.overview.bounds);
      this.topControls.setBounds(
        planBounds,
        config.spatial.overview.floorY,
        worldBounds.isEmpty() ? config.spatial.overview.floorY + 3 : worldBounds.max.y,
      );
      this.setupRenderedTopView(config, planBounds);
      this.measurements = new MeasurementLayer(
        this.scene,
        this.proxyRoot,
        this.overlay,
        this.container,
        () => this.getActiveCamera(),
        config,
      );

      await this.navigation.setCurrentNode(startNode);
      this.ensureActive();
      this.events.emit("loadprogress", { progress: 0.95 });

      const node = config.nodes.find((n) => n.id === startNode)!;
      if (node.initialView) {
        this.controls.setYawPitch(node.initialView.yaw, node.initialView.pitch);
      }

      if (this.options.authorMode) this.setAuthorMode(true);

      this.internalState = "ready";
      this.loadRenderedTopView();
      this.lastTime = performance.now();
      this.loop();
      this.events.emit("loadprogress", { progress: 1 });
      this.events.emit("ready", undefined);
    } catch (cause) {
      if (this.disposed) return;
      this.internalState = "error";
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.events.emit("error", { error });
      throw error;
    }
  }

  private ensureActive(): void {
    if (this.disposed) throw new Error("TourEngine was disposed while starting");
  }

  private applyTextureUpgrade(nodeId: string, previous: Texture, next: Texture): void {
    if (this.projection.replaceTexture(previous, next)) {
      this.assets?.preupload(next);
    }
    // If it was not projected, no material references it; if it was, the
    // replacement above was atomic. Either way the preview can now leave RAM/GPU.
    this.assets?.discardPreview(nodeId, previous);
  }

  private ensureCeiling(config: TourConfig): void {
    const root = this.proxyRoot!;
    let hasCeiling = false;
    root.traverse((object) => {
      if (/(?:ceiling|roof)/i.test(object.name)) {
        hasCeiling = true;
        this.overviewHiddenObjects.push(object);
      }
    });
    const ceiling = config.spatial.overview.ceiling;
    if (hasCeiling || !ceiling) return;
    const [minX, minZ] = ceiling.bounds.min;
    const [maxX, maxZ] = ceiling.bounds.max;
    const mesh = new Mesh(new BoxGeometry(maxX - minX, ceiling.thickness, maxZ - minZ));
    mesh.name = "meshtour_ceiling";
    mesh.position.set((minX + maxX) / 2, ceiling.y + ceiling.thickness / 2, (minZ + maxZ) / 2);
    root.add(mesh);
    this.generatedCeiling = mesh;
    this.overviewHiddenObjects.push(mesh);
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
    const hiddenNames = new Set(config.spatial.overview.hiddenMeshes);
    this.proxyRoot!.traverse((object) => {
      if (hiddenNames.has(object.name) && !this.overviewHiddenObjects.includes(object)) {
        this.overviewHiddenObjects.push(object);
      }
    });
    this.overviewMaterial = this.projection.createMaterial({ sourceVisibility: false });
    this.scene.add(root);
  }

  private setupRenderedTopView(
    config: TourConfig,
    defaultBounds: { min: [number, number]; max: [number, number] },
  ): void {
    const topView = config.spatial.overview.topView;
    if (!topView) return;
    const bounds = topView.bounds ?? defaultBounds;
    const width = bounds.max[0] - bounds.min[0];
    const depth = bounds.max[1] - bounds.min[1];
    const material = new MeshBasicMaterial({
      color: config.rendering.background,
      side: DoubleSide,
    });
    const mesh = new Mesh(new PlaneGeometry(width, depth), material);
    mesh.name = "meshtour_top_view";
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(
      (bounds.min[0] + bounds.max[0]) / 2,
      config.spatial.overview.floorY - 0.03,
      (bounds.min[1] + bounds.max[1]) / 2,
    );
    mesh.visible = false;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.topViewMesh = mesh;
    this.topViewUrl = topView.url;
  }

  private loadRenderedTopView(): void {
    if (!this.topViewMesh || !this.topViewUrl || !this.assets) return;
    const token = ++this.topViewLoadToken;
    void this.assets.ensureAuxiliaryTexture(this.topViewUrl).then(
      (texture) => {
        if (this.disposed || token !== this.topViewLoadToken || !this.topViewMesh) return;
        this.assets?.preupload(texture);
        this.topViewMesh.material.map = texture;
        this.topViewMesh.material.color.set(0xffffff);
        this.topViewMesh.material.needsUpdate = true;
        this.topViewTextureReady = true;
        if (this.viewMode === "top" && this.proxyRoot) {
          this.proxyRoot.visible = false;
          this.topViewMesh.visible = true;
        }
      },
      () => {
        // Keep the projective 3D overview as a backwards-compatible fallback.
      },
    );
  }

  private setupSkysphere(): void {
    // Fallback for rays that miss the proxy mesh (windows, sky, missing
    // geometry): a large sphere that follows the camera, rendered first.
    const material = this.projection.createMaterial({
      side: BackSide,
      depthWrite: false,
      sourceVisibility: false,
    });
    this.skysphere = new Mesh(new SphereGeometry(150, 48, 24), material);
    this.skysphere.renderOrder = -1;
    this.skysphere.frustumCulled = false;
    this.skysphere.raycast = () => {};
    this.scene.add(this.skysphere);
  }

  private setupBridge(root: Object3D): void {
    this.bridgeMaterials = [];
    root.name ||= "meshtour_bridge";
    root.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const mesh = object as Mesh;
      const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const bridgeMaterials = sourceMaterials.map((source) => {
        const candidate = source as MeshBasicMaterial;
        const opacity = candidate.opacity ?? 1;
        const material = new MeshBasicMaterial({
          color: candidate.color ?? 0xffffff,
          map: candidate.map ?? null,
          lightMap: candidate.lightMap ?? null,
          lightMapIntensity: candidate.lightMapIntensity ?? 1,
          aoMap: candidate.aoMap ?? null,
          aoMapIntensity: candidate.aoMapIntensity ?? 1,
          alphaMap: candidate.alphaMap ?? null,
          alphaTest: candidate.alphaTest ?? 0,
          side: candidate.side,
          transparent: true,
          opacity: 0,
          depthTest: true,
          depthWrite: false,
        });
        source.dispose();
        this.bridgeMaterials.push({ material, opacity });
        return material;
      });
      mesh.material = Array.isArray(mesh.material) ? bridgeMaterials : bridgeMaterials[0]!;
      mesh.renderOrder = -0.5;
      mesh.raycast = () => {};
    });
    root.visible = false;
    this.scene.add(root);
  }

  private prepareBridge(): void {
    if (!this.bridgeRoot || !this.assets) return;
    this.bridgeRoot.visible = true;
    for (const entry of this.bridgeMaterials) entry.material.opacity = 0;
    this.assets.preuploadObject(this.bridgeRoot);
    // Compile while transition preparation is still allowed to block.
    this.renderer.compile(this.scene, this.camera);
    this.bridgeRoot.visible = false;
  }

  private updateBridge(progress: number, active: boolean): void {
    if (!this.bridgeRoot) return;
    const opacity = active
      ? Math.min(smoothstep(0, 0.12, progress), 1 - smoothstep(0.88, 1, progress))
      : 0;
    for (const entry of this.bridgeMaterials) {
      entry.material.opacity = opacity * entry.opacity;
    }
    this.bridgeRoot.visible = active && opacity > 0;
  }

  private onArrive(nodeId: string): void {
    if (!this.config || !this.assets || !this.hotspots) return;
    for (const { nodeId, previous, next } of this.pendingTextureUpgrades) {
      this.applyTextureUpgrade(nodeId, previous, next);
    }
    this.pendingTextureUpgrades = [];
    this.hotspots.setCurrentNode(nodeId);
    if (this.options.prefetchNeighbors ?? true) {
      this.assets.prefetchNeighbors(nodeId);
    }
    const node = this.config.nodes.find((n) => n.id === nodeId)!;
    const keep = new Set<string>([
      nodeId,
      ...this.config.links.map((link) => link.to),
      ...node.links.map((link) => link.to),
    ]);
    this.assets.releaseExcept(keep);
    this.visibility?.releaseExcept(keep);
    this.interaction?.invalidate();
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastFrameMs = now - this.lastTime;
    this.lastTime = now;

    const viewMoved = this.controls.update(dt);
    const transitionMoved = this.navigation?.isTransitioning() ?? false;
    this.navigation?.update(dt);
    if (viewMoved || transitionMoved) this.interaction?.invalidate();
    this.interaction?.update();
    this.hotspots?.update(dt);
    this.authorOverlay?.update();
    this.measurements?.update();
    if (this.skysphere) this.skysphere.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.getActiveCamera());
  };

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.topControls.resize(width, height);
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
    if (this.viewMode === "top") this.setViewMode("panorama");
    await this.navigation.goToNode(nodeId, options);
  }

  getCurrentNode(): string | null {
    return this.navigation?.getCurrentNodeId() ?? null;
  }

  lookAt(target: [number, number, number] | Vector3): void {
    const vec = Array.isArray(target) ? new Vector3().fromArray(target) : target;
    this.controls.lookAt(vec);
    this.interaction?.invalidate();
  }

  getView(): { yaw: number; pitch: number } {
    return { yaw: this.controls.yaw, pitch: this.controls.pitch };
  }

  setView(yaw: number, pitch: number): void {
    this.controls.setYawPitch(yaw, pitch);
    this.interaction?.invalidate();
  }

  setHotspotsVisible(visible: boolean): void {
    this.hotspotsRequestedVisible = visible;
    this.hotspots?.setVisible(visible && this.viewMode === "panorama");
  }

  getViewMode(): TourViewMode {
    return this.viewMode;
  }

  setViewMode(mode: TourViewMode): void {
    if (mode === this.viewMode || !this.proxyRoot) return;
    this.viewMode = mode;
    const top = mode === "top";
    this.controls.enabled = !top;
    this.topControls.enabled = top;
    this.interaction?.setCamera(top ? this.topCamera : this.camera);
    this.interaction?.setProxyPickingEnabled(!top);
    const interactive = !(this.navigation?.isTransitioning() ?? false);
    this.interaction?.setEnabled(interactive);
    this.hotspots?.setVisible(!top && this.hotspotsRequestedVisible);
    this.navigation?.setMarkersVisible(interactive, top);
    if (this.skysphere) this.skysphere.visible = !top;

    if (top) {
      this.proxyRootVisibilityBeforeTop = this.proxyRoot.visible;
      this.panoramaMaterials.clear();
      for (const mesh of this.proxyMeshes) {
        this.panoramaMaterials.set(mesh, mesh.material);
        if (this.overviewMaterial) mesh.material = this.overviewMaterial;
      }
      this.overviewVisibility.clear();
      for (const object of this.overviewHiddenObjects) {
        this.overviewVisibility.set(object, object.visible);
        object.visible = false;
      }
      this.topControls.reset();
      if (this.topViewMesh && this.topViewTextureReady) {
        this.proxyRoot.visible = false;
        this.topViewMesh.visible = true;
      }
    } else {
      if (this.topViewMesh) this.topViewMesh.visible = false;
      this.proxyRoot.visible = this.proxyRootVisibilityBeforeTop;
      for (const [mesh, material] of this.panoramaMaterials) mesh.material = material;
      this.panoramaMaterials.clear();
      for (const [object, visible] of this.overviewVisibility) object.visible = visible;
      this.overviewVisibility.clear();
    }
    this.interaction?.invalidate();
    this.events.emit("viewmodechange", { mode });
  }

  getPlanBounds() {
    if (!this.proxyRoot || !this.config) return null;
    return resolvePlanBounds(this.proxyRoot, this.config.spatial.overview.bounds);
  }

  renderPlan(canvas: HTMLCanvasElement, options?: PlanRenderOptions): void {
    if (!this.proxyRoot || !this.config) return;
    renderProxyPlan(this.proxyRoot, canvas, this.getPlanBounds()!, {
      hiddenMeshes: this.config.spatial.overview.hiddenMeshes,
      ...options,
    });
  }

  setMeasurementsVisible(visible: boolean): void {
    if (!this.measurements || this.measurements.isVisible() === visible) return;
    this.measurements.setVisible(visible);
    this.events.emit("measurementschange", { visible });
  }

  areMeasurementsVisible(): boolean {
    return this.measurements?.isVisible() ?? false;
  }

  hasMeasurements(): boolean {
    return this.measurements?.hasTargets() ?? false;
  }

  setMeasurementTarget(interactableId: string): void {
    this.measurements?.selectInteractable(interactableId);
  }

  /** Select a transparent per-node appearance layer for a configurable object. */
  async setVariant(configurableId: string, variantId: string): Promise<void> {
    if (!this.variants) throw new Error("Tour has no configurables");
    const previous = this.variants.getVariant(configurableId);
    await this.variants.setVariant(configurableId, variantId);
    if (previous !== variantId) {
      this.events.emit("variantchange", { configurableId, variantId });
    }
  }

  getVariant(configurableId: string): string | null {
    return this.variants?.getVariant(configurableId) ?? null;
  }

  /** Project a world position to container pixel coordinates (for custom HTML UIs). */
  worldToScreen(position: [number, number, number]): { x: number; y: number; visible: boolean } {
    const camera = this.getActiveCamera();
    camera.updateMatrixWorld();
    const projected = new Vector3().fromArray(position).project(camera);
    return {
      x: ((projected.x + 1) / 2) * this.container.clientWidth,
      y: ((1 - projected.y) / 2) * this.container.clientHeight,
      visible:
        projected.z >= -1 &&
        projected.z <= 1 &&
        Math.abs(projected.x) <= 1.2 &&
        Math.abs(projected.y) <= 1.2,
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
        scene: this.scene,
        visibilityRoot: this.visibilityRoot ?? this.proxyRoot,
        bridgeRoot: this.bridgeRoot,
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
    this.topViewLoadToken += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.authorOverlay?.dispose();
    this.measurements?.dispose();
    this.hotspots?.dispose();
    this.navigation?.dispose();
    this.visibility?.dispose();
    this.interaction?.dispose();
    this.assets?.dispose();
    this.pendingTextureUpgrades = [];
    this.controls.dispose();
    this.topControls.dispose();
    this.projection.dispose();
    this.topViewMesh?.geometry.dispose();
    this.topViewMesh?.material.dispose();
    this.topViewMesh?.removeFromParent();
    this.skysphere?.geometry.dispose();
    this.generatedCeiling?.geometry.dispose();
    this.events.removeAllListeners();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.transitionCurtain.remove();
    this.overlay.remove();
  }
}
