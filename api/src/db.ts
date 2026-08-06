// The DB context (sequelize + models + settingsService) is built once in @voyager/shared so
// api and engine can't diverge on how they connect or resolve settings. Tests pass a
// Testcontainers URL; the server uses DATABASE_URL.
export { createDb, type AppDb } from "@voyager/shared";
