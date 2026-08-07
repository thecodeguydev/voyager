import { describe, expect, it } from "vitest";
import {
  DEFAULT_DISPATCH_MAX_CANDIDATE_DISTANCE,
  DEFAULT_INGESTION_REQUIRE_SKILLS_REQUIRED,
  SETTING_KEYS,
  parseSwitchableSetting,
  dispatchMaxCandidateDistanceSettingSchema,
  ingestionRequireSkillsRequiredSettingSchema,
  validateRegisteredSettingValue,
} from "../src/settings/registry.js";

describe("settings registry", () => {
  it("validates switchable custom key payloads", () => {
    const ok = validateRegisteredSettingValue(SETTING_KEYS.DISPATCH_MAX_CANDIDATE_DISTANCE_M, {
      enabled: true,
      mode: "warn",
      value: 1000,
    });

    expect(ok.success).toBe(true);
  });

  it("rejects unknown keys", () => {
    const result = validateRegisteredSettingValue("custom.unknown", 1);
    expect(result).toMatchObject({ success: false, reason: "UNKNOWN_KEY" });
  });

  it("falls back to default switchable setting on parse failure", () => {
    const parsed = parseSwitchableSetting(
      dispatchMaxCandidateDistanceSettingSchema,
      { enabled: true, mode: "oops", value: 10 },
      DEFAULT_DISPATCH_MAX_CANDIDATE_DISTANCE,
    );

    expect(parsed).toEqual(DEFAULT_DISPATCH_MAX_CANDIDATE_DISTANCE);
  });

  it("parses valid ingestion switchable setting", () => {
    const parsed = parseSwitchableSetting(
      ingestionRequireSkillsRequiredSettingSchema,
      { enabled: true, mode: "enforce", value: true },
      DEFAULT_INGESTION_REQUIRE_SKILLS_REQUIRED,
    );

    expect(parsed).toEqual({ enabled: true, mode: "enforce", value: true });
  });
});
