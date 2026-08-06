import type { Tone } from "@/components/ui/Badge";
import type { AssignmentState, OrderState, WorkerStatus } from "./types";

export const orderStateTone: Record<OrderState, Tone> = {
  created: "neutral",
  queued: "neutral",
  dispatched: "warning",
  accepted: "warning",
  in_progress: "warning",
  completed: "good",
  cancelled: "neutral",
  failed: "critical",
};

export const assignmentStateTone: Record<AssignmentState, Tone> = {
  dispatched: "warning",
  accepted: "warning",
  in_progress: "warning",
  completed: "good",
  rejected: "serious",
  expired: "serious",
  cancelled: "neutral",
  overridden: "neutral",
};

export const workerStatusTone: Record<WorkerStatus, Tone> = {
  available: "good",
  busy: "warning",
  offline: "neutral",
};

export const engineHealthTone: Record<"ok" | "degraded", Tone> = {
  ok: "good",
  degraded: "critical",
};

/** Shared active/inactive tone for groups, jurisdictions, and zones. */
export const activeStatusTone: Record<"active" | "inactive", Tone> = {
  active: "good",
  inactive: "neutral",
};
