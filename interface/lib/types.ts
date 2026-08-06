/** Wire types for the Voyager REST API (api/src/routes/**). Mirrors shared/src/models/*.ts. */

export type LngLat = { lng: number; lat: number };
export type Polygon = { points: LngLat[] };

export type GroupStatus = "active" | "inactive";
export type Group = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: GroupStatus;
  createdAt: string;
  updatedAt: string;
};

export type Jurisdiction = {
  id: string;
  groupId: string;
  name: string;
  code: string;
  timezone: string;
  status: "active" | "inactive";
  settingsVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type Zone = {
  id: string;
  jurisdictionId: string;
  name: string;
  status: "active" | "inactive";
  boundary: Polygon;
  centroid: LngLat;
  createdAt: string;
  updatedAt: string;
};

export type WorkerType = "utility" | "delivery" | "cab";
export type WorkerStatus = "available" | "busy" | "offline";
export type Worker = {
  id: string;
  jurisdictionId: string;
  externalId: string;
  name: string;
  type: WorkerType;
  skills: string[];
  maxConcurrent: number | null;
  location: LngLat | null;
  status: WorkerStatus;
  createdAt: string;
  updatedAt: string;
};

export type Schedule = {
  id: string;
  workerId: string;
  dayOfWeek: number | null;
  date: string | null;
  startTime: string;
  endTime: string;
  type: "shift" | "timeoff";
  recurring: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrderPriorityTier = "critical" | "high" | "normal" | "low";
export type OrderState =
  | "created"
  | "queued"
  | "dispatched"
  | "accepted"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type Order = {
  id: string;
  jurisdictionId: string;
  externalId: string;
  type: string;
  priorityTier: OrderPriorityTier | null;
  payload: Record<string, unknown>;
  pickup: LngLat;
  state: OrderState;
  slaDueAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssignmentState =
  | "dispatched"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "expired"
  | "overridden";

export type PipelineTrace = {
  stages: Array<{ stage: "tier" | "scoring" | "tiebreak"; candidateCount: number }>;
  candidate: {
    tier?: { tier: OrderPriorityTier; minutesUntilDue: number | null; source: "explicit" | "computed" };
    scoring?: {
      distanceScore: number;
      skillScore: number;
      waitScore: number;
      weights: { distance: number; skillMatch: number; waitTime: number };
      score: number;
    };
    tiebreak?: { strategy: "fifo" | "round_robin" | "nearest"; tied: boolean };
  };
};

export type Assignment = {
  id: string;
  orderId: string;
  workerId: string;
  jurisdictionId: string;
  state: AssignmentState;
  source: "auto" | "manual";
  score: number | null;
  pipelineTrace: PipelineTrace | null;
  overriddenBy: string | null;
  overrideReason: string | null;
  dispatchedAt: string;
  respondedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export const ACTIVE_ASSIGNMENT_STATES: AssignmentState[] = ["dispatched", "accepted", "in_progress"];

export type SettingScope = "global" | "group" | "jurisdiction";
export type Setting = {
  id: string;
  scope: SettingScope;
  groupId: string | null;
  jurisdictionId: string | null;
  key: string;
  value: unknown;
  dataType: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PipelinePreset = "simple" | "balanced" | "advanced" | "custom";
export type StageDefinition =
  | { type: "tier"; enabled: boolean; config: { tiers: OrderPriorityTier[]; sla: Partial<Record<OrderPriorityTier, number>> } }
  | { type: "scoring"; enabled: boolean; config: { weights: { distance: number; skillMatch: number; waitTime: number } } }
  | { type: "tiebreak"; enabled: boolean; config: { strategy: "fifo" | "round_robin" | "nearest" } };

export type PipelineConfigView = {
  jurisdictionId: string;
  stored: boolean;
  preset: PipelinePreset | null;
  stages: StageDefinition[];
  enabled: boolean;
};

export type PresetCatalog = Record<"simple" | "balanced" | "advanced", StageDefinition[]>;

export type AuditEntity = "setting" | "pipeline_config" | "assignment";
export type AuditLog = {
  id: string;
  entity: AuditEntity;
  entityId: string;
  groupId: string | null;
  jurisdictionId: string | null;
  action: "create" | "update" | "delete" | "reassign" | "override" | "unassign";
  actor: string;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type MetricType = "counter" | "gauge" | "duration" | "rate";
export type MetricAggregation = "sum" | "avg" | "p95" | "max";
export type MetricDefinition = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  unit: string;
  type: MetricType;
  builtin: boolean;
  aggregation: MetricAggregation;
  jurisdictionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MetricQueryResult = {
  metric: string;
  aggregation: MetricAggregation;
  unit: string;
  rows: Array<{ bucket: string | null; value: number; count: number }>;
};

export type EngineHealthReport = {
  status: "ok" | "degraded";
  instances: Array<{ instanceId: string; state: "healthy" | "stopped"; lastHeartbeatAt: string; claimedInFlight: number }>;
  healthyCount: number;
  ts: string;
};

export type WebhookSource = {
  id: string;
  groupId: string;
  name: string;
  slug: string;
  secret?: string;
  allowedEvents: string[] | null;
  status: "active" | "disabled";
  lastReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WebhookEvent = {
  id: string;
  sourceId: string;
  groupId: string;
  eventType: string;
  dedupeKey: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  status: "received" | "processed" | "failed" | "skipped";
  targetEntity: "order" | "assignment" | "worker" | null;
  targetId: string | null;
  error: string | null;
  receivedAt: string;
  processedAt: string | null;
};

export const METRIC_KEYS = [
  "dispatch.response_time_ms",
  "dispatch.time_to_assign_ms",
  "assignment.duration_ms",
  "assignment.acceptance_rate",
  "assignment.rejection_rate",
  "assignment.manual_override_rate",
  "sla.compliance_rate",
  "dispatch.queue_depth",
  "worker.utilization",
  "worker.active_count",
  "worker.idle_count",
  "orders.created",
] as const;
