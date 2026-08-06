"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useWorkers } from "@/lib/hooks";
import { Button } from "@/components/ui/Button";

export function ReassignForm({ orderId, jurisdictionId, onDone }: { orderId: string; jurisdictionId: string; onDone: () => void }) {
  const { data: workers } = useWorkers(jurisdictionId);
  const [workerId, setWorkerId] = useState("");
  const [reason, setReason] = useState("");
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(force: boolean) {
    if (!workerId || !reason.trim()) {
      setError("Choose a worker and enter a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.orders.reassign(orderId, { workerId, reason, force });
      setWarnings(null);
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === "VALIDATION_ERROR" && Array.isArray((e.details as { warnings?: string[] })?.warnings)) {
        setWarnings((e.details as { warnings: string[] }).warnings);
      } else {
        setError(e instanceof Error ? e.message : "Reassign failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    if (!reason.trim()) {
      setError("Enter a reason to unassign.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.orders.unassign(orderId, reason);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unassign failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-hairline p-4">
      <p className="text-sm font-medium text-text-primary">Reassign / unassign</p>
      <select
        className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
        value={workerId}
        onChange={(e) => {
          setWorkerId(e.target.value);
          setWarnings(null);
        }}
      >
        <option value="">Select a worker…</option>
        {workers?.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} ({w.status})
          </option>
        ))}
      </select>
      <textarea
        className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm"
        placeholder="Reason (required, audited)"
        rows={2}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      {warnings && warnings.length > 0 && (
        <div className="rounded-lg bg-surface-sunken px-3 py-2 text-xs text-text-primary">
          <p className="mb-1 font-medium">Soft constraint warnings:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-xs text-status-critical">{error}</p>}

      <div className="flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => submit(false)}>
          Reassign
        </Button>
        {warnings && warnings.length > 0 && (
          <Button variant="danger" disabled={busy} onClick={() => submit(true)}>
            Force reassign anyway
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={unassign}>
          Unassign (re-queue)
        </Button>
      </div>
    </div>
  );
}
