import { describe, expect, it } from "vitest";
import type { AppDb, PipelineConfigDoc } from "@voyager/shared";
import { buildStages } from "../../src/pipeline/buildStages.js";
import { TierFilterStage } from "../../src/pipeline/tierFilterStage.js";
import { ScoringStage } from "../../src/pipeline/scoringStage.js";
import { TiebreakStage } from "../../src/pipeline/tiebreakStage.js";

const stubDb = {} as unknown as AppDb;

describe("buildStages", () => {
  it("constructs one stage instance per enabled entry, in configured order", () => {
    const doc: PipelineConfigDoc = {
      preset: "advanced",
      enabled: true,
      stages: [
        { type: "tier", enabled: true, config: { tiers: ["critical", "low"], sla: { critical: 15 } } },
        { type: "scoring", enabled: true, config: { weights: { distance: 1, skillMatch: 0, waitTime: 0 } } },
        { type: "tiebreak", enabled: true, config: { strategy: "nearest" } },
      ],
    };

    const stages = buildStages(doc, stubDb);

    expect(stages).toHaveLength(3);
    expect(stages[0]).toBeInstanceOf(TierFilterStage);
    expect(stages[1]).toBeInstanceOf(ScoringStage);
    expect(stages[2]).toBeInstanceOf(TiebreakStage);
  });

  it("skips disabled stages", () => {
    const doc: PipelineConfigDoc = {
      preset: "custom",
      enabled: true,
      stages: [
        { type: "tier", enabled: false, config: { tiers: ["critical", "low"], sla: {} } },
        { type: "scoring", enabled: true, config: { weights: { distance: 1, skillMatch: 0, waitTime: 0 } } },
      ],
    };

    const stages = buildStages(doc, stubDb);

    expect(stages).toHaveLength(1);
    expect(stages[0]).toBeInstanceOf(ScoringStage);
  });
});
