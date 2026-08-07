"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useScope } from "@/lib/scope";
import { useJurisdiction, useSettings } from "@/lib/hooks";
import { api } from "@/lib/api";
import { formatDateTime, titleCase } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { AuditLog, SettingScope } from "@/lib/types";

const KNOWN_KEYS = [
  "worker.max_concurrent",
  "assignment.response_timeout_ms",
  "metrics.retention_days",
  "pipeline.scoring.weights.distance",
  "pipeline.scoring.weights.skillMatch",
  "pipeline.scoring.weights.waitTime",
  "ingestion.require_skills_required",
  "dispatch.max_candidate_distance_m",
  "dispatch.min_skill_match_ratio",
  "engine.heartbeat.staleness_ms",
  "dispatch.expiry_seconds",
];

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-text-muted">Loading…</p>}>
      <SettingsPageInner />
    </Suspense>
  );
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const { groupId: scopeGroupId } = useScope();
  const jurisdictionIdParam = searchParams.get("jurisdictionId") ?? undefined;
  const { data: jurisdiction } = useJurisdiction(jurisdictionIdParam);
  const groupId = jurisdiction?.groupId ?? scopeGroupId ?? undefined;

  const [key, setKey] = useState(KNOWN_KEYS[0]);
  const effectiveKey = key;

  // GET /settings has no key filter — fetch each scope's rows and find the key client-side below.
  const { data: globalRows, mutate: mutateGlobal } = useSettings({ scope: "global" });
  const { data: groupRows, mutate: mutateGroup } = useSettings({ scope: "group", groupId });
  const { data: jurisdictionRows, mutate: mutateJurisdiction } = useSettings({ scope: "jurisdiction", jurisdictionId: jurisdictionIdParam });

  const globalSetting = globalRows?.find((s) => s.key === effectiveKey && s.scope === "global");
  const groupSetting = groupRows?.find((s) => s.key === effectiveKey);
  const jurisdictionSetting = jurisdictionRows?.find((s) => s.key === effectiveKey);

  const effective = jurisdictionSetting ?? groupSetting ?? globalSetting;
  const effectiveScope: SettingScope | null = jurisdictionSetting ? "jurisdiction" : groupSetting ? "group" : globalSetting ? "global" : null;

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Global, per-group, and per-jurisdiction key/value settings. Most specific wins: jurisdiction → group → global."
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-text-muted">Key</span>
            <select className="w-64 rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-sm" value={key} onChange={(e) => setKey(e.target.value)}>
              {KNOWN_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ScopeEditor
          scopeLabel="Global"
          scope="global"
          settingsKey={effectiveKey}
          existing={globalSetting}
          isEffective={effectiveScope === "global"}
          onSaved={() => mutateGlobal()}
        />
        <ScopeEditor
          scopeLabel="Group"
          scope="group"
          settingsKey={effectiveKey}
          groupId={groupId}
          existing={groupSetting}
          isEffective={effectiveScope === "group"}
          disabledHint={!groupId ? "Select a group in the sidebar" : undefined}
          onSaved={() => mutateGroup()}
        />
        <ScopeEditor
          scopeLabel="Jurisdiction"
          scope="jurisdiction"
          settingsKey={effectiveKey}
          jurisdictionId={jurisdictionIdParam}
          existing={jurisdictionSetting}
          isEffective={effectiveScope === "jurisdiction"}
          disabledHint={!jurisdictionIdParam ? "Open Settings from a jurisdiction page to edit this scope" : undefined}
          onSaved={() => mutateJurisdiction()}
        />
      </div>

      <Card title="Resolved effective value">
        {!effective ? (
          <EmptyState title="No value set at any scope" hint="The dispatch engine will use its in-code default." />
        ) : (
          <div className="text-sm">
            <p className="mb-1 text-text-muted">
              Resolved from <span className="font-medium text-text-primary">{titleCase(effectiveScope!)}</span> scope
            </p>
            <pre className="overflow-x-auto rounded-lg bg-surface-sunken p-3 text-xs">{JSON.stringify(effective.value, null, 2)}</pre>
          </div>
        )}
      </Card>
    </div>
  );
}

function ScopeEditor({
  scopeLabel,
  scope,
  settingsKey,
  groupId,
  jurisdictionId,
  existing,
  isEffective,
  disabledHint,
  onSaved,
}: {
  scopeLabel: string;
  scope: SettingScope;
  settingsKey: string;
  groupId?: string;
  jurisdictionId?: string;
  existing?: { value: unknown; dataType: string; description: string | null };
  isEffective: boolean;
  disabledHint?: string;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(() => JSON.stringify(existing?.value ?? "", null, 2));
  const [dataType, setDataType] = useState(existing?.dataType ?? "json");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [audit, setAudit] = useState<AuditLog[] | null>(null);

  // `existing` changes whenever the key/scope switches OR the underlying SWR resource
  // resolves/revalidates (including right after a save, via onSaved's mutate()) — resync
  // the editable fields each time instead of freezing them at first-mount's value.
  useEffect(() => {
    setValue(JSON.stringify(existing?.value ?? "", null, 2));
    setDataType(existing?.dataType ?? "json");
    setAudit(null);
  }, [existing, settingsKey, scope]);

  const disabled = (scope === "group" && !groupId) || (scope === "jurisdiction" && !jurisdictionId);

  async function save() {
    setError(null);
    let parsed: unknown;
    try {
      parsed = value.trim() === "" ? null : JSON.parse(value);
    } catch {
      setError("Value must be valid JSON (wrap strings in quotes).");
      return;
    }
    setSaving(true);
    try {
      await api.settings.upsert(settingsKey, { scope, groupId, jurisdictionId, value: parsed, dataType });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function loadAudit() {
    const rows = await api.settings.audit(settingsKey, { scope, groupId, jurisdictionId }).catch(() => []);
    setAudit(rows);
  }

  async function rollback(auditLogId: string) {
    await api.settings.rollback(settingsKey, auditLogId);
    onSaved();
    loadAudit();
  }

  return (
    <Card title={<span>{scopeLabel} {isEffective && <span className="ml-1 text-xs text-brand-action">(effective)</span>}</span>}>
      {disabled ? (
        <p className="text-xs text-text-muted">{disabledHint}</p>
      ) : (
        <div className="space-y-2">
          <textarea
            className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 font-mono text-xs"
            rows={4}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <input
            className="w-full rounded-md border border-border-hairline bg-surface-page px-2 py-1.5 text-xs"
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            placeholder="dataType"
          />
          {error && <p className="text-xs text-status-critical">{error}</p>}
          <div className="flex gap-2">
            <Button variant="primary" disabled={saving} onClick={save}>
              Save
            </Button>
            <Button variant="ghost" onClick={loadAudit}>
              Audit history
            </Button>
          </div>
          {audit && (
            <ul className="mt-2 space-y-1.5 border-t border-border-hairline pt-2 text-xs">
              {audit.length === 0 ? (
                <li className="text-text-muted">No history at this scope.</li>
              ) : (
                audit.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between">
                    <span className="text-text-secondary">
                      {formatDateTime(entry.createdAt)} · {entry.actor}
                    </span>
                    <Button variant="ghost" onClick={() => rollback(entry.id)}>
                      Rollback
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
