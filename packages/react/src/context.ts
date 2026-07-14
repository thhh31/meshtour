import type { TourEngine, TourViewMode } from "@meshtour/core";
import { createContext } from "react";

export interface TourContextValue {
  engine: TourEngine | null;
  ready: boolean;
  currentNode: string | null;
  viewMode: TourViewMode;
  measurementsVisible: boolean;
}

export const TourContext = createContext<TourContextValue>({
  engine: null,
  ready: false,
  currentNode: null,
  viewMode: "panorama",
  measurementsVisible: false,
});
