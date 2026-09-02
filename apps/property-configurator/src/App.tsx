import { Tour, useTour } from "@meshtour/react";
import type { HotspotConfig, TourEngine } from "@meshtour/core";
import { useState } from "react";
import { ConfiguratorPanel } from "./ConfiguratorPanel";
import { track } from "./analytics";

const TOUR_CONFIG = "./tours/italian-flat-v4/tour.json?v=3";
const ENGINE_OPTIONS = {
  dracoDecoderPath: "./vendor/draco/",
  ktx2TranscoderPath: "./vendor/basis/",
} as const;
const NODES = [
  { id: "kitchen", label: "Kitchen" },
  { id: "living", label: "Living" },
  { id: "lounge", label: "Library" },
];

function SceneNavigation() {
  const { currentNode, transitioning, goToNode } = useTour();
  return (
    <nav className="scene-navigation" aria-label="Rooms">
      {NODES.map((node) => (
        <button
          key={node.id}
          type="button"
          aria-current={currentNode === node.id ? "location" : undefined}
          disabled={transitioning}
          onClick={() => void goToNode(node.id)}
        >
          {node.label}
        </button>
      ))}
    </nav>
  );
}

function LoadingExperience() {
  return (
    <div className="loading-experience" role="status" aria-live="polite">
      <span className="brand-mark">CF</span>
      <p className="eyebrow">Casa Forma · Milano</p>
      <h1>Loading Italian Flat…</h1>
      <div className="loading-line">
        <span />
      </div>
    </div>
  );
}

export function App() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);

  const openHotspot = (hotspot: HotspotConfig) => {
    const payload = hotspot.payload;
    if (!payload || typeof payload !== "object" || !("configurationGroup" in payload)) return;
    const groupId = payload.configurationGroup;
    if (typeof groupId !== "string") return;
    setActiveGroup(groupId);
    setPanelOpen(true);
    track("configurator_opened_from_scene", { groupId, hotspotId: hotspot.id });
  };

  const ready = (engine: TourEngine) => {
    performance.mark("property-configurator-ready");
    track("property_configurator_ready", {
      catalogVersion: engine.getConfiguratorConfig()?.catalogVersion,
    });
  };

  return (
    <main className="property-app">
      <Tour
        config={TOUR_CONFIG}
        engineOptions={ENGINE_OPTIONS}
        onReady={ready}
        onHotspotClick={openHotspot}
        hotspotRenderer={() => null}
        fallback={<LoadingExperience />}
        errorFallback={(error) => (
          <div className="error-experience" role="alert">
            <h1>Could not load the tour</h1>
            <pre>{error.message}</pre>
          </div>
        )}
      >
        <SceneNavigation />
        <ConfiguratorPanel
          open={panelOpen}
          activeGroup={activeGroup}
          onOpenChange={setPanelOpen}
          onActiveGroupChange={setActiveGroup}
        />
      </Tour>
    </main>
  );
}
