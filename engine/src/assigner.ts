import {
  ACTIVE_ASSIGNMENT_STATES,
  resolveEffectiveCapacity,
  type AppDb,
  type Assignment,
  type Order,
} from "@voyager/shared";
import type { Candidate } from "./pipeline/stage.js";
import type { PipelineTraceEntry } from "./pipeline/runner.js";

export interface AssignInput {
  order: Order;
  ranked: Candidate[];
  pipelineTrace: PipelineTraceEntry[];
  dispatchQueueRowId: string;
}

const ALREADY_ASSIGNED = "already-assigned" as const;

/**
 * Transactionally assigns `order` to the highest-ranked candidate that still has capacity,
 * locking the chosen worker row (`SELECT ... FOR UPDATE`) and rechecking capacity inside that
 * lock — falling to the next candidate if it filled up since matching. The `dispatch_queue` row
 * is marked `done` in the same transaction as the assignment write (per PLAN.md's dispatch flow),
 * so a failure afterward can't roll the queue row back to `pending` while the assignment already
 * exists — the two can't go out of sync. Also guards against the order already having an active
 * assignment (e.g. a concurrent manual reassign), so a stale claim can't create a second one.
 * Returns null if every candidate lost capacity or the order was already assigned elsewhere (the
 * caller re-queues the row for retry in the latter case too, which is safe, if wasteful).
 */
export async function assign(db: AppDb, input: AssignInput): Promise<Assignment | null> {
  const { order, ranked, pipelineTrace, dispatchQueueRowId } = input;

  for (const candidate of ranked) {
    const result = await db.sequelize.transaction(async (transaction) => {
      const alreadyActive = await db.models.Assignment.count({
        where: { orderId: order.id, state: ACTIVE_ASSIGNMENT_STATES },
        transaction,
      });
      if (alreadyActive > 0) return ALREADY_ASSIGNED;

      const worker = await db.models.Worker.findByPk(candidate.worker.id, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!worker || worker.status !== "available") return null;

      const effectiveCapacity = await resolveEffectiveCapacity(worker, db.settingsService);
      const activeCount = await db.models.Assignment.count({
        where: { workerId: worker.id, state: ACTIVE_ASSIGNMENT_STATES },
        transaction,
      });
      if (activeCount >= effectiveCapacity) return null;

      const created = await db.models.Assignment.create(
        {
          orderId: order.id,
          workerId: worker.id,
          jurisdictionId: order.jurisdictionId,
          state: "dispatched",
          source: "auto",
          score: candidate.score,
          pipelineTrace: { stages: pipelineTrace, candidate: candidate.trace },
        },
        { transaction },
      );

      await order.update({ state: "dispatched" }, { transaction });
      await db.models.DispatchQueue.update(
        { status: "done" },
        { where: { id: dispatchQueueRowId }, transaction },
      );
      return created;
    });

    if (result === ALREADY_ASSIGNED) return null;
    if (result) return result;
  }

  return null;
}
