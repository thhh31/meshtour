export { Tour } from "./Tour";
export type { TourProps, HotspotRendererHelpers } from "./Tour";
export { useTour } from "./useTour";
export type { UseTourResult } from "./useTour";
export { TourContext } from "./context";
export type { TourContextValue } from "./context";

// Re-export the config types host apps typically need.
export type {
  TourConfig,
  TourConfigInput,
  NodeConfig,
  HotspotConfig,
  LinkConfig,
} from "@meshtour/core";
