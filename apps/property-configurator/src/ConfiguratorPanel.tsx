import type { ConfigurationQuotePayload } from "@meshtour/core";
import { useTourConfiguration } from "@meshtour/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "./analytics";
import { LeadDialog } from "./LeadDialog";

interface ConfiguratorPanelProps {
  open: boolean;
  activeGroup: string | null;
  onOpenChange: (open: boolean) => void;
  onActiveGroupChange: (groupId: string | null) => void;
}

function createShareUrl(serialized: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("configuration", serialized);
  return url.toString();
}

export function ConfiguratorPanel({
  open,
  activeGroup,
  onOpenChange,
  onActiveGroupChange,
}: ConfiguratorPanelProps) {
  const configurationApi = useTourConfiguration();
  const { config, configuration } = configurationApi;
  const restored = useRef(false);
  const comparisonSelections = useRef<Record<string, string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [comparing, setComparing] = useState(false);
  const [lead, setLead] = useState<{ payload: ConfigurationQuotePayload; url: string } | null>(
    null,
  );

  useEffect(() => {
    if (!configuration || restored.current) return;
    restored.current = true;
    const serialized = new URLSearchParams(window.location.search).get("configuration");
    if (!serialized) return;
    void configurationApi
      .restoreSerialized(serialized)
      .then(() => {
        setNotice("Shared specification restored");
        track("configuration_restored", { catalogVersion: configuration.catalogVersion });
      })
      .catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "Could not restore configuration");
      });
  }, [configuration, configurationApi]);

  const share = useCallback(async () => {
    const serialized = configurationApi.serialize();
    const url = createShareUrl(serialized);
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice("Share link copied");
    } catch {
      setNotice("Share link added to the address bar");
    }
    track("configuration_shared", { catalogVersion: configuration?.catalogVersion });
  }, [configuration?.catalogVersion, configurationApi]);

  const beginCompare = useCallback(() => {
    if (!configuration || configuration.status === "applying") return;
    comparisonSelections.current = configuration.selections;
    setComparing(true);
    track("comparison_started", { presetId: configuration.selectedPresetId });
    void configurationApi.reset(true);
  }, [configuration, configurationApi]);

  const endCompare = useCallback(() => {
    const selections = comparisonSelections.current;
    if (!selections) return;
    comparisonSelections.current = null;
    setComparing(false);
    void configurationApi.restore(selections);
  }, [configurationApi]);

  if (!config || !configuration) return null;
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: config.currency,
    maximumFractionDigits: 0,
  });
  const busy = configuration.status === "applying";

  return (
    <>
      <button
        className="mobile-configure-button"
        type="button"
        onClick={() => onOpenChange(true)}
        aria-expanded={open}
      >
        <span>Configure</span>
        <strong>+{money.format(configuration.priceDeltaMinor / 100)}</strong>
      </button>
      <aside
        className={`configurator-panel${open ? " is-open" : ""}`}
        aria-label="Home configurator"
      >
        <header className="panel-header">
          <h1>Make it yours</h1>
          <button
            className="icon-button panel-close"
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close configurator"
          >
            ×
          </button>
        </header>

        <div className="panel-scroll">
          <section aria-labelledby="packages-title">
            <div className="section-heading">
              <h2 id="packages-title">Choose a direction</h2>
            </div>
            <div className="preset-grid">
              {config.presets.map((preset) => {
                const selected = configuration.selectedPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    className={`preset-card${selected ? " is-selected" : ""}`}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    onClick={() => {
                      track("preset_selected", { presetId: preset.id });
                      void configurationApi.applyPreset(preset.id);
                    }}
                  >
                    <span>{preset.badge ?? "Collection"}</span>
                    <strong>{preset.label}</strong>
                    <small>{preset.description}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="details-title">
            <div className="section-heading">
              <h2 id="details-title">Refine the details</h2>
            </div>
            <div className="option-groups">
              {config.groups.map((group) => {
                const expanded =
                  activeGroup === group.id || (!activeGroup && group.id === config.groups[0]?.id);
                const selectedId = configuration.selections[group.id];
                const selected = group.options.find((option) => option.id === selectedId)!;
                return (
                  <article
                    className={`option-group${expanded ? " is-expanded" : ""}`}
                    key={group.id}
                  >
                    <button
                      className="group-trigger"
                      type="button"
                      aria-expanded={expanded}
                      onClick={() => onActiveGroupChange(expanded ? null : group.id)}
                    >
                      <span
                        className="swatch"
                        style={{ background: selected.swatch }}
                        aria-hidden="true"
                      />
                      <span>
                        <small>{group.room}</small>
                        <strong>{group.label}</strong>
                      </span>
                      <span className="chevron" aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                    {expanded ? (
                      <div className="option-list">
                        {group.options.map((option) => {
                          const availability = configurationApi.getOptionAvailability(
                            group.id,
                            option.id,
                          );
                          const checked = option.id === selectedId;
                          return (
                            <button
                              className={`option-card${checked ? " is-selected" : ""}`}
                              key={option.id}
                              type="button"
                              aria-pressed={checked}
                              disabled={busy || !availability.available}
                              title={availability.reason}
                              onClick={() => {
                                track("option_selected", {
                                  groupId: group.id,
                                  optionId: option.id,
                                });
                                void configurationApi.select(group.id, option.id);
                              }}
                            >
                              {option.thumbnail ? (
                                <img src={option.thumbnail} alt="" loading="lazy" />
                              ) : (
                                <span
                                  className="option-color"
                                  style={{ background: option.swatch }}
                                  aria-hidden="true"
                                />
                              )}
                              <span className="option-copy">
                                <strong>{option.label}</strong>
                                <small>
                                  {availability.reason ?? option.description ?? option.sku}
                                </small>
                              </span>
                              <span className="option-price">
                                {option.availability === "on-request"
                                  ? "On request"
                                  : option.priceDeltaMinor === 0
                                    ? "Included"
                                    : `+${money.format(option.priceDeltaMinor / 100)}`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="panel-footer">
          {notice ? (
            <p className="notice" role="status">
              {notice}
            </p>
          ) : null}
          {configuration.error ? (
            <p className="error-notice" role="alert">
              {configuration.error}
            </p>
          ) : null}
          <div className="price-row">
            <span>
              <small>Configured price</small>
              <strong>{money.format(configuration.totalPriceMinor / 100)}</strong>
            </span>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={() => {
              const payload = configurationApi.request();
              setLead({ payload, url: createShareUrl(configurationApi.serialize()) });
            }}
          >
            {busy ? "Applying finishes…" : config.requestLabel}
          </button>
          <div className="secondary-actions">
            <button type="button" onClick={() => void share()}>
              Share
            </button>
            <button
              type="button"
              disabled={busy && !comparing}
              onPointerDown={beginCompare}
              onPointerUp={endCompare}
              onPointerCancel={endCompare}
              onPointerLeave={endCompare}
            >
              {comparing ? "Release to restore" : "Hold for original"}
            </button>
            <button type="button" disabled={busy} onClick={() => void configurationApi.reset()}>
              Reset
            </button>
          </div>
        </footer>
      </aside>
      {lead ? (
        <LeadDialog payload={lead.payload} shareUrl={lead.url} onClose={() => setLead(null)} />
      ) : null}
    </>
  );
}
