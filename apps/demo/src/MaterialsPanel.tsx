import { useTourConfiguration } from "@meshtour/react";
import { useEffect, useRef, useState } from "react";
import { MATERIAL_PANEL_GROUPS } from "./materialUiConfig";

const PANEL_TRANSITION_MS = 460;

interface MaterialsPanelProps {
  open: boolean;
  activeGroup: string | null;
  onOpenChange: (open: boolean) => void;
  onActiveGroupChange: (groupId: string | null) => void;
}

/** A compact demo-only finish selector backed by the tour's configurator data. */
export function MaterialsPanel({
  open,
  activeGroup,
  onOpenChange,
  onActiveGroupChange,
}: MaterialsPanelProps) {
  const configurationApi = useTourConfiguration();
  const { config, configuration } = configurationApi;
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const [panelVisible, setPanelVisible] = useState(open);
  const [panelOpen, setPanelOpen] = useState(open);

  useEffect(() => {
    let firstFrame = 0;
    let secondFrame = 0;
    let hideTimer = 0;

    if (open) {
      // Give the browser a painted off-canvas frame before starting the
      // transition. Otherwise the first backdrop-filter paint can consume
      // most (or all) of the opening animation.
      firstFrame = window.requestAnimationFrame(() => {
        setPanelVisible(true);
        secondFrame = window.requestAnimationFrame(() => setPanelOpen(true));
      });
    } else {
      firstFrame = window.requestAnimationFrame(() => {
        setPanelOpen(false);
        hideTimer = window.setTimeout(() => setPanelVisible(false), PANEL_TRANSITION_MS);
      });
    }

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(hideTimer);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    } else if (wasOpen.current) {
      launcherRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onOpenChange, open]);

  if (!config || !configuration) return null;

  const groups = config.groups.filter((group) => MATERIAL_PANEL_GROUPS.has(group.id));
  const busy = configuration.status === "applying";

  return (
    <>
      <button
        ref={launcherRef}
        className="materials-panel-launcher"
        type="button"
        aria-controls="demo-materials-panel"
        aria-expanded={open}
        onClick={() => onOpenChange(true)}
      >
        <span className="materials-panel-launcher-label">Materials</span>
        <span className="materials-panel-launcher-arrow" aria-hidden="true">
          ←
        </span>
      </button>

      <aside
        id="demo-materials-panel"
        className={`materials-panel${panelVisible ? " is-visible" : ""}${panelOpen ? " is-open" : ""}`}
        aria-label="Material selector"
        aria-hidden={!open}
        inert={!open}
        onTransitionEnd={(event) => {
          if (!open && event.currentTarget === event.target && event.propertyName === "transform") {
            setPanelVisible(false);
          }
        }}
      >
        <header className="materials-panel-header">
          <div>
            <p>Italian Flat</p>
            <h1>Materials</h1>
          </div>
          <button
            ref={closeRef}
            className="materials-panel-close meshtour-control-tooltip"
            type="button"
            aria-label="Close materials"
            data-tooltip="Close materials"
            data-tooltip-align="end"
            onClick={() => onOpenChange(false)}
          >
            <span aria-hidden="true">→</span>
          </button>
        </header>

        <div className="materials-panel-intro">
          Select a finish to preview it throughout the apartment.
        </div>

        <div className="materials-panel-scroll" aria-busy={busy}>
          {groups.map((group) => {
            const expanded = activeGroup === group.id;
            const selectedId = configuration.selections[group.id];
            const selected = group.options.find((option) => option.id === selectedId);

            return (
              <section
                className={`materials-group${expanded ? " is-expanded" : ""}`}
                key={group.id}
              >
                <button
                  className="materials-group-trigger"
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`materials-options-${group.id}`}
                  onClick={() => onActiveGroupChange(expanded ? null : group.id)}
                >
                  <span
                    className="materials-current-swatch"
                    style={{ background: selected?.swatch ?? "#888888" }}
                    aria-hidden="true"
                  />
                  <span className="materials-group-copy">
                    <small>{group.room}</small>
                    <strong>{group.label}</strong>
                    <span>{selected?.label ?? "Choose a finish"}</span>
                  </span>
                  <span className="materials-chevron" aria-hidden="true">
                    ↓
                  </span>
                </button>

                {expanded ? (
                  <div className="materials-options" id={`materials-options-${group.id}`}>
                    {group.options.map((option) => {
                      const availability = configurationApi.getOptionAvailability(
                        group.id,
                        option.id,
                      );
                      const selectedOption = option.id === selectedId;

                      return (
                        <button
                          className={`materials-option${selectedOption ? " is-selected" : ""}`}
                          key={option.id}
                          type="button"
                          aria-pressed={selectedOption}
                          disabled={busy || !availability.available}
                          title={availability.reason}
                          onClick={() => void configurationApi.select(group.id, option.id)}
                        >
                          <span className="materials-option-preview" aria-hidden="true">
                            {option.thumbnail ? (
                              <img src={option.thumbnail} alt="" loading="lazy" />
                            ) : (
                              <span style={{ background: option.swatch }} />
                            )}
                          </span>
                          <span className="materials-option-copy">
                            <strong>{option.label}</strong>
                            <small>
                              {availability.reason ?? option.description ?? "Available finish"}
                            </small>
                          </span>
                          <span className="materials-option-check" aria-hidden="true">
                            {selectedOption ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>

        {configuration.error ? (
          <p className="materials-panel-error" role="alert">
            {configuration.error}
          </p>
        ) : null}
      </aside>
    </>
  );
}
