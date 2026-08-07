import {
  DEFAULT_INGESTION_REQUIRE_SKILLS_REQUIRED,
  SETTING_KEYS,
  ingestionRequireSkillsRequiredSettingSchema,
  parseSwitchableSetting,
  type AppDb,
} from "@voyager/shared";
import { badRequest } from "../lib/httpErrors.js";

export async function assertOrderIngestionPolicy(
  db: AppDb,
  jurisdictionId: string,
  payload: Record<string, unknown> | undefined,
): Promise<void> {
  const resolved = await db.settingsService.resolve(SETTING_KEYS.INGESTION_REQUIRE_SKILLS_REQUIRED, {
    jurisdictionId,
  });
  const setting = parseSwitchableSetting(
    ingestionRequireSkillsRequiredSettingSchema,
    resolved,
    DEFAULT_INGESTION_REQUIRE_SKILLS_REQUIRED,
  );

  if (!setting.enabled || setting.mode !== "enforce" || !setting.value) return;

  const skillsRequired = payload?.skillsRequired;
  if (!Array.isArray(skillsRequired) || skillsRequired.length === 0) {
    throw badRequest("payload.skillsRequired is required by ingestion policy");
  }
}
