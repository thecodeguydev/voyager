import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type GroupStatus = "active" | "inactive";
const GROUP_STATUSES: readonly GroupStatus[] = ["active", "inactive"];

export class Group extends Model<InferAttributes<Group>, InferCreationAttributes<Group>> {
  declare id: CreationOptional<string>;
  declare name: string;
  declare code: string;
  declare description: string | null;
  declare status: CreationOptional<GroupStatus>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initGroupModel(sequelize: Sequelize): typeof Group {
  Group.init(
    {
      ...baseColumns(),
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: false, unique: true },
      description: { type: DataTypes.TEXT, allowNull: true },
      status: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "active",
        validate: isInValidator(GROUP_STATUSES),
      },
    },
    { sequelize, tableName: "groups", modelName: "Group" },
  );
  return Group;
}
