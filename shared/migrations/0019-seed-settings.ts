import { randomUUID } from "node:crypto";
import type { QueryInterface } from "sequelize";

const SCORING_WEIGHT_KEYS = [
  "pipeline.scoring.weights.distance",
  "pipeline.scoring.weights.skillMatch",
  "pipeline.scoring.weights.waitTime",
];
const HEARTBEAT_STALENESS_KEY = "engine.heartbeat.staleness_ms";
const METRIC_KEYS = ["dispatch.response_time_ms", "dispatch.time_to_assign_ms"];

// Global defaults so Phase 2's Scoring stage and GET /health/engine have somewhere to resolve
// from before pipeline_configs (Phase 3) exists. Plain queryInterface.bulkInsert, like every
// other migration — migrations are loaded via Umzug's own dynamic import(), which (unlike the
// rest of shared/src) isn't running through a TS-aware loader, so importing the models here
// fails at runtime. JSONB values are passed as JSON text, which Postgres implicitly casts.
export const up = async ({ context: queryInterface }: { context: QueryInterface }) => {
  const now = new Date();

  await queryInterface.bulkInsert("settings", [
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: SCORING_WEIGHT_KEYS[0],
      value: JSON.stringify(0.5),
      dataType: "number",
      description: "Scoring stage weight for candidate distance (closer is better).",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: SCORING_WEIGHT_KEYS[1],
      value: JSON.stringify(0.3),
      dataType: "number",
      description: "Scoring stage weight for candidate skill overlap with the order.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: SCORING_WEIGHT_KEYS[2],
      value: JSON.stringify(0.2),
      dataType: "number",
      description: "Scoring stage weight for how long the order has been waiting.",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      scope: "global",
      groupId: null,
      jurisdictionId: null,
      key: HEARTBEAT_STALENESS_KEY,
      value: JSON.stringify(15_000),
      dataType: "number",
      description: "GET /health/engine treats an instance stale once its heartbeat is older than this many ms.",
      createdAt: now,
      updatedAt: now,
    },
  ]);

  await queryInterface.bulkInsert("metric_definitions", [
    {
      id: randomUUID(),
      key: METRIC_KEYS[0],
      name: "Dispatch Response Time",
      description: "Time from order creation to its first automatic dispatch.",
      unit: "ms",
      type: "duration",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: randomUUID(),
      key: METRIC_KEYS[1],
      name: "Time to Assign",
      description: "Time the engine spends processing a claimed order before an assignment is written.",
      unit: "ms",
      type: "duration",
      builtin: true,
      aggregation: "avg",
      jurisdictionId: null,
      createdAt: now,
      updatedAt: now,
    },
  ]);
};

export const down = async ({ context: queryInterface }: { context: QueryInterface }) => {
  await queryInterface.bulkDelete("settings", {
    key: [...SCORING_WEIGHT_KEYS, HEARTBEAT_STALENESS_KEY],
  });
  await queryInterface.bulkDelete("metric_definitions", { key: METRIC_KEYS });
};
