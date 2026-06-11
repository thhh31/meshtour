import type { TourEngine } from "@meshtour/core";
import { createContext } from "react";

export interface TourContextValue {
  engine: TourEngine | null;
  ready: boolean;
  currentNode: string | null;
}

export const TourContext = createContext<TourContextValue>({
  engine: null,
  ready: false,
  currentNode: null,
});
