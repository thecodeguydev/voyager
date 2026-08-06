import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns } from "./base.js";

/**
 * One emitted telemetry data point. See PLAN.md "Telemetry / metric dictionaries" — the
 * highest-volume table, managed by partitioning + retention (Phase 4) rather than left unbounded.
 */
export class MetricPoint extends Model<InferAttributes<MetricPoint>, InferCreationAttributes<MetricPoint>> {
  declare id: CreationOptional<string>;
  declare metricKey: string;
  declare jurisdictionId: string;
  declare workerId: string | null;
  declare orderId: string | null;
  declare value: number;
  declare dimensions: CreationOptional<Record<string, unknown>>;
  declare ts: CreationOptional<Date>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initMetricPointModel(sequelize: Sequelize): typeof MetricPoint {
  MetricPoint.init(
    {
      ...baseColumns(),
      metricKey: { type: DataTypes.STRING, allowNull: false },
      jurisdictionId: { type: DataTypes.UUID, allowNull: false },
      workerId: { type: DataTypes.UUID, allowNull: true },
      orderId: { type: DataTypes.UUID, allowNull: true },
      value: { type: DataTypes.DECIMAL, allowNull: false },
      dimensions: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
      ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    },
    { sequelize, tableName: "metric_points", modelName: "MetricPoint" },
  );
  return MetricPoint;
}
