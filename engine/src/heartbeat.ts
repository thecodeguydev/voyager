import type { AppDb } from "@voyager/shared";

export interface Heartbeat {
  stop(): Promise<void>;
}

/**
 * Upserts this instance's `engine_instances` row on startup and every `intervalMs`, marking it
 * `stopped` on graceful shutdown — the liveness source of truth `GET /health/engine` reads
 * across the shared-DB boundary. See PLAN.md "engine_instances" / "Heartbeat mechanism".
 */
export function startHeartbeat(db: AppDb, instanceId: string, intervalMs: number): Heartbeat {
  async function beat(state: "healthy" | "stopped" = "healthy"): Promise<void> {
    const claimedInFlight =
      state === "stopped"
        ? 0
        : await db.models.DispatchQueue.count({ where: { claimedBy: instanceId, status: "claimed" } });

    const now = new Date();
    const [instance] = await db.models.EngineInstance.findOrCreate({
      where: { instanceId },
      defaults: { instanceId, state, startedAt: now, lastHeartbeatAt: now, claimedInFlight },
    });
    await instance.update({ state, lastHeartbeatAt: new Date(), claimedInFlight });
  }

  void beat();
  const timer = setInterval(() => void beat(), intervalMs);

  return {
    async stop() {
      clearInterval(timer);
      await beat("stopped");
    },
  };
}
