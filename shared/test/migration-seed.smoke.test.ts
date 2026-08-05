import { afterAll, afterEach, describe, expect, it } from "vitest";
import { QueryTypes } from "sequelize";
import { getTestSequelize, truncateAll } from "../src/test/db.js";
import { initModels } from "../src/models/index.js";
import { loadSeedWorld } from "../src/seed/loadSeedWorld.js";

describe("migrations + seed world", () => {
  const sequelize = getTestSequelize();
  const models = initModels(sequelize);

  afterEach(async () => {
    await truncateAll(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("loads the canonical seed world with the expected row counts", async () => {
    await loadSeedWorld(sequelize);

    await expect(models.Group.count()).resolves.toBe(1);
    await expect(models.Jurisdiction.count()).resolves.toBe(2);
    await expect(models.Zone.count()).resolves.toBe(4);
    await expect(models.Worker.count()).resolves.toBe(6);
    await expect(models.ZoneWorker.count()).resolves.toBe(7);
    // Schedules expand daysOfWeek into one row per day: 5+1+7+5+5+5+7 = 35
    await expect(models.Schedule.count()).resolves.toBe(35);
    await expect(models.Order.count()).resolves.toBe(7);
    await expect(models.DispatchQueue.count()).resolves.toBe(6);
  });

  it("converts WKT boundaries into queryable PostGIS geography", async () => {
    await loadSeedWorld(sequelize);

    const [row] = await sequelize.query<{ covers: boolean }>(
      `SELECT ST_Covers(boundary, ST_GeogFromText('POINT(-79.39 43.65)')) AS covers
       FROM zones WHERE name = 'Downtown'`,
      { type: QueryTypes.SELECT },
    );
    expect(row.covers).toBe(true);
  });
});
