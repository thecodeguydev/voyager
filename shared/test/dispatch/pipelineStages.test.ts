import { describe, expect, it } from "vitest";
import { pipelineConfigDocSchema, stageDefinitionSchema } from "../../src/dispatch/pipelineStages.js";
import { PRESET_CATALOG } from "../../src/dispatch/pipelinePresets.js";

describe("pipelineConfigDocSchema", () => {
  it("accepts a well-formed tier/scoring/tiebreak document", () => {
    const result = pipelineConfigDocSchema.safeParse({
      preset: "advanced",
      enabled: true,
      stages: [
        {
          type: "tier",
          enabled: true,
          config: { tiers: ["critical", "high", "normal", "low"], sla: { critical: 15, high: 60 } },
        },
        { type: "scoring", enabled: true, config: { weights: { distance: 0.5, skillMatch: 0.3, waitTime: 0.2 } } },
        { type: "tiebreak", enabled: true, config: { strategy: "round_robin" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown stage type", () => {
    const result = stageDefinitionSchema.safeParse({ type: "bogus", enabled: true, config: {} });
    expect(result.success).toBe(false);
  });

  it("rejects a negative scoring weight", () => {
    const result = stageDefinitionSchema.safeParse({
      type: "scoring",
      enabled: true,
      config: { weights: { distance: -0.1, skillMatch: 0.3, waitTime: 0.2 } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown tiebreak strategy", () => {
    const result = stageDefinitionSchema.safeParse({
      type: "tiebreak",
      enabled: true,
      config: { strategy: "shortest_straw" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tier config with an unrecognized tier name", () => {
    const result = stageDefinitionSchema.safeParse({
      type: "tier",
      enabled: true,
      config: { tiers: ["urgent"], sla: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe("PRESET_CATALOG", () => {
  it("every built-in preset validates against stageDefinitionSchema", () => {
    for (const [name, stages] of Object.entries(PRESET_CATALOG)) {
      for (const stage of stages) {
        const result = stageDefinitionSchema.safeParse(stage);
        expect(result.success, `${name} stage ${JSON.stringify(stage)} should be valid`).toBe(true);
      }
    }
  });
});
