import { useTour } from "@meshtour/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface TourPoint {
  readonly id: string;
  readonly name: string;
}

interface NodeSwitcherProps {
  /** Static point metadata keeps the navigation rail visible during loading. */
  readonly nodes: readonly TourPoint[];
}

interface IndicatorState {
  left: number;
  width: number;
  height: number;
  ready: boolean;
}

/** Persistent bottom navigation driven by the public useTour() API with smooth sliding pill animation. */
export function NodeSwitcher({ nodes }: NodeSwitcherProps) {
  const { engine, ready, transitioning, currentNode, goToNode } = useTour();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [navigationPending, setNavigationPending] = useState(false);
  const [indicator, setIndicator] = useState<IndicatorState | null>(null);
  /** Optimistic target — moves the pill the instant a button is clicked. */
  const [visualTarget, setVisualTarget] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const navigationLockRef = useRef(false);

  const activeNodeId = visualTarget ?? currentNode ?? nodes[0]?.id ?? null;
  const navigationDisabled = !ready || !engine || navigationPending || transitioning;

  const navigate = (nodeId: string) => {
    if (
      navigationDisabled ||
      navigationLockRef.current ||
      engine.state === "transitioning" ||
      nodeId === currentNode
    ) {
      return;
    }
    navigationLockRef.current = true;
    setNavigationPending(true);
    setVisualTarget(nodeId);
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void goToNode(nodeId, instant ? { instant: true } : undefined).finally(() => {
      navigationLockRef.current = false;
      setNavigationPending(false);
      setVisualTarget(null);
    });
  };
  const compact = nodes.length <= 3;

  const updateIndicatorFor = (nodeId: string | null, animate = true) => {
    if (!nodeId) return;
    const el = buttonRefs.current.get(nodeId);
    const navEl = navRef.current;
    if (!el || !navEl) return;

    const navRect = navEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const left = elRect.left - navRect.left + navEl.scrollLeft;
    const width = elRect.width;
    const height = elRect.height;

    setIndicator((prev) => {
      if (
        prev &&
        prev.left === left &&
        prev.width === width &&
        prev.height === height &&
        prev.ready
      ) {
        return prev;
      }
      return {
        left,
        width,
        height,
        ready: animate ? (prev?.ready ?? false) : false,
      };
    });
  };

  useLayoutEffect(() => {
    updateIndicatorFor(activeNodeId, false);
    const frame = requestAnimationFrame(() => {
      setIndicator((prev) => (prev ? { ...prev, ready: true } : null));
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  useEffect(() => {
    updateIndicatorFor(activeNodeId, true);
  }, [activeNodeId]);

  useEffect(() => {
    const navEl = navRef.current;
    if (!navEl) return;

    const handleResize = () => updateIndicatorFor(activeNodeId, false);
    window.addEventListener("resize", handleResize);

    const observer = new ResizeObserver(() => updateIndicatorFor(activeNodeId, false));
    observer.observe(navEl);
    for (const button of buttonRefs.current.values()) {
      if (button) observer.observe(button);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes]);

  return (
    <nav
      ref={navRef}
      style={{
        position: "absolute",
        zIndex: 40,
        bottom: "max(18px, calc(12px + env(safe-area-inset-bottom)))",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        pointerEvents: "auto",
        background: "rgba(9, 10, 14, 0.65)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        backdropFilter: "blur(24px) saturate(140%)",
        WebkitBackdropFilter: "blur(24px) saturate(140%)",
        borderRadius: 9999,
        padding: 4,
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255, 255, 255, 0.03)",
        width: compact ? "min(520px, calc(100vw - 24px))" : "max-content",
        maxWidth: "calc(100vw - 24px)",
        overflowX: compact ? "visible" : "auto",
        boxSizing: "border-box",
      }}
      aria-label="Tour points"
    >
      {indicator && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            transform: `translate3d(${indicator.left}px, -50%, 0)`,
            width: indicator.width,
            height: indicator.height,
            borderRadius: 9999,
            background: "#ffffff",
            boxShadow: "0 2px 10px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.12)",
            pointerEvents: "none",
            zIndex: 1,
            opacity: indicator.ready ? 1 : 0,
            transition: indicator.ready
              ? "transform 320ms cubic-bezier(0.2, 0.9, 0.25, 1), width 320ms cubic-bezier(0.2, 0.9, 0.25, 1), height 320ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 150ms ease"
              : "opacity 150ms ease",
          }}
        />
      )}

      {nodes.map((node, index) => {
        const selected = node.id === activeNodeId;
        const hovered = hoveredId === node.id && !selected;
        return (
          <button
            key={node.id}
            ref={(el) => {
              if (el) buttonRefs.current.set(node.id, el);
              else buttonRefs.current.delete(node.id);
            }}
            type="button"
            disabled={navigationDisabled}
            onClick={() => navigate(node.id)}
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() => setHoveredId(null)}
            aria-current={node.id === currentNode ? "location" : undefined}
            aria-label={`Point ${index + 1}: ${node.name}`}
            style={{
              position: "relative",
              zIndex: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              flex: compact ? "1 1 0" : "0 0 auto",
              minWidth: 0,
              minHeight: 40,
              background: hovered ? "rgba(255, 255, 255, 0.07)" : "transparent",
              color: selected ? "#08080a" : hovered ? "#ffffff" : "rgba(255, 255, 255, 0.72)",
              border: "1px solid",
              borderColor: hovered ? "rgba(255, 255, 255, 0.12)" : "transparent",
              borderRadius: 9999,
              padding: compact ? "7px 12px" : "7px 16px",
              cursor: navigationDisabled ? "wait" : "pointer",
              opacity: navigationDisabled ? 0.6 : 1,
              font: "inherit",
              fontSize: 12.5,
              fontWeight: selected ? 600 : 500,
              letterSpacing: "0.03em",
              lineHeight: 1.2,
              transition:
                "color 240ms cubic-bezier(0.2, 0.9, 0.25, 1), background 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "0 0 auto",
                fontSize: 9.5,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "0.08em",
                fontWeight: 600,
                color: selected ? "#08080a" : "inherit",
                opacity: selected ? 0.55 : 0.42,
                transition:
                  "color 240ms cubic-bezier(0.2, 0.9, 0.25, 1), opacity 240ms cubic-bezier(0.2, 0.9, 0.25, 1)",
              }}
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span style={{ overflowWrap: "anywhere" }}>{node.name}</span>
          </button>
        );
      })}
    </nav>
  );
}
