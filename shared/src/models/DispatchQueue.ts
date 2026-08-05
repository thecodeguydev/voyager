import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type DispatchQueueStatus = "pending" | "claimed" | "done" | "error";
const DISPATCH_QUEUE_STATUSES: readonly DispatchQueueStatus[] = [
  "pending",
  "claimed",
  "done",
  "error",
];

export class DispatchQueue extends Model<
  InferAttributes<DispatchQueue>,
  InferCreationAttributes<DispatchQueue>
> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare jurisdictionId: string;
  declare status: CreationOptional<DispatchQueueStatus>;
  declare claimedBy: string | null;
  declare claimedAt: Date | null;
  declare attempts: CreationOptional<number>;
  declare nextAttemptAt: CreationOptional<Date>;
  declare lastError: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initDispatchQueueModel(sequelize: Sequelize): typeof DispatchQueue {
  DispatchQueue.init(
    {
      ...baseColumns(),
      orderId: { type: DataTypes.UUID, allowNull: false },
      jurisdictionId: { type: DataTypes.UUID, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "pending",
        validate: isInValidator(DISPATCH_QUEUE_STATUSES),
      },
      claimedBy: { type: DataTypes.STRING, allowNull: true },
      claimedAt: { type: DataTypes.DATE, allowNull: true },
      attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      nextAttemptAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      lastError: { type: DataTypes.TEXT, allowNull: true },
    },
    { sequelize, tableName: "dispatch_queue", modelName: "DispatchQueue" },
  );
  return DispatchQueue;
}
