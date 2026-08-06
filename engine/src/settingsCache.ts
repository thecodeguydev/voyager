import {
  pipelineConfigDocSchema,
  resolveResponseTimeoutMs,
  type AppDb,
  type PipelineConfigDoc,
} from "@voyager/shared";
import { buildStages } from "./pipeline/buildStages.js";
import { DEFAULT_SCORING_WEIGHTS, ScoringStage, type ScoringWeights } from "./pipeline/scoringStage.js";
import type { Stage } from "./pipeline/stage.js";

export interface JurisdictionContext {
  settingsVersion: number;
  scoringWeights: ScoringWeights;
  stages: Stage[];
  responseTimeoutMs: number;
}

/**
 * In-memory effective-settings + pipeline-stage cache, keyed by jurisdiction and invalidated by
 * comparing `jurisdictions.settingsVersion` (see PLAN.md "Settings hot-reload"). A jurisdiction
 * with a stored, enabled `pipeline_configs` row runs that document's stage list; one with no row
 * (or a disabled/invalid one) runs Phase 2's exact fallback — a single Scoring stage with weights
 * resolved through the Settings cascade — so adopting the new pipeline is an explicit
 * per-jurisdiction action, never a silent behavior change for jurisdictions already running.
 */
export class SettingsCache {
  private readonly entries = new Map<string, JurisdictionContext>();

  constructor(private readonly db: AppDb) {}

  async get(jurisdictionId: string): Promise<JurisdictionContext> {
    const jurisdiction = await this.db.models.Jurisdiction.findByPk(jurisdictionId, {
      attributes: ["settingsVersion"],
    });
    const settingsVersion = jurisdiction?.settingsVersion ?? 0;

    const cached = this.entries.get(jurisdictionId);
    if (cached && cached.settingsVersion === settingsVersion) return cached;

    const entry = await this.load(jurisdictionId, settingsVersion);
    this.entries.set(jurisdictionId, entry);
    return entry;
  }

  private async load(jurisdictionId: string, settingsVersion: number): Promise<JurisdictionContext> {
    const scoringWeights: ScoringWeights = {
      distance: await this.resolveWeight(jurisdictionId, "distance"),
      skillMatch: await this.resolveWeight(jurisdictionId, "skillMatch"),
      waitTime: await this.resolveWeight(jurisdictionId, "waitTime"),
    };

    const doc = await this.loadPipelineConfigDoc(jurisdictionId);
    const stages = doc ? buildStages(doc, this.db) : [new ScoringStage(scoringWeights)];
    const responseTimeoutMs = await resolveResponseTimeoutMs(this.db.settingsService, jurisdictionId);

    return { settingsVersion, scoringWeights, stages, responseTimeoutMs };
  }

  /** The jurisdiction's stored pipeline config, or null to fall back to Phase 2's behavior.
   * Absent, disabled, or failing re-validation (defense against a hand-edited row) all fall back —
   * the API already validates on write, so a failure here means the row was edited outside it. */
  private async loadPipelineConfigDoc(jurisdictionId: string): Promise<PipelineConfigDoc | null> {
    const row = await this.db.models.PipelineConfig.findOne({ where: { jurisdictionId } });
    if (!row || !row.enabled) return null;

    const result = pipelineConfigDocSchema.safeParse({
      preset: row.preset,
      stages: row.stages,
      enabled: row.enabled,
    });
    if (!result.success) {
      console.error(
        `[engine] pipeline_configs row for jurisdiction ${jurisdictionId} failed validation, falling back`,
        result.error,
      );
      return null;
    }
    return result.data;
  }

  private async resolveWeight(jurisdictionId: string, weight: keyof ScoringWeights): Promise<number> {
    const resolved = await this.db.settingsService.resolve(`pipeline.scoring.weights.${weight}`, {
      jurisdictionId,
    });
    return resolved != null ? Number(resolved) : DEFAULT_SCORING_WEIGHTS[weight];
  }
}
