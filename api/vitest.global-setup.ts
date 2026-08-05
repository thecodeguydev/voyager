import { startTestDatabase } from "@voyager/shared/test";

/** Publishes the Testcontainers connection string via TEST_DATABASE_URL for test files to use. */
export default async function setup() {
  const { uri, teardown } = await startTestDatabase();
  process.env.TEST_DATABASE_URL = uri;
  return teardown;
}
