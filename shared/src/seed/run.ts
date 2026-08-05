import { createSequelize } from "../db/sequelize.js";
import { loadSeedWorld } from "./loadSeedWorld.js";

async function main() {
  const sequelize = createSequelize();
  await loadSeedWorld(sequelize);
  await sequelize.close();
  console.log("Seed world loaded.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
