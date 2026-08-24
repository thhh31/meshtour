import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { controlTooltipStyles } from "./controlTooltip";
import { useTour } from "./useTour";
import { useGuidedTour } from "./useGuidedTour";

export interface TourGuidedControlsProps {
  /** Guide offered while no story is active. Defaults to the first configured guide. */
  guideId?: string;
  className?: string;
  style?: CSSProperties;
}

const buttonStyle: CSSProperties = {
  minHeight: 38,
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  padding: "8px 14px",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  background: "#fff",
  color: "#0a0b0e",
  borderColor: "#fff",
};

const iconButtonStyle: CSSProperties = {
  ...buttonStyle,
  width: 38,
  padding: 0,
  display: "grid",
  placeItems: "center",
};

const launcherStyle: CSSProperties = {
  position: "absolute",
  zIndex: 45,
  left: 16,
  bottom: "max(16px, calc(10px + env(safe-area-inset-bottom)))",
  pointerEvents: "auto",
  width: 42,
  height: 42,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  background: "rgba(9, 10, 14, 0.72)",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
  backdropFilter: "blur(20px) saturate(130%)",
  WebkitBackdropFilter: "blur(20px) saturate(130%)",
  color: "rgba(255,255,255,0.9)",
  cursor: "pointer",
  animation: "meshtour-guide-launcher-in 360ms cubic-bezier(.22,1,.36,1) both",
};

const GUIDE_EXIT_MS = 260;
const GUIDE_TO_LAUNCHER_MS = 480;

interface GuideMotionGeometry {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

interface StoredRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const guideMotionStyles = `
@keyframes meshtour-guide-in {
  from { opacity: 0; scale: .965; filter: blur(8px); }
  to { opacity: 1; scale: 1; filter: blur(0); }
}
@keyframes meshtour-guide-out {
  from { opacity: 1; scale: 1; filter: blur(0); }
  to { opacity: 0; scale: .975; filter: blur(6px); }
}
@keyframes meshtour-guide-to-launcher {
  from {
    opacity: 1;
    transform: translate(var(--meshtour-guide-base-x), var(--meshtour-guide-base-y))
      translate3d(0, 0, 0) scale(1);
    filter: blur(0);
  }
  68% { opacity: .72; }
  to {
    opacity: 0;
    transform: translate(var(--meshtour-guide-base-x), var(--meshtour-guide-base-y))
      translate3d(var(--meshtour-guide-x), var(--meshtour-guide-y), 0)
      scale(var(--meshtour-guide-scale-x), var(--meshtour-guide-scale-y));
    filter: blur(5px);
    border-radius: 12px;
  }
}
@keyframes meshtour-guide-from-launcher {
  from {
    opacity: 0;
    transform: translate(var(--meshtour-guide-base-x), var(--meshtour-guide-base-y))
      translate3d(var(--meshtour-guide-x), var(--meshtour-guide-y), 0)
      scale(var(--meshtour-guide-scale-x), var(--meshtour-guide-scale-y));
    filter: blur(5px);
    border-radius: 12px;
  }
  32% { opacity: .72; }
  to {
    opacity: 1;
    transform: translate(var(--meshtour-guide-base-x), var(--meshtour-guide-base-y))
      translate3d(0, 0, 0) scale(1);
    filter: blur(0);
  }
}
@keyframes meshtour-guide-launcher-in {
  from { opacity: 0; scale: .76; rotate: -8deg; }
  to { opacity: 1; scale: 1; rotate: 0deg; }
}
.meshtour-guide-invitation__action,
.meshtour-guide-invitation__close {
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease,
    transform 160ms ease;
}
.meshtour-guide-invitation__action:hover:not(:disabled) {
  border-color: rgba(255,255,255,.28) !important;
  background: rgba(255,255,255,.12) !important;
  transform: translateY(-1px);
}
.meshtour-guide-invitation__action--primary:hover:not(:disabled) {
  border-color: #fff !important;
  background: rgba(255,255,255,.9) !important;
}
.meshtour-guide-invitation__close:hover {
  border-color: rgba(255,255,255,.24) !important;
  background: rgba(255,255,255,.12) !important;
  color: #fff !important;
}
.meshtour-guide-invitation__action:focus-visible,
.meshtour-guide-invitation__close:focus-visible {
  outline: 2px solid rgba(255,255,255,.9);
  outline-offset: 3px;
}
@media (prefers-reduced-motion: reduce) {
  .meshtour-guide-motion { animation-duration: 1ms !important; }
  .meshtour-guide-invitation__action,
  .meshtour-guide-invitation__close { transition: none; }
}
`;

function GuideIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="m4 6.5 5.3-2.4 5.4 2.4L20 4.1v13.4l-5.3 2.4-5.4-2.4L4 19.9V6.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9.3 4.1v13.4m5.4-11v13.4" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="14.7" cy="10" r="1.6" fill="currentColor" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M2.75 2.75 11.25 11.25M11.25 2.75l-8.5 8.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

function disabledStyle(disabled: boolean): CSSProperties {
  return disabled ? { opacity: 0.5, cursor: "wait" } : {};
}

export function TourGuidedControls({
  guideId,
  className,
  style,
}: TourGuidedControlsProps): ReactNode {
  const { engine, ready } = useTour();
  const {
    guides,
    state,
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
  } = useGuidedTour();
  const [compact, setCompact] = useState(false);
  const [invitationOpen, setInvitationOpen] = useState(true);
  const [invitationExit, setInvitationExit] = useState<"start" | "launcher" | null>(null);
  const [invitationOpening, setInvitationOpening] = useState(false);
  const [invitationSettled, setInvitationSettled] = useState(false);
  const [guideClosing, setGuideClosing] = useState(false);
  const [invitationGeometry, setInvitationGeometry] = useState<GuideMotionGeometry | null>(null);
  const [guideGeometry, setGuideGeometry] = useState<GuideMotionGeometry | null>(null);
  const timersRef = useRef<number[]>([]);
  const invitationRef = useRef<HTMLElement>(null);
  const guidePanelRef = useRef<HTMLElement>(null);
  const launcherTargetRef = useRef<HTMLDivElement>(null);
  const launcherButtonRef = useRef<HTMLButtonElement>(null);
  const openingLauncherRectRef = useRef<StoredRect | null>(null);

  useEffect(() => {
    const container = engine?.getContainer();
    if (!container) return;
    const update = () => setCompact(container.clientWidth < 720);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [engine]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) window.clearTimeout(timer);
    },
    [],
  );

  const offeredGuide = guides.find((guide) => guide.id === guideId) ?? guides[0] ?? null;

  const afterExit = (action: () => void, duration = GUIDE_EXIT_MS) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      action();
      return;
    }
    const timer = window.setTimeout(action, duration);
    timersRef.current.push(timer);
  };

  const motionGeometry = (
    source: HTMLElement | null,
    target: HTMLElement | StoredRect | null,
  ): GuideMotionGeometry | null => {
    if (!source || !target) return null;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target instanceof HTMLElement ? target.getBoundingClientRect() : target;
    return {
      x: targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2),
      y: targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2),
      scaleX: targetRect.width / sourceRect.width,
      scaleY: targetRect.height / sourceRect.height,
    };
  };

  useLayoutEffect(() => {
    if (!invitationOpen || !invitationOpening || invitationGeometry) return;
    const geometry = motionGeometry(invitationRef.current, openingLauncherRectRef.current);
    if (geometry) setInvitationGeometry(geometry);
  }, [invitationGeometry, invitationOpen, invitationOpening]);

  const geometryStyle = (
    geometry: GuideMotionGeometry | null,
    baseX: string,
    baseY: string,
    centerCorrectionX: string,
    centerCorrectionY: string,
  ): CSSProperties => {
    if (!geometry) return {};
    return {
      transformOrigin: "center",
      overflow: "hidden",
      "--meshtour-guide-base-x": baseX,
      "--meshtour-guide-base-y": baseY,
      "--meshtour-guide-x": `calc(${geometry.x}px + ${centerCorrectionX})`,
      "--meshtour-guide-y": `calc(${geometry.y}px + ${centerCorrectionY})`,
      "--meshtour-guide-scale-x": geometry.scaleX,
      "--meshtour-guide-scale-y": geometry.scaleY,
    } as CSSProperties;
  };

  const dismissInvitation = () => {
    if (invitationExit) return;
    setInvitationOpening(false);
    setInvitationGeometry(motionGeometry(invitationRef.current, launcherTargetRef.current));
    setInvitationExit("launcher");
    afterExit(() => {
      setInvitationOpen(false);
      setInvitationExit(null);
    }, GUIDE_TO_LAUNCHER_MS);
  };

  const beginGuide = () => {
    if (invitationExit || !ready || !offeredGuide) return;
    setInvitationExit("start");
    afterExit(() => {
      setInvitationOpen(false);
      setInvitationExit(null);
      setGuideGeometry(null);
      void start(offeredGuide.id).catch(() => setInvitationOpen(true));
    });
  };

  const closeGuide = () => {
    if (guideClosing) return;
    setGuideGeometry(motionGeometry(guidePanelRef.current, launcherTargetRef.current));
    setGuideClosing(true);
    afterExit(() => {
      void stop()
        .then(() => {
          setGuideClosing(false);
          setGuideGeometry(null);
        })
        .catch(() => setGuideClosing(false));
    }, GUIDE_TO_LAUNCHER_MS);
  };

  if (!offeredGuide) return null;

  const busy = state.status === "navigating";
  const panelStyle: CSSProperties = {
    position: "absolute",
    zIndex: 45,
    pointerEvents: "auto",
    width: compact ? "calc(100% - 24px)" : 340,
    maxWidth: compact ? 520 : "calc(100% - 48px)",
    left: compact ? 12 : 24,
    right: compact ? 12 : "auto",
    top: compact ? "auto" : "50%",
    bottom: compact ? "max(74px, calc(62px + env(safe-area-inset-bottom)))" : "auto",
    transform: compact ? "none" : "translateY(-50%)",
    boxSizing: "border-box",
    borderRadius: 20,
    padding: compact ? 16 : 20,
    background: "rgba(9, 10, 14, 0.82)",
    border: "1px solid rgba(255,255,255,0.11)",
    boxShadow: "0 22px 70px rgba(0,0,0,0.46)",
    backdropFilter: "blur(26px) saturate(135%)",
    WebkitBackdropFilter: "blur(26px) saturate(135%)",
    color: "#fff",
    fontFamily: "inherit",
    ...style,
  };
  const launcherPositionStyle: CSSProperties = {
    ...launcherStyle,
    left: compact ? 12 : launcherStyle.left,
    bottom: compact ? "max(78px, calc(72px + env(safe-area-inset-bottom)))" : launcherStyle.bottom,
  };
  const launcherTargetStyle: CSSProperties = {
    ...launcherPositionStyle,
    visibility: "hidden",
    pointerEvents: "none",
    animation: "none",
  };

  if (!activeGuide || !activeStep) {
    if (!invitationOpen) {
      return (
        <>
          <style>{`${controlTooltipStyles}\n${guideMotionStyles}`}</style>
          <button
            ref={launcherButtonRef}
            type="button"
            className={`${className ?? ""} meshtour-guide-motion meshtour-control-tooltip`.trim()}
            onClick={() => {
              const rect = launcherButtonRef.current?.getBoundingClientRect();
              openingLauncherRectRef.current = rect
                ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                : null;
              setInvitationGeometry(null);
              setInvitationOpening(true);
              setInvitationOpen(true);
            }}
            aria-label="Open guided tour"
            data-tooltip="Open guided tour"
            style={{
              ...launcherPositionStyle,
            }}
          >
            <GuideIcon />
          </button>
        </>
      );
    }

    const invitationStyle: CSSProperties = {
      ...panelStyle,
      width: compact ? "calc(100% - 24px)" : 560,
      maxWidth: "calc(100% - 24px)",
      maxHeight: "calc(100% - 24px)",
      left: "50%",
      right: "auto",
      top: "50%",
      bottom: "auto",
      transform: "translate(-50%, -50%)",
      overflowY: "auto",
      borderRadius: compact ? 20 : 24,
      padding: compact ? 20 : 32,
      background: "linear-gradient(145deg, rgba(21, 22, 26, 0.94) 0%, rgba(9, 10, 14, 0.94) 100%)",
      border: "1px solid rgba(255,255,255,0.13)",
      boxShadow: "0 28px 90px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.04)",
    };

    const invitationCloseButtonStyle: CSSProperties = {
      ...iconButtonStyle,
      width: 34,
      minHeight: 34,
      background: "rgba(255,255,255,0.06)",
      color: "rgba(255,255,255,0.68)",
    };

    return (
      <>
        <style>{guideMotionStyles}</style>
        <div ref={launcherTargetRef} aria-hidden="true" style={launcherTargetStyle} />
        <aside
          ref={invitationRef}
          className={`${className ?? ""} meshtour-guide-motion`.trim()}
          style={{
            ...invitationStyle,
            ...geometryStyle(
              invitationGeometry,
              "-50%",
              "-50%",
              invitationOpening ? "50%" : "0px",
              invitationOpening ? "50%" : "0px",
            ),
            visibility: invitationOpening && !invitationGeometry ? "hidden" : "visible",
            pointerEvents: invitationExit ? "none" : "auto",
            animation:
              invitationExit === "launcher"
                ? `meshtour-guide-to-launcher ${GUIDE_TO_LAUNCHER_MS}ms cubic-bezier(.22,1,.36,1) both`
                : invitationExit === "start"
                  ? `meshtour-guide-out ${GUIDE_EXIT_MS}ms cubic-bezier(.22,1,.36,1) both`
                  : invitationOpening
                    ? `meshtour-guide-from-launcher ${GUIDE_TO_LAUNCHER_MS}ms cubic-bezier(.22,1,.36,1) both`
                    : invitationSettled
                      ? "none"
                      : "meshtour-guide-in 420ms cubic-bezier(.22,1,.36,1) both",
          }}
          onAnimationEnd={(event) => {
            if (event.animationName === "meshtour-guide-in") {
              setInvitationSettled(true);
            } else if (event.animationName === "meshtour-guide-from-launcher") {
              setInvitationOpening(false);
              setInvitationGeometry(null);
              setInvitationSettled(true);
            }
          }}
          aria-label="Guided property tour"
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div
              style={{
                fontSize: compact ? 9 : 10,
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.48)",
              }}
            >
              Guided property story
            </div>
            <button
              type="button"
              onClick={dismissInvitation}
              aria-label="Dismiss guided tour invitation"
              data-tooltip="Dismiss guided tour"
              data-tooltip-align="end"
              className="meshtour-guide-invitation__close meshtour-control-tooltip"
              style={invitationCloseButtonStyle}
            >
              <CloseIcon />
            </button>
          </div>
          <h2
            style={{
              margin: compact ? "14px 0 0" : "16px 0 0",
              maxWidth: 480,
              fontSize: compact ? 23 : 30,
              fontWeight: 650,
              lineHeight: 1.16,
              letterSpacing: "-0.02em",
            }}
          >
            {offeredGuide.title}
          </h2>
          {offeredGuide.description ? (
            <p
              style={{
                margin: compact ? "10px 0 20px" : "12px 0 24px",
                maxWidth: 470,
                color: "rgba(255,255,255,0.62)",
                fontSize: compact ? 13 : 14,
                lineHeight: 1.55,
              }}
            >
              {offeredGuide.description}
            </p>
          ) : null}
          <div
            style={{
              display: compact ? "grid" : "flex",
              gridTemplateColumns: compact ? "1fr" : undefined,
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <button
              type="button"
              disabled={!ready}
              onClick={beginGuide}
              className="meshtour-guide-invitation__action meshtour-guide-invitation__action--primary"
              style={{
                ...primaryButtonStyle,
                ...disabledStyle(!ready),
                minHeight: 44,
                padding: "10px 18px",
                fontSize: 13,
              }}
            >
              Start guided tour · {offeredGuide.steps.length} chapters
            </button>
            <button
              type="button"
              onClick={dismissInvitation}
              className="meshtour-guide-invitation__action"
              style={{ ...buttonStyle, minHeight: 44, padding: "10px 16px", fontSize: 12 }}
            >
              Explore on my own
            </button>
          </div>
        </aside>
      </>
    );
  }

  const last = state.stepIndex === activeGuide.steps.length - 1;
  const statusMessage =
    state.status === "navigating"
      ? "Moving to the next chapter"
      : state.status === "exploring"
        ? "Free exploration — resume whenever you are ready"
        : state.status === "error"
          ? (state.error?.message ?? "This chapter could not be shown")
          : `Chapter ${state.stepIndex + 1} of ${activeGuide.steps.length}`;

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (busy) return;
    if (event.key === "ArrowLeft" && state.stepIndex > 0) {
      event.preventDefault();
      void previous();
    } else if (event.key === "ArrowRight" && !last) {
      event.preventDefault();
      void next();
    }
  };

  return (
    <>
      <style>{guideMotionStyles}</style>
      <div ref={launcherTargetRef} aria-hidden="true" style={launcherTargetStyle} />
      <section
        ref={guidePanelRef}
        className={`${className ?? ""} meshtour-guide-motion`.trim()}
        style={{
          ...panelStyle,
          ...geometryStyle(guideGeometry, "0px", compact ? "0px" : "-50%", "0px", "0px"),
          pointerEvents: guideClosing ? "none" : "auto",
          animation: `${guideClosing ? "meshtour-guide-to-launcher" : "meshtour-guide-in"} ${
            guideClosing ? GUIDE_TO_LAUNCHER_MS : 420
          }ms cubic-bezier(.22,1,.36,1) both`,
        }}
        aria-label={`${activeGuide.title} guided tour`}
        aria-live="polite"
        onKeyDown={handleKeyDown}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {activeGuide.title}
          </div>
          <button
            type="button"
            onClick={closeGuide}
            aria-label="Close guided tour"
            data-tooltip="Close guided tour"
            data-tooltip-align="end"
            className="meshtour-control-tooltip"
            style={iconButtonStyle}
          >
            <CloseIcon />
          </button>
        </div>

        <div
          role="progressbar"
          aria-label="Guided tour progress"
          aria-valuemin={1}
          aria-valuemax={activeGuide.steps.length}
          aria-valuenow={state.stepIndex + 1}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clipPath: "inset(50%)",
          }}
        />
        <nav aria-label="Guided tour chapters" style={{ display: "flex", gap: 6, marginTop: 14 }}>
          {activeGuide.steps.map((step, index) => (
            <button
              key={step.id}
              type="button"
              disabled={busy}
              onClick={() => void goToStep(index)}
              aria-label={`Go to chapter ${index + 1}: ${step.title}`}
              data-tooltip={`Chapter ${index + 1}: ${step.title}`}
              className="meshtour-control-tooltip"
              aria-current={index === state.stepIndex ? "step" : undefined}
              style={{
                height: 4,
                flex: 1,
                border: 0,
                borderRadius: 999,
                padding: 0,
                cursor: busy ? "wait" : "pointer",
                background: index <= state.stepIndex ? "#fff" : "rgba(255,255,255,0.2)",
              }}
            />
          ))}
        </nav>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>{statusMessage}</div>
          <h2 style={{ margin: "7px 0 0", fontSize: 21, lineHeight: 1.2 }}>{activeStep.title}</h2>
          {activeStep.body ? (
            <p
              style={{
                margin: "10px 0 0",
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
                lineHeight: 1.55,
              }}
            >
              {activeStep.body}
            </p>
          ) : null}
        </div>

        {state.status === "exploring" || state.status === "error" ? (
          <button
            type="button"
            onClick={() => void resume()}
            style={{ ...primaryButtonStyle, width: "100%", marginTop: 16 }}
          >
            {state.status === "error" ? "Retry chapter" : "Resume chapter"}
          </button>
        ) : null}

        {last && activeGuide.cta ? (
          activeGuide.cta.href ? (
            <a
              href={activeGuide.cta.href}
              onClick={triggerAction}
              style={{
                ...primaryButtonStyle,
                display: "block",
                boxSizing: "border-box",
                width: "100%",
                marginTop: 16,
                textAlign: "center",
                textDecoration: "none",
              }}
            >
              {activeGuide.cta.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={triggerAction}
              style={{ ...primaryButtonStyle, width: "100%", marginTop: 16 }}
            >
              {activeGuide.cta.label}
            </button>
          )
        ) : null}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            type="button"
            disabled={busy || state.stepIndex === 0}
            onClick={() => void previous()}
            style={{ ...buttonStyle, ...disabledStyle(busy || state.stepIndex === 0) }}
          >
            Back
          </button>
          {activeGuide.autoplay ? (
            <button
              type="button"
              disabled={busy || last}
              onClick={state.autoplay ? pause : play}
              style={{ ...buttonStyle, ...disabledStyle(busy || last) }}
              aria-label={state.autoplay ? "Pause guided tour autoplay" : "Play guided tour"}
            >
              {state.autoplay ? "Pause" : "Play"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={busy || last}
            onClick={() => void next()}
            style={{
              ...primaryButtonStyle,
              ...disabledStyle(busy || last),
              marginLeft: "auto",
            }}
          >
            {busy ? "Moving…" : last ? "Complete" : "Next"}
          </button>
        </div>
      </section>
    </>
  );
}
