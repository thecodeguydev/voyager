import { describe, expect, it } from "vitest";
import type { Order, TierStageConfig } from "@voyager/shared";
import { resolveTier, TierFilterStage } from "../../src/pipeline/tierFilterStage.js";
import type { Candidate, StageContext } from "../../src/pipeline/stage.js";

const config: TierStageConfig = {
  tiers: ["critical", "high", "normal", "low"],
  sla: { critical: 15, high: 60 },
};

function makeOrder(overrides: Partial<Order> = {}): Pick<Order, "priorityTier" | "slaDueAt"> {
  return { priorityTier: null, slaDueAt: null, ...overrides };
}

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    worker: {} as Candidate["worker"],
    distanceMeters: 1000,
    score: null,
    trace: {},
    ...overrides,
  };
}

describe("resolveTier", () => {
  it("uses an explicit priorityTier and ignores SLA proximity", () => {
    const order = makeOrder({ priorityTier: "low", slaDueAt: new Date(Date.now() + 60_000) });
    const resolved = resolveTier(order, config);
    expect(resolved).toMatchObject({ tier: "low", source: "explicit" });
  });

  it("computes 'critical' when the SLA due time is within the critical cutoff", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const order = makeOrder({ slaDueAt: new Date("2026-01-01T00:10:00Z") });
    const resolved = resolveTier(order, config, now);
    expect(resolved).toMatchObject({ tier: "critical", minutesUntilDue: 10, source: "computed" });
  });

  it("computes 'high' when past the critical cutoff but within the high cutoff", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const order = makeOrder({ slaDueAt: new Date("2026-01-01T00:45:00Z") });
    const resolved = resolveTier(order, config, now);
    expect(resolved.tier).toBe("high");
  });

  it("falls back to the last configured tier once every cutoff is exceeded", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const order = makeOrder({ slaDueAt: new Date("2026-01-02T00:00:00Z") });
    const resolved = resolveTier(order, config, now);
    expect(resolved.tier).toBe("low");
  });

  it("falls back to the last configured tier when there is no slaDueAt", () => {
    const resolved = resolveTier(makeOrder(), config);
    expect(resolved).toMatchObject({ tier: "low", minutesUntilDue: null, source: "computed" });
  });
});

describe("TierFilterStage", () => {
  it("tags every candidate without filtering the list", () => {
    const stage = new TierFilterStage(config);
    const ctx: StageContext = { order: makeOrder({ priorityTier: "critical" }) as Order };
    const candidates = [makeCandidate(), makeCandidate()];

    const result = stage.run(candidates, ctx);

    expect(result).toHaveLength(2);
    expect(result[0].trace.tier).toMatchObject({ tier: "critical" });
  });
});
