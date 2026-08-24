import type { HotspotConfig } from "./config/schema";
import type {
  ConfigurationChangeSource,
  ConfigurationQuotePayload,
  ConfigurationState,
} from "./configuration/ConfigurationController";
import type { GuideState, GuideStepSource } from "./engine/GuidedTourController";
import type { TourViewMode } from "./engine/TourEngine";
import type { CustomMeasurementState } from "./spatial/customMeasurement";

export interface TourEventMap {
  /** Config + mesh + first panorama loaded; the tour is interactive. */
  ready: void;
  error: { error: Error };
  /** Asset loading progress, 0..1 overall for the initial load. */
  loadprogress: { progress: number; url?: string };
  nodechange: { from: string | null; to: string };
  /** All target panorama/layer/depth/bridge work completed before movement. */
  transitionprepare: { from: string; to: string; durationMs: number };
  transitionstart: { from: string; to: string };
  transitionend: { from: string; to: string };
  hotspotclick: { hotspot: HotspotConfig };
  /** id is null when the pointer leaves all interactables. */
  interactablehover: { id: string | null };
  interactableclick: { id: string; point: [number, number, number] };
  variantchange: { configurableId: string; variantId: string };
  variantschange: { variants: Record<string, string> };
  configurationstatechange: {
    configuration: ConfigurationState;
    source: ConfigurationChangeSource;
  };
  configurationrequest: { payload: ConfigurationQuotePayload };
  viewmodechange: { mode: TourViewMode };
  /** Camera flight between a panorama location and the spatial dollhouse. */
  viewtransitionstart: { from: TourViewMode; to: TourViewMode };
  viewtransitionend: { from: TourViewMode; to: TourViewMode };
  measurementschange: { visible: boolean };
  custommeasurementchange: { measurement: CustomMeasurementState };
  /** Availability of immersive WebXR on the current browser/device. */
  vrsupportchange: { supported: boolean };
  /** Entered or left an immersive VR session. */
  vrchange: { active: boolean };
  guidestatechange: { state: GuideState };
  guidestart: { guideId: string };
  guidestepchange: {
    guideId: string;
    stepId: string;
    stepIndex: number;
    source: GuideStepSource;
  };
  guideexplore: { guideId: string; stepId: string; stepIndex: number };
  guideautoplaychange: {
    guideId: string;
    playing: boolean;
    reason?: "manual" | "explore";
  };
  guidecomplete: { guideId: string };
  guideexit: { guideId: string; reason: "close" | "switch" | "dispose" };
  guideaction: {
    guideId: string;
    action: { id: string; label: string; href?: string };
  };
  guideerror: { guideId: string; stepId: string; error: Error };
}

type Listener<T> = (payload: T) => void;

export class TourEventEmitter {
  private listeners = new Map<keyof TourEventMap, Set<Listener<never>>>();

  on<K extends keyof TourEventMap>(event: K, listener: Listener<TourEventMap[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof TourEventMap>(event: K, listener: Listener<TourEventMap[K]>): () => void {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof TourEventMap>(event: K, listener: Listener<TourEventMap[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof TourEventMap>(event: K, payload: TourEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      (listener as Listener<TourEventMap[K]>)(payload);
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
