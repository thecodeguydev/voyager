import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns } from "./base.js";

export class ZoneWorker extends Model<
  InferAttributes<ZoneWorker>,
  InferCreationAttributes<ZoneWorker>
> {
  declare id: CreationOptional<string>;
  declare workerId: string;
  declare zoneId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initZoneWorkerModel(sequelize: Sequelize): typeof ZoneWorker {
  ZoneWorker.init(
    {
      ...baseColumns(),
      workerId: { type: DataTypes.UUID, allowNull: false },
      zoneId: { type: DataTypes.UUID, allowNull: false },
    },
    { sequelize, tableName: "zone_workers", modelName: "ZoneWorker" },
  );
  return ZoneWorker;
}
