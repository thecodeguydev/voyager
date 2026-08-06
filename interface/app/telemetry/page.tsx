"use client";

import Link from "next/link";
import { useScope } from "@/lib/scope";
import { useAssignments } from "@/lib/hooks";
import { formatRelative, titleCase } from "@/lib/format";
import { assignmentStateTone } from "@/lib/statusTone";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function TelemetryPage() {
  const { jurisdictionId } = useScope();
  const { data: assignments } = useAssignments({ jurisdictionId: jurisdictionId ?? undefined });

  const sorted = [...(assignments ?? [])].sort((a, b) => +new Date(b.dispatchedAt) - +new Date(a.dispatchedAt));

  return (
    <div>
      <PageHeader title="Dispatch Telemetry" subtitle="Live feed of dispatch decisions — open any case for the full pipeline trace and lifecycle." />
      <Card>
        {sorted.length === 0 ? (
          <EmptyState title="No dispatches yet" hint="Assignments will appear here as orders are dispatched." />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-hairline text-left text-xs font-medium text-text-muted">
                <th className="pb-2">Order</th>
                <th className="pb-2">State</th>
                <th className="pb-2">Source</th>
                <th className="pb-2">Score</th>
                <th className="pb-2">Dispatched</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 100).map((a) => (
                <tr key={a.id} className="border-b border-border-hairline last:border-0">
                  <td className="py-2.5">
                    <Link href={`/orders/${a.orderId}`} className="font-medium text-brand-action hover:underline">
                      {a.orderId.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="py-2.5">
                    <Badge tone={assignmentStateTone[a.state]}>{titleCase(a.state)}</Badge>
                  </td>
                  <td className="py-2.5 text-text-secondary">{titleCase(a.source)}</td>
                  <td className="py-2.5 text-text-secondary">{a.score !== null ? a.score.toFixed(2) : "—"}</td>
                  <td className="py-2.5 text-text-muted">{formatRelative(a.dispatchedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
