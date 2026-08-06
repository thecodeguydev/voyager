import type { AppDb } from "../db.js";

const DEFAULT_STALENESS_MS = 15_000;

export interface EngineHealthReport {
  status: "ok" | "degraded";
  instances: Array<{
    instanceId: string;
    state: string;
    lastHeartbeatAt: string;
    claimedInFlight: number;
  }>;
  healthyCount: number;
  ts: string;
}

/**
 * Engine liveness seen through the shared DB: no direct API<->engine channel exists, so this
 * reads engine_instances heartbeat rows. See PLAN.md "Health checks" / "engine_instances".
 */
export async function getEngineHealth(db: AppDb): Promise<EngineHealthReport> {
  const staleness = Number(
    (await db.settingsService.resolve("engine.heartbeat.staleness_ms")) ?? DEFAULT_STALENESS_MS,
  );
  const now = Date.now();

  const rows = await db.models.EngineInstance.findAll({ order: [["lastHeartbeatAt", "DESC"]] });
  const instances = rows.map((row) => ({
    instanceId: row.instanceId,
    state: now - row.lastHeartbeatAt.getTime() <= staleness ? row.state : "stopped",
    lastHeartbeatAt: row.lastHeartbeatAt.toISOString(),
    claimedInFlight: row.claimedInFlight,
  }));

  const healthyCount = instances.filter((i) => i.state === "healthy").length;

  return {
    status: healthyCount > 0 ? "ok" : "degraded",
    instances,
    healthyCount,
    ts: new Date(now).toISOString(),
  };
}
