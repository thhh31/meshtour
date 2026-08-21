import type { HotspotConfig } from "./config/schema";
import type { TourViewMode } from "./engine/TourEngine";

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
  viewmodechange: { mode: TourViewMode };
  measurementschange: { visible: boolean };
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
