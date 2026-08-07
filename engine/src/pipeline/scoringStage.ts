import { DEFAULT_SCORING_WEIGHTS, type Order, type ScoringStageConfig } from "@voyager/shared";
import type { Candidate, Stage, StageContext } from "./stage.js";

export type ScoringWeights = ScoringStageConfig["weights"];
export { DEFAULT_SCORING_WEIGHTS };

// Beyond this distance the distance component scores 0 — a normalization reference, not a hard cutoff.
const MAX_SCORING_DISTANCE_METERS = 20_000;
// Idle this long or more scores the wait-time component 1.0.
const WAIT_TIME_REFERENCE_MS = 60 * 60 * 1000;

/**
 * Weighted candidate ranking: closer, better-skill-matched, and longer-idle candidates score
 * higher, sorted descending. Wait time is measured per candidate (idle time), not per order —
 * a per-order value would add the same constant to every candidate and could never affect which
 * one wins. See PLAN.md "Composable pipeline" — Scoring.
 */
export class ScoringStage implements Stage {
  readonly type = "scoring";

  constructor(private readonly weights: ScoringWeights) {}

  run(candidates: Candidate[], ctx: StageContext): Candidate[] {
    return candidates
      .map((candidate) => this.score(candidate, ctx.order))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }

  private score(candidate: Candidate, order: Order): Candidate {
    const distanceScore = Math.max(0, 1 - candidate.distanceMeters / MAX_SCORING_DISTANCE_METERS);
    const skillScore = this.skillScore(candidate, order);
    const waitScore = this.waitScore(candidate);

    const score =
      this.weights.distance * distanceScore +
      this.weights.skillMatch * skillScore +
      this.weights.waitTime * waitScore;

    return {
      ...candidate,
      score,
      trace: {
        ...candidate.trace,
        scoring: { distanceScore, skillScore, waitScore, weights: this.weights, score },
      },
    };
  }

  private skillScore(candidate: Candidate, order: Order): number {
    return skillMatchRatio(candidate, order);
  }

  /** A proxy for idle time: how long since this worker's row last changed. Phase 2 has no
   * explicit idle-since tracking, so `updatedAt` (which moves on every status/location update)
   * is the best available signal. */
  private waitScore(candidate: Candidate): number {
    const idleMs = Date.now() - candidate.worker.updatedAt.getTime();
    return Math.min(idleMs / WAIT_TIME_REFERENCE_MS, 1);
  }
}

export function skillMatchRatio(candidate: Candidate, order: Order): number {
  const required = (order.payload as { skillsRequired?: unknown } | null)?.skillsRequired;
  if (!Array.isArray(required) || required.length === 0) return 1;
  const workerSkills = new Set(candidate.worker.skills);
  const matched = required.filter((skill) => workerSkills.has(skill));
  return matched.length / required.length;
}
