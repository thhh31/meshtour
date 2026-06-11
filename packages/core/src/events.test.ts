import { describe, expect, it, vi } from "vitest";
import { TourEventEmitter } from "./events";

describe("TourEventEmitter", () => {
  it("delivers payloads to listeners", () => {
    const emitter = new TourEventEmitter();
    const listener = vi.fn();
    emitter.on("nodechange", listener);
    emitter.emit("nodechange", { from: null, to: "kitchen" });
    expect(listener).toHaveBeenCalledWith({ from: null, to: "kitchen" });
  });

  it("on() returns an unsubscribe function", () => {
    const emitter = new TourEventEmitter();
    const listener = vi.fn();
    const off = emitter.on("interactablehover", listener);
    off();
    emitter.emit("interactablehover", { id: "table_01" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("once() fires exactly once", () => {
    const emitter = new TourEventEmitter();
    const listener = vi.fn();
    emitter.once("ready", listener);
    emitter.emit("ready", undefined);
    emitter.emit("ready", undefined);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("a listener removing itself during emit does not break others", () => {
    const emitter = new TourEventEmitter();
    const calls: string[] = [];
    const first = () => {
      calls.push("first");
      emitter.off("ready", first);
    };
    emitter.on("ready", first);
    emitter.on("ready", () => calls.push("second"));
    emitter.emit("ready", undefined);
    emitter.emit("ready", undefined);
    expect(calls).toEqual(["first", "second", "second"]);
  });

  it("removeAllListeners clears everything", () => {
    const emitter = new TourEventEmitter();
    const listener = vi.fn();
    emitter.on("error", listener);
    emitter.removeAllListeners();
    emitter.emit("error", { error: new Error("boom") });
    expect(listener).not.toHaveBeenCalled();
  });
});
