import { DEFAULT_SCORING_WEIGHTS, type StageDefinition } from "./pipelineStages.js";

/**
 * Fixed stage content for the built-in presets (PLAN.md "Composable pipeline" / "Pipeline
 * Editor"). `custom` has no catalog entry — it's descriptive metadata a jurisdiction's document
 * carries once its `stages` diverge from one of these, not a template the API enforces against.
 * Consumed by `GET /pipeline/presets` and the Phase 5 Pipeline Editor's "restore to preset"
 * action — never by the engine's runtime fallback, which stays on Phase 2's exact behavior for a
 * jurisdiction with no stored row (see engine/src/settingsCache.ts).
 */
export const PRESET_CATALOG: Record<"simple" | "balanced" | "advanced", StageDefinition[]> = {
  simple: [{ type: "scoring", enabled: true, config: { weights: DEFAULT_SCORING_WEIGHTS } }],
  balanced: [
    { type: "scoring", enabled: true, config: { weights: DEFAULT_SCORING_WEIGHTS } },
    { type: "tiebreak", enabled: true, config: { strategy: "nearest" } },
  ],
  advanced: [
    {
      type: "tier",
      enabled: true,
      config: { tiers: ["critical", "high", "normal", "low"], sla: { critical: 15, high: 60 } },
    },
    { type: "scoring", enabled: true, config: { weights: DEFAULT_SCORING_WEIGHTS } },
    { type: "tiebreak", enabled: true, config: { strategy: "round_robin" } },
  ],
};
