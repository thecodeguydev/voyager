import { ACTIVE_ASSIGNMENT_STATES, METRIC_KEYS, emitMetric, resolveEffectiveCapacity, type AppDb } from "@voyager/shared";

/**
 * Periodically samples point-in-time gauge metrics (queue depth, worker utilization, active/idle
 * worker counts) per jurisdiction — these reflect current DB state rather than a single dispatch
 * event, so they need a sampler rather than an emission call site. See PLAN.md "Built-in metrics".
 */
export async function sampleGauges(db: AppDb): Promise<void> {
  const jurisdictions = await db.models.Jurisdiction.findAll({ where: { status: "active" }, attributes: ["id"] });
  for (const jurisdiction of jurisdictions) {
    await sampleJurisdiction(db, jurisdiction.id);
  }
}

async function sampleJurisdiction(db: AppDb, jurisdictionId: string): Promise<void> {
  const queueDepth = await db.models.DispatchQueue.count({
    where: { jurisdictionId, status: ["pending", "claimed"] },
  });
  await emitMetric(db, { metricKey: METRIC_KEYS.DISPATCH_QUEUE_DEPTH, jurisdictionId, value: queueDepth });

  const workers = await db.models.Worker.findAll({ where: { jurisdictionId } });

  let activeCount = 0;
  let idleCount = 0;
  let utilizationSum = 0;
  let utilizationSamples = 0;

  for (const worker of workers) {
    const activeAssignments = await db.models.Assignment.count({
      where: { workerId: worker.id, state: ACTIVE_ASSIGNMENT_STATES },
    });
    if (activeAssignments > 0) {
      activeCount++;
    } else if (worker.status === "available") {
      // Matches the metric_definitions description exactly: idle means *available* with zero
      // active assignments — an offline worker with no assignments is neither active nor idle.
      idleCount++;
    }

    // A worker with no resolvable capacity anywhere in the settings cascade is effectively
    // unlimited (resolveEffectiveCapacity returns Infinity) — excluded from the utilization
    // average since an Infinity denominator would make the ratio meaningless.
    const effectiveCapacity = await resolveEffectiveCapacity(worker, db.settingsService);
    if (Number.isFinite(effectiveCapacity) && effectiveCapacity > 0) {
      utilizationSum += activeAssignments / effectiveCapacity;
      utilizationSamples++;
    }
  }

  await emitMetric(db, { metricKey: METRIC_KEYS.WORKER_ACTIVE_COUNT, jurisdictionId, value: activeCount });
  await emitMetric(db, { metricKey: METRIC_KEYS.WORKER_IDLE_COUNT, jurisdictionId, value: idleCount });
  if (utilizationSamples > 0) {
    await emitMetric(db, {
      metricKey: METRIC_KEYS.WORKER_UTILIZATION,
      jurisdictionId,
      value: utilizationSum / utilizationSamples,
    });
  }
}
