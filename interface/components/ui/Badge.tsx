import clsx from "clsx";

export type Tone = "good" | "warning" | "serious" | "critical" | "neutral";

// Text stays in neutral ink (dataviz rule: text never wears the data color) —
// the dot alone carries the status hue, paired with the label per the fixed
// status palette's "always icon + label" requirement.
const toneStyles: Record<Tone, string> = {
  good: "bg-surface-sunken text-text-primary",
  warning: "bg-surface-sunken text-text-primary",
  serious: "bg-surface-sunken text-text-primary",
  critical: "bg-surface-sunken text-text-primary",
  neutral: "bg-surface-sunken text-text-secondary",
};

const toneDot: Record<Tone, string> = {
  good: "bg-status-good",
  warning: "bg-status-warning",
  serious: "bg-status-serious",
  critical: "bg-status-critical",
  neutral: "bg-text-muted",
};

/** Status is always icon/dot + label, never color alone — see dataviz skill's status-palette rule. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", toneStyles[tone])}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", toneDot[tone])} />
      {children}
    </span>
  );
}
