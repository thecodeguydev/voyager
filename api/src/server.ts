import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createApp } from "./app.js";
import { createDb } from "./db.js";

// See shared/src/db/sequelize.ts for why this resolves ".env" explicitly against the
// repo root instead of relying on bare `dotenv/config` (which uses process.cwd(),
// wrong here since `npm run dev --workspace=api` sets cwd to this workspace).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const db = createDb();
const app = createApp(db);
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Voyager API listening on port ${port}`);
});
