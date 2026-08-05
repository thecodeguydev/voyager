import { z } from "zod";
import { pointInputSchema } from "./geo.js";

// Phase 1 supports the event types the CRUD/ingestion surface actually has behind it;
// order lifecycle (accept/reject/progress/complete) waits for the Phase 2 engine.
const orderCreatePayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("order.create"),
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
  type: z.string().min(1),
  priorityTier: z.enum(["critical", "high", "normal", "low"]).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  pickup: pointInputSchema,
  slaDueAt: z.iso.datetime().nullable().optional(),
});

const orderCancelPayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("order.cancel"),
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
});

const workerStatusPayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("worker.status"),
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
  status: z.enum(["available", "busy", "offline"]),
});

const workerLocationPayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("worker.location"),
  jurisdictionId: z.uuid(),
  externalId: z.string().min(1),
  location: pointInputSchema,
});

export const webhookPayloadSchema = z.discriminatedUnion("eventType", [
  orderCreatePayloadSchema,
  orderCancelPayloadSchema,
  workerStatusPayloadSchema,
  workerLocationPayloadSchema,
]);

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
