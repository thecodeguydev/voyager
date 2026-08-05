import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createSequelize } from "../db/sequelize.js";
import { createMigrator } from "../db/migrate.js";

export interface TestDatabase {
  uri: string;
  teardown: () => Promise<void>;
}

/**
 * Starts one postgis/postgis Testcontainer, runs every `shared` migration against it, and
 * returns its connection string. Shared by every package's `vitest.global-setup.ts` so the
 * container-boot + migrate logic lives in one place. `.withReuse()` keeps a warm container
 * across local runs when TESTCONTAINERS_REUSE_ENABLE=true.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer("postgis/postgis:16-3.4").withReuse().start();
  const uri = container.getConnectionUri();

  const sequelize = createSequelize(uri);
  await createMigrator(sequelize).up();
  await sequelize.close();

  return {
    uri,
    teardown: async () => {
      await container.stop();
    },
  };
}
