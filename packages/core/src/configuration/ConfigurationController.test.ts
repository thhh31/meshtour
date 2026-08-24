import { describe, expect, it, vi } from "vitest";
import { validateConfig } from "../config/loader";
import { ConfigurationController, deserializeConfiguration } from "./ConfigurationController";

function fixture() {
  const config = validateConfig({
    version: 1,
    nodes: [{ id: "living", position: [0, 1.6, 0], panorama: { url: "living.jpg" } }],
    configurables: [
      {
        id: "sofa-finish",
        interactable: "sofa",
        default: "original",
        variants: [{ id: "original" }, { id: "terracotta" }, { id: "forest" }],
      },
      {
        id: "rug-finish",
        interactable: "rug",
        default: "original",
        variants: [{ id: "original" }, { id: "sand" }],
      },
    ],
    configurator: {
      catalogVersion: "test-1",
      currency: "EUR",
      basePriceMinor: 50_000_000,
      groups: [
        {
          id: "sofa",
          label: "Sofa",
          default: "original",
          options: [
            {
              id: "original",
              label: "Original",
              variants: { "sofa-finish": "original" },
            },
            {
              id: "terracotta",
              label: "Terracotta",
              sku: "SOFA-TERRA",
              priceDeltaMinor: 120_000,
              variants: { "sofa-finish": "terracotta" },
            },
            {
              id: "forest",
              label: "Forest",
              variants: { "sofa-finish": "forest" },
              requires: [{ groupId: "rug", optionIds: ["sand"] }],
            },
          ],
        },
        {
          id: "rug",
          label: "Rug",
          default: "original",
          options: [
            { id: "original", label: "Original", variants: { "rug-finish": "original" } },
            {
              id: "sand",
              label: "Sand",
              priceDeltaMinor: 80_000,
              variants: { "rug-finish": "sand" },
            },
          ],
        },
      ],
      presets: [
        {
          id: "warm",
          label: "Warm",
          selections: { sofa: "terracotta", rug: "sand" },
        },
      ],
    },
  });
  const applyVariants = vi.fn(async () => true);
  const onStateChange = vi.fn();
  const controller = new ConfigurationController(config.configurator!, {
    applyVariants,
    onStateChange,
  });
  return { controller, applyVariants, onStateChange };
}

describe("ConfigurationController", () => {
  it("applies a preset as one visual transaction and calculates minor-unit pricing", async () => {
    const { controller, applyVariants, onStateChange } = fixture();

    const state = await controller.applyPreset("warm");

    expect(applyVariants).toHaveBeenCalledTimes(1);
    expect(applyVariants).toHaveBeenCalledWith({
      "sofa-finish": "terracotta",
      "rug-finish": "sand",
    });
    expect(state.selectedPresetId).toBe("warm");
    expect(state.priceDeltaMinor).toBe(200_000);
    expect(state.totalPriceMinor).toBe(50_200_000);
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });

  it("exposes dependency reasons and rejects an incompatible selection", async () => {
    const { controller, applyVariants } = fixture();

    expect(controller.getOptionAvailability("sofa", "forest")).toEqual({
      available: false,
      reason: "Requires Rug: Sand",
    });
    await expect(controller.select("sofa", "forest")).rejects.toThrow(/unavailable/);
    expect(applyVariants).not.toHaveBeenCalled();
  });

  it("prevents a change that would invalidate another selected option", async () => {
    const { controller } = fixture();
    await controller.restore({ sofa: "forest", rug: "sand" });

    expect(controller.getOptionAvailability("rug", "original")).toEqual({
      available: false,
      reason: "Forest: Requires Rug: Sand",
    });
  });

  it("round-trips share state and produces a SKU-level quote payload", async () => {
    const { controller } = fixture();
    await controller.applyPreset("warm");

    const serialized = controller.serialize();
    expect(deserializeConfiguration(serialized)).toEqual({
      v: 1,
      catalog: "test-1",
      selections: { sofa: "terracotta", rug: "sand" },
    });
    expect(controller.getQuotePayload().lineItems[0]).toMatchObject({
      groupId: "sofa",
      optionId: "terracotta",
      sku: "SOFA-TERRA",
      priceDeltaMinor: 120_000,
    });
  });

  it("keeps the committed selection when visual loading fails", async () => {
    const { controller, applyVariants } = fixture();
    applyVariants.mockRejectedValueOnce(new Error("layer failed"));

    await expect(controller.applyPreset("warm")).rejects.toThrow("layer failed");
    expect(controller.getState()).toMatchObject({
      status: "error",
      selections: { sofa: "original", rug: "original" },
      error: "layer failed",
    });
  });
});
