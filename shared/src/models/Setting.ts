import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type SettingScope = "global" | "group" | "jurisdiction";
const SETTING_SCOPES: readonly SettingScope[] = ["global", "group", "jurisdiction"];

export class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare id: CreationOptional<string>;
  declare scope: SettingScope;
  declare groupId: string | null;
  declare jurisdictionId: string | null;
  declare key: string;
  declare value: unknown;
  declare dataType: string;
  declare description: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initSettingModel(sequelize: Sequelize): typeof Setting {
  Setting.init(
    {
      ...baseColumns(),
      scope: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(SETTING_SCOPES) },
      groupId: { type: DataTypes.UUID, allowNull: true },
      jurisdictionId: { type: DataTypes.UUID, allowNull: true },
      key: { type: DataTypes.STRING, allowNull: false },
      value: { type: DataTypes.JSONB, allowNull: false },
      dataType: { type: DataTypes.STRING, allowNull: false },
      description: { type: DataTypes.TEXT, allowNull: true },
    },
    { sequelize, tableName: "settings", modelName: "Setting" },
  );
  return Setting;
}
