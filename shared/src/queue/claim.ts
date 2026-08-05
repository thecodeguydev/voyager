import { QueryTypes, type Sequelize } from "sequelize";

export interface ClaimedDispatchRow {
  id: string;
  orderId: string;
  jurisdictionId: string;
  status: string;
  claimedBy: string;
  claimedAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Atomically claims up to `batchSize` pending dispatch_queue rows for `instanceId` via
 * `SELECT ... FOR UPDATE SKIP LOCKED`, so concurrent engine instances never claim the same row.
 * See PLAN.md "Queue notification mechanism".
 */
export async function claim(
  sequelize: Sequelize,
  instanceId: string,
  batchSize: number,
): Promise<ClaimedDispatchRow[]> {
  return sequelize.query<ClaimedDispatchRow>(
    `
    UPDATE dispatch_queue SET status = 'claimed', "claimedBy" = :instanceId, "claimedAt" = now(), "updatedAt" = now()
    WHERE id IN (
      SELECT id FROM dispatch_queue
      WHERE status = 'pending' AND "nextAttemptAt" <= now()
      ORDER BY "nextAttemptAt"
      FOR UPDATE SKIP LOCKED
      LIMIT :batchSize
    )
    RETURNING *
    `,
    {
      replacements: { instanceId, batchSize },
      // RETURNING produces plain rows; QueryTypes.SELECT makes sequelize hand them back
      // as a bare array instead of the [results, metadata] tuple UPDATE normally returns.
      type: QueryTypes.SELECT,
    },
  );
}
