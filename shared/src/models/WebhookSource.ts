import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type WebhookSourceStatus = "active" | "disabled";
const WEBHOOK_SOURCE_STATUSES: readonly WebhookSourceStatus[] = ["active", "disabled"];

export class WebhookSource extends Model<
  InferAttributes<WebhookSource>,
  InferCreationAttributes<WebhookSource>
> {
  declare id: CreationOptional<string>;
  declare groupId: string;
  declare name: string;
  declare slug: string;
  declare secret: string;
  declare allowedEvents: string[] | null;
  declare status: CreationOptional<WebhookSourceStatus>;
  declare lastReceivedAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initWebhookSourceModel(sequelize: Sequelize): typeof WebhookSource {
  WebhookSource.init(
    {
      ...baseColumns(),
      groupId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      slug: { type: DataTypes.STRING, allowNull: false, unique: true },
      secret: { type: DataTypes.STRING, allowNull: false },
      allowedEvents: { type: DataTypes.JSONB, allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "active",
        validate: isInValidator(WEBHOOK_SOURCE_STATUSES),
      },
      lastReceivedAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: "webhook_sources", modelName: "WebhookSource" },
  );
  return WebhookSource;
}
