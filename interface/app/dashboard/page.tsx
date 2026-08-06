"use client";

import { useScope } from "@/lib/scope";
import { useAssignments, useEngineHealth, useMetricQuery } from "@/lib/hooks";
import { ACTIVE_ASSIGNMENT_STATES } from "@/lib/types";
import { timeWindow, HOUR_MS, DAY_MS } from "@/lib/timeWindow";
import { formatPercent } from "@/lib/format";
import { PageHeader, Card } from "@/components/ui/Card";
import { StatTile, formatCompact } from "@/components/ui/StatTile";
import { Badge } from "@/components/ui/Badge";
import { engineHealthTone } from "@/lib/statusTone";
import { OrdersPerHourChart } from "@/components/dashboard/OrdersPerHourChart";
import { ActiveAssignmentsMap } from "@/components/dashboard/ActiveAssignmentsMap";

function useLatestMetric(metric: string, windowMs: number, jurisdictionId?: string) {
  const { from, to } = timeWindow(windowMs);
  const { data } = useMetricQuery({ metric, from, to, jurisdictionId });
  return data?.rows[0]?.value;
}

export default function DashboardPage() {
  const { jurisdictionId } = useScope();
  const jid = jurisdictionId ?? undefined;

  const queueDepth = useLatestMetric("dispatch.queue_depth", HOUR_MS, jid);
  const slaCompliance = useLatestMetric("sla.compliance_rate", DAY_MS, jid);
  const utilization = useLatestMetric("worker.utilization", HOUR_MS, jid);
  const overrideRate = useLatestMetric("assignment.manual_override_rate", DAY_MS, jid);

  const { data: assignments } = useAssignments({ jurisdictionId: jid });
  const activeCount = assignments?.filter((a) => ACTIVE_ASSIGNMENT_STATES.includes(a.state)).length;

  const { data: engineHealth } = useEngineHealth();

  return (
    <div>
      <PageHeader
        title="Command Dashboard"
        subtitle={jurisdictionId ? "Scoped to the selected jurisdiction" : "Global telemetry across all jurisdictions"}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile label="Queue depth" value={queueDepth === undefined ? "—" : formatCompact(queueDepth)} hint="pending dispatch rows" />
        <StatTile label="Active dispatches" value={activeCount === undefined ? "—" : formatCompact(activeCount)} hint="dispatched / accepted / in progress" />
        <StatTile label="SLA compliance" value={formatPercent(slaCompliance)} hint="last 24h" />
        <StatTile label="Worker utilization" value={formatPercent(utilization)} hint="last hour" />
        <StatTile
          label="Manual override rate"
          value={formatPercent(overrideRate)}
          hint={overrideRate !== undefined && overrideRate > 0.2 ? "elevated — review pipeline config" : "last 24h"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="Orders per hour" className="xl:col-span-2">
          <OrdersPerHourChart jurisdictionId={jid} />
        </Card>
        <Card title="Engine health">
          {!engineHealth ? (
            <p className="text-sm text-text-muted">Loading…</p>
          ) : (
            <div className="space-y-3">
              <Badge tone={engineHealthTone[engineHealth.status]}>{engineHealth.status === "ok" ? "Healthy" : "Degraded"}</Badge>
              <p className="text-xs text-text-muted">{engineHealth.healthyCount} healthy instance(s)</p>
              <ul className="space-y-2">
                {engineHealth.instances.map((i) => (
                  <li key={i.instanceId} className="flex items-center justify-between rounded-lg bg-surface-sunken px-3 py-2 text-xs">
                    <span className="font-medium text-text-primary">{i.instanceId}</span>
                    <span className="text-text-muted">{i.claimedInFlight} in flight</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <Card title="Active assignments" className="mt-4">
        <ActiveAssignmentsMap jurisdictionId={jid} />
      </Card>
    </div>
  );
}
