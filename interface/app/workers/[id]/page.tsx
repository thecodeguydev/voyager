"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useAssignments, useSchedules, useWorker } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { workerStatusTone } from "@/lib/statusTone";
import { ACTIVE_ASSIGNMENT_STATES } from "@/lib/types";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WorkerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: worker } = useWorker(id);
  const { data: schedules, mutate: mutateSchedules } = useSchedules(id);
  const { data: assignments } = useAssignments({ workerId: id });

  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [type, setType] = useState<"shift" | "timeoff">("shift");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!worker) return <p className="text-sm text-text-muted">Loading…</p>;

  const activeCount = assignments?.filter((a) => ACTIVE_ASSIGNMENT_STATES.includes(a.state)).length ?? 0;

  async function addSchedule() {
    setBusy(true);
    setError(null);
    try {
      await api.schedules.create(id, { dayOfWeek: Number(dayOfWeek), startTime, endTime, type, recurring: true });
      mutateSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add schedule entry");
    } finally {
      setBusy(false);
    }
  }

  async function removeSchedule(scheduleId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.schedules.remove(scheduleId);
      mutateSchedules();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove schedule entry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title={worker.name}
        subtitle={`${titleCase(worker.type)} · ${worker.externalId}`}
        action={
          <Link href="/workers" className="text-sm text-brand-action hover:underline">
            ← Back to workers
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Profile">
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Status</dt>
              <dd>
                <Badge tone={workerStatusTone[worker.status]}>{titleCase(worker.status)}</Badge>
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Skills</dt>
              <dd className="text-text-primary">{worker.skills.join(", ") || "—"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Max concurrent</dt>
              <dd className="text-text-primary">{worker.maxConcurrent ?? "inherited from settings"}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">Active assignments</dt>
              <dd className="text-text-primary">{activeCount}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Add schedule entry" className="lg:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Day">
              <select className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)}>
                {DAYS.map((d, i) => (
                  <option key={i} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Start">
              <input type="time" className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="time" className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
            <Field label="Type">
              <select className="rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value as "shift" | "timeoff")}>
                <option value="shift">Shift</option>
                <option value="timeoff">Time off</option>
              </select>
            </Field>
            <Button variant="primary" disabled={busy} onClick={addSchedule}>
              Add
            </Button>
          </div>
          {error && <p className="mt-2 text-xs text-status-critical">{error}</p>}
        </Card>
      </div>

      <Card title="Schedule" className="mt-4">
        {!schedules || schedules.length === 0 ? (
          <EmptyState title="No schedule entries" hint="This worker has no on-duty windows configured yet." />
        ) : (
          <ul className="divide-y divide-border-hairline">
            {schedules.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="text-text-primary">
                  {s.date ? s.date : DAYS[s.dayOfWeek ?? 0]} · {s.startTime}–{s.endTime} · {titleCase(s.type)}
                  {s.recurring && <span className="ml-2 text-xs text-text-muted">recurring</span>}
                </span>
                <Button variant="ghost" disabled={busy} onClick={() => removeSchedule(s.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
