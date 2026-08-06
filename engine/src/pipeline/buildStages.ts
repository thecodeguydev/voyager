import type { AppDb, PipelineConfigDoc } from "@voyager/shared";
import { ScoringStage } from "./scoringStage.js";
import type { Stage } from "./stage.js";
import { TierFilterStage } from "./tierFilterStage.js";
import { TiebreakStage, type LastDispatchedLookup } from "./tiebreakStage.js";

/** Constructs the enabled stages from a validated pipeline config document, in configured order. */
export function buildStages(doc: PipelineConfigDoc, db: AppDb): Stage[] {
  const lookupLastDispatched = createLastDispatchedLookup(db);

  return doc.stages
    .filter((stage) => stage.enabled)
    .map((stage): Stage => {
      switch (stage.type) {
        case "tier":
          return new TierFilterStage(stage.config);
        case "scoring":
          return new ScoringStage(stage.config.weights);
        case "tiebreak":
          return new TiebreakStage(stage.config, lookupLastDispatched);
      }
    });
}

/** Most recent `dispatchedAt` per worker, for TiebreakStage's `round_robin` strategy. */
function createLastDispatchedLookup(db: AppDb): LastDispatchedLookup {
  return async (workerIds) => {
    const rows = await db.models.Assignment.findAll({
      where: { workerId: workerIds },
      attributes: ["workerId", "dispatchedAt"],
      order: [["dispatchedAt", "DESC"]],
    });

    const lastDispatchedByWorker = new Map<string, Date | null>();
    for (const row of rows) {
      if (!lastDispatchedByWorker.has(row.workerId)) lastDispatchedByWorker.set(row.workerId, row.dispatchedAt);
    }
    for (const workerId of workerIds) {
      if (!lastDispatchedByWorker.has(workerId)) lastDispatchedByWorker.set(workerId, null);
    }
    return lastDispatchedByWorker;
  };
}
