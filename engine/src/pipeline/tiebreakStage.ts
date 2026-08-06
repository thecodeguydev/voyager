import type { TiebreakStageConfig } from "@voyager/shared";
import type { Candidate, Stage, StageContext } from "./stage.js";

// Beyond this, two Scoring outputs are treated as genuinely different rather than a tie —
// a normalization reference for floating-point weighted sums, not a hard cutoff.
const SCORE_TIE_EPSILON = 0.0001;

export type LastDispatchedLookup = (workerIds: string[]) => Promise<Map<string, Date | null>>;

/**
 * Breaks ties among candidates with equal (within `SCORE_TIE_EPSILON`) Scoring output, without
 * reordering across score bands. `fifo` preserves the candidates' natural (matcher) order — a
 * tiebreak for one order has no cross-order queue to draw "first" from, so this is a stable
 * pass-through; `nearest` sorts a tied band by ascending distance; `round_robin` sorts a tied band
 * by each worker's last `dispatchedAt` ascending (never-dispatched first), so consecutive ties
 * rotate rather than always favoring the same worker — derived from `assignments`, no rotation
 * state to persist. See PLAN.md "Composable pipeline" — Tiebreak.
 */
export class TiebreakStage implements Stage {
  readonly type = "tiebreak";

  constructor(
    private readonly config: TiebreakStageConfig,
    private readonly lookupLastDispatched: LastDispatchedLookup,
  ) {}

  async run(candidates: Candidate[], _ctx: StageContext): Promise<Candidate[]> {
    if (candidates.every((candidate) => candidate.score == null)) return candidates;

    const sorted = [...candidates].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const groups = groupTiedByScore(sorted);
    const lastDispatchedByWorker = await this.resolveLastDispatched(groups);

    return groups.flatMap((group) => this.rankGroup(group, lastDispatchedByWorker));
  }

  private async resolveLastDispatched(groups: Candidate[][]): Promise<Map<string, Date | null> | null> {
    if (this.config.strategy !== "round_robin") return null;
    const tiedWorkerIds = groups
      .filter((group) => group.length > 1)
      .flatMap((group) => group.map((candidate) => candidate.worker.id));
    return tiedWorkerIds.length > 0 ? this.lookupLastDispatched(tiedWorkerIds) : null;
  }

  private rankGroup(group: Candidate[], lastDispatchedByWorker: Map<string, Date | null> | null): Candidate[] {
    const tied = group.length > 1;
    const ranked = tied ? this.sortTiedGroup(group, lastDispatchedByWorker) : group;
    return ranked.map((candidate) => ({
      ...candidate,
      trace: { ...candidate.trace, tiebreak: { strategy: this.config.strategy, tied } },
    }));
  }

  private sortTiedGroup(
    group: Candidate[],
    lastDispatchedByWorker: Map<string, Date | null> | null,
  ): Candidate[] {
    switch (this.config.strategy) {
      case "nearest":
        return [...group].sort((a, b) => a.distanceMeters - b.distanceMeters);
      case "round_robin":
        return [...group].sort(
          (a, b) =>
            lastDispatchedTime(a, lastDispatchedByWorker) - lastDispatchedTime(b, lastDispatchedByWorker),
        );
      case "fifo":
        return group;
    }
  }
}

/** Groups adjacent (already score-sorted) candidates within SCORE_TIE_EPSILON of the group's
 * first (highest-scoring) member, so a chain of small steps can't drift a group's range apart. */
function groupTiedByScore(sorted: Candidate[]): Candidate[][] {
  const groups: Candidate[][] = [];
  for (const candidate of sorted) {
    const current = groups[groups.length - 1];
    if (current && Math.abs((current[0].score ?? 0) - (candidate.score ?? 0)) <= SCORE_TIE_EPSILON) {
      current.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }
  return groups;
}

/** Never-dispatched (or unknown) sorts first — the oldest wins the round-robin rotation. */
function lastDispatchedTime(
  candidate: Candidate,
  lastDispatchedByWorker: Map<string, Date | null> | null,
): number {
  const dispatchedAt = lastDispatchedByWorker?.get(candidate.worker.id);
  return dispatchedAt ? dispatchedAt.getTime() : -Infinity;
}
