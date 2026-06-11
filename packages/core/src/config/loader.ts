import { tourConfigSchema, type TourConfig, type TourConfigInput } from "./schema";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Validate raw data against the v1 schema. Throws ConfigError with readable messages. */
export function validateConfig(data: unknown): TourConfig {
  const result = tourConfigSchema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid tour config:\n${details}`);
  }
  return result.data;
}

/** Load a config from a URL or validate an inline object. */
export async function loadConfig(source: string | TourConfigInput): Promise<TourConfig> {
  if (typeof source !== "string") return validateConfig(source);
  let response: Response;
  try {
    response = await fetch(source);
  } catch (cause) {
    throw new ConfigError(`Failed to fetch tour config from "${source}": ${String(cause)}`);
  }
  if (!response.ok) {
    throw new ConfigError(`Failed to fetch tour config from "${source}": HTTP ${response.status}`);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ConfigError(`Tour config at "${source}" is not valid JSON`);
  }
  return validateConfig(data);
}

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/)/i;

/**
 * Resolve an asset URL against `assets.basePath`. Absolute URLs (scheme or
 * root-relative) pass through, which is what makes blob:/data: URLs and CDN
 * paths work without configuration.
 */
export function resolveAssetUrl(config: Pick<TourConfig, "assets">, url: string): string {
  const basePath = config.assets.basePath;
  if (!basePath || ABSOLUTE_URL.test(url)) return url;
  return basePath.endsWith("/") ? basePath + url : `${basePath}/${url}`;
}
