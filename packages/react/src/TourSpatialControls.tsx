import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { controlTooltipStyles } from "./controlTooltip";
import { useTour } from "./useTour";

export interface TourSpatialControlsProps {
  /** Show the automatically generated top-left plan (default true). */
  plan?: boolean;
  /** Show the measurement-mode toggle when targets are configured (default true). */
  measurements?: boolean;
  /** Show the container fullscreen toggle (default true). */
  fullscreen?: boolean;
  /** Show the perspective dollhouse-view toggle (default true). */
  dollhouse?: boolean;
  /** Show immersive VR when WebXR is available (default true). */
  vr?: boolean;
  style?: CSSProperties;
}

interface Size {
  width: number;
  height: number;
}

const iconButton: CSSProperties = {
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(255, 255, 255, 0.09)",
  borderRadius: 12,
  color: "rgba(255, 255, 255, 0.85)",
  background: "rgba(9, 10, 14, 0.68)",
  boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
  backdropFilter: "blur(20px) saturate(130%)",
  WebkitBackdropFilter: "blur(20px) saturate(130%)",
  cursor: "pointer",
  padding: 0,
  transition:
    "background 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
};

function MeasureIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7v10M20 7v10M4 12h16" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 9-4 3 4 3M16 9l4 3-4 3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function CustomMeasureIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m5 18 5-11 9 10"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="18" r="2" fill="currentColor" />
      <circle cx="10" cy="7" r="2" fill="currentColor" />
      <circle cx="19" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

function FullscreenIcon({ active }: { active: boolean }) {
  const path = active
    ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"
    : "M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5";
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={path} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TopViewIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {active ? (
        <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.8" />
      ) : (
        <>
          <path d="M4 8 12 4l8 4-8 4-8-4Z" stroke="currentColor" strokeWidth="1.6" />
          <path d="m4 12 8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.6" />
        </>
      )}
    </svg>
  );
}

function DollhouseIcon({ active }: { active: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 8 8-4 8 4v9l-8 4-8-4V8Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="m4 8 8 4 8-4M12 12v9" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7.5 9.75 4.5-2.2 4.5 2.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function VRIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3.5 8.5c0-1.1.9-2 2-2h13c1.1 0 2 .9 2 2v6.2c0 1.1-.9 2-2 2h-3.3l-1.8-2.6h-2.8l-1.8 2.6H5.5c-1.1 0-2-.9-2-2V8.5Z"
        fill={active ? "currentColor" : "none"}
        fillOpacity={active ? 0.18 : 0}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12 6.5v7.6" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px), (max-height: 560px)");
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return compact;
}

function planPoint(
  x: number,
  z: number,
  bounds: { min: [number, number]; max: [number, number] },
  size: Size,
): { x: number; y: number } {
  const padding = Math.max(12, Math.min(size.width, size.height) * 0.07);
  const extentX = bounds.max[0] - bounds.min[0];
  const extentZ = bounds.max[1] - bounds.min[1];
  const scale = Math.max(
    0.0001,
    Math.min((size.width - padding * 2) / extentX, (size.height - padding * 2) / extentZ),
  );
  const originX = (size.width - extentX * scale) / 2;
  const originY = (size.height - extentZ * scale) / 2;
  return {
    x: originX + (x - bounds.min[0]) * scale,
    y: originY + (z - bounds.min[1]) * scale,
  };
}

export function TourSpatialControls({
  plan = true,
  measurements = true,
  fullscreen = true,
  dollhouse = true,
  vr = true,
  style,
}: TourSpatialControlsProps) {
  const {
    engine,
    ready,
    currentNode,
    viewMode,
    measurementsVisible,
    customMeasurement,
    vrSupported,
    vrActive,
    goToNode,
    setViewMode,
    setMeasurementsVisible,
    setCustomMeasurementActive,
    undoCustomMeasurementPoint,
    clearCustomMeasurement,
    enterVR,
    exitVR,
  } = useTour();
  const compact = useCompactLayout();
  const planSurfaceRef = useRef<HTMLDivElement>(null);
  const planCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const planConeRef = useRef<HTMLDivElement>(null);
  const [planSize, setPlanSize] = useState<Size>({ width: 0, height: 0 });
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const config = engine?.getConfig();
  const bounds = engine?.getPlanBounds();
  const nodes = config?.nodes ?? [];
  const hasMeasurements = engine?.hasMeasurements() ?? false;

  useEffect(() => {
    if (!customMeasurement.active) return;
    const finishOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCustomMeasurementActive(false);
    };
    window.addEventListener("keydown", finishOnEscape);
    return () => window.removeEventListener("keydown", finishOnEscape);
  }, [customMeasurement.active, setCustomMeasurementActive]);

  useEffect(() => {
    const surface = planSurfaceRef.current;
    if (!ready || !engine || !surface) return;
    const canvas = planCanvasRef.current ?? document.createElement("canvas");
    planCanvasRef.current = canvas;
    const draw = () => {
      const rect = surface.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      setPlanSize({ width, height });
      engine.renderPlan(canvas, {
        background: "transparent",
        floor: "rgba(255,255,255,.12)",
        structure: "rgba(255,255,255,.94)",
        furniture: "rgba(255,255,255,.42)",
        detail: "rgba(255,255,255,.26)",
      });
      surface.style.backgroundImage = `url(${canvas.toDataURL("image/png")})`;
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(surface);
    return () => observer.disconnect();
  }, [engine, ready, compact]);

  useEffect(() => {
    if (!engine || viewMode !== "panorama") return;
    let frame = 0;
    let lastYaw = Number.NaN;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const nextYaw = engine.getView().yaw;
      if (!Number.isFinite(lastYaw) || Math.abs(nextYaw - lastYaw) > 0.001) {
        lastYaw = nextYaw;
        if (planConeRef.current) {
          planConeRef.current.style.transform = `translate(-50%, -100%) rotate(${-nextYaw}rad)`;
        }
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, viewMode]);

  useEffect(() => {
    if (!engine) return;
    const target = engine.getContainer();
    const update = () =>
      setFullscreenActive(
        document.fullscreenElement === target ||
          target.classList.contains("meshtour-css-fullscreen"),
      );
    document.addEventListener("fullscreenchange", update);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && target.classList.contains("meshtour-css-fullscreen")) {
        target.classList.remove("meshtour-css-fullscreen");
        update();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("keydown", onKey);
      target.classList.remove("meshtour-css-fullscreen");
    };
  }, [engine]);

  const toggleFullscreen = useCallback(async () => {
    if (!engine) return;
    const target = engine.getContainer() as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const documentWithWebkit = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (target.classList.contains("meshtour-css-fullscreen")) {
      target.classList.remove("meshtour-css-fullscreen");
      setFullscreenActive(false);
      return;
    }
    try {
      if (target.requestFullscreen) await target.requestFullscreen();
      else if (target.webkitRequestFullscreen) await target.webkitRequestFullscreen();
      else throw new Error("Element fullscreen is unavailable");
    } catch {
      target.classList.add("meshtour-css-fullscreen");
      setFullscreenActive(true);
    }
    void documentWithWebkit;
  }, [engine]);

  const activeNode = nodes.find((node) => node.id === currentNode);
  const activePoint =
    activeNode && bounds && planSize.width > 0
      ? planPoint(activeNode.position[0], activeNode.position[2], bounds, planSize)
      : null;

  const planWidth = compact ? 138 : 218;
  const planHeight = compact ? 110 : 166;
  const topLabel = viewMode === "top" ? "Return to panorama" : "Open top view";
  const dollhouseLabel = viewMode === "dollhouse" ? "Return to panorama" : "Open dollhouse view";
  const vrLabel = vrActive ? "Exit VR" : "Enter VR";
  const customMeasurementLabel = customMeasurement.active
    ? "Finish custom measurement"
    : "Start custom measurement";
  const measurementsLabel = measurementsVisible ? "Hide measurements" : "Show measurements";
  const measurementSummary =
    customMeasurement.points.length === 0
      ? "Click a surface to place the first point"
      : customMeasurement.points.length === 1
        ? "Click another surface to measure the distance"
        : customMeasurement.area === null
          ? `${customMeasurement.length.toFixed(customMeasurement.length >= 10 ? 1 : 2)} m total`
          : `${customMeasurement.perimeter!.toFixed(
              customMeasurement.perimeter! >= 10 ? 1 : 2,
            )} m perimeter · ${customMeasurement.area.toFixed(
              customMeasurement.area >= 10 ? 1 : 2,
            )} m² area`;

  return (
    <>
      <style>{`${controlTooltipStyles}
.meshtour-css-fullscreen{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;z-index:2147483000!important;background:#08080a!important}
@keyframes meshtour-measure-tools-in{from{opacity:0;transform:translateY(7px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}`}</style>
      {plan ? (
        <section
          aria-label="Apartment plan"
          aria-hidden={viewMode === "top"}
          style={{
            position: "absolute",
            zIndex: 42,
            left: compact ? 10 : 16,
            top: compact ? 10 : 16,
            width: planWidth,
            height: planHeight,
            pointerEvents: viewMode === "top" ? "none" : "auto",
            opacity: viewMode === "top" ? 0 : 1,
            transform: `translateY(${viewMode === "top" ? -8 : 0}px) scale(${
              viewMode === "top" ? 0.96 : 1
            })`,
            transformOrigin: "top left",
            visibility: viewMode === "top" ? "hidden" : "visible",
            transition:
              viewMode === "top"
                ? "opacity 220ms ease, transform 300ms cubic-bezier(.22,1,.36,1), visibility 0s linear 300ms"
                : "opacity 260ms ease, transform 360ms cubic-bezier(.22,1,.36,1), visibility 0s",
            filter: "drop-shadow(0 3px 7px rgba(0,0,0,.78))",
          }}
        >
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            <div
              ref={planSurfaceRef}
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
              }}
            />
            {bounds && planSize.width > 0 ? (
              <>
                {nodes.map((node) => {
                  const point = planPoint(node.position[0], node.position[2], bounds, planSize);
                  const current = node.id === currentNode;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      className="meshtour-control-tooltip"
                      tabIndex={viewMode === "top" ? -1 : 0}
                      aria-label={`Go to ${node.name ?? node.id}`}
                      data-tooltip={node.name ?? node.id}
                      data-tooltip-align={
                        point.x < 60 ? "start" : point.x > planSize.width - 60 ? "end" : undefined
                      }
                      onClick={() => {
                        setViewMode("panorama");
                        void goToNode(node.id);
                      }}
                      style={{
                        position: "absolute",
                        left: point.x,
                        top: point.y,
                        transform: "translate(-50%,-50%)",
                        width: 13,
                        height: 13,
                        padding: 0,
                        border: "2px solid rgba(20,21,24,.76)",
                        borderRadius: "50%",
                        background: "rgba(255,255,255,.96)",
                        boxShadow: "0 2px 8px rgba(0,0,0,.52)",
                        cursor: "pointer",
                        opacity: current ? 0 : 1,
                        transition: "opacity 180ms ease, transform 180ms ease",
                      }}
                    />
                  );
                })}
                {activePoint ? (
                  <div
                    className="meshtour-plan-current-location"
                    aria-hidden="true"
                    style={{
                      position: "absolute",
                      zIndex: 2,
                      left: activePoint.x,
                      top: activePoint.y,
                      width: 0,
                      height: 0,
                      pointerEvents: "none",
                      opacity: viewMode === "panorama" ? 1 : 0,
                      transform: `scale(${viewMode === "panorama" ? 1 : 0.72})`,
                      transition:
                        "left 680ms cubic-bezier(.22,1,.36,1), top 680ms cubic-bezier(.22,1,.36,1), opacity 260ms ease, transform 360ms cubic-bezier(.22,1,.36,1)",
                      willChange: "left, top, transform",
                    }}
                  >
                    <div
                      className="meshtour-plan-view-cone"
                      ref={planConeRef}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: compact ? 24 : 34,
                        height: compact ? 24 : 34,
                        transform: "translate(-50%, -100%)",
                        transformOrigin: "50% 100%",
                        transition: "transform 90ms linear",
                        clipPath: "polygon(50% 100%, 0 0, 100% 0)",
                        background:
                          "linear-gradient(to top, rgba(88,211,247,.3), rgba(88,211,247,.03))",
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 16,
                        height: 16,
                        transform: "translate(-50%, -50%)",
                        border: "2px solid rgba(255,255,255,.92)",
                        borderRadius: "50%",
                        background: "#58d3f7",
                        boxShadow: "0 2px 9px rgba(0,0,0,.58), 0 0 0 4px rgba(88,211,247,.14)",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {measurements && customMeasurement.active ? (
        <section
          aria-label="Custom measurement tools"
          aria-live="polite"
          style={{
            position: "absolute",
            zIndex: 44,
            right: compact ? 10 : 16,
            bottom: compact
              ? "max(140px, calc(134px + env(safe-area-inset-bottom)))"
              : "max(70px, calc(64px + env(safe-area-inset-bottom)))",
            display: "flex",
            maxWidth: "min(390px, calc(100% - 20px))",
            alignItems: "center",
            gap: 10,
            padding: "10px 11px 10px 14px",
            border: "1px solid rgba(255,255,255,.12)",
            borderRadius: 13,
            color: "#fff",
            background: "rgba(9,10,14,.82)",
            boxShadow: "0 12px 36px rgba(0,0,0,.4)",
            backdropFilter: "blur(20px) saturate(130%)",
            WebkitBackdropFilter: "blur(20px) saturate(130%)",
            pointerEvents: "auto",
            animation: "meshtour-measure-tools-in 260ms cubic-bezier(.22,1,.36,1) both",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong style={{ display: "block", fontSize: 11, letterSpacing: ".02em" }}>
              Custom measurement
            </strong>
            <span
              style={{
                display: "block",
                overflow: "hidden",
                marginTop: 3,
                color: "rgba(255,255,255,.58)",
                fontSize: 10,
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {measurementSummary}
            </span>
          </div>
          <button
            type="button"
            disabled={customMeasurement.points.length === 0}
            onClick={undoCustomMeasurementPoint}
            style={{
              border: 0,
              color: "rgba(255,255,255,.72)",
              background: "transparent",
              font: "600 10px system-ui,sans-serif",
              cursor: customMeasurement.points.length === 0 ? "not-allowed" : "pointer",
              opacity: customMeasurement.points.length === 0 ? 0.4 : 1,
            }}
          >
            Undo
          </button>
          <button
            type="button"
            disabled={customMeasurement.points.length === 0}
            onClick={clearCustomMeasurement}
            style={{
              border: 0,
              color: "rgba(255,255,255,.72)",
              background: "transparent",
              font: "600 10px system-ui,sans-serif",
              cursor: customMeasurement.points.length === 0 ? "not-allowed" : "pointer",
              opacity: customMeasurement.points.length === 0 ? 0.4 : 1,
            }}
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setCustomMeasurementActive(false)}
            style={{
              minHeight: 30,
              padding: "6px 10px",
              border: "1px solid rgba(255,255,255,.18)",
              borderRadius: 8,
              color: "#111216",
              background: "#fff",
              font: "700 10px system-ui,sans-serif",
              cursor: "pointer",
            }}
          >
            Done
          </button>
        </section>
      ) : null}

      <div
        className="meshtour-spatial-toolbar"
        aria-label="Spatial tools"
        role="toolbar"
        style={{
          position: "absolute",
          zIndex: 44,
          right: compact ? 10 : 16,
          bottom: compact
            ? "max(86px, calc(80px + env(safe-area-inset-bottom)))"
            : "max(16px, calc(10px + env(safe-area-inset-bottom)))",
          display: "flex",
          gap: 8,
          pointerEvents: "auto",
          ...style,
        }}
      >
        {vr && vrSupported ? (
          <button
            type="button"
            className="meshtour-control-tooltip"
            onClick={() => {
              const action = vrActive ? exitVR() : enterVR();
              void action.catch((error: unknown) => {
                console.warn(`MeshTour could not ${vrActive ? "exit" : "enter"} VR`, error);
              });
            }}
            disabled={!ready}
            aria-label={vrLabel}
            data-tooltip={vrLabel}
            aria-pressed={vrActive}
            style={{
              ...iconButton,
              color: vrActive ? "#dff9ff" : iconButton.color,
              background: vrActive ? "rgba(25,113,137,.9)" : iconButton.background,
              cursor: ready ? "pointer" : "wait",
            }}
          >
            <VRIcon active={vrActive} />
          </button>
        ) : null}
        {dollhouse ? (
          <button
            type="button"
            className="meshtour-control-tooltip"
            onClick={() => setViewMode(viewMode === "dollhouse" ? "panorama" : "dollhouse")}
            disabled={!ready}
            aria-label={dollhouseLabel}
            data-tooltip={dollhouseLabel}
            aria-pressed={viewMode === "dollhouse"}
            style={{
              ...iconButton,
              color: viewMode === "dollhouse" ? "#dff9ff" : iconButton.color,
              background: viewMode === "dollhouse" ? "rgba(25,113,137,.9)" : iconButton.background,
              cursor: ready ? "pointer" : "wait",
            }}
          >
            <DollhouseIcon active={viewMode === "dollhouse"} />
          </button>
        ) : null}
        <button
          type="button"
          className="meshtour-control-tooltip"
          onClick={() => setViewMode(viewMode === "top" ? "panorama" : "top")}
          disabled={!ready}
          aria-label={topLabel}
          data-tooltip={topLabel}
          aria-pressed={viewMode === "top"}
          style={{
            ...iconButton,
            color: viewMode === "top" ? "#dff9ff" : iconButton.color,
            background: viewMode === "top" ? "rgba(25,113,137,.9)" : iconButton.background,
            cursor: ready ? "pointer" : "wait",
          }}
        >
          <TopViewIcon active={viewMode === "top"} />
        </button>
        {measurements && hasMeasurements ? (
          <button
            type="button"
            className="meshtour-control-tooltip"
            aria-label={measurementsLabel}
            data-tooltip={measurementsLabel}
            aria-pressed={measurementsVisible}
            disabled={!ready}
            onClick={() => setMeasurementsVisible(!measurementsVisible)}
            style={{
              ...iconButton,
              color: measurementsVisible ? "#dff9ff" : iconButton.color,
              background: measurementsVisible ? "rgba(25,113,137,.9)" : iconButton.background,
              cursor: ready ? "pointer" : "wait",
            }}
          >
            <MeasureIcon />
          </button>
        ) : null}
        {measurements ? (
          <button
            type="button"
            className="meshtour-control-tooltip"
            aria-label={customMeasurementLabel}
            data-tooltip={customMeasurement.active ? undefined : customMeasurementLabel}
            aria-pressed={customMeasurement.active}
            disabled={!ready}
            onClick={() => {
              if (customMeasurement.active) {
                setCustomMeasurementActive(false);
                return;
              }
              if (viewMode !== "panorama") setViewMode("panorama");
              setCustomMeasurementActive(true);
            }}
            style={{
              ...iconButton,
              color: customMeasurement.active ? "#dff9ff" : iconButton.color,
              background: customMeasurement.active ? "rgba(25,113,137,.9)" : iconButton.background,
              cursor: ready ? "pointer" : "wait",
            }}
          >
            <CustomMeasureIcon />
          </button>
        ) : null}
        {fullscreen ? (
          <button
            type="button"
            className="meshtour-control-tooltip"
            aria-label={fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"}
            data-tooltip={fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"}
            aria-pressed={fullscreenActive}
            disabled={!ready}
            onClick={() => void toggleFullscreen()}
            style={{ ...iconButton, cursor: ready ? "pointer" : "wait" }}
          >
            <FullscreenIcon active={fullscreenActive} />
          </button>
        ) : null}
      </div>
    </>
  );
}
