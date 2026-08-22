import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
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
    vrSupported,
    vrActive,
    goToNode,
    setViewMode,
    setMeasurementsVisible,
    enterVR,
    exitVR,
  } = useTour();
  const compact = useCompactLayout();
  const planSurfaceRef = useRef<HTMLDivElement>(null);
  const planCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [planSize, setPlanSize] = useState<Size>({ width: 0, height: 0 });
  const [yaw, setYaw] = useState(0);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const config = engine?.getConfig();
  const bounds = engine?.getPlanBounds();
  const nodes = config?.nodes ?? [];
  const hasMeasurements = engine?.hasMeasurements() ?? false;

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
        setYaw(nextYaw);
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
  const cone = (() => {
    if (!activePoint) return "";
    const length = compact ? 24 : 34;
    const halfWidth = compact ? 12 : 17;
    const dx = -Math.sin(yaw);
    const dy = -Math.cos(yaw);
    const px = -dy;
    const py = dx;
    return [
      `${activePoint.x},${activePoint.y}`,
      `${activePoint.x + dx * length + px * halfWidth},${activePoint.y + dy * length + py * halfWidth}`,
      `${activePoint.x + dx * length - px * halfWidth},${activePoint.y + dy * length - py * halfWidth}`,
    ].join(" ");
  })();

  const planWidth = compact ? 138 : 218;
  const planHeight = compact ? 110 : 166;
  const topLabel = viewMode === "top" ? "Return to panorama" : "Open top view";
  const dollhouseLabel = viewMode === "dollhouse" ? "Return to panorama" : "Open dollhouse view";
  const vrLabel = vrActive ? "Exit VR" : "Enter VR";

  return (
    <>
      <style>{`.meshtour-css-fullscreen{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important;z-index:2147483000!important;background:#08080a!important}`}</style>
      {plan ? (
        <section
          aria-label="Apartment plan"
          style={{
            position: "absolute",
            zIndex: 42,
            left: compact ? 10 : 16,
            top: compact ? 10 : 16,
            width: planWidth,
            height: planHeight,
            pointerEvents: "auto",
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
                <svg
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${planSize.width} ${planSize.height}`}
                  aria-hidden="true"
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  {activePoint && viewMode === "panorama" ? (
                    <polygon points={cone} fill="rgba(88,211,247,.26)" />
                  ) : null}
                </svg>
                {nodes.map((node, index) => {
                  const point = planPoint(node.position[0], node.position[2], bounds, planSize);
                  const current = node.id === currentNode;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      aria-label={`Plan point ${index + 1}`}
                      title={node.name ?? node.id}
                      onClick={() => {
                        setViewMode("panorama");
                        void goToNode(node.id);
                      }}
                      style={{
                        position: "absolute",
                        left: point.x,
                        top: point.y,
                        transform: "translate(-50%,-50%)",
                        width: current ? 16 : 13,
                        height: current ? 16 : 13,
                        padding: 0,
                        border: current
                          ? "2px solid rgba(255,255,255,.9)"
                          : "2px solid rgba(20,21,24,.76)",
                        borderRadius: "50%",
                        background: current ? "#58d3f7" : "rgba(255,255,255,.96)",
                        boxShadow: "0 2px 8px rgba(0,0,0,.52)",
                        cursor: "pointer",
                      }}
                    />
                  );
                })}
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      <div
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
            onClick={() => {
              const action = vrActive ? exitVR() : enterVR();
              void action.catch((error: unknown) => {
                console.warn(`MeshTour could not ${vrActive ? "exit" : "enter"} VR`, error);
              });
            }}
            disabled={!ready}
            aria-label={vrLabel}
            title={vrLabel}
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
            onClick={() => setViewMode(viewMode === "dollhouse" ? "panorama" : "dollhouse")}
            disabled={!ready}
            aria-label={dollhouseLabel}
            title={dollhouseLabel}
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
          onClick={() => setViewMode(viewMode === "top" ? "panorama" : "top")}
          disabled={!ready}
          aria-label={topLabel}
          title={topLabel}
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
            aria-label={measurementsVisible ? "Hide measurements" : "Show measurements"}
            title={measurementsVisible ? "Hide measurements" : "Show measurements"}
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
        {fullscreen ? (
          <button
            type="button"
            aria-label={fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"}
            title={fullscreenActive ? "Exit fullscreen" : "Enter fullscreen"}
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
