import type {
  ConfigurationState,
  CustomMeasurementState,
  GuideConfig,
  GuideState,
  TourEngine,
  TourViewMode,
} from "@meshtour/core";
import { createContext } from "react";

export interface TourContextValue {
  engine: TourEngine | null;
  ready: boolean;
  transitioning: boolean;
  currentNode: string | null;
  viewMode: TourViewMode;
  measurementsVisible: boolean;
  customMeasurement: CustomMeasurementState;
  vrSupported: boolean;
  vrActive: boolean;
  guides: readonly GuideConfig[];
  guideState: GuideState;
  configuration: ConfigurationState | null;
}

export const TourContext = createContext<TourContextValue>({
  engine: null,
  ready: false,
  transitioning: false,
  currentNode: null,
  viewMode: "panorama",
  measurementsVisible: false,
  customMeasurement: { active: false, points: [], length: 0, perimeter: null, area: null },
  vrSupported: false,
  vrActive: false,
  guides: [],
  guideState: {
    guideId: null,
    stepIndex: -1,
    status: "idle",
    autoplay: false,
    error: null,
  },
  configuration: null,
});
