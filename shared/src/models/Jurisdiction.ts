import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type JurisdictionStatus = "active" | "inactive";
const JURISDICTION_STATUSES: readonly JurisdictionStatus[] = ["active", "inactive"];

export class Jurisdiction extends Model<
  InferAttributes<Jurisdiction>,
  InferCreationAttributes<Jurisdiction>
> {
  declare id: CreationOptional<string>;
  declare groupId: string;
  declare name: string;
  declare code: string;
  declare timezone: string;
  declare status: CreationOptional<JurisdictionStatus>;
  declare settingsVersion: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initJurisdictionModel(sequelize: Sequelize): typeof Jurisdiction {
  Jurisdiction.init(
    {
      ...baseColumns(),
      groupId: { type: DataTypes.UUID, allowNull: false },
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false },
      timezone: { type: DataTypes.STRING, allowNull: false },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "active",
        validate: isInValidator(JURISDICTION_STATUSES),
      },
      settingsVersion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    },
    { sequelize, tableName: "jurisdictions", modelName: "Jurisdiction" },
  );
  return Jurisdiction;
}
