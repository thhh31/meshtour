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
  "italian-flat-v2": {
    loadingLabel: "Italian Flat v2",
    config: "./tours/italian-flat-v2/tour.json?v=1",
    loadingDetail: "Authored walk paths with dedicated transition visibility",
    points: [
      { id: "kitchen", name: "Kitchen & Dining" },
      { id: "living", name: "Living Room" },
      { id: "lounge", name: "Library Lounge" },
    ],
  },
  "italian-flat-v3": {
    loadingLabel: "Italian Flat v3",
    config: "./tours/italian-flat-v3/tour.json?v=1",
    loadingDetail: "Covered windows and doors proxy geometry",
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
    : "italian-flat-v3";
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
  gap: 16,
  color: "rgba(255, 255, 255, 0.65)",
  background: "#08080a",
  fontFamily: "inherit",
  padding: 24,
  boxSizing: "border-box",
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
          <div
            style={{
              fontSize: 12,
              color: "rgba(255, 255, 255, 0.9)",
              fontWeight: 600,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
            }}
          >
            MeshTour
          </div>
          <div
            style={{
              width: 32,
              height: 1,
              background: "rgba(255, 255, 255, 0.2)",
              margin: "4px 0",
            }}
          />
          <div
            style={{
              fontSize: 16,
              color: "#ffffff",
              fontWeight: 400,
              letterSpacing: "0.04em",
            }}
          >
            Loading the {activeTour.loadingLabel}…
          </div>
          <div
            style={{
              maxWidth: 320,
              textAlign: "center",
              fontSize: 12,
              color: "rgba(255, 255, 255, 0.42)",
              fontWeight: 300,
              letterSpacing: "0.02em",
              lineHeight: 1.6,
            }}
          >
            {activeTour.loadingDetail}
          </div>
        </div>
      }
      errorFallback={(error) => (
        <div style={overlayStyle} role="alert">
          <div
            style={{
              maxWidth: 420,
              padding: "24px 28px",
              borderRadius: 16,
              background: "rgba(18, 14, 16, 0.9)",
              border: "1px solid rgba(248, 113, 113, 0.25)",
              backdropFilter: "blur(20px)",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                color: "#ff8585",
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: "0.03em",
              }}
            >
              The tour could not be loaded.
            </div>
            <div
              style={{
                fontSize: 12,
                color: "rgba(255, 255, 255, 0.6)",
                lineHeight: 1.5,
              }}
            >
              {error.message}
            </div>
          </div>
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
              background: "rgba(10, 11, 15, 0.86)",
              backdropFilter: "blur(24px) saturate(130%)",
              WebkitBackdropFilter: "blur(24px) saturate(130%)",
              color: "#ffffff",
              borderRadius: 14,
              padding: "14px 16px",
              boxShadow: "0 16px 40px rgba(0, 0, 0, 0.48)",
              border: "1px solid rgba(255, 255, 255, 0.09)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 13,
                  letterSpacing: "0.03em",
                }}
              >
                {hotspot.title}
              </div>
              <button
                type="button"
                onClick={close}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255, 255, 255, 0.5)",
                  cursor: "pointer",
                  fontSize: 16,
                  lineHeight: 1,
                  padding: 4,
                  display: "grid",
                  placeItems: "center",
                  borderRadius: 6,
                  transition: "color 0.15s ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "#ffffff")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255, 255, 255, 0.5)")}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            {hotspot.body ? (
              <p
                style={{
                  margin: "8px 0 0",
                  color: "rgba(255, 255, 255, 0.65)",
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontWeight: 400,
                  letterSpacing: "0.01em",
                }}
              >
                {hotspot.body}
              </p>
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
