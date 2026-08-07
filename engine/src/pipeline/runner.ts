import { skillMatchRatio } from "./scoringStage.js";
import type { Candidate, Stage, StageContext } from "./stage.js";

export interface PipelineTraceEntry {
  stage: string;
  candidateCount: number;
}

export interface PipelineResult {
  candidates: Candidate[];
  trace: PipelineTraceEntry[];
}

/**
 * Reduces `candidates` through `stages` in configured order, recording which stages ran and how
 * many candidates survived each — the explainability trace stored on the winning assignment.
 * Phase 2 hardcodes a single Scoring stage; Phase 3's TierFilter/Tiebreak stages plug in here
 * without this function changing. See PLAN.md "Composable pipeline (strategy pattern)".
 */
export async function runPipeline(
  stages: Stage[],
  candidates: Candidate[],
  ctx: StageContext,
): Promise<PipelineResult> {
  const trace: PipelineTraceEntry[] = [];
  let current = candidates;
  for (const stage of stages) {
    current = await stage.run(current, ctx);

    if (ctx.dispatchPolicy.minSkillMatchRatio.enabled && ctx.dispatchPolicy.minSkillMatchRatio.mode === "enforce") {
      current = current.filter((candidate) => {
        const ratio = skillMatchRatio(candidate, ctx.order);
        const threshold = ctx.dispatchPolicy.minSkillMatchRatio.value;
        const matched = ratio >= threshold;

        candidate.trace = {
          ...candidate.trace,
          policy: {
            ...((candidate.trace.policy as Record<string, unknown> | undefined) ?? {}),
            minSkillMatchRatio: {
              enabled: true,
              mode: ctx.dispatchPolicy.minSkillMatchRatio.mode,
              threshold,
              ratio,
              matched,
            },
          },
        };

        return matched;
      });
    }

    trace.push({ stage: stage.type, candidateCount: current.length });
  }
  return { candidates: current, trace };
}
