import { afterAll, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import {
  makeGroup,
  makeJurisdiction,
  makeWorker,
  makeZone,
  truncateAll,
} from "@voyager/shared/test";
import { createApp } from "../src/app.js";
import { getTestDb } from "./testDb.js";

const db = getTestDb();
const app = createApp(db);

describe("worker-zone coverage endpoints", () => {
  afterEach(async () => {
    await truncateAll(db.sequelize);
  });

  afterAll(async () => {
    await db.sequelize.close();
  });

  it("adds, lists, and removes worker zone coverage", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id, { name: "Downtown" }));

    const created = await request(app)
      .post(`/api/v1/workers/${worker.id}/zones`)
      .send({ zoneId: zone.id });

    expect(created.status).toBe(201);
    expect(created.body).toHaveLength(1);
    expect(created.body[0]).toMatchObject({ id: zone.id, name: "Downtown", jurisdictionId: jurisdiction.id });

    const listed = await request(app).get(`/api/v1/workers/${worker.id}/zones`);
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    const removed = await request(app).delete(`/api/v1/workers/${worker.id}/zones/${zone.id}`);
    expect(removed.status).toBe(204);

    const afterRemove = await request(app).get(`/api/v1/workers/${worker.id}/zones`);
    expect(afterRemove.status).toBe(200);
    expect(afterRemove.body).toEqual([]);
  });

  it("returns 200 when adding the same zone link twice", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurisdiction = await db.models.Jurisdiction.create(makeJurisdiction(group.id));
    const worker = await db.models.Worker.create(makeWorker(jurisdiction.id));
    const zone = await db.models.Zone.create(makeZone(jurisdiction.id));

    const first = await request(app)
      .post(`/api/v1/workers/${worker.id}/zones`)
      .send({ zoneId: zone.id });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/workers/${worker.id}/zones`)
      .send({ zoneId: zone.id });
    expect(second.status).toBe(200);
    expect(second.body).toHaveLength(1);
  });

  it("rejects linking a worker to a zone from another jurisdiction", async () => {
    const group = await db.models.Group.create(makeGroup());
    const jurA = await db.models.Jurisdiction.create(makeJurisdiction(group.id, { code: "A" }));
    const jurB = await db.models.Jurisdiction.create(makeJurisdiction(group.id, { code: "B" }));
    const worker = await db.models.Worker.create(makeWorker(jurA.id));
    const zone = await db.models.Zone.create(makeZone(jurB.id));

    const res = await request(app)
      .post(`/api/v1/workers/${worker.id}/zones`)
      .send({ zoneId: zone.id });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
