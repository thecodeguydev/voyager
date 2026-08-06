import { afterAll, afterEach, describe, expect, it } from "vitest";
import { makeGroup, makeJurisdiction, truncateAll } from "@voyager/shared/test";
import { SettingsCache } from "../src/settingsCache.js";
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
});
