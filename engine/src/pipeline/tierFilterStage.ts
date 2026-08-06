import type { Order, OrderPriorityTier, TierStageConfig } from "@voyager/shared";
import type { Candidate, Stage, StageContext } from "./stage.js";

export interface ResolvedTier {
  tier: OrderPriorityTier;
  minutesUntilDue: number | null;
  source: "explicit" | "computed";
}

/**
 * Resolves an order's priority tier: an explicit `order.priorityTier` always wins. Otherwise walks
 * `config.tiers` (most urgent first) and returns the first tier whose `config.sla` cutoff (minutes
 * until `slaDueAt`) isn't exceeded, else the last tier in the list — so a tier with no `sla` entry
 * is only ever reached as that final fallback (config authors should give every non-terminal tier
 * a cutoff). An order with no `slaDueAt` can never match a cutoff and always falls through to the
 * last tier. See PLAN.md "Composable pipeline" — TierFilter.
 */
export function resolveTier(
  order: Pick<Order, "priorityTier" | "slaDueAt">,
  config: TierStageConfig,
  now: Date = new Date(),
): ResolvedTier {
  const minutesUntilDue = order.slaDueAt ? (order.slaDueAt.getTime() - now.getTime()) / 60_000 : null;

  if (order.priorityTier) {
    return { tier: order.priorityTier, minutesUntilDue, source: "explicit" };
  }

  for (const tier of config.tiers) {
    const cutoff = config.sla[tier];
    if (cutoff != null && minutesUntilDue != null && minutesUntilDue <= cutoff) {
      return { tier, minutesUntilDue, source: "computed" };
    }
  }
  return { tier: config.tiers[config.tiers.length - 1], minutesUntilDue, source: "computed" };
}

/**
 * Tags every candidate's trace with the order's resolved tier — it does not filter or reorder
 * candidates, and deliberately does not persist the resolved tier back onto `order.priorityTier`:
 * doing so would make a pipeline-computed tier indistinguishable from a caller-supplied one on the
 * next dispatch attempt (e.g. after a reject/expire re-queue), permanently freezing it instead of
 * re-running the SLA-proximity computation. The resolved tier's explainability lives entirely in
 * `candidate.trace.tier`, which the winning candidate's trace carries into the assignment's
 * `pipelineTrace` for the Dispatch Telemetry UI. Per the Phase 3 design decision, hard eligibility
 * gating by tier is also deferred until a jurisdiction has a concrete need for it — Scoring's
 * skillMatch component already provides soft skill-based ranking.
 */
export class TierFilterStage implements Stage {
  readonly type = "tier";

  constructor(private readonly config: TierStageConfig) {}

  run(candidates: Candidate[], ctx: StageContext): Candidate[] {
    const resolved = resolveTier(ctx.order, this.config);

    return candidates.map((candidate) => ({
      ...candidate,
      trace: { ...candidate.trace, tier: resolved },
    }));
  }
}
