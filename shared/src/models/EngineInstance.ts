import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type EngineInstanceState = "healthy" | "stopped";
const ENGINE_INSTANCE_STATES: readonly EngineInstanceState[] = ["healthy", "stopped"];

/** A running engine process's heartbeat row — the liveness source of truth across the shared-DB boundary. */
export class EngineInstance extends Model<
  InferAttributes<EngineInstance>,
  InferCreationAttributes<EngineInstance>
> {
  declare id: CreationOptional<string>;
  declare instanceId: string;
  declare state: CreationOptional<EngineInstanceState>;
  declare lastHeartbeatAt: CreationOptional<Date>;
  declare claimedInFlight: CreationOptional<number>;
  declare startedAt: CreationOptional<Date>;
  declare version: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initEngineInstanceModel(sequelize: Sequelize): typeof EngineInstance {
  EngineInstance.init(
    {
      ...baseColumns(),
      instanceId: { type: DataTypes.STRING, allowNull: false, unique: true },
      state: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "healthy",
        validate: isInValidator(ENGINE_INSTANCE_STATES),
      },
      lastHeartbeatAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      claimedInFlight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      version: { type: DataTypes.STRING, allowNull: true },
    },
    { sequelize, tableName: "engine_instances", modelName: "EngineInstance" },
  );
  return EngineInstance;
}
