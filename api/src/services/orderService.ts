import {
  METRIC_KEYS,
  TERMINAL_ORDER_STATES,
  emitMetric,
  enqueueDispatch,
  type Order,
  type OrderPriorityTier,
} from "@voyager/shared";
import { UniqueConstraintError, type WhereOptions } from "sequelize";
import type { AppDb } from "../db.js";
import { badRequest, notFound } from "../lib/httpErrors.js";
import { toGeoJSONPoint, type PointInput } from "../lib/geo.js";

export interface CreateOrderInput {
  jurisdictionId: string;
  externalId: string;
  type: string;
  priorityTier?: OrderPriorityTier | null;
  payload?: Record<string, unknown>;
  pickup: PointInput;
  slaDueAt?: string | null;
}

export interface CreateOrderResult {
  order: Order;
  created: boolean;
}

/**
 * Writes the order + a pending dispatch_queue row transactionally. Idempotent on
 * (jurisdictionId, externalId) — a resubmission returns the existing order instead of erroring.
 *
 * The find-then-create isn't atomic, so two concurrent submissions of the same
 * (jurisdictionId, externalId) can both pass the initial check; the loser's insert hits the
 * unique index and is caught below, falling back to the winner's row instead of a 500.
 */
export async function createOrder(db: AppDb, input: CreateOrderInput): Promise<CreateOrderResult> {
  const { Jurisdiction, Order } = db.models;

  const jurisdiction = await Jurisdiction.findByPk(input.jurisdictionId);
  if (!jurisdiction) throw notFound(`Jurisdiction ${input.jurisdictionId} not found`);

  const existing = await Order.findOne({
    where: { jurisdictionId: input.jurisdictionId, externalId: input.externalId },
  });
  if (existing) return { order: existing, created: false };

  try {
    const order = await db.sequelize.transaction(async (transaction) => {
      const created = await Order.create(
        {
          jurisdictionId: input.jurisdictionId,
          externalId: input.externalId,
          type: input.type,
          priorityTier: input.priorityTier ?? null,
          payload: input.payload ?? {},
          pickup: toGeoJSONPoint(input.pickup),
          state: "queued",
          slaDueAt: input.slaDueAt ? new Date(input.slaDueAt) : null,
        },
        { transaction },
      );

      await enqueueDispatch(db.models, { orderId: created.id, jurisdictionId: created.jurisdictionId }, transaction);

      return created;
    });

    // Emitted after commit, in its own try/catch — telemetry can never fail order creation. Only
    // a genuinely new order counts (not an idempotent resubmission), so orders/hour reflects real
    // volume — realized entirely at query time via GET /metrics/query?groupBy=hour.
    try {
      await emitMetric(db, {
        metricKey: METRIC_KEYS.ORDERS_CREATED,
        jurisdictionId: order.jurisdictionId,
        orderId: order.id,
        value: 1,
      });
    } catch (err) {
      console.error(`[api] order-creation telemetry failed for order ${order.id}`, err);
    }

    return { order, created: true };
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const raceWinner = await Order.findOne({
        where: { jurisdictionId: input.jurisdictionId, externalId: input.externalId },
      });
      if (raceWinner) return { order: raceWinner, created: false };
    }
    throw err;
  }
}

export async function listOrders(
  db: AppDb,
  filters: { jurisdictionId?: string; state?: string } = {},
): Promise<Order[]> {
  const where: WhereOptions<Order> = {};
  if (filters.jurisdictionId) where.jurisdictionId = filters.jurisdictionId;
  if (filters.state) where.state = filters.state as Order["state"];
  return db.models.Order.findAll({ where });
}

export async function getOrder(db: AppDb, orderId: string): Promise<Order> {
  const order = await db.models.Order.findByPk(orderId);
  if (!order) throw notFound(`Order ${orderId} not found`);
  return order;
}

/** Cancels a non-terminal order and marks any in-flight dispatch_queue row done. */
export async function cancelOrder(db: AppDb, orderId: string): Promise<Order> {
  const { Order, DispatchQueue } = db.models;
  return db.sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, { transaction });
    if (!order) throw notFound(`Order ${orderId} not found`);
    if (TERMINAL_ORDER_STATES.includes(order.state)) {
      throw badRequest(`Order ${orderId} is already terminal (${order.state})`);
    }

    await order.update({ state: "cancelled" }, { transaction });
    await DispatchQueue.update(
      { status: "done" },
      { where: { orderId, status: ["pending", "claimed"] }, transaction },
    );
    return order;
  });
}
