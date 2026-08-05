import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createSequelize } from "./src/db/sequelize.js";
import { createMigrator } from "./src/db/migrate.js";

/**
 * Starts one postgis/postgis Testcontainer for the whole suite, runs migrations once,
 * and publishes the connection string via TEST_DATABASE_URL for test files to use.
 * `.withReuse()` keeps a warm container across local runs when TESTCONTAINERS_REUSE_ENABLE=true.
 */
export default async function setup() {
  const container = await new PostgreSqlContainer("postgis/postgis:16-3.4").withReuse().start();
  const uri = container.getConnectionUri();
  process.env.TEST_DATABASE_URL = uri;

  const sequelize = createSequelize(uri);
  await createMigrator(sequelize).up();
  await sequelize.close();

  return async () => {
    await container.stop();
  };
}
