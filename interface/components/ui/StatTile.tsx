/** Stat tile contract per the dataviz skill: label, auto-compact value, optional delta. Exactly what a Command Dashboard KPI row is made of. */
export function StatTile({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border-hairline bg-surface-card p-5">
      <p className="text-xs font-medium text-text-secondary">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-text-primary">
        {value}
        {unit && <span className="ml-1 text-base font-medium text-text-muted">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** Auto-compact formatting per the stat-tile contract: 1,284 / 12.9K / 4.2M. */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
