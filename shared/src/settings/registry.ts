import { z } from "zod";

export const SETTING_KEYS = {
  WORKER_MAX_CONCURRENT: "worker.max_concurrent",
  ASSIGNMENT_RESPONSE_TIMEOUT_MS: "assignment.response_timeout_ms",
  METRICS_RETENTION_DAYS: "metrics.retention_days",
  PIPELINE_SCORING_DISTANCE: "pipeline.scoring.weights.distance",
  PIPELINE_SCORING_SKILL_MATCH: "pipeline.scoring.weights.skillMatch",
  PIPELINE_SCORING_WAIT_TIME: "pipeline.scoring.weights.waitTime",
  ENGINE_HEARTBEAT_STALENESS_MS: "engine.heartbeat.staleness_ms",
  DISPATCH_EXPIRY_SECONDS: "dispatch.expiry_seconds",
  INGESTION_REQUIRE_SKILLS_REQUIRED: "ingestion.require_skills_required",
  DISPATCH_MAX_CANDIDATE_DISTANCE_M: "dispatch.max_candidate_distance_m",
  DISPATCH_MIN_SKILL_MATCH_RATIO: "dispatch.min_skill_match_ratio",
} as const;

export const SETTING_MODES = ["off", "warn", "enforce"] as const;
export type SettingMode = (typeof SETTING_MODES)[number];

const settingModeSchema = z.enum(SETTING_MODES);

export interface SwitchableSetting<T> {
  enabled: boolean;
  mode: SettingMode;
  value: T;
}

function switchableSettingSchema<T extends z.ZodTypeAny>(valueSchema: T) {
  return z
    .object({
      enabled: z.boolean().default(true),
      mode: settingModeSchema.default("enforce"),
      value: valueSchema,
    })
    .strict();
}

export const ingestionRequireSkillsRequiredSettingSchema = switchableSettingSchema(z.boolean());
export type IngestionRequireSkillsRequiredSetting = z.infer<typeof ingestionRequireSkillsRequiredSettingSchema>;

export const dispatchMaxCandidateDistanceSettingSchema = switchableSettingSchema(
  z.number().finite().positive(),
);
export type DispatchMaxCandidateDistanceSetting = z.infer<typeof dispatchMaxCandidateDistanceSettingSchema>;

export const dispatchMinSkillMatchRatioSettingSchema = switchableSettingSchema(
  z.number().finite().min(0).max(1),
);
export type DispatchMinSkillMatchRatioSetting = z.infer<typeof dispatchMinSkillMatchRatioSettingSchema>;

export const DEFAULT_INGESTION_REQUIRE_SKILLS_REQUIRED: IngestionRequireSkillsRequiredSetting = {
  enabled: false,
  mode: "off",
  value: true,
};

export const DEFAULT_DISPATCH_MAX_CANDIDATE_DISTANCE: DispatchMaxCandidateDistanceSetting = {
  enabled: false,
  mode: "off",
  value: 20_000,
};

export const DEFAULT_DISPATCH_MIN_SKILL_MATCH_RATIO: DispatchMinSkillMatchRatioSetting = {
  enabled: false,
  mode: "off",
  value: 0,
};

const registeredSettingValueSchemas = {
  [SETTING_KEYS.WORKER_MAX_CONCURRENT]: z.number().int().positive(),
  [SETTING_KEYS.ASSIGNMENT_RESPONSE_TIMEOUT_MS]: z.number().int().positive(),
  [SETTING_KEYS.METRICS_RETENTION_DAYS]: z.number().int().positive(),
  [SETTING_KEYS.PIPELINE_SCORING_DISTANCE]: z.number().finite().min(0),
  [SETTING_KEYS.PIPELINE_SCORING_SKILL_MATCH]: z.number().finite().min(0),
  [SETTING_KEYS.PIPELINE_SCORING_WAIT_TIME]: z.number().finite().min(0),
  [SETTING_KEYS.ENGINE_HEARTBEAT_STALENESS_MS]: z.number().int().positive(),
  [SETTING_KEYS.DISPATCH_EXPIRY_SECONDS]: z.number().int().positive(),
  [SETTING_KEYS.INGESTION_REQUIRE_SKILLS_REQUIRED]: ingestionRequireSkillsRequiredSettingSchema,
  [SETTING_KEYS.DISPATCH_MAX_CANDIDATE_DISTANCE_M]: dispatchMaxCandidateDistanceSettingSchema,
  [SETTING_KEYS.DISPATCH_MIN_SKILL_MATCH_RATIO]: dispatchMinSkillMatchRatioSettingSchema,
} as const satisfies Record<string, z.ZodTypeAny>;

export type RegisteredSettingKey = keyof typeof registeredSettingValueSchemas;

export const REGISTERED_SETTING_KEYS: readonly RegisteredSettingKey[] =
  Object.keys(registeredSettingValueSchemas) as RegisteredSettingKey[];

export function isRegisteredSettingKey(key: string): key is RegisteredSettingKey {
  return key in registeredSettingValueSchemas;
}

type ValidationResult =
  | { success: true; value: unknown }
  | { success: false; reason: "UNKNOWN_KEY" }
  | { success: false; reason: "INVALID_VALUE"; issues: z.ZodIssue[] };

export function validateRegisteredSettingValue(key: string, value: unknown): ValidationResult {
  const schema = registeredSettingValueSchemas[key as RegisteredSettingKey];
  if (!schema) return { success: false, reason: "UNKNOWN_KEY" };

  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return { success: false, reason: "INVALID_VALUE", issues: parsed.error.issues };
  }

  return { success: true, value: parsed.data };
}

export function parseSwitchableSetting<T>(
  schema: z.ZodType<SwitchableSetting<T>>,
  value: unknown,
  fallback: SwitchableSetting<T>,
): SwitchableSetting<T> {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}
