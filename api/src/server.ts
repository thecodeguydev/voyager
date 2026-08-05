import "dotenv/config";
import { createApp } from "./app.js";
import { createDb } from "./db.js";

const db = createDb();
const app = createApp(db);
const port = Number(process.env.PORT ?? 3000);

app.listen(port, () => {
  console.log(`Voyager API listening on port ${port}`);
});
