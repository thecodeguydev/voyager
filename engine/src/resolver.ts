import type { Stage } from "./pipeline/stage.js";
import type { SettingsCache } from "./settingsCache.js";

export interface DispatchContext {
  jurisdictionId: string;
  stages: Stage[];
  responseTimeoutMs: number;
}

/**
 * Loads the effective pipeline stage list + settings for a jurisdiction via the hot-reloading
 * settings cache. See PLAN.md "resolver" — Resolves jurisdiction from the order; loads pipeline
 * config + effective settings (from cache).
 */
export async function resolveContext(cache: SettingsCache, jurisdictionId: string): Promise<DispatchContext> {
  const { stages, responseTimeoutMs } = await cache.get(jurisdictionId);
  return { jurisdictionId, stages, responseTimeoutMs };
}
