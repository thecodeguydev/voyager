import type { AppDb } from "@voyager/shared";
import { sweepExpiredAssignments } from "./expirySweep.js";
import { sampleGauges } from "./gaugeSampler.js";
import { maintainPartitions } from "./partitionMaintenance.js";

export interface SchedulerOptions {
  db: AppDb;
  expirySweepIntervalMs: number;
  gaugeSampleIntervalMs: number;
  partitionMaintenanceIntervalMs: number;
}

export interface Scheduler {
  stop(): void;
}

function logJobError(job: string): (err: unknown) => void {
  return (err) => console.error(`[engine] scheduler job "${job}" failed`, err);
}

/**
 * Wires Phase 4's three independent periodic jobs — SLA-expiry sweep, gauge-metric sampling, and
 * metric_points partition maintenance — each on its own cadence, mirroring heartbeat.ts's
 * start-immediately + interval + stop shape. A deferred future rebalance pass (see PLAN.md) slots
 * in here as a fourth timer without restructuring this module.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const { db } = options;

  void sweepExpiredAssignments(db).catch(logJobError("expiry-sweep"));
  void sampleGauges(db).catch(logJobError("gauge-sampler"));
  void maintainPartitions(db).catch(logJobError("partition-maintenance"));

  const timers = [
    setInterval(() => void sweepExpiredAssignments(db).catch(logJobError("expiry-sweep")), options.expirySweepIntervalMs),
    setInterval(() => void sampleGauges(db).catch(logJobError("gauge-sampler")), options.gaugeSampleIntervalMs),
    setInterval(
      () => void maintainPartitions(db).catch(logJobError("partition-maintenance")),
      options.partitionMaintenanceIntervalMs,
    ),
  ];

  return {
    stop() {
      timers.forEach(clearInterval);
    },
  };
}
