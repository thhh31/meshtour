import { useTour } from "@meshtour/react";
import { useEffect, useState } from "react";

interface MaterialVariantPopupProps {
  configurableId: string;
  onClose: () => void;
}

/** Config-driven material choices rendered inside an anchored hotspot popup. */
export function MaterialVariantPopup({ configurableId, onClose }: MaterialVariantPopupProps) {
  const { engine, ready } = useTour();
  const configurable = engine
    ?.getConfig()
    ?.configurables.find((entry) => entry.id === configurableId);
  const [selected, setSelected] = useState(
    () => engine?.getVariant(configurableId) ?? configurable?.default ?? "",
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredVariant, setHoveredVariant] = useState<string | null>(null);

  const activeSelected = engine?.getVariant(configurableId) ?? selected;
  const title = configurable?.label ?? "Material";
  const titleId = `material-title-${configurableId}`;

  useEffect(() => {
    if (!engine) return;
    return engine.on("variantchange", ({ configurableId: changedId, variantId }) => {
      if (changedId === configurableId) setSelected(variantId);
    });
  }, [configurableId, engine]);

  const choose = async (variantId: string) => {
    if (!engine || loading || variantId === activeSelected) return;
    setLoading(variantId);
    setError(null);
    try {
      await engine.setVariant(configurableId, variantId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(null);
    }
  };

  return (
    <section
      role="dialog"
      aria-labelledby={titleId}
      style={{
        width: "min(320px, calc(100vw - 32px))",
        boxSizing: "border-box",
        padding: "16px 18px",
        borderRadius: 16,
        color: "#ffffff",
        background: "rgba(10, 11, 15, 0.85)",
        border: "1px solid rgba(255, 255, 255, 0.09)",
        backdropFilter: "blur(24px) saturate(130%)",
        WebkitBackdropFilter: "blur(24px) saturate(130%)",
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.52), 0 0 0 1px rgba(255, 255, 255, 0.03)",
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div
            id={titleId}
            style={{
              fontWeight: 600,
              fontSize: 14,
              letterSpacing: "0.03em",
              color: "#ffffff",
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 2,
              color: "rgba(255, 255, 255, 0.42)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
            }}
          >
            Select a finish
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          style={{
            border: 0,
            color: "rgba(255, 255, 255, 0.5)",
            background: "none",
            cursor: "pointer",
            fontSize: 18,
            lineHeight: 1,
            padding: 4,
            display: "grid",
            placeItems: "center",
            borderRadius: 6,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)")}
        >
          ×
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
        {configurable?.variants.map((variant) => {
          const active = activeSelected === variant.id;
          const pending = loading === variant.id;
          const hovered = hoveredVariant === variant.id && !active;
          return (
            <button
              key={variant.id}
              type="button"
              aria-pressed={active}
              disabled={!ready || loading !== null}
              onClick={() => void choose(variant.id)}
              onMouseEnter={() => setHoveredVariant(variant.id)}
              onMouseLeave={() => setHoveredVariant(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 44,
                padding: "7px 10px",
                borderRadius: 10,
                border: "1px solid",
                borderColor: active
                  ? "rgba(255, 255, 255, 0.35)"
                  : hovered
                    ? "rgba(255, 255, 255, 0.16)"
                    : "rgba(255, 255, 255, 0.08)",
                color: active ? "#ffffff" : hovered ? "#ffffff" : "rgba(255, 255, 255, 0.8)",
                background: active
                  ? "rgba(255, 255, 255, 0.14)"
                  : hovered
                    ? "rgba(255, 255, 255, 0.07)"
                    : "rgba(255, 255, 255, 0.035)",
                cursor: ready && !loading ? "pointer" : "wait",
                textAlign: "left",
                font: "inherit",
                fontSize: 11.5,
                fontWeight: active ? 600 : 400,
                letterSpacing: "0.02em",
                lineHeight: 1.25,
                boxShadow: active ? "0 2px 8px rgba(0, 0, 0, 0.24)" : "none",
                transition:
                  "background 180ms cubic-bezier(0.16, 1, 0.3, 1), border-color 180ms cubic-bezier(0.16, 1, 0.3, 1), color 180ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 20,
                  height: 20,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  background: variant.swatch ?? "#888888",
                  boxShadow:
                    "0 0 0 1px rgba(255, 255, 255, 0.18), inset 0 1px 2px rgba(0, 0, 0, 0.3)",
                }}
              />
              <span style={{ overflowWrap: "anywhere" }}>
                {pending ? "Loading…" : (variant.label ?? variant.id)}
              </span>
            </button>
          );
        })}
      </div>
      {error ? (
        <div style={{ marginTop: 10, color: "#ff8585", fontSize: 11, letterSpacing: "0.02em" }}>
          {error}
        </div>
      ) : null}
    </section>
  );
}
