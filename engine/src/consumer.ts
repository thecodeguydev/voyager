import { claim, emitMetric, METRIC_KEYS, type AppDb, type ClaimedDispatchRow } from "@voyager/shared";
import { resolveContext } from "./resolver.js";
import { findCandidates } from "./matcher.js";
import { runPipeline } from "./pipeline/runner.js";
import { assign } from "./assigner.js";
import type { SettingsCache } from "./settingsCache.js";

export interface QueueConsumerOptions {
  db: AppDb;
  cache: SettingsCache;
  instanceId: string;
  batchSize: number;
}

const BASE_RETRY_DELAY_MS = 5_000;

/**
 * One claim cycle: claims up to `batchSize` pending rows and runs each through
 * resolve -> match -> pipeline -> assign. Returns the number of rows claimed so the caller can
 * decide whether to drain again immediately (PLAN.md "Tuning & caveats").
 */
export async function claimCycle(options: QueueConsumerOptions): Promise<number> {
  const { db, cache, instanceId, batchSize } = options;
  const rows = await claim(db.sequelize, instanceId, batchSize);

  for (const row of rows) {
    await processRow(db, cache, row);
  }

  return rows.length;
}

async function processRow(db: AppDb, cache: SettingsCache, row: ClaimedDispatchRow): Promise<void> {
  try {
    const order = await db.models.Order.findByPk(row.orderId);
    if (!order) throw new Error(`Order ${row.orderId} not found for dispatch_queue row ${row.id}`);

    const context = await resolveContext(cache, row.jurisdictionId);
    const candidates = await findCandidates(db, order, context.dispatchPolicy);
    const { candidates: ranked, trace } = await runPipeline(context.stages, candidates, {
      order,
      dispatchPolicy: context.dispatchPolicy,
    });

    if (ranked.length === 0) {
      await requeueForRetry(db, row, "No eligible candidate found");
      return;
    }

    const assignment = await assign(db, {
      order,
      ranked,
      pipelineTrace: trace,
      dispatchQueueRowId: row.id,
      responseTimeoutMs: context.responseTimeoutMs,
    });
    if (!assignment) {
      await requeueForRetry(db, row, "All candidates lost capacity before assignment could be locked in");
      return;
    }

    // assign() already marked this row done in the same transaction as the assignment write, so
    // a telemetry failure below can't roll it back into a pending re-dispatch of the same order.
    await emitDispatchMetrics(db, order, row, assignment);
  } catch (err) {
    await requeueForRetry(db, row, err instanceof Error ? err.message : String(err));
  }
}

async function emitDispatchMetrics(
  db: AppDb,
  order: { jurisdictionId: string; id: string; createdAt: Date },
  row: ClaimedDispatchRow,
  assignment: { workerId: string; dispatchedAt: Date },
): Promise<void> {
  try {
    await emitMetric(db, {
      metricKey: METRIC_KEYS.DISPATCH_RESPONSE_TIME_MS,
      jurisdictionId: order.jurisdictionId,
      orderId: order.id,
      workerId: assignment.workerId,
      value: assignment.dispatchedAt.getTime() - order.createdAt.getTime(),
    });
    await emitMetric(db, {
      metricKey: METRIC_KEYS.DISPATCH_TIME_TO_ASSIGN_MS,
      jurisdictionId: order.jurisdictionId,
      orderId: order.id,
      workerId: assignment.workerId,
      value: assignment.dispatchedAt.getTime() - row.claimedAt.getTime(),
    });
    await emitMetric(db, {
      metricKey: METRIC_KEYS.ASSIGNMENT_MANUAL_OVERRIDE_RATE,
      jurisdictionId: order.jurisdictionId,
      orderId: order.id,
      workerId: assignment.workerId,
      value: 0, // every assignment reaching this path is auto (source="auto")
    });
  } catch (err) {
    console.error(`[engine] failed to emit telemetry for order ${order.id}`, err);
  }
}

/** Flat retry delay on failure — exponential backoff/dead-letter cutoff is Phase 6 per the roadmap. */
async function requeueForRetry(db: AppDb, row: ClaimedDispatchRow, error: string): Promise<void> {
  await db.models.DispatchQueue.update(
    {
      status: "pending",
      attempts: row.attempts + 1,
      nextAttemptAt: new Date(Date.now() + BASE_RETRY_DELAY_MS),
      lastError: error,
    },
    { where: { id: row.id } },
  );
}

export interface QueueRunner {
  wake: () => void;
}

/**
 * Wraps `claimCycle` with drain-to-empty looping and wake coalescing: a wake that arrives while
 * a cycle is already running is remembered and triggers one more full drain after the current
 * cycle finishes, rather than being dropped — closing the race where a NOTIFY lands just after
 * the in-flight cycle's claim query already ran.
 */
export function createQueueRunner(options: QueueConsumerOptions): QueueRunner {
  let running = false;
  let wakeRequestedDuringRun = false;

  async function drain(): Promise<void> {
    if (running) {
      wakeRequestedDuringRun = true;
      return;
    }
    running = true;
    try {
      do {
        wakeRequestedDuringRun = false;
        let claimed: number;
        do {
          claimed = await claimCycle(options);
        } while (claimed >= options.batchSize);
      } while (wakeRequestedDuringRun);
    } finally {
      running = false;
    }
  }

  return { wake: () => void drain() };
}
