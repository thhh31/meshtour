import type { TourEngine, TourViewMode } from "@meshtour/core";
import { createContext } from "react";

export interface TourContextValue {
  engine: TourEngine | null;
  ready: boolean;
  transitioning: boolean;
  currentNode: string | null;
  viewMode: TourViewMode;
  measurementsVisible: boolean;
  vrSupported: boolean;
  vrActive: boolean;
}

export const TourContext = createContext<TourContextValue>({
  engine: null,
  ready: false,
  transitioning: false,
  currentNode: null,
  viewMode: "panorama",
  measurementsVisible: false,
  vrSupported: false,
  vrActive: false,
});
