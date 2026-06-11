import { z } from "zod";

/**
 * The MeshTour JSON config schema, version 1. This is the public contract:
 * everything else (including the future visual editor) builds on it.
 * Documented in CONFIG.md.
 */

export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof vec3Schema>;

export const linkSchema = z.object({
  /** Target node id. */
  to: z.string().min(1),
  /** World-space placement of the floor disc, Y-up meters. */
  position: vec3Schema,
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
});
export type PanoramaConfig = z.infer<typeof panoramaSchema>;

export const nodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  /** Capture position in world space, Y-up meters. */
  position: vec3Schema,
  panorama: panoramaSchema,
  links: z.array(linkSchema).default([]),
  initialView: initialViewSchema.optional(),
});
export type NodeConfig = z.infer<typeof nodeSchema>;

export const hotspotTypeSchema = z.enum(["info", "image", "link", "custom"]);
export type HotspotType = z.infer<typeof hotspotTypeSchema>;

export const hotspotSchema = z.object({
  id: z.string().min(1),
  /** Node this hotspot belongs to. Omit for a global hotspot (visible from every node). */
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

export const tourConfigSchema = z
  .object({
    version: z.literal(1),
    name: z.string().optional(),
    units: z.literal("meters").default("meters"),
    assets: assetsSchema.default({}),
    rendering: renderingSchema.default({}),
    interactables: interactablesSchema.default({}),
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
  });

export type TourConfig = z.infer<typeof tourConfigSchema>;
/** The shape accepted as input (before defaults are applied). */
export type TourConfigInput = z.input<typeof tourConfigSchema>;
