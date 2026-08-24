import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuideConfig, GuideStepConfig } from "../config/schema";
import { TourEventEmitter } from "../events";
import {
  GuidedTourController,
  type GuideRestoreState,
  type GuidedTourHost,
} from "./GuidedTourController";

const guide: GuideConfig = {
  id: "highlights",
  title: "Highlights",
  autoplay: { stepDurationMs: 3_000 },
  cta: { id: "book", label: "Book" },
  steps: [
    {
      id: "living",
      title: "Living",
      view: { mode: "panorama", node: "living", yaw: 0, pitch: 0 },
      measurementsVisible: false,
      variants: {},
    },
    {
      id: "plan",
      title: "Plan",
      view: { mode: "top", center: [0, 0], zoom: 1 },
      measurementsVisible: true,
      variants: {},
    },
  ],
};

function setup(overrides: Partial<GuidedTourHost> = {}) {
  const events = new TourEventEmitter();
  const applied: GuideStepConfig[] = [];
  const restored: GuideRestoreState[] = [];
  const host: GuidedTourHost = {
    captureRestoreState: () => ({ measurementsVisible: false, variants: { sofa: "cream" } }),
    applyStep: async (step) => {
      applied.push(step);
    },
    restoreState: async (state) => {
      restored.push(state);
    },
    ...overrides,
  };
  return {
    controller: new GuidedTourController([guide], host, events),
    events,
    applied,
    restored,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GuidedTourController", () => {
  it("starts, advances, emits completion, and restores visitor state on close", async () => {
    const { controller, events, applied, restored } = setup();
    const changes: string[] = [];
    let completed = 0;
    events.on("guidestepchange", ({ stepId }) => changes.push(stepId));
    events.on("guidecomplete", () => (completed += 1));

    await controller.start("highlights");
    await controller.next();

    expect(applied.map((step) => step.id)).toEqual(["living", "plan"]);
    expect(changes).toEqual(["living", "plan"]);
    expect(controller.getState()).toMatchObject({
      guideId: "highlights",
      stepIndex: 1,
      status: "presenting",
    });
    expect(completed).toBe(1);

    await controller.stop();
    expect(restored).toEqual([{ measurementsVisible: false, variants: { sofa: "cream" } }]);
    expect(controller.getState().status).toBe("idle");
  });

  it("pauses for exploration and resumes the current chapter", async () => {
    const { controller, applied } = setup();
    await controller.start("highlights");
    controller.play();
    controller.markExploring();

    expect(controller.getState()).toMatchObject({ status: "exploring", autoplay: false });
    await controller.resume();
    expect(applied.map((step) => step.id)).toEqual(["living", "living"]);
    expect(controller.getState().status).toBe("presenting");
  });

  it("advances with opt-in autoplay after the configured dwell", async () => {
    vi.useFakeTimers();
    const { controller, applied } = setup();
    await controller.start("highlights");
    controller.play();

    await vi.advanceTimersByTimeAsync(2_999);
    expect(applied).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(applied.map((step) => step.id)).toEqual(["living", "plan"]);
    expect(controller.getState().stepIndex).toBe(1);
  });

  it("skips stale queued requests so the latest chapter wins", async () => {
    let release = () => {};
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { controller, applied } = setup({
      applyStep: async (step) => {
        applied.push(step);
        if (step.id === "living") await first;
      },
    });

    const starting = controller.start("highlights");
    await Promise.resolve();
    const latest = controller.goToStep(1);
    release();
    await Promise.all([starting, latest]);

    expect(applied.at(-1)?.id).toBe("plan");
    expect(controller.getState()).toMatchObject({ stepIndex: 1, status: "presenting" });
  });

  it("surfaces application errors and supports retry", async () => {
    let fail = true;
    const { controller } = setup({
      applyStep: async () => {
        if (fail) throw new Error("asset failed");
      },
    });

    await controller.start("highlights");
    expect(controller.getState()).toMatchObject({ status: "error", autoplay: false });
    expect(controller.getState().error?.message).toBe("asset failed");

    fail = false;
    await controller.resume();
    expect(controller.getState()).toMatchObject({ status: "presenting", error: null });
  });
});
