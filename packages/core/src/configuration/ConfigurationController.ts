import type {
  ConfigurationGroupConfig,
  ConfigurationOptionConfig,
  ConfiguratorConfig,
} from "../config/schema";

export type ConfigurationChangeSource = "user" | "preset" | "restore" | "reset" | "compare";
export type ConfigurationStatus = "ready" | "applying" | "error";

export interface ConfigurationState {
  catalogVersion: string;
  currency: string;
  status: ConfigurationStatus;
  selections: Record<string, string>;
  variants: Record<string, string>;
  selectedPresetId: string | null;
  priceDeltaMinor: number;
  totalPriceMinor: number;
  error: string | null;
}

export interface ConfigurationLineItem {
  groupId: string;
  groupLabel: string;
  optionId: string;
  optionLabel: string;
  sku?: string;
  priceDeltaMinor: number;
  availability: ConfigurationOptionConfig["availability"];
}

export interface ConfigurationQuotePayload {
  catalogVersion: string;
  currency: string;
  selections: Record<string, string>;
  presetId: string | null;
  priceDeltaMinor: number;
  totalPriceMinor: number;
  lineItems: ConfigurationLineItem[];
}

export interface ConfigurationOptionAvailability {
  available: boolean;
  reason?: string;
}

export interface ConfigurationControllerOptions {
  applyVariants: (variants: Record<string, string>) => Promise<boolean>;
  onStateChange?: (state: ConfigurationState, source: ConfigurationChangeSource) => void;
}

interface SerializedConfiguration {
  v: 1;
  catalog: string;
  selections: Record<string, string>;
}

function cloneSelections(selections: Record<string, string>): Record<string, string> {
  return { ...selections };
}

export function serializeConfiguration(
  catalogVersion: string,
  selections: Record<string, string>,
): string {
  return JSON.stringify({
    v: 1,
    catalog: catalogVersion,
    selections,
  } satisfies SerializedConfiguration);
}

export function deserializeConfiguration(value: string): SerializedConfiguration {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object") throw new Error("Configuration link is malformed");
  const candidate = parsed as Partial<SerializedConfiguration>;
  if (candidate.v !== 1 || typeof candidate.catalog !== "string") {
    throw new Error("Configuration link uses an unsupported format");
  }
  if (!candidate.selections || typeof candidate.selections !== "object") {
    throw new Error("Configuration link has no selections");
  }
  for (const [groupId, optionId] of Object.entries(candidate.selections)) {
    if (!groupId || typeof optionId !== "string" || !optionId) {
      throw new Error("Configuration link contains an invalid selection");
    }
  }
  return candidate as SerializedConfiguration;
}

/** Deterministic buyer-configuration state above the renderer's variant layer API. */
export class ConfigurationController {
  private readonly config: ConfiguratorConfig;
  private readonly applyVariants: ConfigurationControllerOptions["applyVariants"];
  private readonly onStateChange?: ConfigurationControllerOptions["onStateChange"];
  private selections: Record<string, string>;
  private status: ConfigurationStatus = "ready";
  private error: string | null = null;
  private operation = 0;

  constructor(config: ConfiguratorConfig, options: ConfigurationControllerOptions) {
    this.config = config;
    this.applyVariants = options.applyVariants;
    this.onStateChange = options.onStateChange;
    this.selections = Object.fromEntries(config.groups.map((group) => [group.id, group.default]));
    this.assertValidSelections(this.selections);
  }

  getConfig(): ConfiguratorConfig {
    return this.config;
  }

  private group(groupId: string): ConfigurationGroupConfig {
    const group = this.config.groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error(`Unknown configuration group "${groupId}"`);
    return group;
  }

  private option(groupId: string, optionId: string): ConfigurationOptionConfig {
    const option = this.group(groupId).options.find((entry) => entry.id === optionId);
    if (!option) throw new Error(`Unknown option "${optionId}" for group "${groupId}"`);
    return option;
  }

  private resolveVariants(selections: Record<string, string>): Record<string, string> {
    const variants: Record<string, string> = {};
    for (const [groupId, optionId] of Object.entries(selections)) {
      const option = this.option(groupId, optionId);
      for (const [configurableId, variantId] of Object.entries(option.variants)) {
        const previous = variants[configurableId];
        if (previous && previous !== variantId) {
          throw new Error(
            `Configuration groups resolve conflicting variants for "${configurableId}"`,
          );
        }
        variants[configurableId] = variantId;
      }
    }
    return variants;
  }

  getOptionAvailability(
    groupId: string,
    optionId: string,
    selections: Record<string, string> = this.selections,
  ): ConfigurationOptionAvailability {
    this.option(groupId, optionId);
    const candidate = { ...selections, [groupId]: optionId };
    for (const [selectedGroupId, selectedOptionId] of Object.entries(candidate)) {
      const availability = this.getDirectAvailability(selectedGroupId, selectedOptionId, candidate);
      if (!availability.available) {
        return selectedGroupId === groupId
          ? availability
          : {
              available: false,
              reason: `${this.option(selectedGroupId, selectedOptionId).label}: ${availability.reason}`,
            };
      }
    }
    return { available: true };
  }

  private getDirectAvailability(
    groupId: string,
    optionId: string,
    selections: Record<string, string>,
  ): ConfigurationOptionAvailability {
    const option = this.option(groupId, optionId);
    if (option.availability === "unavailable") {
      return { available: false, reason: "Currently unavailable" };
    }
    for (const dependency of option.requires) {
      if (!dependency.optionIds.includes(selections[dependency.groupId] ?? "")) {
        return {
          available: false,
          reason:
            dependency.message ??
            `Requires ${this.group(dependency.groupId).label}: ${dependency.optionIds
              .map((id) => this.option(dependency.groupId, id).label)
              .join(" or ")}`,
        };
      }
    }
    for (const dependency of option.excludes) {
      if (dependency.optionIds.includes(selections[dependency.groupId] ?? "")) {
        return {
          available: false,
          reason:
            dependency.message ??
            `Not compatible with ${
              this.option(dependency.groupId, selections[dependency.groupId]!).label
            }`,
        };
      }
    }
    return { available: true };
  }

  private assertValidSelections(selections: Record<string, string>): void {
    for (const group of this.config.groups) {
      const optionId = selections[group.id];
      if (!optionId) throw new Error(`Missing selection for group "${group.id}"`);
      this.option(group.id, optionId);
    }
    for (const groupId of Object.keys(selections)) this.group(groupId);
    for (const [groupId, optionId] of Object.entries(selections)) {
      const availability = this.getOptionAvailability(groupId, optionId, selections);
      if (!availability.available) {
        throw new Error(
          `${this.option(groupId, optionId).label} is unavailable: ${availability.reason ?? "incompatible selection"}`,
        );
      }
    }
    this.resolveVariants(selections);
  }

  private selectedPresetId(selections: Record<string, string>): string | null {
    return (
      this.config.presets.find((preset) =>
        this.config.groups.every(
          (group) => selections[group.id] === (preset.selections[group.id] ?? group.default),
        ),
      )?.id ?? null
    );
  }

  private priceDelta(selections: Record<string, string>): number {
    return Object.entries(selections).reduce(
      (sum, [groupId, optionId]) => sum + this.option(groupId, optionId).priceDeltaMinor,
      0,
    );
  }

  getState(): ConfigurationState {
    const priceDeltaMinor = this.priceDelta(this.selections);
    return {
      catalogVersion: this.config.catalogVersion,
      currency: this.config.currency,
      status: this.status,
      selections: cloneSelections(this.selections),
      variants: this.resolveVariants(this.selections),
      selectedPresetId: this.selectedPresetId(this.selections),
      priceDeltaMinor,
      totalPriceMinor: this.config.basePriceMinor + priceDeltaMinor,
      error: this.error,
    };
  }

  private notify(source: ConfigurationChangeSource): void {
    this.onStateChange?.(this.getState(), source);
  }

  private async apply(
    selections: Record<string, string>,
    source: ConfigurationChangeSource,
  ): Promise<ConfigurationState> {
    this.assertValidSelections(selections);
    const operation = ++this.operation;
    this.status = "applying";
    this.error = null;
    this.notify(source);
    try {
      const applied = await this.applyVariants(this.resolveVariants(selections));
      if (operation !== this.operation || !applied) return this.getState();
      this.selections = cloneSelections(selections);
      this.status = "ready";
      this.notify(source);
      return this.getState();
    } catch (cause) {
      if (operation !== this.operation) return this.getState();
      this.status = "error";
      this.error = cause instanceof Error ? cause.message : String(cause);
      this.notify(source);
      throw cause;
    }
  }

  select(groupId: string, optionId: string): Promise<ConfigurationState> {
    return this.apply({ ...this.selections, [groupId]: optionId }, "user");
  }

  applyPreset(presetId: string): Promise<ConfigurationState> {
    const preset = this.config.presets.find((entry) => entry.id === presetId);
    if (!preset) throw new Error(`Unknown configuration preset "${presetId}"`);
    const defaults = Object.fromEntries(
      this.config.groups.map((group) => [group.id, group.default]),
    );
    return this.apply({ ...defaults, ...preset.selections }, "preset");
  }

  restore(selections: Record<string, string>): Promise<ConfigurationState> {
    const defaults = Object.fromEntries(
      this.config.groups.map((group) => [group.id, group.default]),
    );
    return this.apply({ ...defaults, ...selections }, "restore");
  }

  restoreSerialized(value: string): Promise<ConfigurationState> {
    const serialized = deserializeConfiguration(value);
    if (serialized.catalog !== this.config.catalogVersion) {
      throw new Error(
        `Configuration link uses catalog "${serialized.catalog}" instead of "${this.config.catalogVersion}"`,
      );
    }
    return this.restore(serialized.selections);
  }

  reset(source: ConfigurationChangeSource = "reset"): Promise<ConfigurationState> {
    return this.apply(
      Object.fromEntries(this.config.groups.map((group) => [group.id, group.default])),
      source,
    );
  }

  serialize(): string {
    return serializeConfiguration(this.config.catalogVersion, this.selections);
  }

  getQuotePayload(): ConfigurationQuotePayload {
    const state = this.getState();
    return {
      catalogVersion: state.catalogVersion,
      currency: state.currency,
      selections: state.selections,
      presetId: state.selectedPresetId,
      priceDeltaMinor: state.priceDeltaMinor,
      totalPriceMinor: state.totalPriceMinor,
      lineItems: this.config.groups.map((group) => {
        const option = this.option(group.id, state.selections[group.id]!);
        return {
          groupId: group.id,
          groupLabel: group.label,
          optionId: option.id,
          optionLabel: option.label,
          ...(option.sku ? { sku: option.sku } : {}),
          priceDeltaMinor: option.priceDeltaMinor,
          availability: option.availability,
        };
      }),
    };
  }
}
