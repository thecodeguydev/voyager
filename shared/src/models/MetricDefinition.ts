import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type MetricType = "counter" | "gauge" | "duration" | "rate";
export type MetricAggregation = "sum" | "avg" | "p95" | "max";
const METRIC_TYPES: readonly MetricType[] = ["counter", "gauge", "duration", "rate"];
const METRIC_AGGREGATIONS: readonly MetricAggregation[] = ["sum", "avg", "p95", "max"];

/** The metric dictionary: predefined + user-defined metric metadata. */
export class MetricDefinition extends Model<
  InferAttributes<MetricDefinition>,
  InferCreationAttributes<MetricDefinition>
> {
  declare id: CreationOptional<string>;
  declare key: string;
  declare name: string;
  declare description: string | null;
  declare unit: string;
  declare type: MetricType;
  declare builtin: CreationOptional<boolean>;
  declare aggregation: MetricAggregation;
  declare jurisdictionId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initMetricDefinitionModel(sequelize: Sequelize): typeof MetricDefinition {
  MetricDefinition.init(
    {
      ...baseColumns(),
      key: { type: DataTypes.STRING, allowNull: false, unique: true },
      name: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
      unit: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(METRIC_TYPES) },
      builtin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      aggregation: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: isInValidator(METRIC_AGGREGATIONS),
      },
      jurisdictionId: { type: DataTypes.UUID, allowNull: true },
    },
    { sequelize, tableName: "metric_definitions", modelName: "MetricDefinition" },
  );
  return MetricDefinition;
}
