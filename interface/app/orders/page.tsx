"use client";

import { useState } from "react";
import Link from "next/link";
import { useScope } from "@/lib/scope";
import { useOrders } from "@/lib/hooks";
import { formatDateTime, titleCase } from "@/lib/format";
import { orderStateTone } from "@/lib/statusTone";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { OrderState } from "@/lib/types";

const STATES: OrderState[] = ["created", "queued", "dispatched", "accepted", "in_progress", "completed", "cancelled", "failed"];

export default function OrdersPage() {
  const { jurisdictionId } = useScope();
  const [state, setState] = useState<string>("");
  const { data: orders } = useOrders({ jurisdictionId: jurisdictionId ?? undefined, state: state || undefined });

  const sorted = [...(orders ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Every order ingested into Voyager, filterable by state."
        action={
          <select
            className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="">All states</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </select>
        }
      />
      <Card>
        {sorted.length === 0 ? (
          <EmptyState title="No orders match this filter" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-hairline text-left text-xs font-medium text-text-muted">
                <th className="pb-2">External ID</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Priority</th>
                <th className="pb-2">State</th>
                <th className="pb-2">SLA due</th>
                <th className="pb-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map((o) => (
                <tr key={o.id} className="border-b border-border-hairline last:border-0">
                  <td className="py-2.5">
                    <Link href={`/orders/${o.id}`} className="font-medium text-brand-action hover:underline">
                      {o.externalId}
                    </Link>
                  </td>
                  <td className="py-2.5 text-text-secondary">{titleCase(o.type)}</td>
                  <td className="py-2.5 text-text-secondary">{o.priorityTier ? titleCase(o.priorityTier) : "—"}</td>
                  <td className="py-2.5">
                    <Badge tone={orderStateTone[o.state]}>{titleCase(o.state)}</Badge>
                  </td>
                  <td className="py-2.5 text-text-muted">{formatDateTime(o.slaDueAt)}</td>
                  <td className="py-2.5 text-text-muted">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
