"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useGroup, useJurisdictions } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { activeStatusTone } from "@/lib/statusTone";

export default function GroupDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: group } = useGroup(id);
  const { data: jurisdictions, mutate } = useJurisdictions(id);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!group) return <p className="text-sm text-text-muted">Loading…</p>;

  async function createJurisdiction() {
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.jurisdictions.create(id, { name, code, timezone });
      setName("");
      setCode("");
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create jurisdiction");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={group.name}
        subtitle={`Code ${group.code}`}
        action={
          <Link href="/groups" className="text-sm text-brand-action hover:underline">
            ← Back to groups
          </Link>
        }
      />

      <Card title="New jurisdiction" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label="Timezone">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={busy} onClick={createJurisdiction}>
            Create jurisdiction
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
      </Card>

      <Card title="Jurisdictions">
        {!jurisdictions || jurisdictions.length === 0 ? (
          <EmptyState title="No jurisdictions yet" />
        ) : (
          <ul className="divide-y divide-border-hairline">
            {jurisdictions.map((j) => (
              <li key={j.id} className="flex items-center justify-between py-3">
                <div>
                  <Link href={`/jurisdictions/${j.id}`} className="font-medium text-brand-action hover:underline">
                    {j.name}
                  </Link>
                  <p className="text-xs text-text-muted">
                    {j.code} · {j.timezone}
                  </p>
                </div>
                <Badge tone={activeStatusTone[j.status]}>{titleCase(j.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
