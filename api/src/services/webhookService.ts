import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { WebhookEvent } from "@voyager/shared";
import { UniqueConstraintError } from "sequelize";
import type { AppDb } from "../db.js";
import { badRequest, forbidden, notFound, unauthorized } from "../lib/httpErrors.js";
import { toGeoJSONPoint } from "../lib/geo.js";
import { webhookPayloadSchema, type WebhookPayload } from "../lib/webhookPayloads.js";
import { cancelOrder, createOrder } from "./orderService.js";

export interface ReceiveWebhookInput {
  slug: string;
  rawBody: Buffer;
  signatureHeader: string | undefined;
  parsedBody: unknown;
}

export interface ReceiveWebhookResult {
  status: number;
  body: unknown;
}

interface ApplyResult {
  targetEntity: "order" | "worker";
  targetId: string;
}

interface EventMeta {
  eventType: string;
  dedupeKey: string;
}

function verifySignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signatureHeader, "utf8");
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}

/** Best-effort (eventType, dedupeKey) for logging a delivery whose payload we don't trust or
 * couldn't validate — falls back to a random key so a malformed/unsigned body can't collide
 * with (or block) a legitimate future delivery's dedupeKey. */
function extractEventMeta(body: unknown): EventMeta {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.eventType === "string" && typeof b.eventId === "string") {
      return { eventType: b.eventType, dedupeKey: b.eventId };
    }
  }
  return { eventType: "unknown", dedupeKey: randomUUID() };
}

async function assertJurisdictionInGroup(db: AppDb, jurisdictionId: string, groupId: string): Promise<void> {
  const jurisdiction = await db.models.Jurisdiction.findByPk(jurisdictionId);
  if (!jurisdiction || jurisdiction.groupId !== groupId) {
    throw forbidden("Jurisdiction does not belong to this source's group");
  }
}

/** Maps a validated webhook payload to the same service calls the matching REST endpoint uses. */
async function applyPayload(db: AppDb, groupId: string, payload: WebhookPayload): Promise<ApplyResult> {
  const { Order, Worker } = db.models;

  switch (payload.eventType) {
    case "order.create": {
      await assertJurisdictionInGroup(db, payload.jurisdictionId, groupId);
      const { order } = await createOrder(db, {
        jurisdictionId: payload.jurisdictionId,
        externalId: payload.externalId,
        type: payload.type,
        priorityTier: payload.priorityTier,
        payload: payload.payload,
        pickup: payload.pickup,
        slaDueAt: payload.slaDueAt,
      });
      return { targetEntity: "order", targetId: order.id };
    }
    case "order.cancel": {
      await assertJurisdictionInGroup(db, payload.jurisdictionId, groupId);
      const order = await Order.findOne({
        where: { jurisdictionId: payload.jurisdictionId, externalId: payload.externalId },
      });
      if (!order) throw notFound(`Order ${payload.externalId} not found`);
      await cancelOrder(db, order.id);
      return { targetEntity: "order", targetId: order.id };
    }
    case "worker.status":
    case "worker.location": {
      await assertJurisdictionInGroup(db, payload.jurisdictionId, groupId);
      const worker = await Worker.findOne({
        where: { jurisdictionId: payload.jurisdictionId, externalId: payload.externalId },
      });
      if (!worker) throw notFound(`Worker ${payload.externalId} not found`);
      if (payload.eventType === "worker.status") {
        await worker.update({ status: payload.status });
      } else {
        await worker.update({ location: toGeoJSONPoint(payload.location) });
      }
      return { targetEntity: "worker", targetId: worker.id };
    }
  }
}

interface RecordEventInput {
  sourceId: string;
  groupId: string;
  eventType: string;
  dedupeKey: string;
  signatureValid: boolean;
  payload: unknown;
  status: "processed" | "failed";
  targetEntity: "order" | "worker" | null;
  targetId: string | null;
  error: string | null;
}

/**
 * Writes the webhook_events receipt row. Two concurrent deliveries of the same dedupeKey can
 * both reach here (the dedupe check above is a plain read, not a lock); the loser's insert hits
 * the unique index, which is caught here and resolved to the winner's row instead of a 500.
 */
async function recordEvent(db: AppDb, input: RecordEventInput): Promise<WebhookEvent> {
  try {
    return await db.models.WebhookEvent.create({
      sourceId: input.sourceId,
      groupId: input.groupId,
      eventType: input.eventType,
      dedupeKey: input.dedupeKey,
      signatureValid: input.signatureValid,
      payload: input.payload as Record<string, unknown>,
      status: input.status,
      targetEntity: input.targetEntity,
      targetId: input.targetId,
      error: input.error,
    });
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const existing = await db.models.WebhookEvent.findOne({
        where: { sourceId: input.sourceId, dedupeKey: input.dedupeKey },
      });
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Receives an inbound webhook delivery: verifies the HMAC signature, deduplicates on
 * (sourceId, dedupeKey), maps the event to the same service calls the REST endpoints use,
 * and always logs the outcome to webhook_events for audit/replay — including rejections
 * (bad signature, disabled source, malformed payload, disallowed event type), each of which
 * still gets a receipt row per PLAN.md's "record signatureValid on the receipt regardless".
 * Only an unknown slug has no source to attach a receipt to.
 */
export async function receiveWebhook(db: AppDb, input: ReceiveWebhookInput): Promise<ReceiveWebhookResult> {
  const { WebhookSource } = db.models;

  const source = await WebhookSource.findOne({ where: { slug: input.slug } });
  if (!source) throw notFound(`Unknown webhook source ${input.slug}`);

  const signatureValid = verifySignature(source.secret, input.rawBody, input.signatureHeader);

  if (!signatureValid || source.status === "disabled") {
    const meta = extractEventMeta(input.parsedBody);
    const message = source.status === "disabled" ? "Webhook source is disabled" : "Invalid signature";
    await recordEvent(db, {
      sourceId: source.id,
      groupId: source.groupId,
      ...meta,
      signatureValid,
      payload: input.parsedBody,
      status: "failed",
      targetEntity: null,
      targetId: null,
      error: message,
    });
    throw unauthorized(message);
  }

  const parsed = webhookPayloadSchema.safeParse(input.parsedBody);
  if (!parsed.success) {
    const meta = extractEventMeta(input.parsedBody);
    await recordEvent(db, {
      sourceId: source.id,
      groupId: source.groupId,
      ...meta,
      signatureValid,
      payload: input.parsedBody,
      status: "failed",
      targetEntity: null,
      targetId: null,
      error: "Invalid webhook payload",
    });
    throw badRequest("Invalid webhook payload", parsed.error.issues);
  }
  const payload = parsed.data;

  if (source.allowedEvents && !source.allowedEvents.includes(payload.eventType)) {
    const message = `Source is not allowed to send ${payload.eventType} events`;
    await recordEvent(db, {
      sourceId: source.id,
      groupId: source.groupId,
      eventType: payload.eventType,
      dedupeKey: payload.eventId,
      signatureValid,
      payload: input.parsedBody,
      status: "failed",
      targetEntity: null,
      targetId: null,
      error: message,
    });
    throw forbidden(message);
  }

  const existing = await db.models.WebhookEvent.findOne({
    where: { sourceId: source.id, dedupeKey: payload.eventId },
  });
  if (existing) {
    return {
      status: 200,
      body: { status: existing.status, targetEntity: existing.targetEntity, targetId: existing.targetId },
    };
  }

  let result: ApplyResult | null = null;
  let status: "processed" | "failed" = "processed";
  let error: string | null = null;
  try {
    result = await applyPayload(db, source.groupId, payload);
  } catch (err) {
    status = "failed";
    error = err instanceof Error ? err.message : String(err);
  }

  await recordEvent(db, {
    sourceId: source.id,
    groupId: source.groupId,
    eventType: payload.eventType,
    dedupeKey: payload.eventId,
    signatureValid,
    payload: input.parsedBody,
    status,
    targetEntity: result?.targetEntity ?? null,
    targetId: result?.targetId ?? null,
    error,
  });
  await source.update({ lastReceivedAt: new Date() });

  return {
    status: 202,
    body: { status, targetEntity: result?.targetEntity ?? null, targetId: result?.targetId ?? null, error },
  };
}
