import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryInterface, Sequelize } from "sequelize";
import { SequelizeStorage, Umzug } from "umzug";
import { createSequelize } from "./sequelize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsGlob = path.join(__dirname, "../../migrations/*.ts").replace(/\\/g, "/");

/** Builds the Umzug migrator, backed by migrations/*.ts and a sequelize_meta storage table. */
export function createMigrator(sequelize: Sequelize) {
  return new Umzug<QueryInterface>({
    migrations: { glob: migrationsGlob },
    context: sequelize.getQueryInterface(),
    storage: new SequelizeStorage({ sequelize }),
    logger: console,
  });
}

async function main() {
  const direction = process.argv[2] ?? "up";
  const sequelize = createSequelize();
  const migrator = createMigrator(sequelize);
  if (direction === "down") {
    await migrator.down();
  } else {
    await migrator.up();
  }
  await sequelize.close();
}

const isDirectRun = fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
