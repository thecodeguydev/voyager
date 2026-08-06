"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { usePipeline, usePipelinePresets } from "@/lib/hooks";
import { api } from "@/lib/api";
import { titleCase, formatDateTime } from "@/lib/format";
import { PageHeader, Card, EmptyState } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StageEditor } from "@/components/pipeline/StageEditor";
import type { PipelinePreset, StageDefinition, AuditLog } from "@/lib/types";

const STAGE_TYPES: StageDefinition["type"][] = ["tier", "scoring", "tiebreak"];

function blankStage(type: StageDefinition["type"]): StageDefinition {
  if (type === "tier") return { type, enabled: true, config: { tiers: ["critical", "high", "normal", "low"], sla: {} } };
  if (type === "scoring") return { type, enabled: true, config: { weights: { distance: 0.5, skillMatch: 0.3, waitTime: 0.2 } } };
  return { type: "tiebreak", enabled: true, config: { strategy: "fifo" } };
}

export default function PipelineEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: pipeline, mutate } = usePipeline(id);
  const { data: presets } = usePipelinePresets();
  const [audit, setAudit] = useState<AuditLog[]>([]);

  const [stages, setStages] = useState<StageDefinition[]>([]);
  const [preset, setPreset] = useState<PipelinePreset>("custom");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pipeline?.stored) {
      setStages(pipeline.stages);
      setPreset(pipeline.preset ?? "custom");
      setEnabled(pipeline.enabled);
    }
  }, [pipeline]);

  function refreshAudit() {
    api.pipeline.audit(id).then(setAudit).catch(() => setAudit([]));
  }

  useEffect(refreshAudit, [id]);

  async function applyPreset(name: "simple" | "balanced" | "advanced") {
    if (!presets) return;
    await api.pipeline.put(id, { preset: name, stages: presets[name], enabled: true });
    mutate();
    refreshAudit();
  }

  async function save() {
    setSaving(true);
    try {
      await api.pipeline.put(id, { preset: "custom", stages, enabled });
      mutate();
      refreshAudit();
    } finally {
      setSaving(false);
    }
  }

  function moveStage(index: number, dir: -1 | 1) {
    const next = [...stages];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setStages(next);
  }

  const missingTypes = STAGE_TYPES.filter((t) => !stages.some((s) => s.type === t));

  return (
    <div>
      <PageHeader
        title="Pipeline Editor"
        subtitle="Composable dispatch pipeline — reorder, toggle, and configure stages for this jurisdiction."
        action={
          <Link href={`/jurisdictions/${id}`} className="text-sm text-brand-action hover:underline">
            ← Back to jurisdiction
          </Link>
        }
      />

      {!pipeline ? (
        <p className="text-sm text-text-muted">Loading…</p>
      ) : !pipeline.stored ? (
        <Card>
          <EmptyState
            title="No pipeline configured yet"
            hint="This jurisdiction is silently running the engine's Phase 2 fallback (a single Scoring stage using settings-resolved weights). Initialize a stored pipeline to take explicit control — restoring to a preset is the recommended starting point."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => applyPreset("balanced")}>
                  Initialize with "balanced" preset
                </Button>
                <Button variant="secondary" onClick={() => applyPreset("simple")}>
                  Simple
                </Button>
                <Button variant="secondary" onClick={() => applyPreset("advanced")}>
                  Advanced
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  Pipeline enabled
                </label>
                <span className="text-xs text-text-muted">Current preset: {titleCase(preset)}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-xs text-text-muted self-center">Restore to preset:</span>
                {(["simple", "balanced", "advanced"] as const).map((p) => (
                  <Button key={p} variant="secondary" onClick={() => applyPreset(p)}>
                    {titleCase(p)}
                  </Button>
                ))}
              </div>
            </div>
          </Card>

          <div className="space-y-3">
            {stages.map((stage, i) => (
              <StageEditor
                key={i}
                stage={stage}
                onChange={(next) => setStages(stages.map((s, si) => (si === i ? next : s)))}
                onRemove={() => setStages(stages.filter((_, si) => si !== i))}
                onMove={(dir) => moveStage(i, dir)}
                canMoveUp={i > 0}
                canMoveDown={i < stages.length - 1}
              />
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-2">
              {missingTypes.map((t) => (
                <Button key={t} variant="secondary" onClick={() => setStages([...stages, blankStage(t)])}>
                  + Add {titleCase(t)}
                </Button>
              ))}
            </div>
            <Button variant="primary" disabled={saving} onClick={save}>
              Save pipeline
            </Button>
          </div>

          <Card title="Pipeline audit trail" className="mt-6">
            {audit.length === 0 ? (
              <EmptyState title="No changes recorded yet" />
            ) : (
              <ul className="space-y-2 text-sm">
                {audit.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between border-b border-border-hairline pb-2 last:border-0">
                    <span className="text-text-primary">
                      {titleCase(entry.action)} by {entry.actor}
                    </span>
                    <span className="text-xs text-text-muted">{formatDateTime(entry.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
