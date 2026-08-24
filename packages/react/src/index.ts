export { Tour } from "./Tour";
export type { TourProps, HotspotRendererHelpers } from "./Tour";
export { useTour } from "./useTour";
export type { UseTourResult } from "./useTour";
export { useGuidedTour } from "./useGuidedTour";
export type { UseGuidedTourResult } from "./useGuidedTour";
export { useTourConfiguration } from "./useTourConfiguration";
export type { UseTourConfigurationResult } from "./useTourConfiguration";
export { TourSpatialControls } from "./TourSpatialControls";
export type { TourSpatialControlsProps } from "./TourSpatialControls";
export { TourGuidedControls } from "./TourGuidedControls";
export type { TourGuidedControlsProps } from "./TourGuidedControls";
export { TourContext } from "./context";
export type { TourContextValue } from "./context";

// Re-export the config types host apps typically need.
export type {
  TourConfig,
  TourConfigInput,
  NodeConfig,
  HotspotConfig,
  LinkConfig,
  GuideConfig,
  GuideStepConfig,
  GuideViewConfig,
  ConfiguratorConfig,
  ConfigurationGroupConfig,
  ConfigurationOptionConfig,
  ConfigurationPresetConfig,
  ConfigurationState,
  ConfigurationQuotePayload,
} from "@meshtour/core";
