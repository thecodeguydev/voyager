import type { PipelineTrace } from "@/lib/types";
import { titleCase } from "@/lib/format";

/** Renders "which stages ran, why this worker won" — the explainability panel PLAN.md calls for. */
export function PipelineTraceView({ trace }: { trace: PipelineTrace | null }) {
  if (!trace) {
    return <p className="text-sm text-text-muted">No pipeline trace — this was a manual assignment.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Stages run</p>
        <div className="flex flex-wrap gap-2">
          {trace.stages.map((s, i) => (
            <span key={i} className="rounded-full bg-surface-sunken px-3 py-1 text-xs font-medium text-text-primary">
              {titleCase(s.stage)} · {s.candidateCount} candidate{s.candidateCount === 1 ? "" : "s"}
            </span>
          ))}
        </div>
      </div>

      {trace.candidate.tier && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Tier</p>
          <p className="text-sm text-text-primary">
            {titleCase(trace.candidate.tier.tier)}
            <span className="text-text-muted">
              {" "}
              ({trace.candidate.tier.source}
              {trace.candidate.tier.minutesUntilDue !== null && `, ${trace.candidate.tier.minutesUntilDue}m until SLA due`})
            </span>
          </p>
        </div>
      )}

      {trace.candidate.scoring && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Scoring</p>
          <div className="grid grid-cols-4 gap-3 text-sm">
            <ScoreCell label="Distance" value={trace.candidate.scoring.distanceScore} weight={trace.candidate.scoring.weights.distance} />
            <ScoreCell label="Skill match" value={trace.candidate.scoring.skillScore} weight={trace.candidate.scoring.weights.skillMatch} />
            <ScoreCell label="Wait time" value={trace.candidate.scoring.waitScore} weight={trace.candidate.scoring.weights.waitTime} />
            <ScoreCell label="Total" value={trace.candidate.scoring.score} />
          </div>
        </div>
      )}

      {trace.candidate.tiebreak && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-text-muted">Tiebreak</p>
          <p className="text-sm text-text-primary">
            {titleCase(trace.candidate.tiebreak.strategy)}
            <span className="text-text-muted">{trace.candidate.tiebreak.tied ? " — resolved a tie" : " — no tie"}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreCell({ label, value, weight }: { label: string; value: number; weight?: number }) {
  return (
    <div className="rounded-lg bg-surface-sunken px-3 py-2">
      <p className="text-xs text-text-muted">
        {label}
        {weight !== undefined && ` (×${weight})`}
      </p>
      <p className="font-semibold text-text-primary">{value.toFixed(3)}</p>
    </div>
  );
}
