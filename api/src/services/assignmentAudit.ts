import type { AuditAction } from "@voyager/shared";
import type { Transaction } from "sequelize";
import type { AppDb } from "../db.js";

export interface RecordAssignmentAuditInput {
  assignment: { id: string; toJSON(): Record<string, unknown> };
  jurisdictionId: string;
  action: AuditAction;
  actor: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  transaction: Transaction;
}

/** Writes the `audit_log` row every assignment mutation (reassign/unassign/lifecycle event) records. */
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
