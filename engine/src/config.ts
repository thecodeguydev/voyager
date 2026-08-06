import "dotenv/config";
import { randomUUID } from "node:crypto";

export interface EngineConfig {
  databaseUrl: string;
  instanceId: string;
  pollIntervalMs: number;
  batchSize: number;
  heartbeatIntervalMs: number;
}

/** Engine runtime configuration, read once at process startup. */
export function loadConfig(): EngineConfig {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 5000);

  return {
    databaseUrl,
    instanceId: process.env.ENGINE_INSTANCE_ID ?? `engine-${randomUUID()}`,
    pollIntervalMs,
    batchSize: Number(process.env.DISPATCH_BATCH_SIZE ?? 10),
    heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? pollIntervalMs),
  };
}
