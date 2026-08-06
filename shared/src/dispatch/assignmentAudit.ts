import type { Transaction } from "sequelize";
import type { AppDb } from "../db/createDb.js";
import type { AuditAction } from "../models/AuditLog.js";

export interface RecordAssignmentAuditInput {
  assignment: { id: string; toJSON(): Record<string, unknown> };
  jurisdictionId: string;
  action: AuditAction;
  actor: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  transaction: Transaction;
}

/**
 * Writes the `audit_log` row every assignment mutation records — manual reassign/unassign, a
 * worker-reported lifecycle event, and the scheduler's expiry sweep all call this so the three
 * callers (two in `api`, one in `engine`) can't diverge on the audit shape.
 */
export async function recordAssignmentAudit(db: AppDb, input: RecordAssignmentAuditInput): Promise<void> {
  await db.models.AuditLog.create(
    {
      entity: "assignment",
      entityId: input.assignment.id,
      jurisdictionId: input.jurisdictionId,
      action: input.action,
      actor: input.actor,
      reason: input.reason,
      before: input.before,
      after: input.assignment.toJSON(),
    },
    { transaction: input.transaction },
  );
}
