"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useOrder, useOrderAssignments, useOrderAudit } from "@/lib/hooks";
import { formatDateTime, titleCase } from "@/lib/format";
import { orderStateTone, assignmentStateTone } from "@/lib/statusTone";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PipelineTraceView } from "@/components/telemetry/PipelineTraceView";
import { ReassignForm } from "@/components/telemetry/ReassignForm";

const TERMINAL_ORDER_STATES = new Set(["completed", "cancelled", "failed"]);

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, mutate: mutateOrder } = useOrder(id);
  const { data: assignments, mutate: mutateAssignments } = useOrderAssignments(id);
  const { data: audit } = useOrderAudit(id);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!order) return <p className="text-sm text-text-muted">Loading…</p>;

  const sorted = [...(assignments ?? [])].sort((a, b) => +new Date(b.dispatchedAt) - +new Date(a.dispatchedAt));

  return (
    <div>
      <PageHeader
        title={`Order ${order.externalId}`}
        subtitle={`${titleCase(order.type)} · created ${formatDateTime(order.createdAt)}`}
        action={
          <Link href="/orders" className="text-sm text-brand-action hover:underline">
            ← Back to orders
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Order details">
          <dl className="space-y-2 text-sm">
            <Row label="State">
              <Badge tone={orderStateTone[order.state]}>{titleCase(order.state)}</Badge>
            </Row>
            <Row label="Priority tier">{order.priorityTier ? titleCase(order.priorityTier) : "Not set (pipeline may compute)"}</Row>
            <Row label="SLA due">{formatDateTime(order.slaDueAt)}</Row>
            <Row label="Pickup">
              {order.pickup.lat.toFixed(4)}, {order.pickup.lng.toFixed(4)}
            </Row>
          </dl>
        </Card>

        <Card title="Actions" className="lg:col-span-2">
          {TERMINAL_ORDER_STATES.has(order.state) ? (
            <p className="text-sm text-text-muted">This order is in a terminal state — no further dispatch actions apply.</p>
          ) : (
            <ReassignForm
              orderId={id}
              jurisdictionId={order.jurisdictionId}
              onDone={() => {
                mutateOrder();
                mutateAssignments();
              }}
            />
          )}
        </Card>
      </div>

      <Card title="Assignment history & pipeline trace" className="mt-4">
        {sorted.length === 0 ? (
          <EmptyState title="No assignments yet" />
        ) : (
          <ul className="space-y-3">
            {sorted.map((a) => (
              <li key={a.id} className="rounded-lg border border-border-hairline">
                <button
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                >
                  <div className="flex items-center gap-3">
                    <Badge tone={assignmentStateTone[a.state]}>{titleCase(a.state)}</Badge>
                    <span className="text-sm text-text-secondary">
                      {titleCase(a.source)} {a.score !== null && `· score ${a.score.toFixed(2)}`}
                    </span>
                    {a.overriddenBy && <span className="text-xs text-text-muted">by {a.overriddenBy}</span>}
                  </div>
                  <span className="text-xs text-text-muted">{formatDateTime(a.dispatchedAt)}</span>
                </button>
                {expanded === a.id && (
                  <div className="border-t border-border-hairline px-4 py-4">
                    {a.overrideReason && <p className="mb-3 text-sm text-text-secondary">Reason: {a.overrideReason}</p>}
                    <PipelineTraceView trace={a.pipelineTrace} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Audit trail" className="mt-4">
        {!audit || audit.length === 0 ? (
          <EmptyState title="No manual actions recorded" />
        ) : (
          <ul className="space-y-2 text-sm">
            {audit.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3 border-b border-border-hairline pb-2 last:border-0">
                <div>
                  <p className="font-medium text-text-primary">
                    {titleCase(entry.action)} <span className="text-text-muted">by {entry.actor}</span>
                  </p>
                  {entry.reason && <p className="text-text-secondary">{entry.reason}</p>}
                </div>
                <span className="whitespace-nowrap text-xs text-text-muted">{formatDateTime(entry.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-text-muted">{label}</dt>
      <dd className="text-text-primary">{children}</dd>
    </div>
  );
}
