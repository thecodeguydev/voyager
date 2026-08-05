import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type AssignmentState =
  | "dispatched"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired"
  | "overridden";
export type AssignmentSource = "auto" | "manual";

const ASSIGNMENT_STATES: readonly AssignmentState[] = [
  "dispatched",
  "accepted",
  "rejected",
  "in_progress",
  "completed",
  "cancelled",
  "expired",
  "overridden",
];
const ASSIGNMENT_SOURCES: readonly AssignmentSource[] = ["auto", "manual"];

export class Assignment extends Model<
  InferAttributes<Assignment>,
  InferCreationAttributes<Assignment>
> {
  declare id: CreationOptional<string>;
  declare orderId: string;
  declare workerId: string;
  declare jurisdictionId: string;
  declare state: CreationOptional<AssignmentState>;
  declare source: AssignmentSource;
  declare score: number | null;
  declare pipelineTrace: Record<string, unknown> | null;
  declare overriddenBy: string | null;
  declare overrideReason: string | null;
  declare dispatchedAt: CreationOptional<Date>;
  declare respondedAt: Date | null;
  declare completedAt: Date | null;
  declare expiresAt: Date | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initAssignmentModel(sequelize: Sequelize): typeof Assignment {
  Assignment.init(
    {
      ...baseColumns(),
      orderId: { type: DataTypes.UUID, allowNull: false },
      workerId: { type: DataTypes.UUID, allowNull: false },
      jurisdictionId: { type: DataTypes.UUID, allowNull: false },
      state: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: "dispatched",
        validate: isInValidator(ASSIGNMENT_STATES),
      },
      source: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(ASSIGNMENT_SOURCES) },
      score: { type: DataTypes.DECIMAL, allowNull: true },
      pipelineTrace: { type: DataTypes.JSONB, allowNull: true },
      overriddenBy: { type: DataTypes.STRING, allowNull: true },
      overrideReason: { type: DataTypes.TEXT, allowNull: true },
      dispatchedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      respondedAt: { type: DataTypes.DATE, allowNull: true },
      completedAt: { type: DataTypes.DATE, allowNull: true },
      expiresAt: { type: DataTypes.DATE, allowNull: true },
    },
    { sequelize, tableName: "assignments", modelName: "Assignment" },
  );
  return Assignment;
}
