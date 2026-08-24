import type { GuideConfig, GuideState, GuideStepConfig } from "@meshtour/core";
import { useCallback, useContext } from "react";
import { TourContext } from "./context";

export interface UseGuidedTourResult {
  guides: readonly GuideConfig[];
  state: GuideState;
  activeGuide: GuideConfig | null;
  activeStep: GuideStepConfig | null;
  start: (guideId: string, stepIndex?: number) => Promise<void>;
  stop: () => Promise<void>;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  goToStep: (stepIndex: number) => Promise<void>;
  play: () => void;
  pause: () => void;
  resume: () => Promise<void>;
  triggerAction: () => void;
}

/** Guided-story state and commands. Must be used inside `<Tour>`. */
export function useGuidedTour(): UseGuidedTourResult {
  const { engine, guides, guideState } = useContext(TourContext);
  const activeGuide = guides.find((guide) => guide.id === guideState.guideId) ?? null;
  const activeStep = activeGuide?.steps[guideState.stepIndex] ?? null;

  const requireEngine = useCallback(() => {
    if (!engine) throw new Error("useGuidedTour: engine is not mounted yet");
    return engine;
  }, [engine]);

  const start = useCallback(
    async (guideId: string, stepIndex?: number) => {
      await requireEngine().startGuide(guideId, stepIndex);
    },
    [requireEngine],
  );
  const stop = useCallback(async () => requireEngine().stopGuide(), [requireEngine]);
  const next = useCallback(async () => requireEngine().nextGuideStep(), [requireEngine]);
  const previous = useCallback(async () => requireEngine().previousGuideStep(), [requireEngine]);
  const goToStep = useCallback(
    async (stepIndex: number) => requireEngine().goToGuideStep(stepIndex),
    [requireEngine],
  );
  const play = useCallback(() => requireEngine().playGuide(), [requireEngine]);
  const pause = useCallback(() => requireEngine().pauseGuide(), [requireEngine]);
  const resume = useCallback(async () => requireEngine().resumeGuide(), [requireEngine]);
  const triggerAction = useCallback(() => requireEngine().triggerGuideAction(), [requireEngine]);

  return {
    guides,
    state: guideState,
    activeGuide,
    activeStep,
    start,
    stop,
    next,
    previous,
    goToStep,
    play,
    pause,
    resume,
    triggerAction,
  };
}
