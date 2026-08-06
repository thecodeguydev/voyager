import { z } from "zod";
import type { OrderPriorityTier } from "../models/Order.js";

const PRIORITY_TIERS = ["critical", "high", "normal", "low"] as const satisfies readonly OrderPriorityTier[];

/**
 * TierFilter config: `tiers` lists every tier this jurisdiction uses, most urgent first; `sla`
 * maps a subset of them to a minutes-until-`slaDueAt` cutoff. Resolution walks `tiers` in order
 * and returns the first tier whose `sla` entry isn't exceeded, else the last tier in the list —
 * so a tier with no `sla` entry is only ever reached as that final fallback, never by a cutoff
 * (config authors should give every non-terminal tier an entry).
 */
export const tierStageConfigSchema = z.object({
  tiers: z.array(z.enum(PRIORITY_TIERS)).min(1),
  sla: z.partialRecord(z.enum(PRIORITY_TIERS), z.number().positive()).default({}),
});
export type TierStageConfig = z.infer<typeof tierStageConfigSchema>;

export const scoringStageConfigSchema = z.object({
  weights: z.object({
    distance: z.number().min(0),
    skillMatch: z.number().min(0),
    waitTime: z.number().min(0),
  }),
});
export type ScoringStageConfig = z.infer<typeof scoringStageConfigSchema>;

export const DEFAULT_SCORING_WEIGHTS: ScoringStageConfig["weights"] = {
  distance: 0.5,
  skillMatch: 0.3,
  waitTime: 0.2,
};

export const tiebreakStageConfigSchema = z.object({
  strategy: z.enum(["fifo", "round_robin", "nearest"]),
});
export type TiebreakStageConfig = z.infer<typeof tiebreakStageConfigSchema>;

const tierStageSchema = z.object({ type: z.literal("tier"), enabled: z.boolean(), config: tierStageConfigSchema });
const scoringStageSchema = z.object({
  type: z.literal("scoring"),
  enabled: z.boolean(),
  config: scoringStageConfigSchema,
});
const tiebreakStageSchema = z.object({
  type: z.literal("tiebreak"),
  enabled: z.boolean(),
  config: tiebreakStageConfigSchema,
});

/** One entry in `pipeline_configs.stages` — see PLAN.md "Composable pipeline". */
export const stageDefinitionSchema = z.discriminatedUnion("type", [
  tierStageSchema,
  scoringStageSchema,
  tiebreakStageSchema,
]);
export type StageDefinition = z.infer<typeof stageDefinitionSchema>;

export const PIPELINE_PRESET_NAMES = ["simple", "balanced", "advanced", "custom"] as const;

/** The whole document validated on every `PUT /jurisdictions/:jid/pipeline` and re-validated by
 * the engine before building stages from a stored row (defense against a hand-edited row). */
export const pipelineConfigDocSchema = z.object({
  preset: z.enum(PIPELINE_PRESET_NAMES),
  stages: z.array(stageDefinitionSchema),
  enabled: z.boolean(),
});
export type PipelineConfigDoc = z.infer<typeof pipelineConfigDocSchema>;
