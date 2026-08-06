import type { ReactNode } from "react";
import clsx from "clsx";

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <div className={clsx("rounded-xl border border-border-hairline bg-surface-card p-5 shadow-sm", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h3 className="text-sm font-semibold text-text-primary">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-strong px-6 py-12 text-center">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {hint && <p className="max-w-md text-sm text-text-muted">{hint}</p>}
      {action}
    </div>
  );
}
