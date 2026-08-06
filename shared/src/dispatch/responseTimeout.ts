import type { SettingsService } from "../settings/SettingsService.js";

export const DEFAULT_RESPONSE_TIMEOUT_MS = 300_000;

/**
 * How long a dispatched assignment (auto or manual) waits for a worker response before the
 * scheduler's SLA sweep expires it and re-queues the order — resolved through the Settings
 * cascade like every other dispatch tunable, so it can be overridden per group/jurisdiction.
 */
export async function resolveResponseTimeoutMs(
  settingsService: SettingsService,
  jurisdictionId: string,
): Promise<number> {
  const resolved = await settingsService.resolve("assignment.response_timeout_ms", { jurisdictionId });
  return resolved != null ? Number(resolved) : DEFAULT_RESPONSE_TIMEOUT_MS;
}
