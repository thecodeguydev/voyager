import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import type { GeoJSONPoint } from "./geo.js";
import { baseColumns, isInValidator } from "./base.js";

export type OrderPriorityTier = "critical" | "high" | "normal" | "low";
export type OrderState =
  | "created"
  | "queued"
  | "dispatched"
  | "accepted"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";
  
const ORDER_PRIORITY_TIERS: readonly OrderPriorityTier[] = ["critical", "high", "normal", "low"];
const ORDER_STATES: readonly OrderState[] = ["created", "queued", "dispatched", "accepted", "in_progress", "completed", "cancelled", "failed"];

export class Order extends Model<InferAttributes<Order>, InferCreationAttributes<Order>> {
  declare id: CreationOptional<string>;
  declare jurisdictionId: string;
  declare externalId: string;
  declare type: string;
  declare priorityTier: OrderPriorityTier | null;
  declare payload: CreationOptional<Record<string, unknown>>;
  declare pickup: GeoJSONPoint;
  declare state: CreationOptional<OrderState>;
  declare slaDueAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initOrderModel(sequelize: Sequelize): typeof Order {
  Order.init({
    ...baseColumns(),
    "jurisdictionId": {
      "type": DataTypes.UUID,
      "allowNull": false
    },
    "externalId": {
      "type": DataTypes.STRING,
      "allowNull": false
    },
    "type": {
      "type": DataTypes.STRING,
      "allowNull": false
    },
    "priorityTier": {
      "type": DataTypes.STRING,
      "allowNull": true,
      "validate": isInValidator(ORDER_PRIORITY_TIERS),
    },
    "payload": {
      "type": DataTypes.JSONB,
      "allowNull": false,
      "defaultValue": {}
    },
    "pickup": {
      "type": DataTypes.GEOGRAPHY("POINT", 4326),
      "allowNull": false
    },
    "state": {
      "type": DataTypes.STRING,
      "allowNull": false,
      "defaultValue": "created",
      "validate": isInValidator(ORDER_STATES),
    },
    "slaDueAt": { "type": DataTypes.DATE, "allowNull": true },
  }, {
    sequelize,
    "tableName": "orders",
    "modelName": "Order"
  });

  return Order;
}
