import {
  TourEngine,
  type HotspotConfig,
  type TourConfigInput,
  type TourEngineOptions,
} from "@meshtour/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TourContext } from "./context";

export interface HotspotRendererHelpers {
  close: () => void;
}

export interface TourProps {
  /** Tour config URL or inline object. */
  config: string | TourConfigInput;
  /** Override the config's start node. */
  initialNode?: string;
  /** Toggle the author/debug overlay. */
  authorMode?: boolean;
  className?: string;
  style?: CSSProperties;
  onReady?: () => void;
  onError?: (error: Error) => void;
  onNodeChange?: (nodeId: string, from: string | null) => void;
  onHotspotClick?: (hotspot: HotspotConfig) => void;
  onInteractableHover?: (id: string | null) => void;
  onInteractableClick?: (id: string) => void;
  /**
   * Custom React UI for hotspot popups. When provided, the engine's built-in
   * HTML popups are disabled and this renders anchored to the hotspot instead.
   */
  hotspotRenderer?: (hotspot: HotspotConfig, helpers: HotspotRendererHelpers) => ReactNode;
  /** Shown while the tour is loading. */
  fallback?: ReactNode;
  /** Shown when loading fails. */
  errorFallback?: (error: Error) => ReactNode;
  /** Extra engine options (draco/ktx2 paths, proxyMesh, prefetch tuning…). */
  engineOptions?: Partial<
    Omit<TourEngineOptions, "container" | "config" | "initialNode" | "authorMode">
  >;
  /** Overlay UI rendered on top of the tour; has access to useTour(). */
  children?: ReactNode;
}

interface ActivePopup {
  hotspot: HotspotConfig;
  x: number;
  y: number;
  visible: boolean;
}

/**
 * React wrapper around the framework-agnostic TourEngine. SSR-safe: the
 * engine only mounts in an effect, so server renders produce an empty shell.
 */
export function Tour(props: TourProps): ReactNode {
  const {
    config,
    initialNode,
    authorMode = false,
    className,
    style,
    hotspotRenderer,
    fallback,
    errorFallback,
    engineOptions,
    children,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<TourEngine | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [popup, setPopup] = useState<ActivePopup | null>(null);

  // Keep latest callbacks in a ref so engine listeners never need rebinding.
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  const hasCustomPopups = Boolean(hotspotRenderer);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const tourEngine = new TourEngine({
      container,
      config,
      initialNode,
      authorMode,
      defaultPopups: !hasCustomPopups,
      ...engineOptions,
    });

    tourEngine.on("ready", () => {
      setReady(true);
      callbacksRef.current.onReady?.();
    });
    tourEngine.on("error", ({ error: err }) => {
      setError(err);
      callbacksRef.current.onError?.(err);
    });
    tourEngine.on("nodechange", ({ from, to }) => {
      setCurrentNode(to);
      setPopup(null);
      callbacksRef.current.onNodeChange?.(to, from);
    });
    tourEngine.on("hotspotclick", ({ hotspot }) => {
      callbacksRef.current.onHotspotClick?.(hotspot);
      if (hasCustomPopups) {
        const { x, y, visible } = tourEngine.worldToScreen(hotspot.position);
        setPopup({ hotspot, x, y, visible });
      }
    });
    tourEngine.on("interactablehover", ({ id }) => {
      callbacksRef.current.onInteractableHover?.(id);
    });
    tourEngine.on("interactableclick", ({ id }) => {
      callbacksRef.current.onInteractableClick?.(id);
    });

    setEngine(tourEngine);
    tourEngine.start().catch(() => {
      /* surfaced via the error event */
    });

    return () => {
      tourEngine.dispose();
      setEngine(null);
      setReady(false);
      setError(null);
      setCurrentNode(null);
      setPopup(null);
    };
    // Intentionally not depending on engineOptions/authorMode: options are
    // start-time only, authorMode is toggled in its own effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, initialNode]);

  useEffect(() => {
    engine?.setAuthorMode(authorMode);
  }, [engine, authorMode]);

  // Track the active popup's screen anchor while the camera moves.
  useEffect(() => {
    if (!engine || !popup) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      setPopup((current) => {
        if (!current) return current;
        const { x, y, visible } = engine.worldToScreen(current.hotspot.position);
        if (x === current.x && y === current.y && visible === current.visible) return current;
        return { ...current, x, y, visible };
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, popup?.hotspot]);

  const closePopup = useCallback(() => setPopup(null), []);

  const contextValue = useMemo(
    () => ({ engine, ready, currentNode }),
    [engine, ready, currentNode],
  );

  return (
    <TourContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={className}
        style={{ position: "relative", width: "100%", height: "100%", ...style }}
      >
        {!ready && !error && fallback ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>{fallback}</div>
        ) : null}
        {error && errorFallback ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>{errorFallback(error)}</div>
        ) : null}
        {popup && hotspotRenderer && popup.visible ? (
          <div
            style={{
              position: "absolute",
              left: popup.x,
              top: popup.y,
              transform: "translate(-50%, calc(-100% - 18px))",
              zIndex: 20,
              pointerEvents: "auto",
            }}
          >
            {hotspotRenderer(popup.hotspot, { close: closePopup })}
          </div>
        ) : null}
        <div style={{ position: "absolute", inset: 0, zIndex: 10, pointerEvents: "none" }}>
          {children}
        </div>
      </div>
    </TourContext.Provider>
  );
}
