"use client";

import { useState } from "react";
import { useScope } from "@/lib/scope";
import { useMetricDefinitions } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import type { MetricAggregation, MetricType } from "@/lib/types";

const TYPES: MetricType[] = ["counter", "gauge", "duration", "rate"];
const AGGREGATIONS: MetricAggregation[] = ["sum", "avg", "p95", "max"];

export default function MetricsPage() {
  const { jurisdictionId } = useScope();
  const { data: definitions, mutate } = useMetricDefinitions(jurisdictionId ?? undefined);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [type, setType] = useState<MetricType>("gauge");
  const [aggregation, setAggregation] = useState<MetricAggregation>("avg");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const builtins = definitions?.filter((d) => d.builtin) ?? [];
  const custom = definitions?.filter((d) => !d.builtin) ?? [];

  async function createMetric() {
    setError(null);
    if (!key.trim() || !name.trim() || !unit.trim()) {
      setError("Key, name, and unit are required.");
      return;
    }
    setBusy(true);
    try {
      await api.metrics.createDefinition({ key, name, unit, type, aggregation, jurisdictionId: jurisdictionId ?? null });
      setKey("");
      setName("");
      setUnit("");
      mutate();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create metric");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Metrics Dictionary" subtitle="Built-in dispatch/workforce metrics, plus custom jurisdiction-scoped definitions." />

      <Card title="Define a custom metric" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Key"><input className="w-48 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={key} onChange={(e) => setKey(e.target.value)} placeholder="team.custom_metric" /></Field>
          <Field label="Name"><input className="w-48 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Unit"><input className="w-24 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
          <Field label="Type">
            <select className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value as MetricType)}>
              {TYPES.map((t) => <option key={t} value={t}>{titleCase(t)}</option>)}
            </select>
          </Field>
          <Field label="Aggregation">
            <select className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={aggregation} onChange={(e) => setAggregation(e.target.value as MetricAggregation)}>
              {AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Field>
          <Button variant="primary" disabled={busy} onClick={createMetric}>Create</Button>
        </div>
        {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
        {jurisdictionId && <p className="mt-2 text-xs text-text-muted">Scoped to the selected jurisdiction.</p>}
      </Card>

      <Card title="Built-in metrics" className="mb-4">
        <DefinitionTable rows={builtins} />
      </Card>

      <Card title="Custom metrics">
        {custom.length === 0 ? <EmptyState title="No custom metrics defined yet" /> : <DefinitionTable rows={custom} />}
      </Card>
    </div>
  );
}

function DefinitionTable({ rows }: { rows: Array<{ id: string; key: string; name: string; unit: string; type: string; aggregation: string; builtin: boolean }> }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border-hairline text-left text-xs font-medium text-text-muted">
          <th className="pb-2">Key</th>
          <th className="pb-2">Name</th>
          <th className="pb-2">Unit</th>
          <th className="pb-2">Type</th>
          <th className="pb-2">Aggregation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border-hairline last:border-0">
            <td className="py-2 font-mono text-xs text-text-primary">{r.key}</td>
            <td className="py-2 text-text-secondary">{r.name}</td>
            <td className="py-2 text-text-muted">{r.unit}</td>
            <td className="py-2"><Badge>{titleCase(r.type)}</Badge></td>
            <td className="py-2 text-text-muted">{r.aggregation}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
