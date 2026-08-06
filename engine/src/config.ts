import "dotenv/config";
import { randomUUID } from "node:crypto";

export interface EngineConfig {
  databaseUrl: string;
  instanceId: string;
  pollIntervalMs: number;
  batchSize: number;
  heartbeatIntervalMs: number;
  expirySweepIntervalMs: number;
  gaugeSampleIntervalMs: number;
  partitionMaintenanceIntervalMs: number;
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
    expirySweepIntervalMs: Number(process.env.SLA_SWEEP_INTERVAL_MS ?? 10_000),
    gaugeSampleIntervalMs: Number(process.env.GAUGE_SAMPLE_INTERVAL_MS ?? 30_000),
    partitionMaintenanceIntervalMs: Number(process.env.PARTITION_MAINTENANCE_INTERVAL_MS ?? 86_400_000),
  };
}
