import type { TourEngine, TransitionOptions } from "@meshtour/core";
import { useCallback, useContext } from "react";
import { TourContext } from "./context";

export interface UseTourResult {
  /** The underlying engine (null until mounted client-side). */
  engine: TourEngine | null;
  /** True once the tour has loaded and is interactive. */
  ready: boolean;
  /** Id of the node the user is currently standing at. */
  currentNode: string | null;
  goToNode: (nodeId: string, options?: TransitionOptions) => Promise<void>;
  lookAt: (target: [number, number, number]) => void;
  getCurrentNode: () => string | null;
  setHotspotsVisible: (visible: boolean) => void;
}

/** Imperative tour API. Must be used inside `<Tour>` children. */
export function useTour(): UseTourResult {
  const { engine, ready, currentNode } = useContext(TourContext);

  const goToNode = useCallback(
    async (nodeId: string, options?: TransitionOptions) => {
      if (!engine) throw new Error("useTour: engine is not mounted yet");
      await engine.goToNode(nodeId, options);
    },
    [engine],
  );

  const lookAt = useCallback(
    (target: [number, number, number]) => engine?.lookAt(target),
    [engine],
  );

  const getCurrentNode = useCallback(() => engine?.getCurrentNode() ?? null, [engine]);

  const setHotspotsVisible = useCallback(
    (visible: boolean) => engine?.setHotspotsVisible(visible),
    [engine],
  );

  return { engine, ready, currentNode, goToNode, lookAt, getCurrentNode, setHotspotsVisible };
}
