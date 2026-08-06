import type { Sequelize } from "sequelize";
import { createSequelize } from "./sequelize.js";
import { initModels, type Models } from "../models/index.js";
import { SettingsService } from "../settings/SettingsService.js";

export interface AppDb {
  sequelize: Sequelize;
  models: Models;
  settingsService: SettingsService;
}

/**
 * Builds the shared DB context (models + settings resolution) used by both api and engine, so
 * the two services can't silently diverge on how they connect or resolve settings.
 */
export function createDb(databaseUrl?: string): AppDb {
  const sequelize = createSequelize(databaseUrl);
  const models = initModels(sequelize);
  const settingsService = new SettingsService(sequelize, models);
  return { sequelize, models, settingsService };
}
