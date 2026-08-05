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

export type WorkerType = "utility" | "delivery" | "cab";
export type WorkerStatus = "available" | "busy" | "offline";
const WORKER_TYPES: readonly WorkerType[] = ["utility", "delivery", "cab"];
const WORKER_STATUSES: readonly WorkerStatus[] = ["available", "busy", "offline"];

export class Worker extends Model<InferAttributes<Worker>, InferCreationAttributes<Worker>> {
  declare id: CreationOptional<string>;
  declare jurisdictionId: string;
  declare externalId: string;
  declare name: string;
  declare type: WorkerType;
  declare skills: CreationOptional<string[]>;
  declare maxConcurrent: number | null;
  declare location: GeoJSONPoint | null;
  declare status: CreationOptional<WorkerStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initWorkerModel(sequelize: Sequelize): typeof Worker {
  Worker.init(
    {
      ...baseColumns(),
      jurisdictionId: { type: DataTypes.UUID, allowNull: false },
      externalId: { type: DataTypes.STRING, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(WORKER_TYPES) },
      skills: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
      maxConcurrent: { type: DataTypes.INTEGER, allowNull: true },
      location: { type: DataTypes.GEOGRAPHY("POINT", 4326), allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "available",
        validate: isInValidator(WORKER_STATUSES),
      },
    },
    { sequelize, tableName: "workers", modelName: "Worker" },
  );
  return Worker;
}
