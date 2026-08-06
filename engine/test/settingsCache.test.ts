import { afterAll, afterEach, describe, expect, it } from "vitest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { SettingsCache } from "../src/settingsCache.js";
import { ScoringStage } from "../src/pipeline/scoringStage.js";
import { TierFilterStage } from "../src/pipeline/tierFilterStage.js";
import { TiebreakStage } from "../src/pipeline/tiebreakStage.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();

afterEach(async () => {
  await truncateAll(db.sequelize);
});

afterAll(async () => {
  await db.sequelize.close();
});

describe("SettingsCache hot-reload", () => {
  it("reloads a jurisdiction's scoring weights after settingsVersion is bumped", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const cache = new SettingsCache(db);

    const before = await cache.get(jurisdiction.id);

    await db.settingsService.upsert(
      {
        scope: "jurisdiction",
        jurisdictionId: jurisdiction.id,
        key: "pipeline.scoring.weights.distance",
        value: 0.9,
      },
      "test",
    );

    const after = await cache.get(jurisdiction.id);
    expect(after.scoringWeights.distance).toBe(0.9);
    expect(after.settingsVersion).toBeGreaterThan(before.settingsVersion);
  });

  it("serves the cached entry without reloading when settingsVersion is unchanged", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const cache = new SettingsCache(db);

    const first = await cache.get(jurisdiction.id);
    const second = await cache.get(jurisdiction.id);
    expect(second).toBe(first);
  });

  it("falls back to the in-code default weight when no setting is resolved at any scope", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const cache = new SettingsCache(db);

    const context = await cache.get(jurisdiction.id);
    expect(context.scoringWeights).toEqual({ distance: 0.5, skillMatch: 0.3, waitTime: 0.2 });
  });

  it("falls back to a single Scoring stage when no pipeline_configs row exists", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const cache = new SettingsCache(db);

    const context = await cache.get(jurisdiction.id);
    expect(context.stages).toHaveLength(1);
    expect(context.stages[0]).toBeInstanceOf(ScoringStage);
  });

  it("builds the stage list from a stored, enabled pipeline_configs row", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.PipelineConfig.create({
      jurisdictionId: jurisdiction.id,
      preset: "advanced",
      enabled: true,
      stages: [
        { type: "tier", enabled: true, config: { tiers: ["critical", "low"], sla: { critical: 15 } } },
        { type: "scoring", enabled: true, config: { weights: { distance: 1, skillMatch: 0, waitTime: 0 } } },
        { type: "tiebreak", enabled: true, config: { strategy: "nearest" } },
      ],
    });
    const cache = new SettingsCache(db);

    const context = await cache.get(jurisdiction.id);
    expect(context.stages).toHaveLength(3);
    expect(context.stages[0]).toBeInstanceOf(TierFilterStage);
    expect(context.stages[2]).toBeInstanceOf(TiebreakStage);
  });

  it("falls back to the default Scoring stage when the stored row is disabled", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.PipelineConfig.create({
      jurisdictionId: jurisdiction.id,
      preset: "simple",
      enabled: false,
      stages: [{ type: "scoring", enabled: true, config: { weights: { distance: 1, skillMatch: 0, waitTime: 0 } } }],
    });
    const cache = new SettingsCache(db);

    const context = await cache.get(jurisdiction.id);
    expect(context.stages).toHaveLength(1);
    expect(context.stages[0]).toBeInstanceOf(ScoringStage);
  });

  it("falls back to the default Scoring stage when the stored row fails schema validation", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    await db.models.PipelineConfig.create({
      jurisdictionId: jurisdiction.id,
      preset: "simple",
      enabled: true,
      stages: [{ type: "not-a-real-stage", enabled: true, config: {} }],
    });
    const cache = new SettingsCache(db);

    const context = await cache.get(jurisdiction.id);
    expect(context.stages).toHaveLength(1);
    expect(context.stages[0]).toBeInstanceOf(ScoringStage);
  });
});
