import type { AppDb, AuditLog, PipelineConfigDoc, PipelinePreset, StageDefinition } from "@voyager/shared";

export interface PipelineConfigView {
  jurisdictionId: string;
  stored: boolean;
  preset: PipelinePreset | null;
  stages: StageDefinition[];
  enabled: boolean;
}

/** The jurisdiction's stored pipeline config, or a `stored: false` view if it has none yet —
 * distinct from a 404, since "not configured" is a valid state the Pipeline Editor must detect
 * to offer its init/restore-to-preset action (see PLAN.md Phase 5 note). */
export async function getPipelineConfig(db: AppDb, jurisdictionId: string): Promise<PipelineConfigView> {
  const row = await db.models.PipelineConfig.findOne({ where: { jurisdictionId } });
  if (!row) return { jurisdictionId, stored: false, preset: null, stages: [], enabled: false };

  return {
    jurisdictionId,
    stored: true,
    preset: row.preset,
    stages: row.stages as StageDefinition[],
    enabled: row.enabled,
  };
}

/** Creates or replaces the jurisdiction's pipeline config, auditing the change and bumping
 * `settingsVersion` so the engine's hot-reload picks it up. Mirrors `SettingsService.upsert` —
 * simpler, since `pipeline_configs.jurisdictionId` is unique with no scope cascade to bump. */
export async function upsertPipelineConfig(
  db: AppDb,
  jurisdictionId: string,
  doc: PipelineConfigDoc,
  actor: string,
): Promise<PipelineConfigView> {
  return db.sequelize.transaction(async (transaction) => {
    const existing = await db.models.PipelineConfig.findOne({ where: { jurisdictionId }, transaction });
    const before = existing ? existing.toJSON() : null;

    const config = existing
      ? await existing.update(
          { preset: doc.preset, stages: doc.stages, enabled: doc.enabled },
          { transaction },
        )
      : await db.models.PipelineConfig.create(
          { jurisdictionId, preset: doc.preset, stages: doc.stages, enabled: doc.enabled },
          { transaction },
        );

    await db.models.AuditLog.create(
      {
        entity: "pipeline_config",
        entityId: config.id,
        groupId: null,
        jurisdictionId,
        action: existing ? "update" : "create",
        actor,
        reason: null,
        before,
        after: config.toJSON(),
      },
      { transaction },
    );

    await db.models.Jurisdiction.increment("settingsVersion", {
      by: 1,
      where: { id: jurisdictionId },
      transaction,
    });

    return {
      jurisdictionId,
      stored: true,
      preset: config.preset,
      stages: config.stages as StageDefinition[],
      enabled: config.enabled,
    };
  });
}

export async function getPipelineConfigAuditTrail(db: AppDb, jurisdictionId: string): Promise<AuditLog[]> {
  return db.models.AuditLog.findAll({
    where: { entity: "pipeline_config", jurisdictionId },
    order: [["createdAt", "DESC"]],
  });
}
