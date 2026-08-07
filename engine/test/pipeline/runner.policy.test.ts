import { describe, expect, it } from "vitest";
import type { Order, Worker } from "@voyager/shared";
import { runPipeline } from "../../src/pipeline/runner.js";
import { ScoringStage } from "../../src/pipeline/scoringStage.js";
import type { Candidate, StageContext } from "../../src/pipeline/stage.js";

function makeCandidate(skills: string[]): Candidate {
  return {
    worker: { skills, updatedAt: new Date() } as unknown as Worker,
    distanceMeters: 1_000,
    score: null,
    trace: {},
  };
}

function makeContext(minSkillMode: "off" | "warn" | "enforce", threshold: number): StageContext {
  return {
    order: { payload: { skillsRequired: ["electrical", "hvac"] } } as unknown as Order,
    dispatchPolicy: {
      maxCandidateDistance: { enabled: false, mode: "off", value: 20_000 },
      minSkillMatchRatio: { enabled: true, mode: minSkillMode, value: threshold },
    },
  };
}

describe("runPipeline policy filters", () => {
  it("enforce mode filters candidates below min skill match ratio", async () => {
    const partial = makeCandidate(["electrical"]); // 0.5
    const full = makeCandidate(["electrical", "hvac"]); // 1.0
    const stage = new ScoringStage({ distance: 0, skillMatch: 1, waitTime: 0 });

    const result = await runPipeline([stage], [partial, full], makeContext("enforce", 0.75));

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].worker).toBe(full.worker);
  });

  it("warn mode does not filter candidates", async () => {
    const partial = makeCandidate(["electrical"]);
    const full = makeCandidate(["electrical", "hvac"]);
    const stage = new ScoringStage({ distance: 0, skillMatch: 1, waitTime: 0 });

    const result = await runPipeline([stage], [partial, full], makeContext("warn", 0.75));

    expect(result.candidates).toHaveLength(2);
  });
});
