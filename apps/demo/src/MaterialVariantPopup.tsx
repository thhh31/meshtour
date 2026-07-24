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
        width: "min(330px, calc(100vw - 36px))",
        boxSizing: "border-box",
        padding: 14,
        borderRadius: 16,
        color: "#fff",
        background: "rgba(14,14,18,0.92)",
        border: "1px solid rgba(255,255,255,0.14)",
        backdropFilter: "blur(18px)",
        boxShadow: "0 14px 42px rgba(0,0,0,0.46)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div id={titleId} style={{ fontWeight: 700 }}>
            {title}
          </div>
          <div style={{ marginTop: 2, color: "rgba(255,255,255,0.58)", fontSize: 11 }}>
            Select a finish
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title.toLowerCase()}`}
          style={{ border: 0, color: "#aaa", background: "none", cursor: "pointer", fontSize: 20 }}
        >
          ×
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
        {configurable?.variants.map((variant) => {
          const active = activeSelected === variant.id;
          const pending = loading === variant.id;
          return (
            <button
              key={variant.id}
              type="button"
              aria-pressed={active}
              disabled={!ready || loading !== null}
              onClick={() => void choose(variant.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 46,
                padding: "7px 9px",
                borderRadius: 11,
                border: `1px solid ${active ? "#fff" : "rgba(255,255,255,0.13)"}`,
                color: "#fff",
                background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.035)",
                cursor: ready && !loading ? "pointer" : "wait",
                textAlign: "left",
                font: "inherit",
                fontSize: 11,
                lineHeight: 1.2,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 22,
                  height: 22,
                  flex: "0 0 auto",
                  borderRadius: "50%",
                  background: variant.swatch ?? "#888",
                  boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)",
                }}
              />
              <span>{pending ? "Loading…" : (variant.label ?? variant.id)}</span>
            </button>
          );
        })}
      </div>
      {error ? <div style={{ marginTop: 9, color: "#ffb4ad", fontSize: 11 }}>{error}</div> : null}
    </section>
  );
}
