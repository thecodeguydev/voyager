import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type AuditEntity = "setting" | "pipeline_config" | "assignment";
export type AuditAction = "create" | "update" | "delete" | "reassign" | "override" | "unassign";

const AUDIT_ENTITIES: readonly AuditEntity[] = ["setting", "pipeline_config", "assignment"];
const AUDIT_ACTIONS: readonly AuditAction[] = [
  "create",
  "update",
  "delete",
  "reassign",
  "override",
  "unassign",
];

export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<string>;
  declare entity: AuditEntity;
  declare entityId: string;
  declare groupId: string | null;
  declare jurisdictionId: string | null;
  declare action: AuditAction;
  declare actor: string;
  declare reason: string | null;
  declare before: Record<string, unknown> | null;
  declare after: Record<string, unknown> | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initAuditLogModel(sequelize: Sequelize): typeof AuditLog {
  AuditLog.init(
    {
      ...baseColumns(),
      entity: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(AUDIT_ENTITIES) },
      entityId: { type: DataTypes.UUID, allowNull: false },
      groupId: { type: DataTypes.UUID, allowNull: true },
      jurisdictionId: { type: DataTypes.UUID, allowNull: true },
      action: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(AUDIT_ACTIONS) },
      actor: { type: DataTypes.STRING, allowNull: false },
      reason: { type: DataTypes.TEXT, allowNull: true },
      before: { type: DataTypes.JSONB, allowNull: true },
      after: { type: DataTypes.JSONB, allowNull: true },
    },
    { sequelize, tableName: "audit_log", modelName: "AuditLog" },
  );
  return AuditLog;
}
