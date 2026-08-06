import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { makeEngineInstance, truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

afterAll(async () => {
  await db.sequelize.close();
});

describe("GET /api/v1/health", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  it("reports ok with a successful DB probe", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", checks: { db: "ok" } });
  });
});

describe("GET /api/v1/health/engine", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  it("reports degraded with no engine instances", async () => {
    const res = await request(app).get("/api/v1/health/engine");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "degraded", healthyCount: 0 });
  });

  it("reports ok with a fresh heartbeat", async () => {
    await db.models.EngineInstance.create(makeEngineInstance({ instanceId: "engine-fresh" }));

    const res = await request(app).get("/api/v1/health/engine");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.healthyCount).toBe(1);
  });

  it("treats a stale heartbeat as stopped and reports degraded", async () => {
    await db.models.EngineInstance.create(
      makeEngineInstance({ instanceId: "engine-stale", lastHeartbeatAt: new Date(Date.now() - 60_000) }),
    );

    const res = await request(app).get("/api/v1/health/engine");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(res.body.instances[0].state).toBe("stopped");
  });
});
