import { useTour } from "@meshtour/react";

interface TourPoint {
  readonly id: string;
  readonly name: string;
}

interface NodeSwitcherProps {
  /** Static point metadata keeps the navigation rail visible during loading. */
  readonly nodes: readonly TourPoint[];
}

/** Persistent bottom navigation driven by the public useTour() API. */
export function NodeSwitcher({ nodes }: NodeSwitcherProps) {
  const { engine, ready, currentNode, goToNode } = useTour();
  const navigate = (nodeId: string) => {
    if (!ready || !engine) return;
    const instant = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void goToNode(nodeId, instant ? { instant: true } : undefined);
  };
  const compact = nodes.length <= 3;

  return (
    <nav
      style={{
        position: "absolute",
        zIndex: 40,
        bottom: "max(16px, calc(10px + env(safe-area-inset-bottom)))",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        justifyContent: "center",
        gap: 6,
        pointerEvents: "auto",
        background: "rgba(12,12,16,0.82)",
        border: "1px solid rgba(255,255,255,0.12)",
        backdropFilter: "blur(18px) saturate(1.2)",
        WebkitBackdropFilter: "blur(18px) saturate(1.2)",
        borderRadius: 18,
        padding: 6,
        boxShadow: "0 12px 36px rgba(0,0,0,0.46)",
        width: compact ? "min(560px, calc(100vw - 24px))" : "max-content",
        maxWidth: "calc(100vw - 24px)",
        overflowX: compact ? "visible" : "auto",
        boxSizing: "border-box",
      }}
      aria-label="Tour points"
    >
      {nodes.map((node, index) => {
        const selected = node.id === currentNode;
        return (
          <button
            key={node.id}
            type="button"
            disabled={!ready || !engine}
            onClick={() => navigate(node.id)}
            aria-current={selected ? "location" : undefined}
            aria-label={`Point ${index + 1}: ${node.name}`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              flex: compact ? "1 1 0" : "0 0 auto",
              minWidth: 0,
              minHeight: 44,
              background: selected ? "rgba(255,255,255,0.96)" : "transparent",
              color: selected ? "#17171b" : "rgba(255,255,255,0.88)",
              border: "1px solid",
              borderColor: selected ? "rgba(255,255,255,0.96)" : "rgba(255,255,255,0.13)",
              borderRadius: 13,
              padding: compact ? "8px 10px" : "8px 14px",
              cursor: ready ? "pointer" : "wait",
              opacity: ready ? 1 : 0.62,
              font: "inherit",
              fontSize: 13,
              fontWeight: selected ? 700 : 560,
              lineHeight: 1.15,
              transition: "background 160ms ease, color 160ms ease, border-color 160ms ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                flex: "0 0 auto",
                fontSize: 10,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: 0.5,
                opacity: selected ? 0.58 : 0.5,
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
