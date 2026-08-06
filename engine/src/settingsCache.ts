import type { AppDb } from "@voyager/shared";
import { DEFAULT_SCORING_WEIGHTS, ScoringStage, type ScoringWeights } from "./pipeline/scoringStage.js";
import type { Stage } from "./pipeline/stage.js";

export interface JurisdictionContext {
  settingsVersion: number;
  scoringWeights: ScoringWeights;
  stages: Stage[];
}

/**
 * In-memory effective-settings + pipeline-stage cache, keyed by jurisdiction and invalidated by
 * comparing `jurisdictions.settingsVersion` (see PLAN.md "Settings hot-reload"). Phase 2 hardcodes
 * a single Scoring stage sourced from global settings; Phase 3 swaps this for a
 * pipeline_configs-driven stage list without the resolver or pipeline runner needing to change.
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

    return {
      settingsVersion,
      scoringWeights,
      stages: [new ScoringStage(scoringWeights)],
    };
  }

  private async resolveWeight(jurisdictionId: string, weight: keyof ScoringWeights): Promise<number> {
    const resolved = await this.db.settingsService.resolve(`pipeline.scoring.weights.${weight}`, {
      jurisdictionId,
    });
    return resolved != null ? Number(resolved) : DEFAULT_SCORING_WEIGHTS[weight];
  }
}
