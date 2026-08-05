import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type WebhookEventStatus = "received" | "processed" | "failed" | "skipped";
export type WebhookTargetEntity = "order" | "assignment" | "worker";

const WEBHOOK_EVENT_STATUSES: readonly WebhookEventStatus[] = [
  "received",
  "processed",
  "failed",
  "skipped",
];
const WEBHOOK_TARGET_ENTITIES: readonly WebhookTargetEntity[] = ["order", "assignment", "worker"];

export class WebhookEvent extends Model<
  InferAttributes<WebhookEvent>,
  InferCreationAttributes<WebhookEvent>
> {
  declare id: CreationOptional<string>;
  declare sourceId: string;
  declare groupId: string;
  declare eventType: string;
  declare dedupeKey: string;
  declare signatureValid: boolean;
  declare payload: Record<string, unknown>;
  declare status: CreationOptional<WebhookEventStatus>;
  declare targetEntity: WebhookTargetEntity | null;
  declare targetId: string | null;
  declare error: string | null;
  declare receivedAt: CreationOptional<Date>;
  declare processedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initWebhookEventModel(sequelize: Sequelize): typeof WebhookEvent {
  WebhookEvent.init(
    {
      ...baseColumns(),
      sourceId: { type: DataTypes.UUID, allowNull: false },
      groupId: { type: DataTypes.UUID, allowNull: false },
      eventType: { type: DataTypes.STRING, allowNull: false },
      dedupeKey: { type: DataTypes.STRING, allowNull: false },
      signatureValid: { type: DataTypes.BOOLEAN, allowNull: false },
      payload: { type: DataTypes.JSONB, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "received",
        validate: isInValidator(WEBHOOK_EVENT_STATUSES),
      },
      targetEntity: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: isInValidator(WEBHOOK_TARGET_ENTITIES),
      },
      targetId: { type: DataTypes.UUID, allowNull: true },
      error: { type: DataTypes.TEXT, allowNull: true },
      receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      processedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: "webhook_events", modelName: "WebhookEvent" },
  );
  return WebhookEvent;
}
