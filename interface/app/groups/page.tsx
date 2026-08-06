"use client";

import { useState } from "react";
import Link from "next/link";
import { useGroups } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { activeStatusTone } from "@/lib/statusTone";

export default function GroupsPage() {
  const { data: groups, mutate } = useGroups();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createGroup() {
    if (!name.trim() || !code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.groups.create({ name, code });
      setName("");
      setCode("");
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Groups & Jurisdictions" subtitle="A group is the client/tenant at the top of the hierarchy." />

      <Card title="New group" className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Name">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Code">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={busy} onClick={createGroup}>
            Create group
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
      </Card>

      <Card>
        {!groups || groups.length === 0 ? (
          <EmptyState title="No groups yet" hint="Create a client above to get started." />
        ) : (
          <ul className="divide-y divide-border-hairline">
            {groups.map((g) => (
              <li key={g.id} className="flex items-center justify-between py-3">
                <div>
                  <Link href={`/groups/${g.id}`} className="font-medium text-brand-action hover:underline">
                    {g.name}
                  </Link>
                  <p className="text-xs text-text-muted">{g.code}</p>
                </div>
                <Badge tone={activeStatusTone[g.status]}>{titleCase(g.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
