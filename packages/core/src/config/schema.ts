import { z } from "zod";

/**
 * The MeshTour JSON config schema, version 1. This is the public contract:
 * everything else (including the future visual editor) builds on it.
 * Documented in CONFIG.md.
 */

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof vec3Schema>;

export const transitionPathSchema = z.object({
  /** Intermediate camera positions. Capture positions are always inserted as exact endpoints. */
  waypoints: z.array(vec3Schema).min(1),
  /** Allow the opposite directed edge to reuse this path in reverse when it has no path of its own. */
  reversible: z.boolean().default(true),
});
export type TransitionPathConfig = z.infer<typeof transitionPathSchema>;

export const linkSchema = z.object({
  /** Target node id. */
  to: z.string().min(1),
  /** World-space placement of the floor disc, Y-up meters. */
  position: vec3Schema,
  /** Hide this shared marker while its target node is current (default true). */
  hideAtTarget: z.boolean().optional(),
  /** Optional arc-length-parameterized walk path. */
  path: transitionPathSchema.optional(),
});
export type LinkConfig = z.infer<typeof linkSchema>;

export const initialViewSchema = z.object({
  /** Radians. 0 looks toward -Z; positive turns left (counter-clockwise seen from above). */
  yaw: z.number(),
  /** Radians. Positive looks up. */
  pitch: z.number().default(0),
});
export type InitialViewConfig = z.infer<typeof initialViewSchema>;

export const panoramaSchema = z.object({
  /**
   * Panorama URL, resolved against `assets.basePath`. When
   * `rendering.previewSuffix` / `rendering.fullSuffix` are set, this is the
   * suffix-less stem ("pano/living_room"); otherwise it is loaded as-is.
   */
  url: z.string().min(1),
  /** Yaw alignment offset in radians applied to this panorama. */
  yaw: z.number().default(0),
  /** Deterministic source correction applied before panorama handoff. */
  correction: z
    .object({
      /** Exposure offset in stops. */
      exposure: z.number().finite().default(0),
      /** Linear RGB multiplier. */
      color: z
        .tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()])
        .default([1, 1, 1]),
    })
    .optional(),
});
export type PanoramaConfig = z.infer<typeof panoramaSchema>;

export const radialDepthSchema = z
  .object({
    /** GPU-ready KTX2 cubemap containing packed linear radial distance. */
    url: z.string().min(1),
    encoding: z.literal("rgba8-linear-radial"),
    size: z.number().int().positive(),
    near: z.number().positive(),
    far: z.number().positive(),
    /** Content checksum recorded by the asset compiler (for example sha256:...). */
    checksum: z.string().min(1),
  })
  .refine((depth) => depth.far > depth.near, {
    message: "Radial depth far must be greater than near",
  });
export type RadialDepthConfig = z.infer<typeof radialDepthSchema>;

export const nodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  /** Capture position in world space, Y-up meters. */
  position: vec3Schema,
  panorama: panoramaSchema,
  /** Optional precomputed radial-depth cubemap; runtime capture remains the fallback. */
  depth: radialDepthSchema.optional(),
  links: z.array(linkSchema).default([]),
  initialView: initialViewSchema.optional(),
});
export type NodeConfig = z.infer<typeof nodeSchema>;

export const hotspotTypeSchema = z.enum(["info", "image", "link", "custom"]);
export type HotspotType = z.infer<typeof hotspotTypeSchema>;

export const hotspotSchema = z.object({
  id: z.string().min(1),
  /** Node this hotspot belongs to. Omit for a shared hotspot (visible from every node). */
  node: z.string().optional(),
  /** Anchor position in world space, Y-up meters. */
  position: vec3Schema,
  type: hotspotTypeSchema.default("info"),
  title: z.string().optional(),
  body: z.string().optional(),
  /** For type "link": navigation target URL. */
  href: z.string().optional(),
  media: z
    .object({
      image: z.string().optional(),
    })
    .optional(),
  /** For type "custom": passed to the host app untouched. */
  payload: z.unknown().optional(),
});
export type HotspotConfig = z.infer<typeof hotspotSchema>;

export const assetsSchema = z.object({
  /** Proxy mesh (glTF). Optional when the engine is given a `proxyMesh` object directly. */
  mesh: z
    .object({
      url: z.string().min(1),
      draco: z.boolean().default(false),
    })
    .optional(),
  /** Higher-detail, render-only geometry used to capture transition visibility. */
  visibilityMesh: z
    .object({
      url: z.string().min(1),
      draco: z.boolean().default(false),
    })
    .optional(),
  /** Optional baked, unlit geometry used only to cover true disocclusions while moving. */
  bridge: z
    .object({
      url: z.string().min(1),
      draco: z.boolean().default(false),
    })
    .optional(),
  /** Optional pre-textured dollhouse GLB. The interaction proxy is reused when omitted. */
  dollhouse: z
    .object({
      url: z.string().min(1),
      draco: z.boolean().default(false),
    })
    .optional(),
  /** All relative URLs in the config resolve against this, making a tour folder relocatable. */
  basePath: z.string().optional(),
});
export type AssetsConfig = z.infer<typeof assetsSchema>;

export const renderingSchema = z.object({
  /** Low-res panorama suffix, loaded first (e.g. "_1k.jpg"). */
  previewSuffix: z.string().optional(),
  /** Full-res panorama suffix (e.g. "_8k.ktx2"). */
  fullSuffix: z.string().optional(),
  /** Clear color behind everything, and the fallback when a panorama is missing. */
  background: z.string().default("#0b0b0e"),
  /** Camera-travel projection, or a clean fade for sparse/imperfect proxies. */
  transition: z.enum(["walk", "fade"]).default("walk"),
});
export type RenderingConfig = z.infer<typeof renderingSchema>;

export const interactablesSchema = z.object({
  /** Meshes in the proxy whose name starts with this prefix are interactable. */
  namePrefix: z.string().default("int_"),
  highlight: z
    .object({
      color: z.string().default("#ffffff"),
      opacity: z.number().min(0).max(1).default(0.12),
    })
    .default({}),
});
export type InteractablesConfig = z.infer<typeof interactablesSchema>;

export const planBoundsSchema = z
  .object({
    /** Minimum [x, z] corner in world-space meters. */
    min: z.tuple([z.number(), z.number()]),
    /** Maximum [x, z] corner in world-space meters. */
    max: z.tuple([z.number(), z.number()]),
  })
  .refine((bounds) => bounds.max[0] > bounds.min[0] && bounds.max[1] > bounds.min[1], {
    message: "Plan bounds max must be greater than min",
  });
export type PlanBoundsConfig = z.infer<typeof planBoundsSchema>;

export const worldBoundsSchema = z
  .object({
    min: vec3Schema,
    max: vec3Schema,
  })
  .refine(
    (bounds) =>
      bounds.max[0] > bounds.min[0] &&
      bounds.max[1] > bounds.min[1] &&
      bounds.max[2] > bounds.min[2],
    { message: "World bounds max must be greater than min" },
  );
export type WorldBoundsConfig = z.infer<typeof worldBoundsSchema>;

export const ceilingSchema = z.object({
  /** Finished underside height. */
  y: z.number(),
  /** Thin generated fallback slab. Source geometry named like a ceiling takes precedence. */
  thickness: z.number().positive().default(0.08),
  bounds: planBoundsSchema,
});
export type CeilingConfig = z.infer<typeof ceilingSchema>;

export const topViewSchema = z.object({
  /** Display-referred orthographic render, resolved against assets.basePath. */
  url: z.string().min(1),
  /** World X/Z extent represented by the full image; defaults to overview.bounds. */
  bounds: planBoundsSchema.optional(),
  /** Project this image onto uncovered dollhouse surfaces. Disabled because projection can bend. */
  dollhouseProjection: z.boolean().default(false),
});
export type TopViewConfig = z.infer<typeof topViewSchema>;

export const measurementAxisSchema = z.enum(["width", "depth", "height"]);
export type MeasurementAxis = z.infer<typeof measurementAxisSchema>;

export const measurementSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    /** Exact proxy object/group name. Its world bounds are measured automatically. */
    target: z.string().min(1).optional(),
    /** Authored bounds override for architecture or irregular/rotated objects. */
    bounds: worldBoundsSchema.optional(),
    axes: z.array(measurementAxisSchema).min(1).default(["width", "depth", "height"]),
    /** Always visible while measurement mode is active. */
    defaultVisible: z.boolean().default(false),
    /** Per-target outline override; falls back to spatial.measurementColor. */
    color: z.string().min(1).optional(),
    /** Draw the outline through scene geometry. */
    alwaysOnTop: z.boolean().default(false),
    /** Distance between the measured bounds and its dimension lines. */
    offset: z.number().positive().default(0.18),
  })
  .refine((measurement) => measurement.target !== undefined || measurement.bounds !== undefined, {
    message: "A measurement needs a target or explicit bounds",
  });
export type MeasurementConfig = z.infer<typeof measurementSchema>;

export const spatialSchema = z.object({
  overview: z
    .object({
      /** Optional stable plan crop; otherwise proxy bounds are used. */
      bounds: planBoundsSchema.optional(),
      floorY: z.number().default(0),
      /** Generate a missing ceiling slab and hide it in top view. */
      ceiling: ceilingSchema.optional(),
      /** Optional baked orthographic render used instead of panorama reprojection. */
      topView: topViewSchema.optional(),
      /** Additional proxy object names to omit from plan/top rendering. */
      hiddenMeshes: z.array(z.string().min(1)).default([]),
    })
    .default({}),
  measurementColor: z.string().min(1).default("#ffffff"),
  measurements: z.array(measurementSchema).default([]),
});
export type SpatialConfig = z.infer<typeof spatialSchema>;

/** One selectable appearance for a configurable proxy-mesh group. */
export const configurableVariantSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** Optional CSS color used by host UIs to render a material swatch. */
  swatch: z.string().min(1).optional(),
  /**
   * Transparent equirectangular image layer per tour node. Each image must be
   * rendered from the same capture position/orientation as that node's panorama.
   * Missing nodes fall back to the original panorama appearance.
   */
  layers: z.record(z.string().min(1)).default({}),
});
export type ConfigurableVariantConfig = z.infer<typeof configurableVariantSchema>;

/** A proxy interactable whose appearance can be replaced at runtime. */
export const configurableSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  /** Interactable id, or a projection-only mesh id after removing the `proxy_` prefix. */
  interactable: z.string().min(1),
  default: z.string().min(1),
  variants: z.array(configurableVariantSchema).min(1),
});
export type ConfigurableConfig = z.infer<typeof configurableSchema>;

export const configurationDependencySchema = z.object({
  groupId: z.string().min(1),
  optionIds: z.array(z.string().min(1)).min(1),
  message: z.string().min(1).optional(),
});
export type ConfigurationDependencyConfig = z.infer<typeof configurationDependencySchema>;

export const configurationOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  sku: z.string().min(1).optional(),
  swatch: z.string().min(1).optional(),
  thumbnail: z.string().min(1).optional(),
  priceDeltaMinor: z.number().int().default(0),
  availability: z.enum(["available", "on-request", "unavailable"]).default("available"),
  /** Low-level configurable id to visual variant id. */
  variants: z.record(z.string().min(1)).default({}),
  requires: z.array(configurationDependencySchema).default([]),
  excludes: z.array(configurationDependencySchema).default([]),
  metadata: z.record(z.unknown()).default({}),
});
export type ConfigurationOptionConfig = z.infer<typeof configurationOptionSchema>;

export const configurationGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  room: z.string().optional(),
  default: z.string().min(1),
  options: z.array(configurationOptionSchema).min(1),
});
export type ConfigurationGroupConfig = z.infer<typeof configurationGroupSchema>;

export const configurationPresetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().optional(),
  badge: z.string().optional(),
  selections: z.record(z.string().min(1)),
});
export type ConfigurationPresetConfig = z.infer<typeof configurationPresetSchema>;

/** Buyer-facing product model layered above the renderer's configurables. */
export const configuratorSchema = z.object({
  catalogVersion: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  basePriceMinor: z.number().int().nonnegative().default(0),
  groups: z.array(configurationGroupSchema).min(1),
  presets: z.array(configurationPresetSchema).default([]),
  requestLabel: z.string().min(1).default("Request this configuration"),
});
export type ConfiguratorConfig = z.infer<typeof configuratorSchema>;

export const panoramaGuideViewSchema = z.object({
  mode: z.literal("panorama"),
  node: z.string().min(1),
  yaw: z.number().finite(),
  pitch: z
    .number()
    .finite()
    .min(-Math.PI / 2)
    .max(Math.PI / 2),
});

export const dollhouseGuideViewSchema = z.object({
  mode: z.literal("dollhouse"),
  /** Panorama anchor used for the flight and preferred dollhouse projection. */
  node: z.string().min(1),
  position: vec3Schema,
  target: vec3Schema,
  fov: z.number().finite().min(20).max(100).default(45),
});

export const topGuideViewSchema = z.object({
  mode: z.literal("top"),
  /** Plan center in world X/Z coordinates. */
  center: z.tuple([z.number(), z.number()]),
  zoom: z.number().finite().min(0.65).max(5).default(1),
});

export const guideViewSchema = z.discriminatedUnion("mode", [
  panoramaGuideViewSchema,
  dollhouseGuideViewSchema,
  topGuideViewSchema,
]);
export type GuideViewConfig = z.infer<typeof guideViewSchema>;

export const guideStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  view: guideViewSchema,
  measurementsVisible: z.boolean().default(false),
  /** Configurable id to variant id. Omitted configurables retain their current selection. */
  variants: z.record(z.string().min(1)).default({}),
  /** Override the guide's autoplay dwell for this step. */
  durationMs: z.number().int().min(3_000).max(120_000).optional(),
});
export type GuideStepConfig = z.infer<typeof guideStepSchema>;

export const guideSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(guideStepSchema).min(1),
  /** When present, the UI may offer opt-in autoplay. Playback never starts automatically. */
  autoplay: z
    .object({
      stepDurationMs: z.number().int().min(3_000).max(120_000).default(8_000),
    })
    .optional(),
  cta: z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      href: z.string().min(1).optional(),
    })
    .optional(),
});
export type GuideConfig = z.infer<typeof guideSchema>;

export const tourConfigSchema = z
  .object({
    version: z.literal(1),
    name: z.string().optional(),
    units: z.literal("meters").default("meters"),
    assets: assetsSchema.default({}),
    rendering: renderingSchema.default({}),
    interactables: interactablesSchema.default({}),
    spatial: spatialSchema.default({}),
    configurables: z.array(configurableSchema).default([]),
    configurator: configuratorSchema.optional(),
    /** Optional interactive, authored property stories. */
    guides: z.array(guideSchema).default([]),
    /** Navigation links visible from every node. */
    links: z.array(linkSchema).default([]),
    nodes: z.array(nodeSchema).min(1),
    hotspots: z.array(hotspotSchema).default([]),
    /** Starting node id. Defaults to the first node. */
    start: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    const ids = new Set<string>();
    for (const node of config.nodes) {
      if (ids.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["nodes"],
          message: `Duplicate node id "${node.id}"`,
        });
      }
      ids.add(node.id);
    }
    if (config.start !== undefined && !ids.has(config.start)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["start"],
        message: `Start node "${config.start}" does not exist`,
      });
    }
    config.links.forEach((link, i) => {
      if (link.path) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["links", i, "path"],
          message: "Shared links cannot define a source-specific transition path",
        });
      }
      if (!ids.has(link.to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["links", i, "to"],
          message: `Link target "${link.to}" does not exist`,
        });
      }
    });
    config.nodes.forEach((node, i) => {
      node.links.forEach((link, j) => {
        if (!ids.has(link.to)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["nodes", i, "links", j, "to"],
            message: `Link target "${link.to}" does not exist`,
          });
        }
      });
    });
    config.hotspots.forEach((hotspot, i) => {
      if (hotspot.node !== undefined && !ids.has(hotspot.node)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hotspots", i, "node"],
          message: `Hotspot node "${hotspot.node}" does not exist`,
        });
      }
    });
    const hotspotIds = new Set<string>();
    config.hotspots.forEach((hotspot, i) => {
      if (hotspotIds.has(hotspot.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["hotspots", i, "id"],
          message: `Duplicate hotspot id "${hotspot.id}"`,
        });
      }
      hotspotIds.add(hotspot.id);
    });

    const configurableIds = new Set<string>();
    const configurableTargets = new Set<string>();
    config.configurables.forEach((configurable, i) => {
      if (configurableIds.has(configurable.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["configurables", i, "id"],
          message: `Duplicate configurable id "${configurable.id}"`,
        });
      }
      configurableIds.add(configurable.id);

      if (configurableTargets.has(configurable.interactable)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["configurables", i, "interactable"],
          message: `Interactable "${configurable.interactable}" has more than one configurable`,
        });
      }
      configurableTargets.add(configurable.interactable);

      const variantIds = new Set<string>();
      configurable.variants.forEach((variant, j) => {
        if (variantIds.has(variant.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["configurables", i, "variants", j, "id"],
            message: `Duplicate variant id "${variant.id}"`,
          });
        }
        variantIds.add(variant.id);

        for (const nodeId of Object.keys(variant.layers)) {
          if (!ids.has(nodeId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["configurables", i, "variants", j, "layers", nodeId],
              message: `Variant layer node "${nodeId}" does not exist`,
            });
          }
        }
      });
      if (!variantIds.has(configurable.default)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["configurables", i, "default"],
          message: `Default variant "${configurable.default}" does not exist`,
        });
      }
    });

    if (config.configurator) {
      const groupIds = new Set<string>();
      const optionsByGroup = new Map<string, Set<string>>();

      config.configurator.groups.forEach((group, i) => {
        if (groupIds.has(group.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["configurator", "groups", i, "id"],
            message: `Duplicate configuration group id "${group.id}"`,
          });
        }
        groupIds.add(group.id);

        const optionIds = new Set<string>();
        optionsByGroup.set(group.id, optionIds);
        group.options.forEach((option, j) => {
          if (optionIds.has(option.id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["configurator", "groups", i, "options", j, "id"],
              message: `Duplicate option id "${option.id}" in group "${group.id}"`,
            });
          }
          optionIds.add(option.id);

          for (const [configurableId, variantId] of Object.entries(option.variants)) {
            const configurable = config.configurables.find((entry) => entry.id === configurableId);
            if (!configurable) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["configurator", "groups", i, "options", j, "variants", configurableId],
                message: `Configuration option references unknown configurable "${configurableId}"`,
              });
            } else if (!configurable.variants.some((variant) => variant.id === variantId)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["configurator", "groups", i, "options", j, "variants", configurableId],
                message: `Configuration option variant "${variantId}" does not exist for "${configurableId}"`,
              });
            }
          }
        });

        if (!optionIds.has(group.default)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["configurator", "groups", i, "default"],
            message: `Default option "${group.default}" does not exist in group "${group.id}"`,
          });
        }
      });

      config.configurator.groups.forEach((group, i) => {
        group.options.forEach((option, j) => {
          for (const [kind, dependencies] of [
            ["requires", option.requires],
            ["excludes", option.excludes],
          ] as const) {
            dependencies.forEach((dependency, k) => {
              const knownOptions = optionsByGroup.get(dependency.groupId);
              if (!knownOptions) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  path: ["configurator", "groups", i, "options", j, kind, k, "groupId"],
                  message: `Configuration dependency references unknown group "${dependency.groupId}"`,
                });
              } else {
                dependency.optionIds.forEach((optionId, l) => {
                  if (!knownOptions.has(optionId)) {
                    ctx.addIssue({
                      code: z.ZodIssueCode.custom,
                      path: ["configurator", "groups", i, "options", j, kind, k, "optionIds", l],
                      message: `Configuration dependency option "${optionId}" does not exist in group "${dependency.groupId}"`,
                    });
                  }
                });
              }
            });
          }
        });
      });

      const presetIds = new Set<string>();
      config.configurator.presets.forEach((preset, i) => {
        if (presetIds.has(preset.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["configurator", "presets", i, "id"],
            message: `Duplicate configuration preset id "${preset.id}"`,
          });
        }
        presetIds.add(preset.id);
        for (const [groupId, optionId] of Object.entries(preset.selections)) {
          const options = optionsByGroup.get(groupId);
          if (!options) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["configurator", "presets", i, "selections", groupId],
              message: `Configuration preset references unknown group "${groupId}"`,
            });
          } else if (!options.has(optionId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["configurator", "presets", i, "selections", groupId],
              message: `Configuration preset option "${optionId}" does not exist in group "${groupId}"`,
            });
          }
        }
      });
    }

    const guideIds = new Set<string>();
    config.guides.forEach((guide, i) => {
      if (guideIds.has(guide.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["guides", i, "id"],
          message: `Duplicate guide id "${guide.id}"`,
        });
      }
      guideIds.add(guide.id);

      const stepIds = new Set<string>();
      guide.steps.forEach((step, j) => {
        if (stepIds.has(step.id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["guides", i, "steps", j, "id"],
            message: `Duplicate guide step id "${step.id}"`,
          });
        }
        stepIds.add(step.id);

        if (step.view.mode !== "top" && !ids.has(step.view.node)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["guides", i, "steps", j, "view", "node"],
            message: `Guide step node "${step.view.node}" does not exist`,
          });
        }

        for (const [configurableId, variantId] of Object.entries(step.variants)) {
          const configurable = config.configurables.find((entry) => entry.id === configurableId);
          if (!configurable) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["guides", i, "steps", j, "variants", configurableId],
              message: `Guide step configurable "${configurableId}" does not exist`,
            });
          } else if (!configurable.variants.some((variant) => variant.id === variantId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["guides", i, "steps", j, "variants", configurableId],
              message: `Guide step variant "${variantId}" does not exist for "${configurableId}"`,
            });
          }
        }
      });
    });

    const measurementIds = new Set<string>();
    config.spatial.measurements.forEach((measurement, i) => {
      if (measurementIds.has(measurement.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["spatial", "measurements", i, "id"],
          message: `Duplicate measurement id "${measurement.id}"`,
        });
      }
      measurementIds.add(measurement.id);
    });
  });

export type TourConfig = z.infer<typeof tourConfigSchema>;
/** The shape accepted as input (before defaults are applied). */
export type TourConfigInput = z.input<typeof tourConfigSchema>;
