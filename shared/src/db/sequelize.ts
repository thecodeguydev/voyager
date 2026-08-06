import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Sequelize, type Options } from "sequelize";

// Bare `dotenv/config` resolves ".env" against process.cwd(), which npm sets to this
// workspace's own directory (e.g. shared/) when run via `npm run <script> --workspace=shared`
// — so a repo-root .env is invisible to it. Resolve explicitly against this file's
// location instead, which stays correct whether run from src/ (tsx) or dist/ (node),
// since tsc mirrors src/'s folder depth into dist/.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

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
