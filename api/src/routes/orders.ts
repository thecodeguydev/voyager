import { Router } from "express";
import { z } from "zod";
import type { Order } from "@voyager/shared";
import type { AppDb } from "../db.js";
import { actorFrom } from "../lib/actor.js";
import { fromGeoJSONPoint, pointInputSchema } from "../lib/geo.js";
import { idParamsSchema } from "../lib/schemas.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { cancelOrder, createOrder, getOrder, listOrders } from "../services/orderService.js";
import {
  getOrderAudit,
  listOrderAssignments,
  reassignOrder,
  unassignOrder,
} from "../services/assignmentService.js";
import {
  acceptOrder,
  completeOrder,
  progressOrder,
  rejectOrder,
} from "../services/lifecycleService.js";

const listQuerySchema = z.object({ jurisdictionId: z.uuid().optional(), state: z.string().optional() });

const createOrderSchema = z.object({
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
  type: z.string().min(1),
  priorityTier: z.enum(["critical", "high", "normal", "low"]).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  pickup: pointInputSchema,
  slaDueAt: z.iso.datetime().nullable().optional(),
});

const reassignSchema = z.object({
  workerId: z.uuid(),
  reason: z.string().min(1),
  force: z.boolean().optional(),
});
const unassignSchema = z.object({ reason: z.string().min(1) });
const lifecycleEventSchema = z.object({ reason: z.string().min(1).optional() });

function serializeOrder(order: Order) {
  const json = order.toJSON();
  return { ...json, pickup: fromGeoJSONPoint(json.pickup) };
}

export function createOrdersRouter(db: AppDb): Router {
  const router = Router();

  router.get("/", validateQuery(listQuerySchema), async (req, res) => {
    const orders = await listOrders(db, req.query as z.infer<typeof listQuerySchema>);
    res.json(orders.map(serializeOrder));
  });

  router.post("/", validateBody(createOrderSchema), async (req, res) => {
    const { order, created } = await createOrder(db, req.body);
    res.status(created ? 202 : 200).json(serializeOrder(order));
  });

  router.get<{ id: string }>("/:id", validateParams(idParamsSchema), async (req, res) => {
    res.json(serializeOrder(await getOrder(db, req.params.id)));
  });

  router.post<{ id: string }>("/:id/cancel", validateParams(idParamsSchema), async (req, res) => {
    res.json(serializeOrder(await cancelOrder(db, req.params.id)));
  });

  router.post<{ id: string }>(
    "/:id/accept",
    validateParams(idParamsSchema),
    validateBody(lifecycleEventSchema),
    async (req, res) => {
      res.json(await acceptOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) }));
    },
  );

  router.post<{ id: string }>(
    "/:id/reject",
    validateParams(idParamsSchema),
    validateBody(lifecycleEventSchema),
    async (req, res) => {
      res.json(await rejectOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) }));
    },
  );

  router.post<{ id: string }>(
    "/:id/progress",
    validateParams(idParamsSchema),
    validateBody(lifecycleEventSchema),
    async (req, res) => {
      res.json(await progressOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) }));
    },
  );

  router.post<{ id: string }>(
    "/:id/complete",
    validateParams(idParamsSchema),
    validateBody(lifecycleEventSchema),
    async (req, res) => {
      res.json(await completeOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) }));
    },
  );

  router.get<{ id: string }>("/:id/assignments", validateParams(idParamsSchema), async (req, res) => {
    res.json(await listOrderAssignments(db, req.params.id));
  });

  router.post<{ id: string }>(
    "/:id/reassign",
    validateParams(idParamsSchema),
    validateBody(reassignSchema),
    async (req, res) => {
      const result = await reassignOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) });
      res.json(result);
    },
  );

  router.post<{ id: string }>(
    "/:id/unassign",
    validateParams(idParamsSchema),
    validateBody(unassignSchema),
    async (req, res) => {
      const order = await unassignOrder(db, req.params.id, { ...req.body, actor: actorFrom(req) });
      res.json(serializeOrder(order));
    },
  );

  router.get<{ id: string }>("/:id/audit", validateParams(idParamsSchema), async (req, res) => {
    res.json(await getOrderAudit(db, req.params.id));
  });

  return router;
}
