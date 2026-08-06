import type { Worker } from "../models/Worker.js";
import type { SettingsService } from "../settings/SettingsService.js";

/**
 * A worker's effective capacity: its own override, else the resolved `worker.max_concurrent`
 * setting, else unlimited. The one place this cascade is computed — matcher's soft filter,
 * assigner's in-lock hard recheck, and manual reassignment all call this so they can't diverge.
 */
export async function resolveEffectiveCapacity(
  worker: Pick<Worker, "maxConcurrent" | "jurisdictionId">,
  settingsService: SettingsService,
): Promise<number> {
  if (worker.maxConcurrent != null) return worker.maxConcurrent;
  const resolved = await settingsService.resolve("worker.max_concurrent", {
    jurisdictionId: worker.jurisdictionId,
  });
  return resolved != null ? Number(resolved) : Infinity;
}
