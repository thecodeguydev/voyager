import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from "sequelize";
import { baseColumns, isInValidator } from "./base.js";

export type PipelinePreset = "simple" | "balanced" | "advanced" | "custom";
const PIPELINE_PRESETS: readonly PipelinePreset[] = ["simple", "balanced", "advanced", "custom"];

/**
 * A jurisdiction's composable dispatch pipeline (PLAN.md "Composable pipeline"). `stages` is the
 * ordered stage array validated against `pipelineConfigDocSchema` (shared/src/dispatch/pipelineStages.ts)
 * at every write; the model itself stores it loosely (like Setting.value) since its shape varies by
 * stage type. A jurisdiction with no row here isn't broken — engine/src/settingsCache.ts falls back
 * to Phase 2's single-Scoring-stage behavior.
 */
export class PipelineConfig extends Model<
  InferAttributes<PipelineConfig>,
  InferCreationAttributes<PipelineConfig>
> {
  declare id: CreationOptional<string>;
  declare jurisdictionId: string;
  declare preset: PipelinePreset;
  declare stages: Record<string, unknown>[];
  declare enabled: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

export function initPipelineConfigModel(sequelize: Sequelize): typeof PipelineConfig {
  PipelineConfig.init(
    {
      ...baseColumns(),
      jurisdictionId: { type: DataTypes.UUID, allowNull: false, unique: true },
      preset: { type: DataTypes.STRING, allowNull: false, validate: isInValidator(PIPELINE_PRESETS) },
      stages: { type: DataTypes.JSONB, allowNull: false },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    },
    { sequelize, tableName: "pipeline_configs", modelName: "PipelineConfig" },
  );
  return PipelineConfig;
}
