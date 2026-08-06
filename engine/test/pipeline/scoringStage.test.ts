import { describe, expect, it } from "vitest";
import type { Order, Worker } from "@voyager/shared";
import { ScoringStage } from "../../src/pipeline/scoringStage.js";
import type { Candidate, StageContext } from "../../src/pipeline/stage.js";

function makeCandidate(overrides: Partial<Candidate> & { worker?: Partial<Worker> } = {}): Candidate {
  const { worker, ...rest } = overrides;
  return {
    worker: { skills: ["electrical"], updatedAt: new Date(), ...worker } as unknown as Worker,
    distanceMeters: 1000,
    score: null,
    trace: {},
    ...rest,
  };
}

function makeCtx(payload: Record<string, unknown> = {}): StageContext {
  return { order: { createdAt: new Date(), payload } as unknown as Order };
}

describe("ScoringStage", () => {
  it("ranks a closer candidate above a farther one when only distance is weighted", () => {
    const stage = new ScoringStage({ distance: 1, skillMatch: 0, waitTime: 0 });
    const near = makeCandidate({ distanceMeters: 100 });
    const far = makeCandidate({ distanceMeters: 15_000 });

    const [winner] = stage.run([far, near], makeCtx());
    expect(winner.worker).toBe(near.worker);
  });

  it("ranks a fully skill-matched candidate above a partial match when only skill is weighted", () => {
    const stage = new ScoringStage({ distance: 0, skillMatch: 1, waitTime: 0 });
    const fullMatch = makeCandidate({ worker: { skills: ["electrical", "hvac"] } });
    const partialMatch = makeCandidate({ worker: { skills: ["hvac"] } });
    const ctx = makeCtx({ skillsRequired: ["electrical", "hvac"] });

    const [winner] = stage.run([partialMatch, fullMatch], ctx);
    expect(winner.worker).toBe(fullMatch.worker);
  });

  it("treats an order with no skillsRequired as a full match for every candidate", () => {
    const stage = new ScoringStage({ distance: 0, skillMatch: 1, waitTime: 0 });
    const a = makeCandidate({ worker: { skills: [] } });
    const b = makeCandidate({ worker: { skills: ["hvac"] } });

    const ranked = stage.run([a, b], makeCtx());
    expect(ranked.map((c) => c.score)).toEqual([1, 1]);
  });

  it("ranks a longer-idle candidate above a recently-updated one when only wait time is weighted", () => {
    const stage = new ScoringStage({ distance: 0, skillMatch: 0, waitTime: 1 });
    const idle = makeCandidate({ worker: { updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000) } });
    const fresh = makeCandidate({ worker: { updatedAt: new Date() } });

    const [winner] = stage.run([fresh, idle], makeCtx());
    expect(winner.worker).toBe(idle.worker);
  });

  it("records each component's score and the weights used in the candidate's trace", () => {
    const weights = { distance: 0.5, skillMatch: 0.3, waitTime: 0.2 };
    const stage = new ScoringStage(weights);
    const [scored] = stage.run([makeCandidate()], makeCtx());

    expect(scored.trace.scoring).toMatchObject({ weights });
    expect(typeof (scored.trace.scoring as { score: number }).score).toBe("number");
  });
});
