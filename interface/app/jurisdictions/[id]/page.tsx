"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useJurisdiction, useZones } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { activeStatusTone } from "@/lib/statusTone";

export default function JurisdictionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: jurisdiction } = useJurisdiction(id);
  const { data: zones, mutate } = useZones(id);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!jurisdiction) return <p className="text-sm text-text-muted">Loading…</p>;

  async function createZone() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // A minimal placeholder square around (0,0) — real boundaries are drawn/edited outside this quick-create form.
      await api.zones.create(id, {
        name,
        boundary: {
          points: [
            { lng: -0.05, lat: -0.05 },
            { lng: 0.05, lat: -0.05 },
            { lng: 0.05, lat: 0.05 },
            { lng: -0.05, lat: 0.05 },
            { lng: -0.05, lat: -0.05 },
          ],
        },
        centroid: { lng: 0, lat: 0 },
      });
      setName("");
      mutate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create zone");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={jurisdiction.name}
        subtitle={`${jurisdiction.code} · ${jurisdiction.timezone} · settings v${jurisdiction.settingsVersion}`}
        action={
          <div className="flex gap-3">
            <Link href={`/jurisdictions/${id}/pipeline`} className="text-sm text-brand-action hover:underline">
              Pipeline editor →
            </Link>
            <Link href={`/settings?jurisdictionId=${id}`} className="text-sm text-brand-action hover:underline">
              Settings →
            </Link>
          </div>
        }
      />

      <Card title="New zone" className="mb-4">
        <p className="mb-3 text-xs text-text-muted">
          Creates a small placeholder boundary — edit the geometry via the API once real coordinates are available.
        </p>
        <div className="flex items-end gap-3">
          <Field label="Name">
            <input className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Button variant="primary" disabled={busy} onClick={createZone}>
            Create zone
          </Button>
        </div>
        {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
      </Card>

      <Card title="Zones">
        {!zones || zones.length === 0 ? (
          <EmptyState title="No zones yet" />
        ) : (
          <ul className="divide-y divide-border-hairline">
            {zones.map((z) => (
              <li key={z.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-medium text-text-primary">{z.name}</span>
                <Badge tone={activeStatusTone[z.status]}>{titleCase(z.status)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
