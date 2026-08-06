import type { Transaction } from "sequelize";
import type { Models } from "../models/index.js";

/**
 * Inserts a fresh pending `dispatch_queue` row for `orderId` — the re-queue-to-auto-dispatch
 * step shared by order creation, manual unassign, and lifecycle reject/expire. Relies on the
 * model's own defaults for `status`/`attempts`/`nextAttemptAt`.
 */
export async function enqueueDispatch(
  models: Pick<Models, "DispatchQueue">,
  input: { orderId: string; jurisdictionId: string },
  transaction?: Transaction,
): Promise<void> {
  await models.DispatchQueue.create({ orderId: input.orderId, jurisdictionId: input.jurisdictionId }, { transaction });
}
