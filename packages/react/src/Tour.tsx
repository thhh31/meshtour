import {
  TourEngine,
  type ConfigurationChangeSource,
  type ConfigurationQuotePayload,
  type ConfigurationState,
  type CustomMeasurementState,
  type GuideConfig,
  type GuideState,
  type GuideStepSource,
  type HotspotConfig,
  type TourConfigInput,
  type TourEngineOptions,
  type TourViewMode,
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
  onReady?: (engine: TourEngine) => void;
  onError?: (error: Error) => void;
  onNodeChange?: (nodeId: string, from: string | null) => void;
  onTransitionStart?: (from: string, to: string) => void;
  onTransitionEnd?: (from: string, to: string) => void;
  onHotspotClick?: (hotspot: HotspotConfig) => void;
  onInteractableHover?: (id: string | null) => void;
  onInteractableClick?: (id: string) => void;
  onVariantChange?: (configurableId: string, variantId: string) => void;
  onConfigurationChange?: (
    configuration: ConfigurationState,
    source: ConfigurationChangeSource,
  ) => void;
  onConfigurationRequest?: (payload: ConfigurationQuotePayload) => void;
  onViewModeChange?: (mode: TourViewMode) => void;
  onMeasurementsChange?: (visible: boolean) => void;
  onCustomMeasurementChange?: (measurement: CustomMeasurementState) => void;
  onVRSupportChange?: (supported: boolean) => void;
  onVRChange?: (active: boolean) => void;
  onGuideStart?: (guideId: string) => void;
  onGuideStepChange?: (
    guideId: string,
    stepId: string,
    stepIndex: number,
    source: GuideStepSource,
  ) => void;
  onGuideExplore?: (guideId: string, stepId: string, stepIndex: number) => void;
  onGuideAutoplayChange?: (guideId: string, playing: boolean) => void;
  onGuideComplete?: (guideId: string) => void;
  onGuideExit?: (guideId: string) => void;
  onGuideAction?: (guideId: string, action: NonNullable<GuideConfig["cta"]>) => void;
  onGuideError?: (guideId: string, stepId: string, error: Error) => void;
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
  closing: boolean;
}

const popupMotionStyles = `
@keyframes meshtour-popup-in {
  from { opacity: 0; scale: .94; translate: 0 8px; filter: blur(5px); }
  to { opacity: 1; scale: 1; translate: 0 0; filter: blur(0); }
}
@keyframes meshtour-popup-out {
  from { opacity: 1; scale: 1; translate: 0 0; filter: blur(0); }
  to { opacity: 0; scale: .94; translate: 0 8px; filter: blur(5px); }
}
@media (prefers-reduced-motion: reduce) {
  .meshtour-react-popup { animation-duration: 1ms !important; }
}
`;

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
  const [transitioning, setTransitioning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [currentNode, setCurrentNode] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<TourViewMode>("panorama");
  const [measurementsVisible, setMeasurementsVisible] = useState(false);
  const [customMeasurement, setCustomMeasurement] = useState<CustomMeasurementState>({
    active: false,
    points: [],
    length: 0,
    perimeter: null,
    area: null,
  });
  const [vrSupported, setVRSupported] = useState(false);
  const [vrActive, setVRActive] = useState(false);
  const [guides, setGuides] = useState<readonly GuideConfig[]>([]);
  const [guideState, setGuideState] = useState<GuideState>({
    guideId: null,
    stepIndex: -1,
    status: "idle",
    autoplay: false,
    error: null,
  });
  const [configuration, setConfiguration] = useState<ConfigurationState | null>(null);
  const [popup, setPopup] = useState<ActivePopup | null>(null);
  const popupElementRef = useRef<HTMLDivElement>(null);

  // Keep latest callbacks in a ref so engine listeners never need rebinding.
  const callbacksRef = useRef(props);
  useEffect(() => {
    callbacksRef.current = props;
  }, [props]);

  const hasCustomPopups = Boolean(hotspotRenderer);
  const closePopup = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPopup(null);
      return;
    }
    setPopup((current) => (current?.closing ? current : current && { ...current, closing: true }));
  }, []);

  const popupClosing = popup?.closing ?? false;
  useEffect(() => {
    if (!popupClosing) return;
    const timer = window.setTimeout(() => setPopup(null), 220);
    return () => window.clearTimeout(timer);
  }, [popupClosing]);

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
      setGuides(tourEngine.getGuides());
      setGuideState(tourEngine.getGuideState());
      setConfiguration(tourEngine.getConfigurationState());
      setCustomMeasurement(tourEngine.getCustomMeasurement());
      callbacksRef.current.onReady?.(tourEngine);
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
    tourEngine.on("transitionstart", ({ from, to }) => {
      setTransitioning(true);
      callbacksRef.current.onTransitionStart?.(from, to);
    });
    tourEngine.on("transitionend", ({ from, to }) => {
      setTransitioning(false);
      callbacksRef.current.onTransitionEnd?.(from, to);
    });
    tourEngine.on("hotspotclick", ({ hotspot }) => {
      callbacksRef.current.onHotspotClick?.(hotspot);
      if (hasCustomPopups) {
        const { x, y, visible } = tourEngine.worldToScreen(hotspot.position);
        setPopup({ hotspot, x, y, visible, closing: false });
      }
    });
    tourEngine.on("interactablehover", ({ id }) => {
      callbacksRef.current.onInteractableHover?.(id);
    });
    tourEngine.on("interactableclick", ({ id }) => {
      callbacksRef.current.onInteractableClick?.(id);
    });
    tourEngine.on("variantchange", ({ configurableId, variantId }) => {
      callbacksRef.current.onVariantChange?.(configurableId, variantId);
    });
    tourEngine.on("configurationstatechange", ({ configuration: next, source }) => {
      setConfiguration(next);
      callbacksRef.current.onConfigurationChange?.(next, source);
    });
    tourEngine.on("configurationrequest", ({ payload }) => {
      callbacksRef.current.onConfigurationRequest?.(payload);
    });
    tourEngine.on("viewmodechange", ({ mode }) => {
      setViewMode(mode);
      callbacksRef.current.onViewModeChange?.(mode);
    });
    tourEngine.on("viewtransitionstart", () => setTransitioning(true));
    tourEngine.on("viewtransitionend", () => setTransitioning(false));
    tourEngine.on("measurementschange", ({ visible }) => {
      setMeasurementsVisible(visible);
      callbacksRef.current.onMeasurementsChange?.(visible);
    });
    tourEngine.on("custommeasurementchange", ({ measurement }) => {
      setCustomMeasurement(measurement);
      callbacksRef.current.onCustomMeasurementChange?.(measurement);
    });
    tourEngine.on("vrsupportchange", ({ supported }) => {
      setVRSupported(supported);
      callbacksRef.current.onVRSupportChange?.(supported);
    });
    tourEngine.on("vrchange", ({ active }) => {
      setVRActive(active);
      setPopup(null);
      callbacksRef.current.onVRChange?.(active);
    });
    tourEngine.on("guidestatechange", ({ state }) => setGuideState(state));
    tourEngine.on("guidestart", ({ guideId }) => {
      callbacksRef.current.onGuideStart?.(guideId);
    });
    tourEngine.on("guidestepchange", ({ guideId, stepId, stepIndex, source }) => {
      callbacksRef.current.onGuideStepChange?.(guideId, stepId, stepIndex, source);
    });
    tourEngine.on("guideexplore", ({ guideId, stepId, stepIndex }) => {
      callbacksRef.current.onGuideExplore?.(guideId, stepId, stepIndex);
    });
    tourEngine.on("guideautoplaychange", ({ guideId, playing }) => {
      callbacksRef.current.onGuideAutoplayChange?.(guideId, playing);
    });
    tourEngine.on("guidecomplete", ({ guideId }) => {
      callbacksRef.current.onGuideComplete?.(guideId);
    });
    tourEngine.on("guideexit", ({ guideId }) => {
      callbacksRef.current.onGuideExit?.(guideId);
    });
    tourEngine.on("guideaction", ({ guideId, action }) => {
      callbacksRef.current.onGuideAction?.(guideId, action);
    });
    tourEngine.on("guideerror", ({ guideId, stepId, error: guideError }) => {
      callbacksRef.current.onGuideError?.(guideId, stepId, guideError);
    });

    setEngine(tourEngine);
    tourEngine.start().catch(() => {
      /* surfaced via the error event */
    });

    return () => {
      tourEngine.dispose();
      setEngine(null);
      setReady(false);
      setTransitioning(false);
      setError(null);
      setCurrentNode(null);
      setViewMode("panorama");
      setMeasurementsVisible(false);
      setCustomMeasurement({
        active: false,
        points: [],
        length: 0,
        perimeter: null,
        area: null,
      });
      setVRSupported(false);
      setVRActive(false);
      setGuides([]);
      setGuideState({
        guideId: null,
        stepIndex: -1,
        status: "idle",
        autoplay: false,
        error: null,
      });
      setConfiguration(null);
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
  const popupHotspot = popup?.hotspot;
  useEffect(() => {
    if (!engine || !popupHotspot) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      setPopup((current) => {
        if (!current) return current;
        const { x, y, visible } = engine.worldToScreen(popupHotspot.position);
        if (x === current.x && y === current.y && visible === current.visible) return current;
        return { ...current, x, y, visible };
      });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [engine, popupHotspot]);

  const contextValue = useMemo(
    () => ({
      engine,
      ready,
      transitioning,
      currentNode: viewMode === "dollhouse" ? null : currentNode,
      viewMode,
      measurementsVisible,
      customMeasurement,
      vrSupported,
      vrActive,
      guides,
      guideState,
      configuration,
    }),
    [
      engine,
      ready,
      transitioning,
      currentNode,
      viewMode,
      measurementsVisible,
      customMeasurement,
      vrSupported,
      vrActive,
      guides,
      guideState,
      configuration,
    ],
  );

  return (
    <TourContext.Provider value={contextValue}>
      <div
        ref={containerRef}
        className={className}
        style={{ position: "relative", width: "100%", height: "100%", ...style }}
        onPointerDownCapture={(event) => {
          if (!popup || popup.closing || popupElementRef.current?.contains(event.target as Node)) {
            return;
          }
          closePopup();
        }}
      >
        <style>{popupMotionStyles}</style>
        {!ready && !error && fallback ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>{fallback}</div>
        ) : null}
        {error && errorFallback ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 5 }}>{errorFallback(error)}</div>
        ) : null}
        {popup && hotspotRenderer && (popup.visible || popup.closing) ? (
          <div
            key={popup.hotspot.id}
            ref={popupElementRef}
            className="meshtour-react-popup"
            style={{
              position: "absolute",
              left: popup.x,
              top: popup.y,
              transform: "translate(-50%, calc(-100% - 18px))",
              zIndex: 20,
              pointerEvents: popup.closing ? "none" : "auto",
              transformOrigin: "50% 100%",
              animation: `${popup.closing ? "meshtour-popup-out 220ms ease" : "meshtour-popup-in 320ms cubic-bezier(.22,1,.36,1)"} both`,
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
