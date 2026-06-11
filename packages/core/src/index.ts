// Engine
export { TourEngine } from "./engine/TourEngine";
export type { TourEngineOptions, TourEngineState } from "./engine/TourEngine";
export { AssetManager } from "./engine/AssetManager";
export type { AssetManagerOptions } from "./engine/AssetManager";

// Config (the public contract)
export {
  tourConfigSchema,
  nodeSchema,
  hotspotSchema,
  linkSchema,
  assetsSchema,
  renderingSchema,
  interactablesSchema,
} from "./config/schema";
export type {
  TourConfig,
  TourConfigInput,
  NodeConfig,
  HotspotConfig,
  HotspotType,
  LinkConfig,
  PanoramaConfig,
  InitialViewConfig,
  AssetsConfig,
  RenderingConfig,
  InteractablesConfig,
  Vec3,
} from "./config/schema";
export { loadConfig, validateConfig, resolveAssetUrl, ConfigError } from "./config/loader";

// Events
export { TourEventEmitter } from "./events";
export type { TourEventMap } from "./events";

// Rendering
export { PanoramaProjection } from "./rendering/PanoramaMaterial";
export type { PanoramaUniforms } from "./rendering/PanoramaMaterial";

// Navigation
export type { TransitionOptions } from "./navigation/NavigationManager";

// Math utilities (shared with tests and tooling)
export { dirToEquirectUv, transitionBlend, easeInOutCubic, clamp, lerp } from "./utils/math";
