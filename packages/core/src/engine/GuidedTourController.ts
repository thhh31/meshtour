import type { GuideConfig, GuideStepConfig } from "../config/schema";
import type { TourEventEmitter } from "../events";

export type GuideStatus = "idle" | "navigating" | "presenting" | "exploring" | "error";
export type GuideStepSource = "start" | "next" | "previous" | "seek" | "autoplay" | "resume";

export interface GuideState {
  guideId: string | null;
  stepIndex: number;
  status: GuideStatus;
  autoplay: boolean;
  error: Error | null;
}

export interface GuideRestoreState {
  measurementsVisible: boolean;
  variants: Record<string, string>;
}

export interface GuidedTourHost {
  captureRestoreState(): GuideRestoreState;
  applyStep(step: GuideStepConfig): Promise<void>;
  restoreState(state: GuideRestoreState): Promise<void>;
}

const IDLE_STATE: GuideState = {
  guideId: null,
  stepIndex: -1,
  status: "idle",
  autoplay: false,
  error: null,
};

/** Framework-independent guided-story state machine and autoplay scheduler. */
export class GuidedTourController {
  private guides: GuideConfig[];
  private host: GuidedTourHost;
  private events: TourEventEmitter;
  private state: GuideState = { ...IDLE_STATE };
  private restoreState: GuideRestoreState | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request = 0;
  private queue: Promise<void> = Promise.resolve();
  private completedGuideId: string | null = null;
  private disposed = false;

  constructor(guides: GuideConfig[], host: GuidedTourHost, events: TourEventEmitter) {
    this.guides = guides;
    this.host = host;
    this.events = events;
  }

  getGuides(): readonly GuideConfig[] {
    return this.guides;
  }

  getState(): GuideState {
    return { ...this.state };
  }

  private guide(): GuideConfig | null {
    return this.guides.find((guide) => guide.id === this.state.guideId) ?? null;
  }

  private emitState(): void {
    this.events.emit("guidestatechange", { state: this.getState() });
  }

  private setState(patch: Partial<GuideState>): void {
    this.state = { ...this.state, ...patch };
    this.emitState();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleAutoplay(): void {
    this.clearTimer();
    const guide = this.guide();
    if (!guide?.autoplay || !this.state.autoplay || this.state.status !== "presenting") return;
    if (this.state.stepIndex >= guide.steps.length - 1) return;
    const step = guide.steps[this.state.stepIndex]!;
    this.timer = setTimeout(() => {
      void this.goToStep(this.state.stepIndex + 1, "autoplay");
    }, step.durationMs ?? guide.autoplay.stepDurationMs);
  }

  async start(guideId: string, stepIndex = 0): Promise<void> {
    if (this.disposed) throw new Error("Guided tour controller is disposed");
    const guide = this.guides.find((entry) => entry.id === guideId);
    if (!guide) throw new Error(`Unknown guide "${guideId}"`);
    if (this.state.guideId && this.state.guideId !== guideId) await this.stop("switch");
    if (!this.restoreState) this.restoreState = this.host.captureRestoreState();
    this.completedGuideId = null;
    this.setState({
      guideId,
      stepIndex: Math.max(0, Math.min(stepIndex, guide.steps.length - 1)),
      status: "navigating",
      autoplay: false,
      error: null,
    });
    this.events.emit("guidestart", { guideId });
    await this.goToStep(this.state.stepIndex, "start");
  }

  async goToStep(stepIndex: number, source: GuideStepSource = "seek"): Promise<void> {
    const guide = this.guide();
    if (!guide) throw new Error("No guided tour is active");
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= guide.steps.length) {
      throw new Error(`Guide step index ${stepIndex} is out of range`);
    }

    this.clearTimer();
    const request = ++this.request;
    this.setState({ stepIndex, status: "navigating", error: null });
    const task = this.queue
      .catch(() => {})
      .then(async () => {
        if (this.disposed || request !== this.request) return;
        const activeGuide = this.guide();
        if (!activeGuide) return;
        const step = activeGuide.steps[stepIndex]!;
        try {
          await this.host.applyStep(step);
          if (this.disposed || request !== this.request) return;
          this.setState({ status: "presenting", error: null });
          this.events.emit("guidestepchange", {
            guideId: activeGuide.id,
            stepId: step.id,
            stepIndex,
            source,
          });
          if (
            stepIndex === activeGuide.steps.length - 1 &&
            this.completedGuideId !== activeGuide.id
          ) {
            this.completedGuideId = activeGuide.id;
            this.events.emit("guidecomplete", { guideId: activeGuide.id });
          }
          this.scheduleAutoplay();
        } catch (cause) {
          if (request !== this.request) return;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          this.setState({ status: "error", autoplay: false, error });
          this.events.emit("guideerror", {
            guideId: activeGuide.id,
            stepId: step.id,
            error,
          });
        }
      });
    this.queue = task;
    await task;
  }

  async next(): Promise<void> {
    const guide = this.guide();
    if (!guide) throw new Error("No guided tour is active");
    if (this.state.stepIndex < guide.steps.length - 1) {
      await this.goToStep(this.state.stepIndex + 1, "next");
    }
  }

  async previous(): Promise<void> {
    if (!this.guide()) throw new Error("No guided tour is active");
    if (this.state.stepIndex > 0) await this.goToStep(this.state.stepIndex - 1, "previous");
  }

  play(): void {
    const guide = this.guide();
    if (!guide?.autoplay) return;
    if (this.state.status === "exploring" || this.state.status === "error") {
      void this.goToStep(this.state.stepIndex, "resume").then(() => {
        if (this.guide()) this.play();
      });
      return;
    }
    if (this.state.autoplay) return;
    this.setState({ autoplay: true });
    this.events.emit("guideautoplaychange", { guideId: guide.id, playing: true });
    this.scheduleAutoplay();
  }

  pause(reason: "manual" | "explore" = "manual"): void {
    const guide = this.guide();
    if (!guide) return;
    const wasPlaying = this.state.autoplay;
    this.clearTimer();
    this.setState({ autoplay: false });
    if (wasPlaying) {
      this.events.emit("guideautoplaychange", { guideId: guide.id, playing: false, reason });
    }
  }

  markExploring(): void {
    const guide = this.guide();
    if (!guide || this.state.status !== "presenting") return;
    this.pause("explore");
    this.setState({ status: "exploring" });
    this.events.emit("guideexplore", {
      guideId: guide.id,
      stepId: guide.steps[this.state.stepIndex]!.id,
      stepIndex: this.state.stepIndex,
    });
  }

  async resume(): Promise<void> {
    if (!this.guide()) throw new Error("No guided tour is active");
    await this.goToStep(this.state.stepIndex, "resume");
  }

  triggerAction(): void {
    const guide = this.guide();
    if (!guide?.cta) return;
    this.events.emit("guideaction", { guideId: guide.id, action: guide.cta });
  }

  async stop(reason: "close" | "switch" | "dispose" = "close"): Promise<void> {
    const guide = this.guide();
    if (!guide) return;
    this.clearTimer();
    ++this.request;
    const restore = this.restoreState;
    this.restoreState = null;
    this.state = { ...IDLE_STATE };
    this.emitState();
    if (restore && reason !== "dispose") await this.host.restoreState(restore);
    this.events.emit("guideexit", { guideId: guide.id, reason });
  }

  dispose(): void {
    const guide = this.guide();
    this.disposed = true;
    this.clearTimer();
    ++this.request;
    this.restoreState = null;
    this.state = { ...IDLE_STATE };
    if (guide) this.events.emit("guideexit", { guideId: guide.id, reason: "dispose" });
  }
}
