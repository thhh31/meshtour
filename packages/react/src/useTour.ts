import type { EnterVROptions, TourEngine, TourViewMode, TransitionOptions } from "@meshtour/core";
import { useCallback, useContext } from "react";
import { TourContext } from "./context";

export interface UseTourResult {
  /** The underlying engine (null until mounted client-side). */
  engine: TourEngine | null;
  /** True once the tour has loaded and is interactive. */
  ready: boolean;
  /** True while an animated node transition is in progress. */
  transitioning: boolean;
  /** Id of the node the user is currently standing at. */
  currentNode: string | null;
  viewMode: TourViewMode;
  measurementsVisible: boolean;
  vrSupported: boolean;
  vrActive: boolean;
  goToNode: (nodeId: string, options?: TransitionOptions) => Promise<void>;
  lookAt: (target: [number, number, number]) => void;
  getCurrentNode: () => string | null;
  setHotspotsVisible: (visible: boolean) => void;
  setViewMode: (mode: TourViewMode) => void;
  setMeasurementsVisible: (visible: boolean) => void;
  enterVR: (options?: EnterVROptions) => Promise<void>;
  exitVR: () => Promise<void>;
}

/** Imperative tour API. Must be used inside `<Tour>` children. */
export function useTour(): UseTourResult {
  const {
    engine,
    ready,
    transitioning,
    currentNode,
    viewMode,
    measurementsVisible,
    vrSupported,
    vrActive,
  } = useContext(TourContext);

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

  const setViewMode = useCallback((mode: TourViewMode) => engine?.setViewMode(mode), [engine]);

  const setMeasurementsVisible = useCallback(
    (visible: boolean) => engine?.setMeasurementsVisible(visible),
    [engine],
  );

  const enterVR = useCallback(
    async (options?: EnterVROptions) => {
      if (!engine) throw new Error("useTour: engine is not mounted yet");
      await engine.enterVR(options);
    },
    [engine],
  );

  const exitVR = useCallback(async () => {
    await engine?.exitVR();
  }, [engine]);

  return {
    engine,
    ready,
    transitioning,
    currentNode,
    viewMode,
    measurementsVisible,
    vrSupported,
    vrActive,
    goToNode,
    lookAt,
    getCurrentNode,
    setHotspotsVisible,
    setViewMode,
    setMeasurementsVisible,
    enterVR,
    exitVR,
  };
}
