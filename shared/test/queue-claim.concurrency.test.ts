import { afterAll, afterEach, describe, expect, it } from "vitest";
import { getTestSequelize, truncateAll } from "../src/test/db.js";
import { initModels } from "../src/models/index.js";
import { makeGroup, makeJurisdiction, makeOrder } from "../src/test/factories.js";
import { claim } from "../src/queue/claim.js";

// Dedicated connection with a large pool so N concurrent claim() calls run on genuinely
// distinct connections instead of queueing behind a small default pool.
const sequelize = getTestSequelize({ pool: { max: 25 } });
const models = initModels(sequelize);

async function seedPendingQueue(count: number): Promise<string[]> {
  const group = await models.Group.create(makeGroup());
  const jurisdiction = await models.Jurisdiction.create(makeJurisdiction(group.id));

  const rowIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const order = await models.Order.create(
      makeOrder(jurisdiction.id, { externalId: `CONC-${i}` }),
    );
    const row = await models.DispatchQueue.create({
      orderId: order.id,
      jurisdictionId: jurisdiction.id,
      status: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
    });
    rowIds.push(row.id);
  }
  return rowIds;
}

describe("queue.claim() under concurrency (no double-dispatch)", () => {
  afterEach(async () => {
    await truncateAll(sequelize);
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it("lets N concurrent callers claim M pending rows with no duplicate and no missed claim", async () => {
    const rowCount = 20;
    const callerCount = 20;
    const rowIds = await seedPendingQueue(rowCount);

    const results = await Promise.all(
      Array.from({ length: callerCount }, (_, i) => claim(sequelize, `instance-${i}`, 1)),
    );

    const claimedIds = results.flat().map((row) => row.id);
    expect(claimedIds).toHaveLength(rowCount);
    expect(new Set(claimedIds).size).toBe(rowCount);
    expect(new Set(claimedIds)).toEqual(new Set(rowIds));

    const stillPending = await models.DispatchQueue.count({ where: { status: "pending" } });
    expect(stillPending).toBe(0);
  });

  it("never lets two callers claim the same row when there are more callers than rows", async () => {
    const rowCount = 5;
    const callerCount = 15;
    await seedPendingQueue(rowCount);

    const results = await Promise.all(
      Array.from({ length: callerCount }, (_, i) => claim(sequelize, `instance-${i}`, 1)),
    );

    const claimedIds = results.flat().map((row) => row.id);
    expect(claimedIds).toHaveLength(rowCount);
    expect(new Set(claimedIds).size).toBe(rowCount);
  });
});
