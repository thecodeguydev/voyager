"use client";

import { useState } from "react";
import Link from "next/link";
import { useScope } from "@/lib/scope";
import { useWorkers } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { workerStatusTone } from "@/lib/statusTone";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { WorkerStatus } from "@/lib/types";

const STATUSES: WorkerStatus[] = ["available", "busy", "offline"];

export default function WorkersPage() {
  const { jurisdictionId } = useScope();
  const { data: workers, mutate } = useWorkers(jurisdictionId ?? undefined);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(id: string, status: WorkerStatus) {
    setSavingId(id);
    setError(null);
    try {
      await api.workers.setStatus(id, status);
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update worker status");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Workers" subtitle="Roster, availability, and current status. Select a jurisdiction in the sidebar to scope this list." />
      {error && <p className="mb-3 text-xs text-status-critical">{error}</p>}
      <Card>
        {!jurisdictionId ? (
          <EmptyState title="Select a jurisdiction" hint="Workers are scoped per jurisdiction — pick one in the sidebar to see the roster." />
        ) : !workers || workers.length === 0 ? (
          <EmptyState title="No workers in this jurisdiction" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-hairline text-left text-xs font-medium text-text-muted">
                <th className="pb-2">Name</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Skills</th>
                <th className="pb-2">Capacity</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-b border-border-hairline last:border-0">
                  <td className="py-2.5">
                    <Link href={`/workers/${w.id}`} className="font-medium text-brand-action hover:underline">
                      {w.name}
                    </Link>
                    <p className="text-xs text-text-muted">{w.externalId}</p>
                  </td>
                  <td className="py-2.5 text-text-secondary">{titleCase(w.type)}</td>
                  <td className="py-2.5 text-text-secondary">{w.skills.join(", ") || "—"}</td>
                  <td className="py-2.5 text-text-secondary">{w.maxConcurrent ?? "inherited"}</td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <Badge tone={workerStatusTone[w.status]}>{titleCase(w.status)}</Badge>
                      <select
                        className="rounded-md border border-border-hairline bg-surface-page px-1.5 py-1 text-xs disabled:opacity-50"
                        value={w.status}
                        disabled={savingId === w.id}
                        onChange={(e) => updateStatus(w.id, e.target.value as WorkerStatus)}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {titleCase(s)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
