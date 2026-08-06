import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getTestSequelize, truncateAll } from "../../src/test/db.js";
import { initModels } from "../../src/models/index.js";
import { makeGroup, makeJurisdiction } from "../../src/test/factories.js";
import { SettingsService } from "../../src/settings/SettingsService.js";
import { DEFAULT_RESPONSE_TIMEOUT_MS, resolveResponseTimeoutMs } from "../../src/dispatch/responseTimeout.js";

const sequelize = getTestSequelize();
const models = initModels(sequelize);
const settingsService = new SettingsService(sequelize, models);

afterEach(async () => {
  await truncateAll(sequelize);
});

afterAll(async () => {
  await sequelize.close();
});

describe("dispatch/responseTimeout", () => {
  // Whether or not the migration-seeded global setting survives truncateAll (it doesn't, once
  // any other test's jurisdictions-table truncate cascades to it), this resolves to the same
  // number via the in-code fallback — so this covers the fallback path, not necessarily the seed.
  it("resolves to the default timeout for a jurisdiction with no override anywhere", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));

    const timeout = await resolveResponseTimeoutMs(settingsService, jurisdiction.id);
    expect(timeout).toBe(DEFAULT_RESPONSE_TIMEOUT_MS);
  });

  it("resolves a jurisdiction-scoped override over the global default", async () => {
    const group = await models.Group.create(makeGroup());
    const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));

    await settingsService.upsert(
      {
        scope: "jurisdiction",
        jurisdictionId: jurisdiction.id,
        key: "assignment.response_timeout_ms",
        value: 60_000,
      },
      "test",
    );

    const timeout = await resolveResponseTimeoutMs(settingsService, jurisdiction.id);
    expect(timeout).toBe(60_000);
  });
});
