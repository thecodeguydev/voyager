import { createDb } from "@voyager/shared";
import { loadConfig } from "./config.js";
import { startListener } from "./listener.js";
import { createQueueRunner } from "./consumer.js";
import { startHeartbeat } from "./heartbeat.js";
import { SettingsCache } from "./settingsCache.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDb(config.databaseUrl);
  const cache = new SettingsCache(db);

  const heartbeat = startHeartbeat(db, config.instanceId, config.heartbeatIntervalMs);
  const runner = createQueueRunner({
    db,
    cache,
    instanceId: config.instanceId,
    batchSize: config.batchSize,
  });

  const listener = startListener({
    databaseUrl: config.databaseUrl,
    onWake: runner.wake,
    onError: (err) => console.error(`[engine:${config.instanceId}] LISTEN connection error`, err),
  });

  // The poll loop is the mandatory safety net for a missed/dropped NOTIFY (see PLAN.md
  // "Queue notification mechanism") — it never determines *whether* a row gets claimed, only
  // the worst-case latency if a notification is missed.
  const pollTimer = setInterval(runner.wake, config.pollIntervalMs);
  runner.wake();

  console.log(`[engine:${config.instanceId}] started`);

  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[engine:${config.instanceId}] shutting down`);
    clearInterval(pollTimer);
    await listener.stop();
    await heartbeat.stop();
    await db.sequelize.close();
    process.exit(0);
  }

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
