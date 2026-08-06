import { createDb, type AppDb } from "@voyager/shared";

/** Builds an AppDb pointed at the Testcontainers database started by vitest.global-setup.ts. */
export function getTestDb(): AppDb {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set — did vitest.global-setup.ts run?");
  return createDb(url);
}
