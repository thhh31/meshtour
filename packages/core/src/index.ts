// Engine
export { TourEngine, shortestYawDelta } from "./engine/TourEngine";
export type {
  EnterVROptions,
  TourEngineOptions,
  TourEngineState,
  TourViewMode,
} from "./engine/TourEngine";
export type { GuideState, GuideStatus, GuideStepSource } from "./engine/GuidedTourController";
export { AssetManager } from "./engine/AssetManager";
export type { AssetManagerOptions } from "./engine/AssetManager";

// Config (the public contract)
export {
  tourConfigSchema,
  nodeSchema,
  hotspotSchema,
  linkSchema,
  transitionPathSchema,
  radialDepthSchema,
  assetsSchema,
  renderingSchema,
  interactablesSchema,
  spatialSchema,
  planBoundsSchema,
  worldBoundsSchema,
  ceilingSchema,
  topViewSchema,
  measurementSchema,
  measurementAxisSchema,
  configurableSchema,
  configurableVariantSchema,
  configuratorSchema,
  configurationGroupSchema,
  configurationOptionSchema,
  configurationPresetSchema,
  configurationDependencySchema,
  guideSchema,
  guideStepSchema,
  guideViewSchema,
} from "./config/schema";
export type {
  TourConfig,
  TourConfigInput,
  NodeConfig,
  HotspotConfig,
  HotspotType,
  LinkConfig,
  TransitionPathConfig,
  RadialDepthConfig,
  PanoramaConfig,
  InitialViewConfig,
  AssetsConfig,
  RenderingConfig,
  InteractablesConfig,
  SpatialConfig,
  PlanBoundsConfig,
  WorldBoundsConfig,
  CeilingConfig,
  TopViewConfig,
  MeasurementConfig,
  MeasurementAxis,
  ConfigurableConfig,
  ConfigurableVariantConfig,
  ConfiguratorConfig,
  ConfigurationGroupConfig,
  ConfigurationOptionConfig,
  ConfigurationPresetConfig,
  ConfigurationDependencyConfig,
  GuideConfig,
  GuideStepConfig,
  GuideViewConfig,
  Vec3,
} from "./config/schema";
export { loadConfig, validateConfig, resolveAssetUrl, ConfigError } from "./config/loader";
export {
  ConfigurationController,
  serializeConfiguration,
  deserializeConfiguration,
} from "./configuration/ConfigurationController";
export type {
  ConfigurationChangeSource,
  ConfigurationStatus,
  ConfigurationState,
  ConfigurationLineItem,
  ConfigurationQuotePayload,
  ConfigurationOptionAvailability,
  ConfigurationControllerOptions,
} from "./configuration/ConfigurationController";

// Events
export { TourEventEmitter } from "./events";
export type { TourEventMap } from "./events";

// Rendering
export { PanoramaProjection } from "./rendering/PanoramaMaterial";
export type {
  PanoramaUniforms,
  PanoramaLayerUniforms,
  PanoramaLayerMaterial,
} from "./rendering/PanoramaMaterial";

// Spatial overview + measurements
export { renderProxyPlan, resolvePlanBounds } from "./spatial/PlanRenderer";
export type { PlanRenderOptions } from "./spatial/PlanRenderer";
export { calculateCustomMeasurement } from "./spatial/customMeasurement";
export type { CustomMeasurementState } from "./spatial/customMeasurement";

// Navigation
export type { TransitionOptions } from "./navigation/NavigationManager";

// Math utilities (shared with tests and tooling)
export { dirToEquirectUv, transitionBlend, easeInOutCubic, clamp, lerp } from "./utils/math";
