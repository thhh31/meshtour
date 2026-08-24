import {
  BackSide,
  Box3,
  BoxGeometry,
  BufferGeometry,
  Camera,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Material,
  type Texture,
  type XRTargetRaySpace,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { AuthorMode } from "../author/AuthorMode";
import { loadConfig } from "../config/loader";
import {
  ConfigurationController,
  type ConfigurationQuotePayload,
  type ConfigurationState,
} from "../configuration/ConfigurationController";
import type {
  GuideConfig,
  GuideStepConfig,
  GuideViewConfig,
  TourConfig,
  TourConfigInput,
} from "../config/schema";
import { LookControls } from "../controls/LookControls";
import { TopViewControls } from "../controls/TopViewControls";
import { TourEventEmitter, type TourEventMap } from "../events";
import { HotspotLayer } from "../interaction/HotspotLayer";
import { InteractionManager } from "../interaction/InteractionManager";
import { NavigationManager, type TransitionOptions } from "../navigation/NavigationManager";
import {
  createDollhouseMaterial,
  MAX_DOLLHOUSE_SOURCES,
  type DollhouseSource,
  type DollhouseTopView,
} from "../rendering/DollhouseMaterial";
import { PanoramaProjection } from "../rendering/PanoramaMaterial";
import { PanoramaVisibilityMap } from "../rendering/PanoramaVisibilityMap";
import { MeasurementLayer } from "../spatial/MeasurementLayer";
import type { CustomMeasurementState } from "../spatial/customMeasurement";
import { smoothstep } from "../utils/math";
import {
  renderProxyPlan,
  resolvePlanBounds,
  type PlanRenderOptions,
} from "../spatial/PlanRenderer";
import { AssetManager } from "./AssetManager";
import {
  GuidedTourController,
  type GuideState,
  type GuideStepSource,
} from "./GuidedTourController";
import { VariantManager } from "./VariantManager";
import { resolveXRRigPosition, resolveXRRigYaw } from "./xrMath";

export type TourEngineState = "idle" | "loading" | "ready" | "transitioning" | "error";
export type TourViewMode = "panorama" | "top" | "dollhouse";

interface ViewTransition {
  from: "panorama" | "dollhouse";
  to: "panorama" | "dollhouse";
  elapsed: number;
  duration: number;
  arcHeight: number;
  startPosition: Vector3;
  endPosition: Vector3;
  startQuaternion: Quaternion;
  endQuaternion: Quaternion;
  startFov: number;
  endFov: number;
}

interface ViewFadeTransition {
  from: TourViewMode;
  to: TourViewMode;
  elapsed: number;
  duration: number;
  swapped: boolean;
}

interface GuideViewAnimation {
  elapsed: number;
  duration: number;
  startYaw: number;
  startPitch: number;
  yawDelta: number;
  endPitch: number;
  resolve: () => void;
}

export function shortestYawDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export interface EnterVROptions {
  /** Additional WebXR features that must be available. `local-floor` is always required. */
  requiredFeatures?: XRSessionInit["requiredFeatures"];
  /** Optional capabilities requested from the headset. */
  optionalFeatures?: XRSessionInit["optionalFeatures"];
}

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
  private xrRig = new Group();
  private xrControllers: Array<{
    controller: XRTargetRaySpace;
    ray: Line<BufferGeometry, LineBasicMaterial>;
    connected: boolean;
    onSelect: () => void;
    onConnected: () => void;
    onDisconnected: () => void;
  }> = [];
  private vrSession: XRSession | null = null;
  private vrSupported: boolean | null = null;
  private vrViewerOrigin: Vector3 | null = null;
  private vrDesktopView: { yaw: number; pitch: number } | null = null;
  private navigationPosition = new Vector3();
  private scratchPosition = new Vector3();
  private scratchDirection = new Vector3();
  private scratchQuaternion = new Quaternion();
  private topCamera = new OrthographicCamera(-5, 5, 5, -5, 0.05, 1000);
  private dollhouseCamera = new PerspectiveCamera(45, 1, 0.05, 1000);
  private viewTransitionCamera = new PerspectiveCamera(60, 1, 0.025, 1000);
  private viewTransition: ViewTransition | null = null;
  private viewFadeTransition: ViewFadeTransition | null = null;
  private viewTransitionWaiters: Array<() => void> = [];
  private projection = new PanoramaProjection();
  private visibility: PanoramaVisibilityMap | null = null;
  private dollhouseVisibility: PanoramaVisibilityMap | null = null;
  private controls: LookControls;
  private topControls: TopViewControls;
  private dollhouseControls: OrbitControls;
  private interaction: InteractionManager | null = null;
  private hotspots: HotspotLayer | null = null;
  private navigation: NavigationManager | null = null;
  private assets: AssetManager | null = null;
  private variants: VariantManager | null = null;
  private configuration: ConfigurationController | null = null;
  private authorOverlay: AuthorMode | null = null;
  private measurements: MeasurementLayer | null = null;
  private guidedTours: GuidedTourController | null = null;
  private guideViewAnimation: GuideViewAnimation | null = null;
  private guideInteractionAbort = new AbortController();
  private config: TourConfig | null = null;
  private proxyRoot: Object3D | null = null;
  private visibilityRoot: Object3D | null = null;
  private bridgeRoot: Object3D | null = null;
  private dollhouseRoot: Object3D | null = null;
  private dollhouseUsesProxy = true;
  private dollhouseMaterial: ShaderMaterial | null = null;
  private dollhouseSourceIds: string[] = [];
  private dollhousePreferredNodeId: string | null = null;
  private dollhousePanoramaMix = 0;
  private dollhousePreparation: Promise<void> | null = null;
  private dollhouseLoadToken = 0;
  private bridgeMaterials: Array<{ material: MeshBasicMaterial; opacity: number }> = [];
  private bridgeFallbackReason: string | null = null;
  private proxyMeshes: Mesh[] = [];
  private overviewMaterial: ShaderMaterial | null = null;
  private panoramaMaterials = new Map<Mesh, Material | Material[]>();
  private overviewVisibility = new Map<Object3D, boolean>();
  private overviewHiddenObjects: Object3D[] = [];
  private ceilingHiddenObjects = new Set<Object3D>();
  private ceilingMeshes = new Set<Mesh>();
  private ceilingMeshVisibility = new Map<Mesh, boolean>();
  private ceilingFadeMaterials: Material[] = [];
  private ceilingOpacity = 1;
  private dollhouseHiddenObjects: Object3D[] = [];
  private generatedCeiling: Mesh | null = null;
  private topViewMesh: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  private topViewUrl: string | null = null;
  private topViewTextureReady = false;
  private topViewLoadToken = 0;
  private proxyRootVisibilityBeforeSpatial = true;
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
    this.xrRig.name = "meshtour_xr_rig";
    this.scene.add(this.xrRig);
    this.xrRig.add(this.camera);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local-floor");
    this.setupXRControllers();
    this.controls = new LookControls(this.camera, canvas);
    this.topControls = new TopViewControls(this.topCamera, canvas);
    this.dollhouseControls = new OrbitControls(this.dollhouseCamera, canvas);
    this.dollhouseControls.enabled = false;
    this.dollhouseControls.enableDamping = true;
    this.dollhouseControls.dampingFactor = 0.08;
    this.dollhouseControls.screenSpacePanning = false;
    this.dollhouseControls.minPolarAngle = 0.2;
    this.dollhouseControls.maxPolarAngle = Math.PI * 0.48;

    const markGuideExploring = () => this.guidedTours?.markExploring();
    canvas.addEventListener("pointerdown", markGuideExploring, {
      signal: this.guideInteractionAbort.signal,
      capture: true,
    });
    canvas.addEventListener("wheel", markGuideExploring, {
      signal: this.guideInteractionAbort.signal,
      passive: true,
    });

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

  private setupXRControllers(): void {
    for (let index = 0; index < 2; index += 1) {
      const controller = this.renderer.xr.getController(index);
      const rayMaterial = new LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
      });
      const ray = new Line(
        new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]),
        rayMaterial,
      );
      ray.name = `meshtour_xr_ray_${index}`;
      ray.scale.z = 6;
      ray.visible = false;
      ray.raycast = () => {};
      controller.add(ray);
      this.xrRig.add(controller);

      const binding = {
        controller,
        ray,
        connected: false,
        onSelect: () => this.selectFromXRController(controller),
        onConnected: () => {
          binding.connected = true;
          ray.visible = this.isVRActive();
        },
        onDisconnected: () => {
          binding.connected = false;
          ray.visible = false;
        },
      };
      controller.addEventListener("select", binding.onSelect);
      controller.addEventListener("connected", binding.onConnected);
      controller.addEventListener("disconnected", binding.onDisconnected);
      this.xrControllers.push(binding);
    }
  }

  private selectFromXRController(controller: XRTargetRaySpace): void {
    if (!this.vrSession || !this.interaction) return;
    controller.updateMatrixWorld(true);
    const origin = controller.getWorldPosition(this.scratchPosition);
    const direction = this.scratchDirection
      .set(0, 0, -1)
      .applyQuaternion(controller.getWorldQuaternion(this.scratchQuaternion))
      .normalize();
    this.interaction.selectFromRay(origin, direction);
  }

  private updateXRControllerHover(): void {
    if (!this.vrSession || !this.interaction) return;
    const binding = this.xrControllers.find((candidate) => candidate.connected);
    if (!binding) return;
    binding.controller.updateMatrixWorld(true);
    const origin = binding.controller.getWorldPosition(this.scratchPosition);
    const direction = this.scratchDirection
      .set(0, 0, -1)
      .applyQuaternion(binding.controller.getWorldQuaternion(this.scratchQuaternion))
      .normalize();
    this.interaction.updateFromRay(origin, direction);
  }

  private applyNavigationPosition(position: Vector3): void {
    this.navigationPosition.copy(position);
    if (!this.vrSession) {
      this.xrRig.position.set(0, 0, 0);
      this.xrRig.rotation.set(0, 0, 0);
      this.camera.position.copy(position);
      return;
    }

    if (this.vrViewerOrigin) {
      resolveXRRigPosition(
        position,
        this.vrViewerOrigin,
        this.xrRig.quaternion,
        this.xrRig.position,
      );
    } else {
      this.xrRig.position.set(position.x, this.config?.spatial.overview.floorY ?? 0, position.z);
    }
    this.xrRig.updateMatrixWorld(true);
  }

  private calibrateVR(frame: XRFrame): void {
    const referenceSpace = this.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;
    const pose = frame.getViewerPose(referenceSpace);
    if (!pose) return;

    const { position, orientation } = pose.transform;
    this.scratchQuaternion.set(orientation.x, orientation.y, orientation.z, orientation.w);
    this.camera.position.set(position.x, position.y, position.z);
    this.camera.quaternion.copy(this.scratchQuaternion);
    this.camera.updateMatrixWorld(true);
    if (this.vrViewerOrigin) return;
    this.vrViewerOrigin = new Vector3(position.x, position.y, position.z);
    const rigYaw = resolveXRRigYaw(
      this.vrDesktopView?.yaw ?? 0,
      this.scratchQuaternion,
      this.scratchDirection,
    );
    this.xrRig.rotation.set(0, rigYaw, 0);
    this.applyNavigationPosition(this.navigationPosition);
  }

  private finishVRSession = (): void => {
    const session = this.vrSession;
    if (!session) return;
    session.removeEventListener("end", this.finishVRSession);
    this.vrSession = null;
    this.vrViewerOrigin = null;
    if (this.navigation) this.navigation.onPositionChange = null;
    for (const binding of this.xrControllers) binding.ray.visible = false;
    this.xrRig.position.set(0, 0, 0);
    this.xrRig.rotation.set(0, 0, 0);
    this.camera.position.copy(this.navigationPosition);
    const view = this.vrDesktopView;
    this.vrDesktopView = null;
    if (view) this.controls.setYawPitch(view.yaw, view.pitch);
    this.controls.enabled = this.viewMode === "panorama";
    this.interaction?.setEnabled(!(this.navigation?.isTransitioning() ?? false));
    this.interaction?.invalidate();
    this.renderer.setAnimationLoop(null);
    if (!this.disposed) {
      this.lastTime = performance.now();
      this.loop();
    }
    if (!this.disposed) this.events.emit("vrchange", { active: false });
  };

  get state(): TourEngineState {
    if (
      this.internalState === "ready" &&
      (this.viewTransition || this.navigation?.isTransitioning())
    ) {
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
    if (this.viewTransition) return this.viewTransitionCamera;
    if (this.viewMode === "top") return this.topCamera;
    if (this.viewMode === "dollhouse") return this.dollhouseCamera;
    return this.camera;
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
      const [proxyRoot, , visibilityRoot, bridgeRoot, dollhouseRoot] = await Promise.all([
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
        this.assets.loadDollhouseMesh().catch((error) => {
          console.warn(
            `MeshTour could not load the dedicated dollhouse mesh; using the interaction proxy: ${String(error)}`,
          );
          return null;
        }),
      ]);
      this.proxyRoot = proxyRoot;
      this.visibilityRoot = visibilityRoot;
      this.bridgeRoot = bridgeRoot;
      this.dollhouseRoot = dollhouseRoot ?? proxyRoot;
      this.dollhouseUsesProxy = dollhouseRoot === null;
      this.ensureActive();
      this.events.emit("loadprogress", { progress: 0.5 });
      this.ensureCeiling(config);
      this.setupProxy(config);
      if (config.configurables.length > 0) {
        this.variants = new VariantManager(config, this.assets, this.projection, this.proxyRoot);
      }
      if (config.configurator) {
        if (!this.variants) throw new Error("A configurator requires visual configurables");
        this.configuration = new ConfigurationController(config.configurator, {
          applyVariants: (variants) => this.setVariants(variants),
          onStateChange: (configuration, source) => {
            this.events.emit("configurationstatechange", { configuration, source });
          },
        });
      }
      this.visibility = new PanoramaVisibilityMap(
        this.renderer,
        this.visibilityRoot ?? this.proxyRoot,
      );
      if (this.bridgeRoot) this.setupBridge(this.bridgeRoot);
      if (!this.dollhouseUsesProxy && this.dollhouseRoot) {
        this.dollhouseRoot.name ||= "meshtour_dollhouse";
        this.dollhouseRoot.visible = false;
        this.scene.add(this.dollhouseRoot);
      }
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
      this.setupDollhouseCamera(worldBounds, config.spatial.overview.floorY);
      this.setupRenderedTopView(config, planBounds);
      this.measurements = new MeasurementLayer(
        this.scene,
        this.proxyRoot,
        this.overlay,
        this.container,
        () => this.getActiveCamera(),
        config,
      );
      this.interaction.onMeasurementClick = (hit) => {
        if (!this.measurements?.isCustomActive()) return false;
        this.measurements.addCustomPoint(hit.point, hit.normal);
        this.events.emit("custommeasurementchange", {
          measurement: this.measurements.getCustomState(),
        });
        return true;
      };

      await this.navigation.setCurrentNode(startNode);
      this.guidedTours = new GuidedTourController(
        config.guides,
        {
          captureRestoreState: () => ({
            measurementsVisible: this.areMeasurementsVisible(),
            variants: this.getVariantSelections(),
          }),
          applyStep: (step) => this.applyGuideStep(step),
          restoreState: async (state) => {
            await this.setVariants(state.variants);
            this.setMeasurementsVisible(state.measurementsVisible);
          },
        },
        this.events,
      );
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
      void this.checkVRSupport();
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
        this.ceilingHiddenObjects.add(object);
        object.traverse((child) => {
          if ((child as Mesh).isMesh) this.ceilingMeshes.add(child as Mesh);
        });
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
    this.ceilingHiddenObjects.add(mesh);
    this.ceilingMeshes.add(mesh);
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

  private setupDollhouseCamera(worldBounds: Box3, floorY: number): void {
    const bounds = worldBounds.isEmpty()
      ? new Box3(new Vector3(-2, floorY, -2), new Vector3(2, floorY + 3, 2))
      : worldBounds;
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const radius = Math.max(2, size.length() * 0.5);
    const target = new Vector3(center.x, floorY + Math.max(0.5, size.y * 0.32), center.z);
    const direction = new Vector3(0.9, 0.82, 1).normalize();

    this.dollhouseCamera.near = Math.max(0.025, radius / 200);
    this.dollhouseCamera.far = Math.max(100, radius * 20);
    this.dollhouseCamera.position.copy(target).addScaledVector(direction, radius * 2.45);
    this.dollhouseCamera.updateProjectionMatrix();
    this.dollhouseControls.target.copy(target);
    this.dollhouseControls.minDistance = radius * 0.55;
    this.dollhouseControls.maxDistance = radius * 5;
    this.dollhouseControls.update();

    if (!this.dollhouseUsesProxy && this.dollhouseRoot) {
      const hiddenNames = new Set(this.config?.spatial.overview.hiddenMeshes ?? []);
      this.dollhouseRoot.traverse((object) => {
        if (/(?:ceiling|roof)/i.test(object.name) || hiddenNames.has(object.name)) {
          this.dollhouseHiddenObjects.push(object);
        }
      });
    }
  }

  /** Pick spatially distributed capture points when a tour has more sources than the shader cap. */
  private selectDollhouseNodes() {
    const nodes = this.config?.nodes ?? [];
    if (nodes.length <= MAX_DOLLHOUSE_SOURCES) return nodes;
    const currentId = this.navigation?.getCurrentNodeId() ?? this.config?.start;
    const first = nodes.find((node) => node.id === currentId) ?? nodes[0]!;
    const selected = [first];
    const remaining = new Set(nodes.filter((node) => node !== first));
    while (selected.length < MAX_DOLLHOUSE_SOURCES && remaining.size > 0) {
      let best = [...remaining][0]!;
      let bestDistance = -1;
      for (const candidate of remaining) {
        const candidatePosition = new Vector3().fromArray(candidate.position);
        const nearest = Math.min(
          ...selected.map((node) =>
            candidatePosition.distanceToSquared(new Vector3().fromArray(node.position)),
          ),
        );
        if (nearest > bestDistance) {
          best = candidate;
          bestDistance = nearest;
        }
      }
      selected.push(best);
      remaining.delete(best);
    }
    return selected;
  }

  private prepareDollhouse(): Promise<void> {
    if (this.dollhousePreparation) return this.dollhousePreparation;
    if (!this.dollhouseUsesProxy || !this.assets || !this.proxyRoot || !this.config) {
      return Promise.resolve();
    }

    this.dollhouseVisibility ??= new PanoramaVisibilityMap(
      this.renderer,
      this.visibilityRoot ?? this.proxyRoot,
      256,
    );
    const dollhouseVisibility = this.dollhouseVisibility;
    const token = ++this.dollhouseLoadToken;
    const nodes = this.selectDollhouseNodes();
    const sourcePromise = Promise.all(
      nodes.map(async (node): Promise<DollhouseSource> => {
        const center = new Vector3().fromArray(node.position);
        const texture = await this.assets!.ensureDollhousePreview(node.id);
        this.ensureActive();
        const depth = dollhouseVisibility.capture(node.id, center);
        this.assets!.preupload(texture);
        this.assets!.preupload(depth);
        return { nodeId: node.id, texture, depth, center, panorama: node.panorama };
      }),
    );
    const topViewConfig = this.config.spatial.overview.topView;
    const topViewPromise: Promise<DollhouseTopView | undefined> = topViewConfig?.dollhouseProjection
      ? this.assets.ensureAuxiliaryTexture(topViewConfig.url).then((texture) => {
          this.ensureActive();
          this.assets!.preupload(texture);
          return {
            texture,
            bounds:
              topViewConfig.bounds ??
              this.config!.spatial.overview.bounds ??
              resolvePlanBounds(this.proxyRoot!, undefined),
          };
        })
      : Promise.resolve(undefined);
    this.dollhousePreparation = Promise.all([sourcePromise, topViewPromise])
      .then(async ([sources, topView]) => {
        if (this.disposed || token !== this.dollhouseLoadToken || !this.config) return;
        this.dollhouseMaterial?.dispose();
        this.dollhouseMaterial = createDollhouseMaterial(
          sources,
          this.config.rendering.background,
          topView,
        );
        await this.variants?.prepareDollhouseMaterials(this.dollhouseMaterial, sources);
        return { sources };
      })
      .then((prepared) => {
        if (!prepared) return;
        const { sources } = prepared;
        if (this.disposed || token !== this.dollhouseLoadToken || !this.dollhouseMaterial) return;
        this.dollhouseSourceIds = sources.map((source) => source.nodeId);
        this.applyDollhouseTextureBlend();
        if (this.viewMode === "dollhouse") {
          this.applyDollhouseMaterial(this.dollhouseMaterial);
          this.interaction?.invalidate();
        }
      })
      .catch((error) => {
        if (!this.disposed) {
          console.warn(
            `MeshTour could not prepare the multi-panorama dollhouse texture; using the active panorama: ${String(error)}`,
          );
        }
      });
    return this.dollhousePreparation;
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
    this.skysphere.name = "meshtour_panorama_skysphere";
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
    this.tick(performance.now());
  };

  private xrLoop = (time: DOMHighResTimeStamp, frame: XRFrame): void => {
    if (this.disposed) return;
    this.tick(time, frame);
  };

  private beginViewTransition(
    fromCamera: PerspectiveCamera,
    toCamera: PerspectiveCamera,
    from: "panorama" | "dollhouse",
    to: "panorama" | "dollhouse",
  ): boolean {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;

    this.scene.updateMatrixWorld(true);
    const startPosition = fromCamera.getWorldPosition(new Vector3());
    const endPosition = toCamera.getWorldPosition(new Vector3());
    const startQuaternion = fromCamera.getWorldQuaternion(new Quaternion());
    const endQuaternion = toCamera.getWorldQuaternion(new Quaternion());
    const distance = startPosition.distanceTo(endPosition);
    const duration = Math.min(1.85, Math.max(1.25, 1 + distance * 0.045));

    this.viewTransitionCamera.position.copy(startPosition);
    this.viewTransitionCamera.quaternion.copy(startQuaternion);
    this.viewTransitionCamera.fov = fromCamera.fov;
    this.viewTransitionCamera.aspect = toCamera.aspect;
    this.viewTransitionCamera.near = Math.min(fromCamera.near, toCamera.near);
    this.viewTransitionCamera.far = Math.max(fromCamera.far, toCamera.far);
    this.viewTransitionCamera.layers.mask = fromCamera.layers.mask | toCamera.layers.mask;
    this.viewTransitionCamera.updateProjectionMatrix();
    this.viewTransition = {
      from,
      to,
      elapsed: 0,
      duration,
      arcHeight: Math.min(2.2, distance * 0.08),
      startPosition,
      endPosition,
      startQuaternion,
      endQuaternion,
      startFov: fromCamera.fov,
      endFov: toCamera.fov,
    };
    return true;
  }

  private updateViewTransition(dt: number): boolean {
    const transition = this.viewTransition;
    if (!transition) return false;
    transition.elapsed += dt;
    const linear = Math.min(1, transition.elapsed / transition.duration);
    // Quintic smootherstep makes velocity and acceleration reach zero at both ends.
    const eased = linear * linear * linear * (linear * (linear * 6 - 15) + 10);
    this.viewTransitionCamera.position.lerpVectors(
      transition.startPosition,
      transition.endPosition,
      eased,
    );
    this.viewTransitionCamera.position.y += Math.sin(Math.PI * eased) * transition.arcHeight;
    this.viewTransitionCamera.quaternion.slerpQuaternions(
      transition.startQuaternion,
      transition.endQuaternion,
      eased,
    );
    this.viewTransitionCamera.fov =
      transition.startFov + (transition.endFov - transition.startFov) * eased;
    this.viewTransitionCamera.updateProjectionMatrix();
    this.setDollhousePanoramaMix(
      transition.to === "panorama"
        ? smoothstep(0.08, 0.92, eased)
        : 1 - smoothstep(0.08, 0.82, eased),
    );
    this.setCeilingOpacity(
      transition.to === "panorama" ? smoothstep(0.92, 1, linear) : 1 - smoothstep(0, 0.08, linear),
    );
    if (this.skysphere) {
      if (transition.to === "dollhouse") {
        this.skysphere.visible = false;
      } else if (linear >= 1) {
        // The camera is already at the panorama node, so revealing the
        // fallback background here cannot appear behind an external dollhouse.
        this.skysphere.visible = true;
      }
    }
    if (linear < 1) return true;

    this.viewTransition = null;
    if (transition.to === "panorama") this.completePanoramaHandoff();
    else {
      this.setDollhousePanoramaMix(0);
      this.setCeilingOpacity(0);
    }
    this.configureViewInteraction(false);
    this.events.emit("viewtransitionend", { from: transition.from, to: transition.to });
    for (const resolve of this.viewTransitionWaiters.splice(0)) resolve();
    return true;
  }

  private updateViewFadeTransition(dt: number): boolean {
    const transition = this.viewFadeTransition;
    if (!transition) return false;
    transition.elapsed += dt;
    const linear = Math.min(1, transition.elapsed / transition.duration);
    const midpoint = 0.38;
    const opacity =
      linear < midpoint ? smoothstep(0, midpoint, linear) : 1 - smoothstep(midpoint, 1, linear);
    this.transitionCurtain.style.opacity = String(opacity);

    if (!transition.swapped && linear >= midpoint) {
      transition.swapped = true;
      this.applyViewMode(transition.to, true);
    }
    if (linear < 1) return true;

    this.viewFadeTransition = null;
    this.transitionCurtain.style.opacity = "0";
    this.configureViewInteraction(false);
    this.events.emit("viewtransitionend", { from: transition.from, to: transition.to });
    for (const resolve of this.viewTransitionWaiters.splice(0)) resolve();
    return true;
  }

  private configureViewInteraction(animating: boolean): void {
    const panorama = this.viewMode === "panorama";
    const top = this.viewMode === "top";
    const dollhouse = this.viewMode === "dollhouse";
    const interactive = !animating && !(this.navigation?.isTransitioning() ?? false);
    this.controls.enabled = panorama && interactive && !this.vrSession;
    this.topControls.enabled = top && interactive;
    this.dollhouseControls.enabled = dollhouse && interactive;
    this.interaction?.setCamera(this.getActiveCamera());
    this.interaction?.setProxyPickingEnabled(panorama);
    this.interaction?.setEnabled(interactive);
    this.hotspots?.setVisible(panorama && interactive && this.hotspotsRequestedVisible);
    // Spatial overviews are location-neutral: expose the complete graph,
    // including a shared link whose destination happens to be the remembered
    // panorama node.
    this.navigation?.setMarkersVisible(panorama ? interactive : true, !panorama, !panorama);
  }

  private waitForViewTransition(): Promise<void> {
    if (!this.viewTransition && !this.viewFadeTransition) return Promise.resolve();
    return new Promise((resolve) => this.viewTransitionWaiters.push(resolve));
  }

  private setDollhousePreferredNode(nodeId: string | null): void {
    this.dollhousePreferredNodeId = nodeId;
    this.applyDollhouseTextureBlend();
  }

  private setDollhousePanoramaMix(value: number): void {
    this.dollhousePanoramaMix = Math.min(1, Math.max(0, value));
    this.applyDollhouseTextureBlend();
  }

  private applyDollhouseTextureBlend(): void {
    const uniforms = this.dollhouseMaterial?.uniforms;
    if (!uniforms) return;
    uniforms.uPanoramaMix!.value = this.dollhousePanoramaMix;
    this.dollhouseSourceIds.forEach((nodeId, index) => {
      uniforms[`uPreferred${index}`]!.value = nodeId === this.dollhousePreferredNodeId ? 1 : 0;
    });
  }

  private captureCeilingVisibility(): void {
    this.ceilingMeshVisibility.clear();
    for (const mesh of this.ceilingMeshes) {
      this.ceilingMeshVisibility.set(mesh, mesh.visible);
    }
  }

  private applyDollhouseMaterial(material: Material): void {
    for (const mesh of this.proxyMeshes) {
      // While the multi-source compositor is loading, keep the selected
      // current-node layer visible instead of flashing the original finish.
      const configurableMaterial = this.dollhouseMaterial
        ? this.variants?.getDollhouseMaterial(mesh)
        : this.variants?.getPanoramaMaterial(mesh);
      mesh.material = configurableMaterial ?? material;
    }
    this.disposeCeilingFadeMaterials();
    for (const mesh of this.ceilingMeshes) {
      // Keep the ceiling on the settled panorama projection while it fades.
      // The multi-source dollhouse shader may legitimately reject the ceiling
      // as uncovered, which would make it pop out before opacity can animate.
      const sourceMaterial = this.panoramaMaterials.get(mesh) ?? mesh.material;
      const materials = Array.isArray(sourceMaterial) ? sourceMaterial : [sourceMaterial];
      const faded = materials.map((source) => {
        const clone =
          source instanceof ShaderMaterial
            ? new ShaderMaterial({
                uniforms: {
                  ...source.uniforms,
                  uOpacity: { value: this.ceilingOpacity },
                },
                defines: { ...source.defines },
                vertexShader: source.vertexShader,
                fragmentShader: source.fragmentShader,
                glslVersion: source.glslVersion,
                side: source.side,
                depthTest: source.depthTest,
                depthWrite: false,
                transparent: true,
              })
            : source.clone();
        clone.name = `${source.name || source.type}_ceiling_fade`;
        clone.transparent = true;
        clone.depthWrite = false;
        clone.toneMapped = source.toneMapped;
        clone.needsUpdate = true;
        this.ceilingFadeMaterials.push(clone);
        return clone;
      });
      mesh.material = Array.isArray(sourceMaterial) ? faded : faded[0]!;
    }
    this.setCeilingOpacity(this.ceilingOpacity);
  }

  private setCeilingOpacity(value: number): void {
    this.ceilingOpacity = Math.min(1, Math.max(0, value));
    for (const material of this.ceilingFadeMaterials) {
      if (material instanceof ShaderMaterial && material.uniforms.uOpacity) {
        material.uniforms.uOpacity.value = this.ceilingOpacity;
      } else {
        material.opacity = this.ceilingOpacity;
      }
    }
    for (const [mesh, originallyVisible] of this.ceilingMeshVisibility) {
      mesh.visible = originallyVisible && this.ceilingOpacity > 0.001;
    }
  }

  private disposeCeilingFadeMaterials(): void {
    for (const material of this.ceilingFadeMaterials) material.dispose();
    this.ceilingFadeMaterials = [];
  }

  private updateGuideViewAnimation(dt: number): boolean {
    const animation = this.guideViewAnimation;
    if (!animation) return false;
    animation.elapsed += dt;
    const linear = Math.min(1, animation.elapsed / animation.duration);
    const eased = linear * linear * (3 - 2 * linear);
    this.controls.setYawPitch(
      animation.startYaw + animation.yawDelta * eased,
      animation.startPitch + (animation.endPitch - animation.startPitch) * eased,
    );
    if (linear < 1) return true;
    this.guideViewAnimation = null;
    this.configureViewInteraction(false);
    animation.resolve();
    return true;
  }

  private tick(time: DOMHighResTimeStamp, frame?: XRFrame): void {
    if (frame && this.vrSession) this.calibrateVR(frame);
    const dt = Math.min(0.05, (time - this.lastTime) / 1000);
    this.lastFrameMs = time - this.lastTime;
    this.lastTime = time;

    const viewTransitionMoved = this.updateViewTransition(dt);
    const viewFadeTransitionMoved = this.updateViewFadeTransition(dt);
    const guideViewMoved = this.updateGuideViewAnimation(dt);
    const viewMoved = this.controls.update(dt);
    if (this.viewMode === "dollhouse" && !this.viewTransition) {
      this.dollhouseControls.update();
      this.interaction?.invalidate();
    }
    const transitionMoved = this.navigation?.isTransitioning() ?? false;
    this.navigation?.update(dt);
    if (
      viewMoved ||
      guideViewMoved ||
      viewTransitionMoved ||
      viewFadeTransitionMoved ||
      transitionMoved
    ) {
      this.interaction?.invalidate();
    }
    this.interaction?.update();
    this.updateXRControllerHover();
    this.hotspots?.update(dt);
    this.authorOverlay?.update();
    this.measurements?.update(dt);
    if (this.skysphere) this.camera.getWorldPosition(this.skysphere.position);
    this.renderer.render(this.scene, this.getActiveCamera());
  }

  private resize(): void {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dollhouseCamera.aspect = width / height;
    this.dollhouseCamera.updateProjectionMatrix();
    this.viewTransitionCamera.aspect = width / height;
    this.viewTransitionCamera.updateProjectionMatrix();
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

  /** Detect immersive WebXR support. Requires a secure context (HTTPS or localhost). */
  async checkVRSupport(): Promise<boolean> {
    let supported = false;
    try {
      const xr = navigator.xr;
      supported =
        window.isSecureContext &&
        Boolean(xr) &&
        Boolean(await xr?.isSessionSupported("immersive-vr"));
    } catch {
      supported = false;
    }
    if (this.vrSupported !== supported) {
      this.vrSupported = supported;
      if (!this.disposed) this.events.emit("vrsupportchange", { supported });
    }
    return supported;
  }

  getVRSupported(): boolean | null {
    return this.vrSupported;
  }

  isVRActive(): boolean {
    return this.vrSession !== null;
  }

  /** Enter immersive VR. Must be called directly from a user gesture. */
  async enterVR(options: EnterVROptions = {}): Promise<void> {
    if (this.vrSession) return;
    if (this.internalState !== "ready") throw new Error("Engine is not ready");
    if (!(await this.checkVRSupport()) || !navigator.xr) {
      throw new Error("Immersive WebXR is unavailable; use a supported headset browser over HTTPS");
    }

    if (this.viewMode !== "panorama") this.setViewMode("panorama");
    const requiredFeatures = Array.from(
      new Set(["local-floor", ...(options.requiredFeatures ?? [])]),
    );
    const optionalFeatures = Array.from(
      new Set(["bounded-floor", "hand-tracking", ...(options.optionalFeatures ?? [])]),
    );
    const session = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures,
      optionalFeatures,
    });

    this.vrSession = session;
    this.vrViewerOrigin = null;
    this.vrDesktopView = this.getView();
    this.navigation?.getPosition(this.navigationPosition);
    if (this.navigation) {
      this.navigation.onPositionChange = (position) => this.applyNavigationPosition(position);
    }
    this.controls.enabled = false;
    this.interaction?.setEnabled(false);
    this.interaction?.setEnabled(true);
    this.applyNavigationPosition(this.navigationPosition);
    cancelAnimationFrame(this.animationFrame);
    this.renderer.setAnimationLoop(this.xrLoop);
    try {
      await this.renderer.xr.setSession(session);
      session.addEventListener("end", this.finishVRSession);
      for (const binding of this.xrControllers) binding.ray.visible = binding.connected;
      this.events.emit("vrchange", { active: true });
    } catch (error) {
      this.finishVRSession();
      await session.end().catch(() => {});
      this.renderer.setAnimationLoop(null);
      throw error;
    }
  }

  async exitVR(): Promise<void> {
    await this.vrSession?.end();
  }

  async goToNode(nodeId: string, options?: TransitionOptions): Promise<void> {
    this.guidedTours?.markExploring();
    if (!this.navigation) throw new Error("Engine not started");
    if (this.viewMode === "dollhouse") {
      // A dollhouse marker represents the destination itself. Re-anchor the
      // hidden panorama first, then fly directly into that location.
      if (nodeId !== this.navigation.getCurrentNodeId()) {
        await this.navigation.goToNode(nodeId, { ...options, instant: true });
      }
      this.setViewMode("panorama");
      await this.waitForViewTransition();
      return;
    }
    if (this.viewMode !== "panorama") {
      this.setViewMode("panorama");
      await this.waitForViewTransition();
    }
    await this.navigation.goToNode(
      nodeId,
      this.vrSession ? { ...options, instant: options?.instant ?? true } : options,
    );
  }

  getCurrentNode(): string | null {
    return this.navigation?.getCurrentNodeId() ?? null;
  }

  lookAt(target: [number, number, number] | Vector3): void {
    this.guidedTours?.markExploring();
    const vec = Array.isArray(target) ? new Vector3().fromArray(target) : target;
    this.controls.lookAt(vec);
    this.interaction?.invalidate();
  }

  getView(): { yaw: number; pitch: number } {
    return { yaw: this.controls.yaw, pitch: this.controls.pitch };
  }

  setView(yaw: number, pitch: number): void {
    this.guidedTours?.markExploring();
    this.controls.setYawPitch(yaw, pitch);
    this.interaction?.invalidate();
  }

  captureViewSnapshot(): GuideViewConfig {
    const node = this.getCurrentNode();
    if (this.viewMode === "top") {
      const view = this.topControls.getView();
      return { mode: "top", center: view.center, zoom: view.zoom };
    }
    if (this.viewMode === "dollhouse") {
      if (!node) throw new Error("Cannot capture a dollhouse guide view without an anchor node");
      return {
        mode: "dollhouse",
        node,
        position: this.dollhouseCamera.position.toArray(),
        target: this.dollhouseControls.target.toArray(),
        fov: this.dollhouseCamera.fov,
      };
    }
    if (!node) throw new Error("Cannot capture a panorama guide view before the tour is ready");
    return { mode: "panorama", node, yaw: this.controls.yaw, pitch: this.controls.pitch };
  }

  private animatePanoramaView(yaw: number, pitch: number): Promise<void> {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.controls.setYawPitch(yaw, pitch);
      this.interaction?.invalidate();
      return Promise.resolve();
    }
    if (this.guideViewAnimation) {
      this.guideViewAnimation.resolve();
      this.guideViewAnimation = null;
    }
    this.controls.enabled = false;
    return new Promise((resolve) => {
      this.guideViewAnimation = {
        elapsed: 0,
        duration: 0.65,
        startYaw: this.controls.yaw,
        startPitch: this.controls.pitch,
        yawDelta: shortestYawDelta(this.controls.yaw, yaw),
        endPitch: pitch,
        resolve,
      };
    });
  }

  async applyViewSnapshot(view: GuideViewConfig): Promise<void> {
    if (!this.navigation) throw new Error("Engine not started");
    if (this.vrSession) throw new Error("Guided desktop views cannot be applied during WebXR");

    if (view.mode === "panorama") {
      await this.goToNode(view.node);
      await this.animatePanoramaView(view.yaw, view.pitch);
      return;
    }

    if (view.mode === "dollhouse") {
      if (this.getCurrentNode() !== view.node) await this.goToNode(view.node);
      if (this.viewMode !== "dollhouse") {
        this.setViewMode("dollhouse");
        await this.waitForViewTransition();
      }
      this.dollhouseCamera.position.fromArray(view.position);
      this.dollhouseCamera.fov = view.fov;
      this.dollhouseCamera.updateProjectionMatrix();
      this.dollhouseControls.target.fromArray(view.target);
      this.dollhouseControls.update();
      this.interaction?.invalidate();
      return;
    }

    if (this.viewMode !== "top") {
      this.setViewMode("top");
      await this.waitForViewTransition();
    }
    this.topControls.setView(view.center, view.zoom);
    this.interaction?.invalidate();
  }

  getVariantSelections(): Record<string, string> {
    const selections: Record<string, string> = {};
    for (const configurable of this.config?.configurables ?? []) {
      const variant = this.getVariant(configurable.id);
      if (variant) selections[configurable.id] = variant;
    }
    return selections;
  }

  private async applyGuideStep(step: GuideStepConfig): Promise<void> {
    this.setMeasurementsVisible(false);
    await this.setVariants(step.variants);
    await this.applyViewSnapshot(step.view);
    this.setMeasurementsVisible(step.measurementsVisible);
  }

  getGuides(): readonly GuideConfig[] {
    return this.guidedTours?.getGuides() ?? this.config?.guides ?? [];
  }

  getGuideState(): GuideState {
    return (
      this.guidedTours?.getState() ?? {
        guideId: null,
        stepIndex: -1,
        status: "idle",
        autoplay: false,
        error: null,
      }
    );
  }

  async startGuide(guideId: string, stepIndex = 0): Promise<void> {
    if (!this.guidedTours) throw new Error("Engine not started");
    await this.guidedTours.start(guideId, stepIndex);
  }

  async stopGuide(): Promise<void> {
    await this.guidedTours?.stop("close");
  }

  async goToGuideStep(stepIndex: number, source: GuideStepSource = "seek"): Promise<void> {
    if (!this.guidedTours) throw new Error("Engine not started");
    await this.guidedTours.goToStep(stepIndex, source);
  }

  async nextGuideStep(): Promise<void> {
    if (!this.guidedTours) throw new Error("Engine not started");
    await this.guidedTours.next();
  }

  async previousGuideStep(): Promise<void> {
    if (!this.guidedTours) throw new Error("Engine not started");
    await this.guidedTours.previous();
  }

  playGuide(): void {
    this.guidedTours?.play();
  }

  pauseGuide(): void {
    this.guidedTours?.pause("manual");
  }

  async resumeGuide(): Promise<void> {
    if (!this.guidedTours) throw new Error("Engine not started");
    await this.guidedTours.resume();
  }

  triggerGuideAction(): void {
    this.guidedTours?.triggerAction();
  }

  setHotspotsVisible(visible: boolean): void {
    this.hotspotsRequestedVisible = visible;
    this.hotspots?.setVisible(visible && this.viewMode === "panorama" && !this.viewTransition);
  }

  getViewMode(): TourViewMode {
    return this.viewMode;
  }

  setViewMode(mode: TourViewMode): void {
    this.guidedTours?.markExploring();
    if (this.vrSession && mode !== "panorama") return;
    if (mode === this.viewMode || mode === this.viewFadeTransition?.to || !this.proxyRoot) return;
    if (mode !== "panorama" && this.measurements?.isCustomActive()) {
      this.setCustomMeasurementActive(false);
    }

    const topViewChange = mode === "top" || this.viewMode === "top";
    if (topViewChange && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.viewFadeTransition = {
        from: this.viewMode,
        to: mode,
        elapsed: 0,
        duration: 0.72,
        swapped: false,
      };
      this.configureViewInteraction(true);
      this.events.emit("viewtransitionstart", { from: this.viewMode, to: mode });
      return;
    }

    this.applyViewMode(mode);
  }

  private applyViewMode(mode: TourViewMode, holdInteraction = false): void {
    if (mode === this.viewMode || !this.proxyRoot) return;
    const fromCamera = this.getActiveCamera();
    if (this.viewTransition) {
      const interrupted = this.viewTransition;
      this.viewTransition = null;
      if (interrupted.to === "panorama") this.completePanoramaHandoff();
      else {
        this.setDollhousePanoramaMix(0);
        this.setCeilingOpacity(0);
      }
      this.events.emit("viewtransitionend", { from: interrupted.from, to: interrupted.to });
      for (const resolve of this.viewTransitionWaiters.splice(0)) resolve();
    }
    const previousMode = this.viewMode;
    const cameraFlight =
      (previousMode === "panorama" && mode === "dollhouse") ||
      (previousMode === "dollhouse" && mode === "panorama");
    if (previousMode !== "panorama" && !cameraFlight) this.restorePanoramaScene();
    this.viewMode = mode;
    const top = mode === "top";
    const dollhouse = mode === "dollhouse";
    const panorama = mode === "panorama";
    if (this.skysphere) {
      this.skysphere.visible = panorama && !cameraFlight;
    }

    if (cameraFlight) {
      this.setDollhousePreferredNode(this.navigation?.getCurrentNodeId() ?? null);
      this.setDollhousePanoramaMix(previousMode === "panorama" ? 1 : 0);
      if (previousMode === "panorama") this.captureCeilingVisibility();
      this.setCeilingOpacity(previousMode === "panorama" ? 1 : 0);
    }

    if (!panorama) {
      this.proxyRootVisibilityBeforeSpatial = this.proxyRoot.visible;
      this.panoramaMaterials.clear();
      for (const mesh of this.proxyMeshes) {
        this.panoramaMaterials.set(mesh, mesh.material);
      }
      this.overviewVisibility.clear();
      for (const object of this.overviewHiddenObjects) {
        this.overviewVisibility.set(object, object.visible);
        const fadeCeiling = dollhouse && cameraFlight && this.ceilingHiddenObjects.has(object);
        if (!fadeCeiling) object.visible = false;
      }
    }

    if (top) {
      for (const mesh of this.proxyMeshes) {
        if (this.overviewMaterial) mesh.material = this.overviewMaterial;
      }
      this.topControls.reset();
      if (this.topViewMesh && this.topViewTextureReady) {
        this.proxyRoot.visible = false;
        this.topViewMesh.visible = true;
      }
    } else if (dollhouse) {
      if (this.dollhouseUsesProxy) {
        this.proxyRoot.visible = true;
        const material = this.dollhouseMaterial ?? this.overviewMaterial;
        if (material) this.applyDollhouseMaterial(material);
        void this.prepareDollhouse();
      } else if (this.dollhouseRoot) {
        this.proxyRoot.visible = false;
        this.dollhouseRoot.visible = true;
        for (const object of this.dollhouseHiddenObjects) {
          this.overviewVisibility.set(object, object.visible);
          object.visible = false;
        }
      }
      this.dollhouseControls.update();
    }
    let animating = false;
    if (cameraFlight && fromCamera instanceof PerspectiveCamera) {
      // Flush residual drag inertia before capturing the panorama endpoint.
      this.controls.setYawPitch(this.controls.yaw, this.controls.pitch);
      const targetCamera = panorama ? this.camera : this.dollhouseCamera;
      animating = this.beginViewTransition(
        fromCamera,
        targetCamera,
        previousMode as "panorama" | "dollhouse",
        panorama ? "panorama" : "dollhouse",
      );
      if (!animating && panorama) this.completePanoramaHandoff();
      else if (!animating) {
        this.setDollhousePanoramaMix(0);
        this.setCeilingOpacity(0);
      }
    }
    this.configureViewInteraction(animating || holdInteraction);
    if (animating) {
      this.events.emit("viewtransitionstart", {
        from: previousMode,
        to: mode,
      });
    }
    this.interaction?.invalidate();
    this.events.emit("viewmodechange", { mode });
  }

  private restorePanoramaScene(restoreVisibility = true): void {
    if (!this.proxyRoot) return;
    if (this.topViewMesh) this.topViewMesh.visible = false;
    if (!this.dollhouseUsesProxy && this.dollhouseRoot) this.dollhouseRoot.visible = false;
    this.proxyRoot.visible = this.proxyRootVisibilityBeforeSpatial;
    for (const [mesh, material] of this.panoramaMaterials) mesh.material = material;
    this.disposeCeilingFadeMaterials();
    this.panoramaMaterials.clear();
    if (restoreVisibility) this.restoreSpatialVisibility();
  }

  private completePanoramaHandoff(): void {
    this.setDollhousePanoramaMix(1);
    this.restorePanoramaScene();
    if (this.skysphere) this.skysphere.visible = true;
  }

  private restoreSpatialVisibility(): void {
    for (const [object, visible] of this.overviewVisibility) object.visible = visible;
    this.overviewVisibility.clear();
    for (const [mesh, visible] of this.ceilingMeshVisibility) mesh.visible = visible;
    this.ceilingMeshVisibility.clear();
    this.ceilingOpacity = 1;
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

  setCustomMeasurementActive(active: boolean, options: { clear?: boolean } = {}): void {
    if (!this.measurements) return;
    let changed = false;
    if (options.clear) changed = this.measurements.clearCustomMeasurement() || changed;
    changed = this.measurements.setCustomActive(active) || changed;
    this.interaction?.setMeasurementMode(active);
    if (changed) {
      this.events.emit("custommeasurementchange", {
        measurement: this.measurements.getCustomState(),
      });
    }
  }

  undoCustomMeasurementPoint(): void {
    if (!this.measurements?.undoCustomPoint()) return;
    this.events.emit("custommeasurementchange", {
      measurement: this.measurements.getCustomState(),
    });
  }

  clearCustomMeasurement(): void {
    if (!this.measurements?.clearCustomMeasurement()) return;
    this.events.emit("custommeasurementchange", {
      measurement: this.measurements.getCustomState(),
    });
  }

  getCustomMeasurement(): CustomMeasurementState {
    return (
      this.measurements?.getCustomState() ?? {
        active: false,
        points: [],
        length: 0,
        perimeter: null,
        area: null,
      }
    );
  }

  /** Select a transparent per-node appearance layer for a configurable object. */
  async setVariant(configurableId: string, variantId: string): Promise<void> {
    await this.setVariants({ [configurableId]: variantId });
  }

  /** Preload and commit several transparent appearance layers atomically. */
  async setVariants(selections: Record<string, string>): Promise<boolean> {
    if (Object.keys(selections).length === 0) return true;
    if (!this.variants) throw new Error("Tour has no configurables");
    const previous = this.variants.getVariants();
    const applied = await this.variants.setVariants(selections);
    if (!applied) return false;
    const current = this.variants.getVariants();
    const changed: Record<string, string> = {};
    for (const [configurableId, variantId] of Object.entries(current)) {
      if (previous[configurableId] !== variantId) {
        changed[configurableId] = variantId;
        this.events.emit("variantchange", { configurableId, variantId });
      }
    }
    if (Object.keys(changed).length > 0) this.events.emit("variantschange", { variants: changed });
    if (this.viewMode === "dollhouse") this.interaction?.invalidate();
    return true;
  }

  getVariant(configurableId: string): string | null {
    return this.variants?.getVariant(configurableId) ?? null;
  }

  getConfigurationState(): ConfigurationState | null {
    return this.configuration?.getState() ?? null;
  }

  getConfiguratorConfig() {
    return this.configuration?.getConfig() ?? null;
  }

  getConfigurationOptionAvailability(groupId: string, optionId: string) {
    if (!this.configuration)
      return { available: false, reason: "Tour has no product configurator" };
    return this.configuration.getOptionAvailability(groupId, optionId);
  }

  selectConfigurationOption(groupId: string, optionId: string): Promise<ConfigurationState> {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.select(groupId, optionId);
  }

  applyConfigurationPreset(presetId: string): Promise<ConfigurationState> {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.applyPreset(presetId);
  }

  restoreConfiguration(selections: Record<string, string>): Promise<ConfigurationState> {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.restore(selections);
  }

  restoreSerializedConfiguration(value: string): Promise<ConfigurationState> {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.restoreSerialized(value);
  }

  resetConfiguration(compare = false): Promise<ConfigurationState> {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.reset(compare ? "compare" : "reset");
  }

  serializeConfiguration(): string {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.serialize();
  }

  getConfigurationQuotePayload(): ConfigurationQuotePayload {
    if (!this.configuration) throw new Error("Tour has no product configurator");
    return this.configuration.getQuotePayload();
  }

  requestConfiguration(): ConfigurationQuotePayload {
    const payload = this.getConfigurationQuotePayload();
    this.events.emit("configurationrequest", { payload });
    return payload;
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
        captureGuideView: () => this.captureViewSnapshot(),
        getMeasurementsVisible: () => this.areMeasurementsVisible(),
        getVariantSelections: () => this.getVariantSelections(),
        previewGuideStep: (guideId, stepIndex) => this.startGuide(guideId, stepIndex),
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
    this.dollhouseLoadToken += 1;
    this.viewTransition = null;
    if (this.guideViewAnimation) this.guideViewAnimation.resolve();
    this.guideViewAnimation = null;
    for (const resolve of this.viewTransitionWaiters.splice(0)) resolve();
    cancelAnimationFrame(this.animationFrame);
    this.renderer.setAnimationLoop(null);
    if (this.vrSession) {
      this.vrSession.removeEventListener("end", this.finishVRSession);
      void this.vrSession.end();
      this.vrSession = null;
    }
    this.resizeObserver.disconnect();
    this.guideInteractionAbort.abort();
    this.guidedTours?.dispose();
    this.authorOverlay?.dispose();
    this.measurements?.dispose();
    this.hotspots?.dispose();
    this.navigation?.dispose();
    this.visibility?.dispose();
    this.dollhouseVisibility?.dispose();
    this.interaction?.dispose();
    this.assets?.dispose();
    this.pendingTextureUpgrades = [];
    this.controls.dispose();
    this.topControls.dispose();
    this.dollhouseControls.dispose();
    this.variants?.dispose();
    this.projection.dispose();
    this.dollhouseMaterial?.dispose();
    this.topViewMesh?.geometry.dispose();
    this.topViewMesh?.material.dispose();
    this.topViewMesh?.removeFromParent();
    this.skysphere?.geometry.dispose();
    this.generatedCeiling?.geometry.dispose();
    for (const binding of this.xrControllers) {
      binding.controller.removeEventListener("select", binding.onSelect);
      binding.controller.removeEventListener("connected", binding.onConnected);
      binding.controller.removeEventListener("disconnected", binding.onDisconnected);
      binding.ray.geometry.dispose();
      binding.ray.material.dispose();
      binding.controller.removeFromParent();
    }
    this.xrControllers = [];
    this.events.removeAllListeners();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.transitionCurtain.remove();
    this.overlay.remove();
  }
}
