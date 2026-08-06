import type { Sequelize } from "sequelize";
import { createSequelize } from "../db/sequelize.js";

/** Connects to the Testcontainers database started by vitest.global-setup.ts. */
export function getTestSequelize(options?: Parameters<typeof createSequelize>[1]): Sequelize {
  const url = process.env.TEST_DATABASE_URL;
  
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — did vitest.global-setup.ts run?");
  }

  return createSequelize(url, options);
}

const ALL_TABLES = [
  "webhook_events",
  "webhook_sources",
  "audit_log",
  "metric_points",
  "engine_instances",
  "settings",
  "assignments",
  "dispatch_queue",
  "orders",
  "schedules",
  "zone_workers",
  "workers",
  "zones",
  "jurisdictions",
  "groups",
];

/** Clears every table so each test starts from a clean slate. */
export async function truncateAll(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`TRUNCATE TABLE ${ALL_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
}
