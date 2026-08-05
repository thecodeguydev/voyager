import "dotenv/config";
import { Sequelize, type Options } from "sequelize";

/**
 * Creates a Sequelize instance for the given Postgres connection string,
 * falling back to DATABASE_URL. Used by the app, migrations, and tests
 * (which pass a Testcontainers connection string explicitly).
 */
export function createSequelize(databaseUrl?: string, options?: Partial<Options>): Sequelize {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }

  return new Sequelize(url, {
    "dialect": "postgres",
    "logging": false,
    ...options,
  });
}
