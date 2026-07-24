import { Tour, TourSpatialControls } from "@meshtour/react";
import type { TourEngine } from "@meshtour/core";
import type { CSSProperties } from "react";
import { NodeSwitcher } from "./NodeSwitcher";
import { MaterialVariantPopup } from "./MaterialVariantPopup";

const DEMO_TOURS = {
  "italian-flat": {
    loadingLabel: "Italian Flat",
    config: "./tours/italian-flat/tour.json?v=23",
    loadingDetail: "Fast preview first, high-quality 4K detail next",
    points: [
      { id: "kitchen", name: "Kitchen & Dining" },
      { id: "living", name: "Living Room" },
      { id: "lounge", name: "Library Lounge" },
    ],
  },
} as const;

type DemoTourId = keyof typeof DEMO_TOURS;

const SEARCH_PARAMS =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
const REQUESTED_TOUR = SEARCH_PARAMS.get("tour");
const INITIAL_TOUR: DemoTourId =
  REQUESTED_TOUR !== null && Object.hasOwn(DEMO_TOURS, REQUESTED_TOUR)
    ? (REQUESTED_TOUR as DemoTourId)
    : "italian-flat";
const AUTHOR_MODE = SEARCH_PARAMS.has("author");
const TEST_MODE = SEARCH_PARAMS.has("test");
const ENGINE_OPTIONS = {
  dracoDecoderPath: "./vendor/draco/",
  ktx2TranscoderPath: "./vendor/basis/",
} as const;

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  color: "#aaa",
  background: "#0b0b0e",
};

declare global {
  interface Window {
    __MESHTOUR_TEST_ENGINE__?: TourEngine;
    __MESHTOUR_TEST_EVENTS__?: {
      hovered: string | null;
      clicked: string | null;
    };
  }
}

if (TEST_MODE) {
  window.__MESHTOUR_TEST_EVENTS__ = { hovered: null, clicked: null };
}

export function App() {
  const tourId = INITIAL_TOUR;
  const activeTour = DEMO_TOURS[tourId];

  return (
    <Tour
      key={tourId}
      config={activeTour.config}
      authorMode={AUTHOR_MODE}
      engineOptions={ENGINE_OPTIONS}
      onReady={(engine) => {
        performance.mark("meshtour-ready");
        if (TEST_MODE) window.__MESHTOUR_TEST_ENGINE__ = engine;
      }}
      onTransitionStart={() => performance.mark("meshtour-transition-start")}
      onTransitionEnd={() => performance.mark("meshtour-transition-end")}
      onInteractableHover={(id) => {
        if (TEST_MODE && window.__MESHTOUR_TEST_EVENTS__) {
          window.__MESHTOUR_TEST_EVENTS__.hovered = id;
        }
      }}
      onInteractableClick={(id) => {
        if (TEST_MODE && window.__MESHTOUR_TEST_EVENTS__) {
          window.__MESHTOUR_TEST_EVENTS__.clicked = id;
        }
      }}
      fallback={
        <div style={overlayStyle} role="status" aria-live="polite">
          <div style={{ fontSize: 20, color: "#fff", fontWeight: 650, letterSpacing: 0.2 }}>
            MeshTour
          </div>
          <div>Loading the {activeTour.loadingLabel}…</div>
          <div style={{ maxWidth: 320, textAlign: "center", fontSize: 13, color: "#73737e" }}>
            {activeTour.loadingDetail}
          </div>
        </div>
      }
      errorFallback={(error) => (
        <div style={overlayStyle} role="alert">
          <div style={{ color: "#fff", fontWeight: 600 }}>The tour could not be loaded.</div>
          <div style={{ maxWidth: 480, textAlign: "center" }}>{error.message}</div>
        </div>
      )}
      hotspotRenderer={(hotspot, { close }) =>
        typeof hotspot.payload === "object" &&
        hotspot.payload !== null &&
        "configurableId" in hotspot.payload &&
        typeof hotspot.payload.configurableId === "string" ? (
          <MaterialVariantPopup configurableId={hotspot.payload.configurableId} onClose={close} />
        ) : (
          <div
            style={{
              maxWidth: 280,
              background: "rgba(20,20,26,0.95)",
              color: "#fff",
              borderRadius: 12,
              padding: "14px 16px",
              boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong>{hotspot.title}</strong>
              <button
                onClick={close}
                style={{
                  background: "none",
                  border: "none",
                  color: "#999",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {hotspot.body ? (
              <p style={{ margin: "8px 0 0", color: "#ccc" }}>{hotspot.body}</p>
            ) : null}
          </div>
        )
      }
    >
      <TourSpatialControls />
      <NodeSwitcher nodes={activeTour.points} />
    </Tour>
  );
}
