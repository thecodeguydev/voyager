import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { truncateAll } from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

describe("groups + nested jurisdictions CRUD", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("creates, reads, updates, and deletes a group", async () => {
    const created = await request(app)
      .post("/api/v1/groups")
      .send({ name: "Aurora Field Services", code: "AURORA" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Aurora Field Services", code: "AURORA", status: "active" });

    const fetched = await request(app).get(`/api/v1/groups/${created.body.id}`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.id).toBe(created.body.id);

    const updated = await request(app)
      .put(`/api/v1/groups/${created.body.id}`)
      .send({ description: "Utility client" });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("Utility client");

    const deleted = await request(app).delete(`/api/v1/groups/${created.body.id}`);
    expect(deleted.status).toBe(204);

    const missing = await request(app).get(`/api/v1/groups/${created.body.id}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });

  it("rejects an invalid body with a VALIDATION_ERROR envelope", async () => {
    const res = await request(app).post("/api/v1/groups").send({ name: "Missing code" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("creates a jurisdiction nested under its group", async () => {
    const group = await request(app).post("/api/v1/groups").send({ name: "Aurora", code: "AURORA2" });

    const jurisdiction = await request(app)
      .post(`/api/v1/groups/${group.body.id}/jurisdictions`)
      .send({ name: "Central Metro", code: "CENTRAL", timezone: "America/Toronto" });
    expect(jurisdiction.status).toBe(201);
    expect(jurisdiction.body.groupId).toBe(group.body.id);

    const list = await request(app).get(`/api/v1/groups/${group.body.id}/jurisdictions`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });
});
