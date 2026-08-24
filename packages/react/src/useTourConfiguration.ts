import type {
  ConfigurationOptionAvailability,
  ConfigurationQuotePayload,
  ConfigurationState,
  ConfiguratorConfig,
} from "@meshtour/core";
import { useCallback, useContext } from "react";
import { TourContext } from "./context";

export interface UseTourConfigurationResult {
  config: ConfiguratorConfig | null;
  configuration: ConfigurationState | null;
  select: (groupId: string, optionId: string) => Promise<ConfigurationState>;
  applyPreset: (presetId: string) => Promise<ConfigurationState>;
  restore: (selections: Record<string, string>) => Promise<ConfigurationState>;
  restoreSerialized: (value: string) => Promise<ConfigurationState>;
  reset: (compare?: boolean) => Promise<ConfigurationState>;
  serialize: () => string;
  getQuotePayload: () => ConfigurationQuotePayload;
  request: () => ConfigurationQuotePayload;
  getOptionAvailability: (groupId: string, optionId: string) => ConfigurationOptionAvailability;
}

/** Buyer-facing product configuration API. Must be used inside `<Tour>`. */
export function useTourConfiguration(): UseTourConfigurationResult {
  const { engine, configuration } = useContext(TourContext);
  const requireEngine = useCallback(() => {
    if (!engine) throw new Error("useTourConfiguration: engine is not mounted yet");
    return engine;
  }, [engine]);

  return {
    config: engine?.getConfiguratorConfig() ?? null,
    configuration,
    select: (groupId, optionId) => requireEngine().selectConfigurationOption(groupId, optionId),
    applyPreset: (presetId) => requireEngine().applyConfigurationPreset(presetId),
    restore: (selections) => requireEngine().restoreConfiguration(selections),
    restoreSerialized: (value) => requireEngine().restoreSerializedConfiguration(value),
    reset: (compare) => requireEngine().resetConfiguration(compare),
    serialize: () => requireEngine().serializeConfiguration(),
    getQuotePayload: () => requireEngine().getConfigurationQuotePayload(),
    request: () => requireEngine().requestConfiguration(),
    getOptionAvailability: (groupId, optionId) =>
      requireEngine().getConfigurationOptionAvailability(groupId, optionId),
  };
}
