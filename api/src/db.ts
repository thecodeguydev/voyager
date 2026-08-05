import { createSequelize, initModels, SettingsService, type Models } from "@voyager/shared";
import type { Sequelize } from "sequelize";

export interface AppDb {
  sequelize: Sequelize;
  models: Models;
  settingsService: SettingsService;
}

/** Builds the app's DB context. Tests pass a Testcontainers URL; the server uses DATABASE_URL. */
export function createDb(databaseUrl?: string): AppDb {
  const sequelize = createSequelize(databaseUrl);
  const models = initModels(sequelize);
  const settingsService = new SettingsService(sequelize, models);
  return { sequelize, models, settingsService };
}
