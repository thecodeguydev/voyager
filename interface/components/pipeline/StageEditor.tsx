import type { StageDefinition, OrderPriorityTier } from "@/lib/types";
import { titleCase } from "@/lib/format";
import { Button } from "@/components/ui/Button";

const TIERS: OrderPriorityTier[] = ["critical", "high", "normal", "low"];

export function StageEditor({
  stage,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  stage: StageDefinition;
  onChange: (next: StageDefinition) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  return (
    <div className="rounded-lg border border-border-hairline p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <input type="checkbox" checked={stage.enabled} onChange={(e) => onChange({ ...stage, enabled: e.target.checked } as StageDefinition)} />
            {titleCase(stage.type)}
          </label>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" disabled={!canMoveUp} onClick={() => onMove(-1)}>
            ↑
          </Button>
          <Button variant="ghost" disabled={!canMoveDown} onClick={() => onMove(1)}>
            ↓
          </Button>
          <Button variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      {stage.type === "tier" && (
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-text-muted">Tiers (in eligibility order)</p>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 rounded-full bg-surface-sunken px-2.5 py-1 text-xs">
                  <input
                    type="checkbox"
                    checked={stage.config.tiers.includes(t)}
                    onChange={(e) => {
                      const tiers = e.target.checked ? [...stage.config.tiers, t] : stage.config.tiers.filter((x) => x !== t);
                      onChange({ ...stage, config: { ...stage.config, tiers } });
                    }}
                  />
                  {titleCase(t)}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text-muted">SLA minutes per tier</p>
            <div className="flex flex-wrap gap-3">
              {TIERS.map((t) => (
                <label key={t} className="flex items-center gap-1.5 text-xs">
                  {titleCase(t)}
                  <input
                    type="number"
                    className="w-20 rounded-md border border-border-hairline bg-surface-page px-1.5 py-1"
                    value={stage.config.sla[t] ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? undefined : Number(e.target.value);
                      const sla = { ...stage.config.sla };
                      if (v === undefined) delete sla[t];
                      else sla[t] = v;
                      onChange({ ...stage, config: { ...stage.config, sla } });
                    }}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {stage.type === "scoring" && (
        <div className="flex flex-wrap gap-4">
          {(["distance", "skillMatch", "waitTime"] as const).map((k) => (
            <label key={k} className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-text-muted">{titleCase(k)} weight</span>
              <input
                type="number"
                step="0.05"
                min="0"
                className="w-24 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5"
                value={stage.config.weights[k]}
                onChange={(e) =>
                  onChange({ ...stage, config: { weights: { ...stage.config.weights, [k]: Number(e.target.value) } } })
                }
              />
            </label>
          ))}
        </div>
      )}

      {stage.type === "tiebreak" && (
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-text-muted">Strategy</span>
          <select
            className="w-40 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
            value={stage.config.strategy}
            onChange={(e) => onChange({ ...stage, config: { strategy: e.target.value as typeof stage.config.strategy } })}
          >
            <option value="fifo">FIFO</option>
            <option value="round_robin">Round robin</option>
            <option value="nearest">Nearest</option>
          </select>
        </label>
      )}
    </div>
  );
}
